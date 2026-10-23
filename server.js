const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const Database = require('better-sqlite3');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'athletics.sqlite'));
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK(id=1), state_json TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS admins (id INTEGER PRIMARY KEY CHECK(id=1), password_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS integrations (id INTEGER PRIMARY KEY CHECK(id=1), refresh_token_enc TEXT NOT NULL, workbook_item_id TEXT, last_modified TEXT, last_sync_at TEXT, status TEXT NOT NULL DEFAULT 'connected', error TEXT, account_name TEXT);
CREATE TABLE IF NOT EXISTS google_sheet_sync (id INTEGER PRIMARY KEY CHECK(id=1), last_modified TEXT, last_sync_at TEXT, status TEXT NOT NULL DEFAULT 'not_configured', error TEXT);`);
const secret = process.env.SESSION_SECRET;
const adminPassword = process.env.ADMIN_PASSWORD;
if (!secret || secret.length < 32) { console.error('Set SESSION_SECRET to a random string of at least 32 characters.'); process.exit(1); }
if (!adminPassword || adminPassword.length < 8) { console.error('Set ADMIN_PASSWORD to a password of at least 8 characters.'); process.exit(1); }
const hash = bcrypt.hashSync(adminPassword, 12);
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed.json'), 'utf8'));
const existingState = db.prepare('SELECT id FROM app_state WHERE id=1').get();
if (!existingState) db.prepare('INSERT INTO app_state(id,state_json,updated_at) VALUES(1,?,?)').run(JSON.stringify(seed), new Date().toISOString());
// The configured environment password is the source of truth. Re-apply it on
// every start so an older persistent SQLite database cannot keep a stale hash
// after a redeploy or password correction.
db.prepare(`INSERT INTO admins(id,password_hash) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET password_hash=excluded.password_hash`).run(hash);

app.disable('x-powered-by');
app.set('trust proxy', 1);
// Credentialed CORS for a GitHub Pages frontend talking to the Render API.
// Set FRONTEND_ORIGIN to the exact frontend origin (scheme + hostname, no path).
const allowedFrontendOrigins = String(process.env.FRONTEND_ORIGIN || '').split(',').map(x=>x.trim()).filter(Boolean);
app.use((req,res,next)=>{
  const origin=req.headers.origin;
  const sameOrigin=origin && (()=>{try{return new URL(origin).host===req.get('host')}catch(e){return false}})();
  if(origin && (sameOrigin || allowedFrontendOrigins.includes(origin))){
    res.setHeader('Access-Control-Allow-Origin',origin);
    res.setHeader('Access-Control-Allow-Credentials','true');
    res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers','Content-Type');
    res.vary('Origin');
  }
  if(req.method==='OPTIONS'){
    if(origin && !(sameOrigin || allowedFrontendOrigins.includes(origin))) return res.status(403).end();
    return res.status(204).end();
  }
  next();
});
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '12mb' }));
app.use(cookieParser());
app.get('/api/health',(req,res)=>{
  try {
    db.prepare('SELECT 1').get();
    res.set('Cache-Control','no-store').json({ok:true,service:'athletics-portal',database:'connected'});
  } catch (error) {
    console.error('Health check failed:', error.message);
    res.status(503).json({ok:false,service:'athletics-portal',database:'error'});
  }
});
const sessions = new Map();
function authenticated(req,res,next){
  const token=req.cookies.at_session; const item=token&&sessions.get(token);
  if(!item || item.expires < Date.now()){ if(token)sessions.delete(token); return res.status(401).json({error:'Authentication required'}); }
  item.expires=Date.now()+8*60*60*1000; next();
}
app.use('/api/login', rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:true,legacyHeaders:false}));
app.post('/api/login', async (req,res)=>{
  const row=db.prepare('SELECT password_hash FROM admins WHERE id=1').get();
  if(!req.body || typeof req.body.password!=='string' || !bcrypt.compareSync(req.body.password,row.password_hash)) return res.status(401).json({error:'Invalid credentials'});
  const token=crypto.randomBytes(32).toString('hex'); sessions.set(token,{expires:Date.now()+8*60*60*1000});
  const requestOrigin=req.headers.origin;const crossOrigin=Boolean(requestOrigin && (()=>{try{return new URL(requestOrigin).host!==req.get('host')}catch(e){return true}})());
  res.cookie('at_session',token,{httpOnly:true,sameSite:crossOrigin?'none':'strict',secure:process.env.NODE_ENV==='production',maxAge:8*60*60*1000,path:'/'}).json({ok:true});
});
app.post('/api/logout',authenticated,(req,res)=>{sessions.delete(req.cookies.at_session);const requestOrigin=req.headers.origin;const crossOrigin=Boolean(requestOrigin && (()=>{try{return new URL(requestOrigin).host!==req.get('host')}catch(e){return true}})());res.clearCookie('at_session',{httpOnly:true,sameSite:crossOrigin?'none':'strict',secure:process.env.NODE_ENV==='production',path:'/'});res.json({ok:true});});
app.get('/api/state',(req,res)=>{
  const row=db.prepare('SELECT state_json,updated_at FROM app_state WHERE id=1').get();
  if(!row) return res.status(503).json({error:'Website data has not been initialized. Import the starter Excel workbook in the admin panel or use the initial website data.'});
  res.set('Cache-Control','no-store').json({state:JSON.parse(row.state_json),updatedAt:row.updated_at});
});
app.put('/api/state',authenticated,(req,res)=>{
  const state=req.body&&req.body.state;
  if(!state || typeof state!=='object' || Array.isArray(state) || !state.site || !Array.isArray(state.ath)) return res.status(400).json({error:'Invalid website state'});
  const json=JSON.stringify(state); if(Buffer.byteLength(json)>10*1024*1024)return res.status(413).json({error:'State is too large. Use image links or reduce photo sizes.'});
  const now=new Date().toISOString();
  db.prepare(`INSERT INTO app_state(id,state_json,updated_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json,updated_at=excluded.updated_at`).run(json,now);
  if (googleSheetsConfigured()) pushGoogleSheetState(state).catch(e=>console.error('Google Sheets push failed:',e.message));
  res.json({ok:true,updatedAt:now});
});
const EXCEL_TABS = {
  site: {name:'Site Settings', headers:['Setting','Value'], fields:['l1','l2','sub'], labels:{l1:'Headline line 1',l2:'Headline line 2',sub:'Subtitle'}},
  ath: {name:'Athletes', headers:['Athlete ID','Name','Department','Roll Number','Year','Category','Primary Event','Biography'], fields:['id','name','dept','roll','year','cat','pe','bio']},
  med: {name:'Medals', headers:['Competition','Medal','Event','Athlete / Team','Performance']},
  evt: {name:'Events', headers:['Status','Event Name','Date','Venue','Description']},
  qs: {name:'Qualifying Standards', headers:['Event','Type','Men Standard','Women Standard','Record']},
  heat: {name:'Heat Schedule', headers:['Competition','Heat / Event','Time','Lanes / Participants']},
  sch: {name:'Training Plan', headers:['Day','Focus','Morning Session','Evening Session']},
  gal: {name:'Gallery', headers:['Title','Competition / Event','Category']},
  coach: {name:'Coaches', headers:['Name','Role','Specialty','Qualifications / Experience','Contact']},
  alum: {name:'Alumni', headers:['Name','Batch','Event','Personal Best','Achievements','Current Role']}
};
const excelCellText = cell => {
  const v = cell && cell.value;
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0,10);
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map(x=>x.text||'').join('');
    if (v.text != null) return String(v.text);
    if (v.result != null) return String(v.result);
  }
  return String(v);
};
function styleSheet(ws) {
  ws.views = [{state:'frozen', ySplit:1}];
  ws.getRow(1).font = {bold:true,color:{argb:'FFFFFFFF'}};
  ws.getRow(1).fill = {type:'pattern',pattern:'solid',fgColor:{argb:'FF7F1D1D'}};
  ws.getRow(1).alignment = {vertical:'middle',wrapText:true};
  ws.autoFilter = {from:{row:1,column:1},to:{row:Math.max(1,ws.rowCount),column:Math.max(1,ws.columnCount)}};
  ws.columns.forEach(c=>{c.width=Math.min(48,Math.max(c.width||12,16)); c.alignment={vertical:'top',wrapText:true};});
}
function stateToWorkbook(state, wb) {
  wb.creator='IIT (BHU) Athletics Portal';
  for (const [key, spec] of Object.entries(EXCEL_TABS)) {
    const ws=wb.addWorksheet(spec.name);
    ws.addRow(spec.headers);
    if(key==='site') for(const field of spec.fields) ws.addRow([spec.labels?.[field] || field, state.site?.[field] ?? '']);
    else if(key==='ath') for(const a of (state.ath||[])) ws.addRow(spec.fields.map(f=>a[f]??''));
    else for(const item of (state[key]||[])) ws.addRow(item);
    styleSheet(ws);
  }
  const ticker=wb.addWorksheet('Ticker Messages');
  ticker.addRow(['Order','Message']);
  (state.site?.tick||[]).forEach((message,i)=>ticker.addRow([i+1,message])); styleSheet(ticker);
  const records=wb.addWorksheet('Athlete Records');
  records.addRow(['Athlete ID','Event','Personal Best','Competition','Previous Best']);
  for(const a of (state.ath||[])) for(const rec of (a.rec||[])) records.addRow([a.id,...rec]);
  styleSheet(records);
  const readme=wb.addWorksheet('README');
  readme.addRows([
    ['IIT (BHU) Athletics — easy-edit workbook'],
    ['Each website data category has its own worksheet. Edit the rows in the relevant tab.'],
    ['Site Settings: Setting keys must remain l1, l2, or sub. Edit values in column B.'],
    ['Ticker Messages: edit messages; Order controls their display order.'],
    ['Athletes: Athlete ID must be unique. Athlete Records rows connect by Athlete ID.'],
    ['Do not rename worksheet tabs or change column headers. Remove unused data rows rather than leaving partial rows.'],
    ['The website syncs from OneDrive to the website (one-way) about every 60 seconds after Excel Online saves.'],
    ['The workbook replaces the full website data on sync. Keep a backup before making large edits.'],
    ['Updated at',new Date().toISOString()]
  ]);
  readme.getColumn(1).width=100; readme.getColumn(2).width=70; readme.getColumn(1).alignment={wrapText:true};
  return wb;
}
function worksheetRows(ws, width) {
  const out=[];
  ws.eachRow((row,n)=>{
    if(n===1)return;
    const vals=Array.from({length:width},(_,i)=>excelCellText(row.getCell(i+1)));
    if(vals.every(v=>v.trim()===''))return;
    out.push(vals);
  });
  return out;
}
function workbookToState(wb) {
  const legacy=wb.getWorksheet('Website Data');
  if(legacy) {
    const state={};
    legacy.eachRow((row,n)=>{if(n===1)return;const section=excelCellText(row.getCell(1)).trim();const raw=excelCellText(row.getCell(2));if(!section||!raw)return;try{state[section]=JSON.parse(raw)}catch{throw new Error(`Invalid JSON in Excel row ${n} (${section}).`)} });
    if(!state.site||!Array.isArray(state.ath))throw new Error('Workbook must include site and ath sections.');
    return state;
  }
  const getTab=key=>wb.getWorksheet(EXCEL_TABS[key].name);
  const siteWs=getTab('site');
  if(!siteWs) throw new Error('Missing worksheet "Site Settings". Use the easy-edit workbook template.');
  const siteValues={};
  for(const [key,value] of worksheetRows(siteWs,2)) {
    const settingMap={'l1':'l1','l2':'l2','sub':'sub','Headline line 1':'l1','Headline line 2':'l2','Subtitle':'sub'};
    if(!settingMap[key]) throw new Error(`Unknown Site Settings setting: ${key}. Keep the supplied setting labels.`);
    siteValues[settingMap[key]]=value;
  }
  const state={site:{...siteValues,tick:[]},ath:[]};
  const ticker=wb.getWorksheet('Ticker Messages');
  if(ticker) state.site.tick=worksheetRows(ticker,2).map(r=>({order:Number(r[0])||0,message:r[1]})).sort((a,b)=>a.order-b.order).map(r=>r.message).filter(Boolean);
  const athletesWs=getTab('ath');
  if(!athletesWs) throw new Error('Missing worksheet "Athletes".');
  state.ath=worksheetRows(athletesWs,EXCEL_TABS.ath.fields.length).map(r=>Object.fromEntries(EXCEL_TABS.ath.fields.map((f,i)=>[f,r[i]])));
  const byId=new Map();
  for(const a of state.ath){if(!a.id)throw new Error('Every athlete row needs an Athlete ID.');if(byId.has(a.id))throw new Error(`Duplicate Athlete ID: ${a.id}`);a.rec=[];byId.set(a.id,a);}
  const records=wb.getWorksheet('Athlete Records');
  if(records) for(const r of worksheetRows(records,5)){const athlete=byId.get(r[0]);if(!athlete)throw new Error(`Athlete Records references unknown Athlete ID: ${r[0]}`);athlete.rec.push(r.slice(1));}
  for(const key of Object.keys(EXCEL_TABS)) {
    if(key==='site'||key==='ath')continue;
    const spec=EXCEL_TABS[key], ws=getTab(key);
    if(!ws) throw new Error(`Missing worksheet "${spec.name}".`);
    state[key]=worksheetRows(ws,spec.headers.length);
  }
  if(!state.site.l1||!state.site.l2||!state.ath.length) throw new Error('Site Settings and Athletes must contain website data.');
  return state;
}
// Fields that exist on the website but have no column in the easy-edit workbook
// (photos, achievements, leadership role, course length, countdown, gallery images).
// Carry them over from the current state so an Excel import never wipes them.
function preserveExtras(next, prev) {
  if (!prev || typeof prev !== 'object') return next;
  const out = next;
  for (const k of ['cd','cdl','sess']) if (out.site[k] === undefined && prev.site && prev.site[k] !== undefined) out.site[k] = prev.site[k];
  const prevAth = new Map((prev.ath||[]).map(a=>[String(a.id),a]));
  for (const a of out.ath) {
    const old = prevAth.get(String(a.id)); if (!old) continue;
    for (const k of Object.keys(old)) if (!(k in a) || a[k] === undefined) a[k] = old[k];
  }
  if (Array.isArray(out.gal) && Array.isArray(prev.gal)) {
    for (const g of out.gal) {
      const old = prev.gal.find(x => x[0] === g[0] && x[1] === g[1]);
      if (old && old.length > 3 && g.length <= 3) for (let i = 3; i < old.length; i++) g[i] = old[i];
    }
  }
  return out;
}
function currentState(){ const r=db.prepare('SELECT state_json FROM app_state WHERE id=1').get(); try{return r&&JSON.parse(r.state_json)}catch{return null} }
app.get('/api/export.xlsx',authenticated,async(req,res)=>{
  const row=db.prepare('SELECT state_json,updated_at FROM app_state WHERE id=1').get();
  if(!row)return res.status(404).json({error:'No server data yet'});
  const wb=stateToWorkbook(JSON.parse(row.state_json),new ExcelJS.Workbook());
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition','attachment; filename="athletics-website-data.xlsx"');
  await wb.xlsx.write(res); res.end();
});
app.post('/api/import.xlsx',authenticated,async(req,res)=>{
  try{
    const raw=req.body&&req.body.fileBase64;
    if(typeof raw!=='string'||raw.length>14*1024*1024)return res.status(400).json({error:'Upload an Excel file smaller than 10 MB'});
    const buf=Buffer.from(raw,'base64'), wb=new ExcelJS.Workbook(); await wb.xlsx.load(buf);
    const state=preserveExtras(workbookToState(wb),currentState()), json=JSON.stringify(state);
    if(Buffer.byteLength(json)>10*1024*1024)return res.status(413).json({error:'State is too large.'});
    const now=new Date().toISOString();
    db.prepare(`INSERT INTO app_state(id,state_json,updated_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json,updated_at=excluded.updated_at`).run(json,now);
    if (googleSheetsConfigured()) pushGoogleSheetState(state).catch(e=>console.error('Google Sheets push failed:',e.message));
    res.json({ok:true,updatedAt:now,sections:Object.keys(state).length});
  }catch(e){res.status(400).json({error:e.message||'Could not read Excel workbook'});}
});

// Microsoft OneDrive / Excel Online integration. The workbook is read-only from this
// service: edits in Excel Online flow into the website on the polling interval.
const ONEDRIVE_CLIENT_ID = process.env.ONEDRIVE_CLIENT_ID || '';
const ONEDRIVE_CLIENT_SECRET = process.env.ONEDRIVE_CLIENT_SECRET || '';
const ONEDRIVE_TENANT = process.env.ONEDRIVE_TENANT || 'common';
const ONEDRIVE_WORKBOOK_NAME = process.env.ONEDRIVE_WORKBOOK_NAME || 'athletics-website-data.xlsx';
const ONEDRIVE_POLL_MS = Math.max(30000, Number(process.env.ONEDRIVE_POLL_MS) || 60000);
const GOOGLE_SHEETS_WEBAPP_URL = process.env.GOOGLE_SHEETS_WEBAPP_URL || '';
const GOOGLE_SHEETS_TOKEN = process.env.GOOGLE_SHEETS_TOKEN || '';
const GOOGLE_SHEETS_POLL_MS = Math.max(15000, Number(process.env.GOOGLE_SHEETS_POLL_MS) || 30000);
const oauthStates = new Map();
let syncPromise = null;
const integrationRow = () => db.prepare('SELECT * FROM integrations WHERE id=1').get();
function tokenKey(){ return crypto.createHash('sha256').update(secret).digest(); }
function encryptToken(value){
  const iv=crypto.randomBytes(12), cipher=crypto.createCipheriv('aes-256-gcm',tokenKey(),iv);
  const enc=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
  return [iv.toString('base64'),cipher.getAuthTag().toString('base64'),enc.toString('base64')].join('.');
}
function decryptToken(value){
  const [iv,tag,enc]=String(value).split('.');
  const decipher=crypto.createDecipheriv('aes-256-gcm',tokenKey(),Buffer.from(iv,'base64'));
  decipher.setAuthTag(Buffer.from(tag,'base64'));
  return Buffer.concat([decipher.update(Buffer.from(enc,'base64')),decipher.final()]).toString('utf8');
}
function redirectUri(req){
  const base=(process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/,'');
  return `${base}/api/onedrive/callback`;
}
function microsoftConfigured(){ return Boolean(ONEDRIVE_CLIENT_ID && ONEDRIVE_CLIENT_SECRET); }
async function graphToken(){
  const row=integrationRow(); if(!row) throw new Error('OneDrive is not connected. Choose Connect OneDrive in the admin page first.');
  const refreshToken=decryptToken(row.refresh_token_enc);
  const body=new URLSearchParams({client_id:ONEDRIVE_CLIENT_ID,client_secret:ONEDRIVE_CLIENT_SECRET,grant_type:'refresh_token',refresh_token:refreshToken,scope:'offline_access User.Read Files.Read'});
  const response=await fetch(`https://login.microsoftonline.com/${encodeURIComponent(ONEDRIVE_TENANT)}/oauth2/v2.0/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(payload.error_description || payload.error || 'Microsoft sign-in expired. Reconnect OneDrive from the admin page.');
  if(payload.refresh_token) db.prepare('UPDATE integrations SET refresh_token_enc=? WHERE id=1').run(encryptToken(payload.refresh_token));
  return payload.access_token;
}
async function graphGet(url, token, options={}){
  const response=await fetch(url,{...options,headers:{Authorization:`Bearer ${token}`,...(options.headers||{})}});
  if(!response.ok){const body=await response.text().catch(()=> '');throw new Error(`Microsoft Graph request failed (${response.status})${body?`: ${body.slice(0,240)}`:''}`);}
  return response;
}
async function locateWorkbook(token){
  let url='https://graph.microsoft.com/v1.0/me/drive/root/children?$select=id,name,lastModifiedDateTime,eTag,file&$top=200';
  for(let page=0;url && page<10;page++){
    const r=await graphGet(url,token); const data=await r.json();
    const match=(data.value||[]).find(x=>x.name===ONEDRIVE_WORKBOOK_NAME && x.file);
    if(match)return match; url=data['@odata.nextLink']||null;
  }
  throw new Error(`Could not find ${ONEDRIVE_WORKBOOK_NAME} in the root of your OneDrive. Upload the website workbook there using that exact filename.`);
}
async function stateFromWorkbook(buffer){
  const wb=new ExcelJS.Workbook(); await wb.xlsx.load(buffer);
  const state=preserveExtras(workbookToState(wb),currentState());
  const json=JSON.stringify(state); if(Buffer.byteLength(json)>10*1024*1024)throw new Error('Workbook data is larger than the 10 MB website state limit.');
  return {state,sections:Object.keys(state).length};
}
async function syncOneDrive(force=false){
  if(syncPromise)return syncPromise;
  syncPromise=(async()=>{
    const row=integrationRow(); if(!row)throw new Error('Connect OneDrive first.');
    try{
      const token=await graphToken();
      let file;
      if(row.workbook_item_id){
        try{const r=await graphGet(`https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(row.workbook_item_id)}?$select=id,name,lastModifiedDateTime,eTag,file`,token);file=await r.json();}
        catch{file=await locateWorkbook(token);}
      } else file=await locateWorkbook(token);
      if(!force && row.last_modified && file.lastModifiedDateTime && new Date(file.lastModifiedDateTime)<=new Date(row.last_modified)){
        db.prepare("UPDATE integrations SET status='connected',error=NULL,workbook_item_id=? WHERE id=1").run(file.id);
        return {ok:true,changed:false,lastSyncAt:row.last_sync_at,lastModified:file.lastModifiedDateTime};
      }
      const download=await graphGet(`https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(file.id)}/content`,token);
      const buffer=Buffer.from(await download.arrayBuffer());
      if(buffer.length>10*1024*1024)throw new Error('Excel workbook exceeds the 10 MB sync limit.');
      const parsed=await stateFromWorkbook(buffer);
      const now=new Date().toISOString();
      db.transaction(()=>{
        db.prepare(`INSERT INTO app_state(id,state_json,updated_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json,updated_at=excluded.updated_at`).run(JSON.stringify(parsed.state),now);
        db.prepare("UPDATE integrations SET workbook_item_id=?,last_modified=?,last_sync_at=?,status='connected',error=NULL WHERE id=1").run(file.id,file.lastModifiedDateTime||now,now);
      })();
      console.log(`OneDrive sync imported ${parsed.sections} sections from ${file.name}`);
      return {ok:true,changed:true,sections:parsed.sections,lastSyncAt:now,lastModified:file.lastModifiedDateTime||now};
    }catch(error){
      db.prepare("UPDATE integrations SET status='error',error=? WHERE id=1").run(String(error.message||error).slice(0,1000));
      throw error;
    }
  })();
  try{return await syncPromise;}finally{syncPromise=null;}
}
app.get('/api/onedrive/connect',authenticated,(req,res)=>{
  if(!microsoftConfigured())return res.status(503).send('OneDrive integration is not configured yet. Set ONEDRIVE_CLIENT_ID, ONEDRIVE_CLIENT_SECRET, and APP_BASE_URL in the service environment. See README.md.');
  const state=crypto.randomBytes(24).toString('hex'); oauthStates.set(state,{expires:Date.now()+10*60*1000,redirectUri:redirectUri(req)});
  const authUrl=new URL(`https://login.microsoftonline.com/${encodeURIComponent(ONEDRIVE_TENANT)}/oauth2/v2.0/authorize`);
  authUrl.searchParams.set('client_id',ONEDRIVE_CLIENT_ID);authUrl.searchParams.set('response_type','code');authUrl.searchParams.set('redirect_uri',redirectUri(req));
  authUrl.searchParams.set('response_mode','query');authUrl.searchParams.set('scope','offline_access User.Read Files.Read');authUrl.searchParams.set('state',state);
  res.redirect(authUrl.toString());
});
app.get('/api/onedrive/callback',async(req,res)=>{
  const state=String(req.query.state||''),saved=oauthStates.get(state);oauthStates.delete(state);
  if(!saved||saved.expires<Date.now())return res.status(400).send('OneDrive authorization expired or could not be verified. Return to the website admin page and connect again.');
  if(req.query.error)return res.status(400).send(`Microsoft authorization failed: ${String(req.query.error_description||req.query.error).slice(0,500)}. Return to the website admin page and try again.`);
  if(!microsoftConfigured()||typeof req.query.code!=='string')return res.status(400).send('Microsoft did not return an authorization code. Check the app registration redirect URI.');
  try{
    const body=new URLSearchParams({client_id:ONEDRIVE_CLIENT_ID,client_secret:ONEDRIVE_CLIENT_SECRET,grant_type:'authorization_code',code:req.query.code,redirect_uri:saved.redirectUri,scope:'offline_access User.Read Files.Read'});
    const tokenResponse=await fetch(`https://login.microsoftonline.com/${encodeURIComponent(ONEDRIVE_TENANT)}/oauth2/v2.0/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
    const token=await tokenResponse.json();if(!tokenResponse.ok)throw new Error(token.error_description||token.error||'Could not obtain Microsoft access token');if(!token.refresh_token)throw new Error('Microsoft did not return a refresh token. Ensure offline_access is requested and re-consent to the app.');
    let accountName='Connected Microsoft account';
    try{const me=await fetch('https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName',{headers:{Authorization:`Bearer ${token.access_token}`}});if(me.ok){const m=await me.json();accountName=m.displayName||m.mail||m.userPrincipalName||accountName;}}catch{}
    db.prepare(`INSERT INTO integrations(id,refresh_token_enc,workbook_item_id,last_modified,last_sync_at,status,error,account_name) VALUES(1,?,NULL,NULL,NULL,'connected',NULL,?) ON CONFLICT(id) DO UPDATE SET refresh_token_enc=excluded.refresh_token_enc,workbook_item_id=NULL,last_modified=NULL,last_sync_at=NULL,status='connected',error=NULL,account_name=excluded.account_name`).run(encryptToken(token.refresh_token),accountName);
    let message='OneDrive connected.';
    try{await syncOneDrive(true);message='OneDrive connected and the workbook has been synced to the website.';}catch(e){message=`OneDrive connected, but initial sync needs attention: ${e.message}`;}
    res.status(200).send(`<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OneDrive connection</title><body style="font:16px system-ui;max-width:680px;margin:12vh auto;padding:24px;line-height:1.6"><h1>${message.startsWith('OneDrive connected and')?'Sync complete':'OneDrive connection status'}</h1><p>${message.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p><p>Return to your athletics website and open Admin → OneDrive status to check synchronization.</p><p><a href="/">Return to website</a></p></body></html>`);
  }catch(e){res.status(500).send(`Could not finish OneDrive setup: ${String(e.message||e).replace(/</g,'&lt;').slice(0,1000)}. Return to the website and try connecting again.`);}
});
app.get('/api/onedrive/status',authenticated,(req,res)=>{
  const row=integrationRow();
  res.set('Cache-Control','no-store').json({configured:microsoftConfigured(),connected:Boolean(row),workbookName:ONEDRIVE_WORKBOOK_NAME,pollMs:ONEDRIVE_POLL_MS,accountName:row?.account_name||null,status:row?.status||'not_connected',lastSyncAt:row?.last_sync_at||null,lastModified:row?.last_modified||null,error:row?.error||null});
});
app.post('/api/onedrive/sync',authenticated,async(req,res)=>{
  try{const result=await syncOneDrive(true);res.json(result);}catch(e){res.status(400).json({error:e.message||'OneDrive sync failed'});}
});
app.post('/api/onedrive/disconnect',authenticated,(req,res)=>{db.prepare('DELETE FROM integrations WHERE id=1').run();res.json({ok:true});});
setInterval(()=>{if(integrationRow())syncOneDrive(false).catch(e=>console.error('Scheduled OneDrive sync failed:',e.message));},ONEDRIVE_POLL_MS).unref();

// Google Sheets bridge. A bound Apps Script web app reads and writes the target spreadsheet;
// secrets remain server-side. Sheet edits are polled into the site, admin edits are pushed out.
const googleSyncRow = () => db.prepare('SELECT * FROM google_sheet_sync WHERE id=1').get();
function googleSheetsConfigured(){ return Boolean(GOOGLE_SHEETS_WEBAPP_URL && GOOGLE_SHEETS_TOKEN && GOOGLE_SHEETS_WEBAPP_URL.startsWith('https://script.google.com/macros/s/')); }
function updateGoogleStatus(fields){
  const current=googleSyncRow()||{};
  const row={last_modified:fields.last_modified===undefined?current.last_modified:fields.last_modified,
    last_sync_at:fields.last_sync_at===undefined?current.last_sync_at:fields.last_sync_at,
    status:fields.status||current.status||'connected',error:fields.error===undefined?current.error:fields.error};
  db.prepare(`INSERT INTO google_sheet_sync(id,last_modified,last_sync_at,status,error) VALUES(1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET last_modified=excluded.last_modified,last_sync_at=excluded.last_sync_at,status=excluded.status,error=excluded.error`).run(row.last_modified||null,row.last_sync_at||null,row.status,row.error||null);
}
async function googleSheetsRequest(method, body){
  const url=new URL(GOOGLE_SHEETS_WEBAPP_URL);
  const requestBody={...(body||{}),token:GOOGLE_SHEETS_TOKEN};
  const response=await fetch(url.toString(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(requestBody),redirect:'follow'});
  const responsePayload=await response.json().catch(()=>({}));
  if(!response.ok||responsePayload.ok===false)throw new Error(responsePayload.error||`Google Sheets bridge returned HTTP ${response.status}`);
  return responsePayload;
}
async function pushGoogleSheetState(state){
  if(!googleSheetsConfigured()){updateGoogleStatus({status:'not_configured',error:'Set GOOGLE_SHEETS_WEBAPP_URL and GOOGLE_SHEETS_TOKEN in the server environment.'});return {ok:false,configured:false};}
  try{const result=await googleSheetsRequest('POST',{state});const now=new Date().toISOString();updateGoogleStatus({last_modified:result.updatedAt||now,last_sync_at:now,status:'connected',error:null});return {ok:true,updatedAt:result.updatedAt||now};}
  catch(error){updateGoogleStatus({status:'error',error:String(error.message||error).slice(0,1000)});throw error;}
}
let googleSyncPromise=null;
async function syncGoogleSheets(force=false){
  if(!googleSheetsConfigured())return {ok:false,configured:false};
  if(googleSyncPromise)return googleSyncPromise;
  googleSyncPromise=(async()=>{
    try{
      const remote=await googleSheetsRequest('POST',{action:'read'});
      if(!remote.initialized||!remote.state){
        if(remote.needsSetup)throw new Error('Your spreadsheet already has athletics-related tabs but is missing required tabs or has an incomplete layout. No data was overwritten. Back up the sheet, then align it with GOOGLE_SHEETS_SETUP.md and deploy the latest Apps Script.');
        const row=db.prepare('SELECT state_json FROM app_state WHERE id=1').get();
        if(!row)throw new Error('Website state is not initialized.');
        return await pushGoogleSheetState(JSON.parse(row.state_json));
      }
      const local=googleSyncRow();
      const remoteStamp=remote.updatedAt||'';
      if(!force && local?.last_modified && remoteStamp && new Date(remoteStamp)<=new Date(local.last_modified)){
        updateGoogleStatus({status:'connected',error:null});return {ok:true,changed:false,lastSyncAt:local.last_sync_at};
      }
      const state=remote.state;
      if(!state.site||!Array.isArray(state.ath))throw new Error('The Google Sheet does not contain valid website data. Check the Apps Script template and tab headers.');
      const json=JSON.stringify(state);if(Buffer.byteLength(json)>10*1024*1024)throw new Error('Google Sheets data exceeds the 10 MB website state limit.');
      const now=new Date().toISOString();
      db.prepare(`INSERT INTO app_state(id,state_json,updated_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json,updated_at=excluded.updated_at`).run(json,now);
      updateGoogleStatus({last_modified:remoteStamp||now,last_sync_at:now,status:'connected',error:null});
      console.log('Google Sheets sync imported website data.');
      return {ok:true,changed:true,updatedAt:now,lastSyncAt:now};
    }catch(error){updateGoogleStatus({status:'error',error:String(error.message||error).slice(0,1000)});throw error;}
  })();
  try{return await googleSyncPromise;}finally{googleSyncPromise=null;}
}
app.get('/api/google-sheets/status',authenticated,(req,res)=>{
  const row=googleSyncRow();
  res.set('Cache-Control','no-store').json({configured:googleSheetsConfigured(),sheetId:'1ZcpDbdYuA-MgUfAervLSqJWoiX0bCK5mQhVxDNoQRv0',pollMs:GOOGLE_SHEETS_POLL_MS,status:row?.status||(googleSheetsConfigured()?'pending':'not_configured'),lastSyncAt:row?.last_sync_at||null,lastModified:row?.last_modified||null,error:row?.error||null});
});
app.post('/api/google-sheets/sync',authenticated,async(req,res)=>{
  try{const result=await syncGoogleSheets(true);res.json(result);}catch(e){res.status(400).json({error:e.message||'Google Sheets sync failed'});}
});
setInterval(()=>{if(googleSheetsConfigured())syncGoogleSheets(false).catch(e=>console.error('Scheduled Google Sheets sync failed:',e.message));},GOOGLE_SHEETS_POLL_MS).unref();

app.use(express.static(path.join(__dirname,'public'),{extensions:['html']}));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`Athletics portal listening on port ${PORT}`));
