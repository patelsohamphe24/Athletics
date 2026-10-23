/**
 * IIT (BHU) Athletics Portal — Google Sheets two-way sync bridge.
 * Bind this script to the target spreadsheet (Extensions → Apps Script).
 * Set SYNC_TOKEN to the same 32+ character secret as GOOGLE_SHEETS_TOKEN.
 * Deploy as a Web app, Execute as: Me, access: Anyone. The shared token is required.
 */
const SPREADSHEET_ID = '1ZcpDbdYuA-MgUfAervLSqJWoiX0bCK5mQhVxDNoQRv0';
const SYNC_TOKEN = 'REPLACE_WITH_A_LONG_RANDOM_SECRET_AT_LEAST_32_CHARACTERS';
const CHUNK_SIZE = 40000; // Under Google Sheets' 50,000-character cell limit.
const TAB = {
  site: {name:'Site Settings', headers:['Setting','Value']},
  ath: {name:'Athletes', headers:['Athlete ID','Name','Department','Roll Number','Year','Category','Primary Event','Biography','Leadership Role','Course Length','Graduated','Photo URL (optional)','Achievements JSON']},
  med: {name:'Medals', headers:['Competition','Medal','Event','Athlete / Team','Performance']},
  evt: {name:'Events', headers:['Status','Event Name','Date','Venue','Description']},
  qs: {name:'Qualifying Standards', headers:['Event','Type','Men Standard','Women Standard','Record']},
  heat: {name:'Heat Schedule', headers:['Competition','Heat / Event','Time','Lanes / Participants']},
  sch: {name:'Training Plan', headers:['Day','Focus','Morning Session','Evening Session']},
  gal: {name:'Gallery', headers:['Title','Competition / Event','Category','Image URL (optional)']},
  coach: {name:'Coaches', headers:['Name','Role','Specialty','Qualifications / Experience','Contact']},
  alum: {name:'Alumni', headers:['Name','Batch','Event','Personal Best','Achievements','Current Role']}
};
const TICKER_HEADERS = ['Order','Message'];
const RECORD_HEADERS = ['Athlete ID','Event','Personal Best','Competition','Previous Best'];
const BACKUP_HEADERS = ['Chunk','JSON fragment'];

function doGet(e) {
  if (!authorized_(e && e.parameter && e.parameter.token)) return json_({ok:false,error:'Unauthorized'});
  try { return json_(readResponse_()); }
  catch (err) { return json_({ok:false,error:String(err.message || err)}); }
}
function doPost(e) {
  let body = {};
  try { body = JSON.parse(e && e.postData && e.postData.contents || '{}'); } catch (_) {}
  if (!authorized_(body.token)) return json_({ok:false,error:'Unauthorized'});
  try {
    if (body.action === 'read') return json_(readResponse_());
    if (!body.state || !body.state.site || !Array.isArray(body.state.ath)) throw new Error('Invalid website state payload.');
    writeState_(body.state);
    const stamp = new Date().toISOString();
    PropertiesService.getScriptProperties().setProperty('SHEET_UPDATED_AT', stamp);
    PropertiesService.getScriptProperties().setProperty('LAST_SERVER_PUSH_AT', stamp);
    return json_({ok:true,updatedAt:stamp});
  } catch (err) { return json_({ok:false,error:String(err.message || err)}); }
}
function readResponse_() {
  const result = readState_();
  return {ok:true, initialized:result.initialized, needsSetup:!!result.needsSetup,
    state:result.state || null,
    updatedAt:PropertiesService.getScriptProperties().getProperty('SHEET_UPDATED_AT') || ''};
}
function onEdit(e) {
  if (!e || !e.range) return;
  const name = e.range.getSheet().getName();
  if (name === 'State Backup') return;
  PropertiesService.getScriptProperties().setProperty('SHEET_UPDATED_AT', new Date().toISOString());
}
function setupSyncBridge() {
  const ss = spreadsheet_();
  if (!ss) throw new Error('Could not open the configured target spreadsheet. Check its ID and Google account permissions.');
  PropertiesService.getScriptProperties().setProperty('SHEET_UPDATED_AT', new Date().toISOString());
  return 'Bridge ready for deployment: ' + ss.getName();
}
function spreadsheet_() { return SpreadsheetApp.openById(SPREADSHEET_ID); }
function authorized_(candidate) { return !!SYNC_TOKEN && SYNC_TOKEN.indexOf('REPLACE_WITH_') !== 0 && candidate === SYNC_TOKEN; }
function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

function getSheet_(name, headers) {
  const sh = spreadsheet_().getSheetByName(name);
  if (!sh) return null;
  if (sh.getLastRow() === 0) throw new Error('The tab "' + name + '" exists but has no header row. Add the exact headers from GOOGLE_SHEETS_SETUP.md; no data was changed.');
  const existing = sh.getRange(1,1,1,headers.length).getDisplayValues()[0];
  if (!headers.every((h,i) => String(existing[i] || '').trim() === h))
    throw new Error('The tab "' + name + '" has different column headers. Back it up and align row 1 with: ' + headers.join(' | ') + '. No data was changed.');
  return sh;
}
function readRows_(name, headers) {
  const sh = getSheet_(name, headers);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2,1,sh.getLastRow()-1,headers.length).getDisplayValues()
    .filter(row => row.some(v => String(v).trim() !== ''));
}
function readBackupState_() {
  const rawSheet = spreadsheet_().getSheetByName('State Backup');
  if (!rawSheet || rawSheet.getLastRow() === 0) return null;
  const sh = getSheet_('State Backup', BACKUP_HEADERS);
  if (sh.getLastRow() < 2) return null;
  const rows = sh.getRange(2,1,sh.getLastRow()-1,2).getDisplayValues().filter(r => r[1] !== '');
  rows.sort((a,b)=>(Number(a[0])||0)-(Number(b[0])||0));
  try { return JSON.parse(rows.map(r=>r[1]).join('')); }
  catch (_) { throw new Error('State Backup JSON is invalid. Do not edit this tab manually; restore it from a backup or run a successful admin-to-sheet sync.'); }
}
function readState_() {
  const ss = spreadsheet_();
  const required = Object.values(TAB).map(t => t.name).concat(['Ticker Messages','Athlete Records']);
  const missingCore = ['Site Settings','Athletes'].filter(n => !ss.getSheetByName(n));
  if (missingCore.length) {
    const hasRelevant = required.some(n => ss.getSheetByName(n));
    return {initialized:false,needsSetup:hasRelevant};
  }
  const missingTabs = required.filter(n => !ss.getSheetByName(n));
  if (missingTabs.length) return {initialized:false,needsSetup:true,missingTabs};
  // Keep fields that don't fit naturally in a tab (uploaded image data, image metadata,
  // custom athlete fields) in chunked JSON, then overlay all spreadsheet-editable fields.
  const base = readBackupState_() || {site:{},ath:[]};
  if (!base.site || typeof base.site !== 'object') base.site = {};
  const setting = {...base.site};
  readRows_(TAB.site.name,TAB.site.headers).forEach(r => {
    const k=String(r[0]).trim(), v=String(r[1] || '');
    const aliases={'Headline line 1':'l1','Headline line 2':'l2','Subtitle':'sub'};
    const key=aliases[k]||k;
    if (['l1','l2','sub','cd','cdl','sess'].includes(key)) setting[key]=v;
  });
  setting.tick = readRows_('Ticker Messages',TICKER_HEADERS).sort((a,b)=>(Number(a[0])||0)-(Number(b[0])||0)).map(r=>r[1]).filter(Boolean);
  const priorAth = new Map((Array.isArray(base.ath)?base.ath:[]).map(a=>[String(a.id),a]));
  const athletes = readRows_(TAB.ath.name,TAB.ath.headers).map(r=>{
    const old=priorAth.get(String(r[0]))||{};
    let achievements=old.ach||[];
    if (r[12]) { try { achievements=JSON.parse(r[12]); if(!Array.isArray(achievements)) throw new Error(); } catch (_) { throw new Error('Invalid Achievements JSON for athlete '+r[0]+'. Use a JSON array or leave the cell blank.'); } }
    return {...old,id:r[0],name:r[1],dept:r[2],roll:r[3],year:r[4],cat:r[5],pe:r[6],bio:r[7],role:r[8]||'',dur:Number(r[9])||old.dur||4,grad:/^(true|yes|1)$/i.test(r[10]),img:r[11] ? r[11] : (old.img||''),ach:achievements,rec:[]};
  });
  const byId=new Map();
  athletes.forEach(a=>{if(!a.id)throw new Error('Every athlete row needs a unique Athlete ID.');if(byId.has(a.id))throw new Error('Duplicate Athlete ID: '+a.id);byId.set(a.id,a);});
  readRows_('Athlete Records',RECORD_HEADERS).forEach(r=>{const a=byId.get(r[0]);if(!a)throw new Error('Athlete Records references unknown Athlete ID: '+r[0]);a.rec.push(r.slice(1));});
  const state={...base,site:setting,ath:athletes};
  for (const key of Object.keys(TAB)) {
    if (key==='site'||key==='ath') continue;
    const spec=TAB[key];
    const rows=readRows_(spec.name,spec.headers);
    if (key==='gal') {
      const prior=Array.isArray(base.gal)?base.gal:[];
      const oldByTitle=new Map(prior.map(g=>[String(g[0])+'\u0000'+String(g[1])+'\u0000'+String(g[2]),g]));
      state.gal=rows.map(r=>{const old=oldByTitle.get(String(r[0])+'\u0000'+String(r[1])+'\u0000'+String(r[2]))||[];return [r[0],r[1],r[2],r[3]||old[3]||''];});
    } else state[key]=rows;
  }
  if (!ss.getSheetByName('Athlete Records')) athletes.forEach(a=>{a.rec=a.rec||[];});
  return {initialized:true,state};
}
function writeTab_(name, headers, rows) {
  const ss=spreadsheet_();
  let sh=ss.getSheetByName(name);
  if (!sh) sh=ss.insertSheet(name);
  if (sh.getLastRow()>0) {
    const current=sh.getRange(1,1,1,headers.length).getDisplayValues()[0];
    const hasAny=current.some(v=>String(v).trim()!=='');
    const matches=headers.every((h,i)=>String(current[i]||'').trim()===h);
    if (hasAny&&!matches) throw new Error('The tab "'+name+'" has different headers. No data was written to that tab. Back it up and align row 1 with: '+headers.join(' | '));
  }
  sh.clearContents();
  const values=[headers].concat(rows);
  sh.getRange(1,1,values.length,headers.length).setValues(values.map(row=>headers.map((_,i)=>row[i] == null ? '' : row[i])));
  sh.setFrozenRows(1); sh.getRange(1,1,1,headers.length).setFontWeight('bold');
  sh.autoResizeColumns(1,headers.length);
}
function writeStateBackup_(state) {
  const json=JSON.stringify(state);
  const chunks=[];
  for (let i=0;i<json.length;i+=CHUNK_SIZE) chunks.push([chunks.length+1,json.slice(i,i+CHUNK_SIZE)]);
  writeTab_('State Backup',BACKUP_HEADERS,chunks);
  const sh=spreadsheet_().getSheetByName('State Backup');
  if (sh && spreadsheet_().getSheets().length > 1) sh.hideSheet();
  if (sh && sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).length === 0) {
    sh.protect().setDescription('Managed by Athletics Portal sync; do not edit manually').setWarningOnly(true);
  }
}
function writeState_(state) {
  // Preflight every existing tab before changing anything to avoid partial overwrites.
  const ss=spreadsheet_();
  const preflight = [[TAB.site.name,TAB.site.headers],[TAB.ath.name,TAB.ath.headers],...Object.keys(TAB).filter(k=>k!=='site'&&k!=='ath').map(k=>[TAB[k].name,TAB[k].headers]),['Ticker Messages',TICKER_HEADERS],['Athlete Records',RECORD_HEADERS],['State Backup',BACKUP_HEADERS]];
  preflight.forEach(([name,headers])=>{const sh=ss.getSheetByName(name);if(sh&&sh.getLastRow()>0){const row=sh.getRange(1,1,1,headers.length).getDisplayValues()[0];const hasAny=row.some(v=>String(v).trim()!=='');const match=headers.every((h,i)=>String(row[i]||'').trim()===h);if(hasAny&&!match)throw new Error('The tab "'+name+'" has different headers. No rows were changed. Back it up and align the first row with: '+headers.join(' | '));}});
  const siteRows=['l1','l2','sub','cd','cdl','sess'].map(k=>[k,state.site[k] == null ? '' : String(state.site[k])]);
  writeTab_(TAB.site.name,TAB.site.headers,siteRows);
  const oldBackup = readBackupState_() || {};
  const oldAth = new Map((oldBackup.ath||[]).map(a=>[String(a.id),a]));
  writeTab_(TAB.ath.name,TAB.ath.headers,(state.ath||[]).map(a=>[
    a.id,a.name,a.dept,a.roll,a.year,a.cat,a.pe,a.bio,a.role||'',a.dur||4,a.grad?'TRUE':'FALSE',
    a.img && !String(a.img).startsWith('data:') ? a.img : '', JSON.stringify(a.ach||oldAth.get(String(a.id))?.ach||[])
  ]));
  for (const key of Object.keys(TAB)) {
    if(key==='site'||key==='ath')continue;
    const spec=TAB[key];
    if(key==='gal') writeTab_(spec.name,spec.headers,(state.gal||[]).map(g=>[g[0],g[1],g[2],g[3]&&!String(g[3]).startsWith('data:')?g[3]:'']));
    else writeTab_(spec.name,spec.headers,state[key]||[]);
  }
  writeTab_('Ticker Messages',TICKER_HEADERS,(state.site.tick||[]).map((message,i)=>[i+1,message]));
  const records=[];
  (state.ath||[]).forEach(a=>(a.rec||[]).forEach(r=>records.push([a.id,...r])));
  writeTab_('Athlete Records',RECORD_HEADERS,records);
  // Store the complete state (including uploaded image data and any future fields) after
  // writing editable tabs. On reads, editable tabs override their corresponding values.
  writeStateBackup_(state);
}
