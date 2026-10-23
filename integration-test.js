// Live integration test: starts the server on a temp DB and exercises auth, state, Excel round-trip.
const { spawn } = require('node:child_process'); const assert = require('node:assert/strict');
const os = require('node:os'), fs = require('node:fs'), path = require('node:path');
const PORT = 3911, B = `http://localhost:${PORT}`, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ath-'));
const srv = spawn('node', ['server.js'], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, PORT, DATA_DIR: dir, ADMIN_PASSWORD: 'iitbhu11', SESSION_SECRET: 'x'.repeat(40) }, stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  try {
    for (let i = 0; i < 40; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(250); }
    assert.equal((await fetch(B + '/api/health')).status, 200);
    const login = pw => fetch(B + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pw }) });
    assert.equal((await login('wrong')).status, 401);
    const ok = await login('iitbhu11'); assert.equal(ok.status, 200);
    const cookie = ok.headers.get('set-cookie').split(';')[0]; const H = { cookie, 'content-type': 'application/json' };
    assert.equal((await fetch(B + '/api/export.xlsx')).status, 401);
    const state = (await (await fetch(B + '/api/state')).json()).state;
    state.ath[0].role = 'Boys Captain'; state.ath[0].img = 'data:image/png;base64,AAAA'; state.site.cd = '2027-01-01T10:00';
    assert.equal((await fetch(B + '/api/state', { method: 'PUT', headers: H, body: JSON.stringify({ state }) })).status, 200);
    assert.equal((await fetch(B + '/api/state', { method: 'PUT', headers: H, body: JSON.stringify({ state: { x: 1 } }) })).status, 400);
    const xl = Buffer.from(await (await fetch(B + '/api/export.xlsx', { headers: H })).arrayBuffer());
    const imp = await fetch(B + '/api/import.xlsx', { method: 'POST', headers: H, body: JSON.stringify({ fileBase64: xl.toString('base64') }) });
    assert.equal(imp.status, 200);
    const after = (await (await fetch(B + '/api/state')).json()).state;
    assert.equal(after.ath[0].role, 'Boys Captain', 'Excel import preserves leadership role');
    assert.equal(after.ath[0].img, 'data:image/png;base64,AAAA', 'Excel import preserves athlete photo');
    assert.equal(after.site.cd, '2027-01-01T10:00', 'Excel import preserves countdown');
    assert.equal((await fetch(B + '/')).status, 200);
    console.log('PASS: integration test (auth, state, Excel round-trip, static)');
  } catch (e) { console.error('FAIL:', e.message); process.exitCode = 1; } finally { srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
})();
