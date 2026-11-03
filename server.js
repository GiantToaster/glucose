// Libre dashboard. Requires Node 18+, no packages to install.
//
// 1) In the LibreLink app, invite a DIFFERENT email address (Connected apps > LibreLinkUp > Add connection).
//    Log in with that address in the LibreLinkUp app and accept the terms. That account is used here.
// 2) Start:  node server.js
// 3) Open http://localhost:3000 and log in with that account. The password is kept in the server's memory only,
//    never written to disk. With "Stay logged in" ticked, the login key (token) LibreLinkUp hands out is saved
//    in data/session.json so you skip the login after a restart. "Log out" deletes it.
//    (Add HOST=0.0.0.0 to reach it from your phone on the same wifi. The password then travels unencrypted over your wifi when you log in.)
//
// Optional: LLU_EMAIL and LLU_PASSWORD environment variables log in automatically at start.
// Try without logging in:  DEMO=1 node server.js
// Login refused (version/Account-Id)? Set LLU_VERSION to the latest LibreLinkUp app version (default 4.16.0).
// Data is stored in the data/ folder. LibreLinkUp only returns about 12 h of history, so history builds up while the server runs.

const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { LLU_EMAIL, LLU_PASSWORD, DEMO, PORT = 3000, HOST = '127.0.0.1', LLU_VERSION = '4.16.0' } = process.env;

const DIR = path.join(__dirname, DEMO ? 'data-demo' : 'data'), RF = path.join(DIR, 'readings.jsonl'), DBF = path.join(DIR, 'db.json'), SF = path.join(DIR, 'session.json');
fs.mkdirSync(DIR, { recursive: true });
const R = new Map(); // tid (ms, hel minut) -> mg/dL
const BASE = 'https://api.libreview.io';
let creds = LLU_EMAIL && LLU_PASSWORD ? { email: LLU_EMAIL, password: LLU_PASSWORD } : null; // lösenordet finns bara i minnet
let last = null, loginErr = '', base = BASE, token = null, acct, pid, user = null, gen = 0; // gen räknas upp vid in/utloggning
// Sparad inloggning från förra körningen: bara token, aldrig lösenordet.
try { const s = JSON.parse(fs.readFileSync(SF, 'utf8')); if (!DEMO && !creds && !(s.expires * 1000 < Date.now())) ({ token, acct, base, user } = s); } catch {}
let status = DEMO ? 'demo' : creds || token ? 'starting' : 'login';
const forget = () => fs.rmSync(SF, { force: true });

if (fs.existsSync(RF)) for (const l of fs.readFileSync(RF, 'utf8').split('\n')) { try { const [t, v] = JSON.parse(l); R.set(t, v); } catch {} }
const add = (t, v) => { t = Math.floor(t / 6e4) * 6e4; if (R.has(t)) return; R.set(t, v); fs.appendFileSync(RF, JSON.stringify([t, v]) + '\n'); };

// ---------- LibreLinkUp ----------
const hdr = () => ({ 'content-type': 'application/json', product: 'llu.android', version: LLU_VERSION, ...(token && { authorization: 'Bearer ' + token, 'account-id': acct }) });
async function call(p, body) {
  const r = await fetch(base + p, { method: body ? 'POST' : 'GET', headers: hdr(), body: body && JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || (j.status && j.status !== 0)) throw Object.assign(new Error(`${p}: HTTP ${r.status} ${JSON.stringify(j).slice(0, 200)}`), { http: r.status, llu: j.status });
  return j;
}
async function login(c) {
  const b = { email: c.email, password: c.password };
  token = null; pid = null; base = BASE;
  let j = await call('/llu/auth/login', b);
  if (j.data.redirect) { base = `https://api-${j.data.region}.libreview.io`; j = await call('/llu/auth/login', b); }
  token = j.data.authTicket.token; user = c.email;
  acct = crypto.createHash('sha256').update(j.data.user.id).digest('hex');
  if (c.remember) fs.writeFileSync(SF, JSON.stringify({ token, acct, base, user, expires: j.data.authTicket.expires })); else forget();
}
function logout(err = '') { gen++; creds = token = pid = last = user = null; base = BASE; loginErr = err; status = DEMO ? 'demo' : 'login'; forget(); }
// LibreLinkUp status 2 = fel e-post/lösenord, 4 = villkor måste godkännas i appen
const why = e => e.llu === 2 ? 'LibreLinkUp did not accept that email and password.'
  : e.llu === 4 ? 'Open the LibreLinkUp app with this account, accept the terms there, then log in again.'
  : e.http === 429 ? 'Too many attempts. Wait a few minutes and try again.'
  : e.message;
// "10/25/2026 2:35:12 PM" (FactoryTimestamp är UTC) -> ms
const ts = s => { const m = s.match(/(\d+)\/(\d+)\/(\d+),? (\d+):(\d+):(\d+) ?(AM|PM)/i); return Date.UTC(+m[3], m[1] - 1, +m[2], (m[4] % 12) + (/pm/i.test(m[7]) ? 12 : 0), +m[5], +m[6]); };
async function poll() {
  if (!token && !creds) return;
  const g0 = gen;
  try {
    if (!token) await login(creds);
    if (!pid) {
      const p = (await call('/llu/connections')).data[0];
      if (!p) throw new Error('This account follows nobody yet. Accept the invitation in the LibreLinkUp app first.');
      pid = p.patientId;
    }
    const d = (await call(`/llu/connections/${pid}/graph`)).data, g = d.connection.glucoseMeasurement;
    if (g0 !== gen) return; // in- eller utloggad medan anropet pågick
    [...d.graphData, g].forEach(x => add(ts(x.FactoryTimestamp), x.ValueInMgPerDl ?? x.Value));
    last = { t: ts(g.FactoryTimestamp), v: g.ValueInMgPerDl ?? g.Value, trend: g.TrendArrow };
    status = 'ok';
  } catch (e) {
    console.error(e.message);
    if (g0 !== gen) return;
    // Fel uppgifter: sluta försöka (upprepade försök kan låsa kontot) och visa inloggningen igen.
    if (e.llu === 2 || e.llu === 4) return logout(why(e));
    // Token ogiltig: logga in igen med lösenordet om det finns i minnet, annars (efter omstart) be om inloggning.
    if (e.http === 401) { if (!creds) return logout('Your saved login has expired. Please log in again.'); token = null; }
    status = why(e); // nätverksfel o.d.: behåll token, ingen ny inloggning varje minut
  }
}

// ---------- Demo ----------
let dv = 120;
const step = () => (dv = Math.min(300, Math.max(45, dv + (Math.random() - .5) * 14 + (125 - dv) * .05)));
async function demo() { add(Date.now(), Math.round(step())); last = { t: Date.now(), v: Math.round(dv), trend: 3 }; status = 'demo'; }
if (DEMO && !R.size) for (let t = Date.now() - 90 * 864e5; t < Date.now(); t += 3e5) add(t, Math.round(step()));

// ---------- Statistik (tidsvägd, luckor över 15 min räknas inte) ----------
function stats() {
  const now = Date.now(), a = [...R].filter(r => r[0] >= now - 2160 * 36e5).sort((x, y) => x[0] - y[0]), out = {};
  for (const [k, h] of Object.entries({ '24h': 24, '7d': 168, '14d': 336, '30d': 720, '90d': 2160 })) {
    const from = now - h * 36e5; let w = 0, s = 0, lo = 0, hi = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i][0] < from) continue;
      const d = Math.min((a[i + 1] ? a[i + 1][0] : now) - a[i][0], 15 * 6e4), v = a[i][1];
      w += d; s += v * d; if (v < 70) lo += d; else if (v > 180) hi += d;
    }
    out[k] = w ? { avg: s / w, low: lo / w * 100, high: hi / w * 100, tir: (w - lo - hi) / w * 100, cov: Math.min(100, w / (h * 36e5) * 100) } : null;
  }
  return out;
}

// ---------- Efter en måltid: värdet vid måltiden (senaste 15 min) samt högsta och lägsta inom 3 h ----------
function outcome(t) {
  const t0 = Math.floor(t / 6e4) * 6e4, o = { done: t + 3 * 36e5 <= Date.now() };
  let n = 0, pk, lo;
  for (let k = t0 - 15 * 6e4; k <= t0; k += 6e4) if (R.has(k)) o.b = [k, R.get(k)];
  for (let k = t0 + 6e4; k <= t0 + 3 * 36e5; k += 6e4) {
    const v = R.get(k); if (v === undefined) continue;
    n++; if (!pk || v > pk[1]) pk = [k, v]; if (!lo || v < lo[1]) lo = [k, v];
  }
  if (n > 3) Object.assign(o, { pk, lo });
  return o;
}

// ---------- Dygnsprofil: percentiler per halvtimme ----------
// Ett värde per 15 min, så att dagar med minutdata inte väger tyngre än nätter som bara har 15-minutersvärden.
function profile(days) {
  const from = Date.now() - days * 864e5, slot = new Map(), dates = new Set(), b = Array.from({ length: 48 }, () => []);
  for (const [t, v] of R) { const k = Math.floor(t / 9e5); if (t >= from && !slot.has(k)) slot.set(k, [t, v]); }
  for (const [t, v] of slot.values()) { const d = new Date(t); dates.add(d.toDateString()); b[d.getHours() * 2 + (d.getMinutes() >= 30 ? 1 : 0)].push(v); }
  return { days: dates.size, b: b.map(a => {
    if (a.length < 5) return null;
    a.sort((x, y) => x - y);
    return [.05, .25, .5, .75, .95].map(p => a[Math.min(a.length - 1, Math.floor(p * a.length))]);
  }) };
}

// ---------- HTTP ----------
const readDb = () => fs.existsSync(DBF) ? JSON.parse(fs.readFileSync(DBF, 'utf8')) : { meals: [], log: [] };
const send = (res, o, c = 200) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
// Läser JSON-kroppen. Kräver content-type application/json, så att andra webbsidor i webbläsaren
// inte kan skicka hit anrop (t.ex. falska mätvärden) utan en CORS-förfrågan som servern aldrig godkänner.
const body = (req, res, fn) => {
  if (!/^application\/json/.test(req.headers['content-type'] || '')) return send(res, { error: 'expected JSON' }, 415);
  let b = ''; req.on('data', c => b += c);
  req.on('end', () => { let o; try { o = JSON.parse(b); } catch { return send(res, { error: 'invalid JSON' }, 400); } fn(o, b); });
};
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/now') return send(res, { last, status, demo: !!DEMO, user, loginErr });
  if (u.pathname === '/api/stats') return send(res, stats());
  if (u.pathname === '/api/readings') {
    const q = u.searchParams, from = +q.get('from') || Date.now() - (+q.get('hours') || 24) * 36e5, to = +q.get('to') || Infinity;
    return send(res, [...R].filter(r => r[0] >= from && r[0] <= to).sort((a, b) => a[0] - b[0]));
  }
  if (u.pathname === '/api/outcomes') return send(res, Object.fromEntries(readDb().log.map(m => [m.id, outcome(m.t)])));
  if (u.pathname === '/api/profile') return send(res, profile(Math.min(90, Math.max(1, +u.searchParams.get('days') || 14))));
  if (u.pathname === '/api/login' && req.method === 'POST') return body(req, res, async ({ email, password, remember }) => {
    if (DEMO) return send(res, { error: 'Not available in demo mode.' }, 400);
    if (!email || !password) return send(res, { error: 'Enter both email and password.' }, 400);
    const c = { email, password, remember: !!remember };
    try {
      await login(c);
      gen++; creds = c; loginErr = ''; status = 'starting';
      await poll(); send(res, { ok: 1 });
    } catch (e) { console.error(e.message); send(res, { error: why(e) }, 401); }
  });
  if (u.pathname === '/api/logout' && req.method === 'POST') return body(req, res, () => { logout(); send(res, { ok: 1 }); });
  if (u.pathname === '/api/import' && req.method === 'POST') return body(req, res, rows => {
    try {
      let added = 0, lines = '';
      for (const [t0, v] of rows) { const t = Math.floor(t0 / 6e4) * 6e4; if (v > 0 && !R.has(t)) { R.set(t, v); lines += JSON.stringify([t, v]) + '\n'; added++; } }
      fs.appendFileSync(RF, lines); send(res, { added });
    } catch { send(res, { error: 'bad data' }, 400); }
  });
  if (u.pathname === '/api/db') {
    if (req.method === 'PUT') return body(req, res, (o, b) => { fs.writeFileSync(DBF, b); send(res, { ok: 1 }); });
    return send(res, readDb());
  }
  fs.readFile(path.join(__dirname, 'index.html'), (e, d) => { res.writeHead(e ? 500 : 200, { 'content-type': 'text/html; charset=utf-8' }); res.end(d); });
}).listen(PORT, HOST, () => console.log(`Dashboard: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}${DEMO ? ' (demo mode)' : creds ? '' : token ? ` (saved login: ${user})` : ' (open it and log in)'}`));

const tick = DEMO ? demo : poll;
tick(); setInterval(tick, 6e4);
