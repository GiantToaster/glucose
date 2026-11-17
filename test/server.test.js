// Tester för det som inte får gå sönder: spärren mot dosfrågor, loggning med egna ord, skydden i servern,
// exporten och LibreLinkUp-versionen. Kör från projektmappen:  node --test
// Inga paket. Varje test startar en kopia av appen i en tillfällig mapp (aldrig mot data/), utan AI och utan Telegram,
// och LibreLinkUp är en låtsasserver här i filen (LLU_API).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');

// Startar appen på en ledig port i en egen mapp och väntar tills den lyssnar
async function start(env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glucose-test-'));
  for (const f of ['server.js', 'index.html', 'icon.svg']) fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  const port = 40000 + Math.floor(Math.random() * 20000);
  const p = spawn(process.execPath, ['server.js'], { cwd: dir, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', OLLAMA_URL: 'http://127.0.0.1:9', OLLAMA_AUTOSTART: '0', TELEGRAM_API: 'http://127.0.0.1:9', ...env } });
  let log = '';
  await new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error('The server did not start:\n' + log)), 20e3);
    const on = d => { log += d; if (log.includes('Dashboard:')) { clearTimeout(t); ok(); } };
    p.stdout.on('data', on); p.stderr.on('data', on); p.on('exit', c => fail(new Error(`The server stopped (${c}):\n` + log)));
  });
  const url = `http://127.0.0.1:${port}`;
  return {
    url, dir, port,
    get: p => fetch(url + p),
    post: (p, o) => fetch(url + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) }),
    // Windows släpper inte mappen förrän processen har avslutats
    stop: async () => {
      p.removeAllListeners('exit'); const gone = new Promise(r => p.once('exit', r)); p.kill(); await gone;
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
    },
  };
}
// fetch låter inte Host bytas, så den här frågan går med http.request
const statusWithHost = (port, host) => new Promise((ok, fail) => {
  http.get({ host: '127.0.0.1', port, path: '/api/now', headers: { host } }, r => { r.resume(); ok(r.statusCode); }).on('error', fail);
});

let demo;
before(async () => { demo = await start({ DEMO: '1' }); });
after(async () => { if (demo) await demo.stop(); });

const ask = async q => { const r = await demo.post('/api/ask', { messages: [{ role: 'user', content: q }] }); return { status: r.status, text: await r.text() }; };

test('dose questions get the fixed answer and never reach the AI', async () => {
  for (const q of ['Should I take more insulin?', 'Which meal needs more insulin than I usually take?', 'Is 5 units enough for pizza?',
    'Should I use less bolus for pasta?', 'How many units should I take for pizza?', 'Ska jag ta mer insulin?', 'Behöver jag korrigera nu?',
    'Vilken måltid behöver mer insulin?', 'Kräver pizza högre dos?', 'Är 5 enheter lagom till pizza?']) {
    const a = await ask(q);
    assert.equal(a.status, 200, q);
    assert.match(a.text, /can't give advice on doses|kan inte ge råd om doser/, q);
    assert.doesNotMatch(a.text, /Patterns/, 'the fixed answer must not point to a removed tab');
  }
});

test('the fixed answer is in the language of the question', async () => {
  assert.match((await ask('Ska jag ta mer insulin?')).text, /^Jag kan inte ge råd/);
  assert.match((await ask('Should I take more insulin?')).text, /^I can't give advice/);
});

test('questions about what happened are not stopped', async () => {
  // Utan AI svarar servern att den inte är igång (503), men frågan stoppades inte av spärren
  for (const q of ['How much insulin did I take yesterday?', 'Hur mycket insulin har jag tagit i veckan?', 'Varför gick jag högt efter pizza?',
    'How did it go the last times I had pizza?', 'Vilka måltider ger högst topp?']) {
    const a = await ask(q);
    assert.equal(a.status, 503, q);
    assert.doesNotMatch(a.text, /give advice|ge råd/, q);
  }
});

test('logging in your own words, with the simple reader', async () => {
  const m = await (await demo.post('/api/quicklog', { text: 'pizza 7,5 enheter' })).json();
  assert.equal(m.entry.name, 'Pizza'); assert.equal(m.entry.ins, 7.5);
  const n = await (await demo.post('/api/quicklog', { text: 'promenad 45 min' })).json();
  assert.equal(n.entry.kind, 'Exercise'); assert.equal(n.entry.dur, 45);
  // Ett tal utan enhet sparas aldrig som en dos: appen frågar först
  const b = await (await demo.post('/api/quicklog', { text: '2 skivor bröd' })).json();
  assert.ok(b.check && !b.entry, JSON.stringify(b));
  const x = await (await demo.post('/api/quicklog', { text: 'hej' })).json();
  assert.ok(x.error && !x.entry);
});

test('only its own host names are answered (DNS rebinding)', async () => {
  assert.equal(await statusWithHost(demo.port, 'evil.example.com'), 403);
  assert.equal(await statusWithHost(demo.port, `localhost:${demo.port}`), 200);
});

test('too large requests are refused', async () => {
  const r = await fetch(demo.url + '/api/db', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: ' '.repeat(65 * 2 ** 20) });
  assert.equal(r.status, 413);
});

test('requests without JSON are refused', async () => {
  const r = await fetch(demo.url + '/api/quicklog', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"text":"pizza 7 units"}' });
  assert.equal(r.status, 415);
});

test('the demo has readings up to now', async () => {
  const s = await (await demo.get('/api/stats')).json();
  assert.ok(s['24h'].cov > 90, 'coverage last 24 h: ' + s['24h'].cov);
  const n = await (await demo.get('/api/now')).json();
  assert.ok(Date.now() - n.last.t < 2 * 6e4);
});

test('export as CSV', async () => {
  // Börjar med en BOM, så att Excel läser å, ä och ö rätt (text() tar bort den, därför bytena)
  const raw = Buffer.from(await (await demo.get('/api/export?what=readings')).arrayBuffer());
  assert.deepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.match(raw.subarray(3, 200).toString(), /^time,mmol\/L,mg\/dL\r\n\d{4}-\d\d-\d\d \d\d:\d\d,\d+\.\d,\d+\r\n/);
  const l = await (await demo.get('/api/export?what=log')).text();
  assert.match(l.slice(0, 200), /^time,type,what,units,insulin\r\n/);
  assert.match(l, /,Meal,/);
  assert.equal((await demo.get('/api/export?what=x')).status, 400);
});

test('the LibreLinkUp version can be set, and empty means the default', async () => {
  assert.equal((await demo.post('/api/llu', { version: 'abc' })).status, 400);
  assert.equal((await (await demo.post('/api/llu', { version: '4.17.1' })).json()).version, '4.17.1');
  assert.equal((await (await demo.get('/api/now')).json()).llu.version, '4.17.1');
  assert.equal((await (await demo.post('/api/llu', { version: '' })).json()).version, '4.16.0');
});

test('the version is raised by itself when LibreLinkUp asks for a newer one', async () => {
  // Låtsas-LibreLinkUp: nekar allt under 4.20.0 med status 920 och den lägsta godkända versionen
  const seen = [];
  const llu = http.createServer((req, res) => {
    seen.push(req.headers.version);
    const out = o => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.headers.version !== '4.20.0') return out({ status: 920, data: { minimumVersion: '4.20.0' } });
    if (req.url === '/llu/auth/login') return out({ status: 0, data: { authTicket: { token: 't', expires: Date.now() / 1e3 + 3600 }, user: { id: 'u1' } } });
    if (req.url === '/llu/connections') return out({ status: 0, data: [{ patientId: 'p1' }] });
    return out({ status: 0, data: { connection: { glucoseMeasurement: null }, graphData: [] } });
  });
  await new Promise(r => llu.listen(0, '127.0.0.1', r));
  const app = await start({ LLU_API: `http://127.0.0.1:${llu.address().port}` });
  try {
    const r = await app.post('/api/login', { email: 'test@example.com', password: 'x' });
    assert.equal(r.status, 200, await r.clone().text());
    assert.deepEqual(seen.slice(0, 2), ['4.16.0', '4.20.0']);
    assert.equal((await (await app.get('/api/now')).json()).llu.version, '4.20.0');
    // Sparas, så att den gäller även efter en omstart
    assert.equal(JSON.parse(fs.readFileSync(path.join(app.dir, 'data', 'llu.json'), 'utf8')).version, '4.20.0');
    assert.ok(!fs.existsSync(path.join(app.dir, 'data', 'session.json')), 'nothing is saved without "stay logged in"');
  } finally { await app.stop(); llu.close(); }
});
