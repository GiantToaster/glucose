// Libre dashboard. Requires Node 18.17+ (AbortSignal.any), no packages to install.
//
// 1) In the LibreLink app, invite a DIFFERENT email address (Connected apps > LibreLinkUp > Add connection).
//    Log in with that address in the LibreLinkUp app and accept the terms. That account is used here.
// 2) Start:  node server.js
// 3) Open http://localhost:3000 and log in with that account. The password is kept in the server's memory only,
//    never written to disk. With "Stay logged in" ticked, the login key (token) LibreLinkUp hands out is saved
//    in data/session.json so you skip the login after a restart. "Log out" deletes it.
//
// Write what you ate or did: type "pizza 7,5 enheter" or "promenad 45 min" in the box at the top of the dashboard, or send it
//    to your own Telegram bot from your phone (Settings > Telegram shows how to create and connect it). The computer
//    fetches the messages itself, so nothing is opened in the router, and messages wait at Telegram for up to 24 h if
//    the computer is off. Only the meal texts pass through Telegram, never glucose readings. A weekly and monthly summary
//    (time in range, lows, average) is sent only if you turn it on under Settings > Telegram, or ask with /week or /month.
//
// Local AI (Insights tab and reading what you type): install Ollama and a model, e.g.  ollama pull gemma4:12b
//    Uses a gemma model if one is installed. OLLAMA_MODEL picks another, OLLAMA_URL points to another address.
//    Everything stays on this computer. Without it, a simple built-in reader handles the logging.
//
// Optional: LLU_EMAIL and LLU_PASSWORD environment variables log in automatically at start.
// Try without logging in:  DEMO=1 node server.js  (made-up person with meals, notes and 90 days of readings in
//    data-demo/, so screenshots never show your own health data. Each start fills it in up to now; delete data-demo/
//    to start over.) The same demo runs in the browser without a server: node web/build.js writes it to docs/.
// Login refused because of the app version? It is raised by itself when LibreLinkUp says which version it wants, and can be
// set under Settings → LibreLinkUp. LLU_VERSION sets the default (4.16.0).
// Data is stored in the data/ folder. LibreLinkUp only returns about 12 h of history, so history builds up while the server runs.

const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), os = require('os');
const { LLU_EMAIL, LLU_PASSWORD, DEMO, PORT = 3000, HOST = '127.0.0.1', LLU_VERSION = '4.16.0', OLLAMA_URL = 'http://127.0.0.1:11434', OLLAMA_MODEL, OLLAMA_AUTOSTART, TELEGRAM_API = 'https://api.telegram.org' } = process.env;
// Ett missat fel i ett asynkront anrop: skriv ut det och avsluta, så att tjänsten (systemd, Restart=always) startar om
// från ett känt läge i stället för att köra vidare i ett okänt. Förut skrevs felet bara ut och servern fortsatte.
process.on('unhandledRejection', e => { console.error('Unhandled:', e); process.exit(1); });

const DIR = path.join(__dirname, DEMO ? 'data-demo' : 'data'), RF = path.join(DIR, 'readings.jsonl'), DBF = path.join(DIR, 'db.json'), SF = path.join(DIR, 'session.json');
// Mappen och filerna med inloggningsnyckeln och bot-token kan bara läsas av användaren som kör servern (700/600)
fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
try { fs.chmodSync(DIR, 0o700); } catch {}
const writePrivate = (f, data) => { fs.writeFileSync(f, data, { mode: 0o600 }); try { fs.chmodSync(f, 0o600); } catch {} };
// Filer som skapades innan detta (med 644) görs privata vid start
for (const f of ['session.json', 'telegram.json', 'auth.json']) try { fs.chmodSync(path.join(DIR, f), 0o600); } catch {}
const R = new Map(); // tid (ms, hel minut) -> mg/dL
// LLU_API: en annan adress till LibreLinkUp, bara för testerna (test/), som kör mot en låtsasserver
const BASE = process.env.LLU_API || 'https://api.libreview.io';
let creds = LLU_EMAIL && LLU_PASSWORD ? { email: LLU_EMAIL, password: LLU_PASSWORD } : null; // lösenordet finns bara i minnet
let last = null, loginErr = '', base = BASE, token = null, acct, pid, user = null, gen = 0; // gen räknas upp vid in/utloggning
// LibreLinkUp-adressen kommer från svaret vid inloggningen (region) och från session.json. Bara LibreLinkUps egna adresser
// godtas, så att ett manipulerat svar eller en ändrad fil inte kan skicka lösenordet eller nyckeln någon annanstans.
const okBase = b => b === BASE || /^https:\/\/api-[a-z0-9]{2,8}\.libreview\.io$/.test(String(b));
const regionBase = r => { const b = `https://api-${String(r).toLowerCase()}.libreview.io`; if (!/^[a-z0-9]{2,8}$/i.test(String(r)) || !okBase(b)) throw new Error('LibreLinkUp answered with an unknown region.'); return b; };
// Sparad inloggning från förra körningen: bara token, aldrig lösenordet.
try { const s = JSON.parse(fs.readFileSync(SF, 'utf8')); if (!DEMO && !creds && !(s.expires * 1000 < Date.now()) && okBase(s.base)) ({ token, acct, base, user } = s); } catch {}
let status = DEMO ? 'demo' : creds || token ? 'starting' : 'login';
const forget = () => fs.rmSync(SF, { force: true });

// Rimliga mätvärden: Libre visar 40–500 mg/dL. Allt annat (t.ex. trasiga rader i en import) hoppas över.
const okT = t => Number.isFinite(t) && t > Date.UTC(2014, 0, 1) && t < Date.now() + 36e5, okV = v => Number.isFinite(v) && v >= 20 && v <= 600;
if (fs.existsSync(RF)) for (const l of fs.readFileSync(RF, 'utf8').split('\n')) { try { const [t, v] = JSON.parse(l); if (okT(t) && okV(v)) R.set(t, v); } catch {} }
// S: samma mätvärden sorterade på tid, så att en period hittas med binärsökning i stället för att alla värden
// (hundratusentals efter ett år) kopieras och sorteras vid varje anrop. R behålls för uppslag på exakt minut.
let S = [...R].sort((x, y) => x[0] - y[0]);
const lowerBound = t => { let a = 0, b = S.length; while (a < b) { const m = (a + b) >> 1; if (S[m][0] < t) a = m + 1; else b = m; } return a; };
const range = (from, to) => S.slice(lowerBound(from), lowerBound(to)); // [from, to)
const add = (t, v) => {
  t = Math.floor(t / 6e4) * 6e4; v = Math.round(v); if (!okT(t) || !okV(v) || R.has(t)) return;
  R.set(t, v); fs.appendFileSync(RF, JSON.stringify([t, v]) + '\n');
  if (!S.length || t > S[S.length - 1][0]) S.push([t, v]); else S.splice(lowerBound(t), 0, [t, v]); // nya värden hamnar nästan alltid sist
};

// ---------- LibreLinkUp ----------
// Appversionen som skickas med varje anrop. LibreLinkUp nekar för gamla versioner (status 920, och då står den lägsta
// godkända i svaret). Den höjs då automatiskt och sparas i data/llu.json; den kan också ändras under Settings →
// LibreLinkUp. Förut var den fast (LLU_VERSION) och värdena slutade komma tills någon ändrade koden.
const VF = path.join(DIR, 'llu.json'), okVer = v => typeof v === 'string' && /^\d{1,2}\.\d{1,3}(\.\d{1,3})?$/.test(v);
let lluVer = LLU_VERSION;
try { const v = JSON.parse(fs.readFileSync(VF, 'utf8')).version; if (okVer(v)) lluVer = v; } catch {}
const setVer = v => { lluVer = okVer(v) ? v : LLU_VERSION; if (lluVer === LLU_VERSION) fs.rmSync(VF, { force: true }); else fs.writeFileSync(VF, JSON.stringify({ version: lluVer })); };
const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
// auth = { token, acct } för just det anropet; utan auth används den aktuella inloggningen. at = adressen (standard: base).
const hdr = (auth = { token, acct }) => ({ 'content-type': 'application/json', product: 'llu.android', version: lluVer, ...(auth.token && { authorization: 'Bearer ' + auth.token, 'account-id': auth.acct }) });
async function call(p, body, again = true, at = base, auth) {
  // Timeout: ett anrop som hänger får inte blockera alla följande minuters hämtningar
  const r = await fetch(at + p, { method: body ? 'POST' : 'GET', headers: hdr(auth), body: body && JSON.stringify(body), signal: AbortSignal.timeout(20e3) });
  const j = await r.json().catch(() => ({}));
  const min = j.data && j.data.minimumVersion;
  if (j.status === 920 && again && okVer(min) && newer(min, lluVer)) { console.log(`LibreLinkUp wants app version ${min} (was ${lluVer}). Using it from now on.`); setVer(min); return call(p, body, false, at, auth); }
  if (!r.ok || (j.status && j.status !== 0)) throw Object.assign(new Error(`${p}: HTTP ${r.status} ${JSON.stringify(j).slice(0, 200)}`), { http: r.status, llu: j.status });
  return j;
}
// Loggar in utan att röra den aktuella inloggningen: allt räknas fram i egna variabler och sparas först när
// LibreLinkUp har godkänt. Förut nollställdes token innan svaret kom, så ett enda misslyckat försök (fel lösenord,
// vem som helst i nätverket) raderade en sparad inloggning och hämtningen slutade tyst. Bara en inloggning åt gången.
let loginQ = Promise.resolve();
function login(c) {
  const run = async () => {
    const b = { email: c.email, password: c.password }, none = { token: null };
    let at = BASE, j = await call('/llu/auth/login', b, true, at, none);
    if (j.data.redirect) { at = regionBase(j.data.region); j = await call('/llu/auth/login', b, true, at, none); }
    const t = j.data.authTicket.token, a = crypto.createHash('sha256').update(j.data.user.id).digest('hex');
    token = t; acct = a; base = at; pid = null; user = c.email;
    if (c.remember) writePrivate(SF, JSON.stringify({ token, acct, base, user, expires: j.data.authTicket.expires })); else forget();
  };
  const p = loginQ.catch(() => {}).then(run);
  loginQ = p;
  return p;
}
function logout(err = '') { gen++; creds = token = pid = last = user = null; base = BASE; loginErr = err; status = DEMO ? 'demo' : 'login'; forget(); }
// LibreLinkUp status 2 = fel e-post/lösenord, 4 = villkor måste godkännas i appen
const why = e => e.llu === 2 ? 'LibreLinkUp did not accept that email and password.'
  : e.llu === 4 ? 'Open the LibreLinkUp app with this account, accept the terms there, then log in again.'
  : e.llu === 920 ? `LibreLinkUp no longer accepts app version ${lluVer}. Enter the version of the LibreLinkUp app in your phone's app store under Settings → LibreLinkUp, then log in again.`
  : e.http === 429 ? 'Too many attempts. Wait a few minutes and try again.'
  : e.name === 'TimeoutError' ? 'LibreLinkUp did not answer in time. Trying again in a minute.'
  : e.message;
// "10/25/2026 2:35:12 PM" (FactoryTimestamp är UTC) -> ms. Okänt format ger NaN, och add() hoppar då över värdet.
const ts = s => {
  const m = String(s).match(/(\d+)\/(\d+)\/(\d+),? (\d+):(\d+):(\d+) ?(AM|PM)?/i);
  return m ? Date.UTC(+m[3], m[1] - 1, +m[2], m[7] ? (m[4] % 12) + (/pm/i.test(m[7]) ? 12 : 0) : +m[4], +m[5], +m[6]) : NaN;
};
// Bara en hämtning åt gången. Inloggningen väntar in en pågående hämtning innan den startar en egen.
let running = null;
const poll = () => running ||= pollOnce().finally(() => running = null);
async function pollOnce(retry = true) {
  if (!token && !creds) return;
  const g0 = gen;
  try {
    if (!token) await login(creds);
    if (!pid) {
      const p = (await call('/llu/connections')).data[0];
      if (!p) throw new Error('This account follows nobody yet. Accept the invitation in the LibreLinkUp app first.');
      pid = p.patientId;
    }
    const d = (await call(`/llu/connections/${pid}/graph`)).data, g = d.connection && d.connection.glucoseMeasurement;
    if (g0 !== gen) return; // in- eller utloggad medan anropet pågick
    seenSensor(d.connection && d.connection.sensor);
    // Inget aktuellt värde (t.ex. sensorbyte eller uppvärmning): spara historiken och behåll senaste kända värdet.
    // Bara ValueInMgPerDl: Value är i kontots egen enhet (mmol/L i Europa), så 6.2 skulle läsas som 6 mg/dL ("Very low")
    [...(d.graphData || []), ...(g ? [g] : [])].forEach(x => add(ts(x.FactoryTimestamp), x.ValueInMgPerDl));
    const t = g && ts(g.FactoryTimestamp), v = g && Math.round(g.ValueInMgPerDl);
    if (okT(t) && okV(v)) last = { t, v, trend: g.TrendArrow };
    status = 'ok';
  } catch (e) {
    console.error(e.message);
    if (g0 !== gen) return;
    // Fel uppgifter: sluta försöka (upprepade försök kan låsa kontot) och visa inloggningen igen.
    if (e.llu === 2 || e.llu === 4) return logout(why(e));
    // Token ogiltig: logga in igen direkt med lösenordet om det finns i minnet, annars (efter omstart) be om inloggning.
    if (e.http === 401) { if (!creds) return logout('Your saved login has expired. Please log in again.'); token = null; if (retry) return pollOnce(false); }
    status = why(e); // nätverksfel o.d.: behåll token, ingen ny inloggning varje minut
  }
}

// ---------- Sensorn: när den startades ----------
// LibreLinkUp skickar sensorns starttid (connection.sensor.a, unix-sekunder) och uppvärmningen i minuter (w), men inte
// hur länge den håller: Plus-sensorerna håller 15 dagar, Libre 2 och 3 14 dagar. SENSOR_DAYS (miljövariabel, 14 eller 15)
// väljer; standard 15. Starterna sparas, så att äldre byten kan markeras i grafen.
const SNF = path.join(DIR, 'sensors.json'), SENSOR_DAYS = [14, 15].includes(+process.env.SENSOR_DAYS) ? +process.env.SENSOR_DAYS : 15;
let sens = { starts: [], warm: 60 };
if (DEMO) for (let k = 6; k >= 0; k--) sens.starts.push(Math.round(Date.now() - (8.4 + 14 * k) * 864e5));
else try { const j = JSON.parse(fs.readFileSync(SNF, 'utf8')); sens = { starts: (j.starts || []).filter(Number.isFinite), warm: j.warm > 0 ? j.warm : 60 }; } catch {}
const saveSens = () => { if (DEMO) return; try { fs.writeFileSync(SNF, JSON.stringify(sens)); } catch (e) { console.error(e.message); } };
function seenSensor(x) {
  const a = x && x.a * 1000, w = x && x.w > 0 ? x.w : 60;
  if (!(a > 0) || a > Date.now() + 864e5) return; // saknas eller orimlig
  if (sens.starts.includes(a) && sens.warm === w) return;
  if (!sens.starts.includes(a)) sens.starts = [...sens.starts, a].sort((p, q) => p - q).slice(-60);
  sens.warm = w; saveSens();
}

// ---------- Demo ----------
// En påhittad men trovärdig person: tre måltider om dagen med olika rätter och doser, gryningsfenomen,
// ibland träning eller en för stor dos som ger en känning, och en sensorlucka då och då. Samma dag ger
// alltid samma kurva, så historiken och det som kommer in live hänger ihop.
const rng = seed => () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
const MENU = [ // [timme, [namn, vanlig dos, ökning i mg/dL, minuter till toppen]]
  [7.5, [['Havregrynsgröt', 4, 70, 55], ['Kvarg med bär', 3, 35, 50], ['Mackor', 2, 50, 50]]],
  [12.25, [['Pasta bolognese', 6, 75, 70], ['Kycklingsallad', 3, 30, 60], ['Pad Ka Pao', 6, 70, 65]]],
  [18.25, [['Pizza', 7, 95, 110], ['Lax med potatis', 5, 55, 70], ['Tacos', 6, 80, 80]]]];
const midnight = t => new Date(t).setHours(0, 0, 0, 0);
const plans = new Map();
function plan(d) {
  if (plans.has(d)) return plans.get(d);
  const r = rng(Math.round(d / 36e5) * 2654435761), meals = [], notes = [];
  for (const [h, opts] of MENU) {
    const [name, usual, rise, peak] = opts[Math.floor(r() * opts.length)], extra = [-1, -.5, 0, 0, 0, .5, 1][Math.floor(r() * 7)];
    // Mer insulin än vanligt: lägre topp och risk för känning efter 2–3 h. Mindre: högre topp.
    meals.push({ t: d + (h + (r() - .5) * 1.2) * 36e5, name, ins: usual + extra, a: rise * 1.15 * (1 - extra * .3) * (.7 + r() * .6), peak,
      dip: extra > 0 && r() < .6 ? 40 + r() * 30 : r() < .1 ? 40 : 0 });
  }
  if (r() < .3) notes.push({ t: d + (16.5 + r()) * 36e5, kind: 'Exercise', text: ['45 min promenad', 'Gym', 'Cykel till jobbet'][Math.floor(r() * 3)], dip: 45 + r() * 30 });
  const p = { meals, notes, base: 95 + r() * 40, gap: r() < .07 ? d + (9 + r() * 6) * 36e5 : 0 };
  plans.set(d, p); if (plans.size > 200) plans.delete(plans.keys().next().value);
  return p;
}
const bell = (x, m, s) => Math.exp(-((x - m) ** 2) / (2 * s * s));
function model(t) {
  // Allt glider över i varandra: basnivån tonas från gårdagens till dagens under natten, och en måltid
  // räknas tills dess kurva har klingat av helt, så att det inte blir trappsteg i kurvan.
  const d = midnight(t), p = plan(d), y = plan(midnight(d - 1)), h = (t - d) / 36e5, k = Math.min(1, h / 5);
  let v = y.base + (p.base - y.base) * k * k * (3 - 2 * k) + 22 * bell(h, 6, 1.3) - 10 * bell(h, 2.5, 1.2) + 9 * Math.sin(t / 58e5) + 5 * Math.sin(t / 23e5 + 1.7);
  for (const q of [y, p]) {
    for (const m of q.meals) { const x = (t - m.t) / 6e4; if (x > 0) v += m.a * (x / m.peak) ** 2 * Math.exp(2 - 2 * x / m.peak) - m.dip * bell(x, 165, 40); }
    for (const n of q.notes) { const x = (t - n.t) / 6e4; if (x > 0) v -= n.dip * bell(x, 75, 40); }
  }
  return Math.min(400, Math.max(40, v));
}
const inGap = t => { const g = plan(midnight(t)).gap; return g && t >= g && t < g + 2 * 36e5; };
async function demo() {
  const now = Date.now(), v = model(now) + (Math.random() - .5) * 4, slope = (model(now) - model(now - 15 * 6e4)) / 15;
  add(now, v); status = 'demo';
  last = { t: now, v: Math.round(v), trend: slope > 2 ? 5 : slope > 1 ? 4 : slope < -2 ? 1 : slope < -1 ? 2 : 3 };
}
// Demodatan skapas första gången och fylls sedan på vid varje start: från senaste sparade värde, måltid och
// anteckning fram till nu. Förut skapades den bara en gång, så en demo som startades veckor senare hade en tom kurva.
if (DEMO) {
  // Varje lucka över 15 min de senaste 90 dagarna fylls, även en mitt i (demon kördes en stund och stängdes av)
  const now = Date.now(), from = now - 90 * 864e5, have = range(from, now).map(x => x[0]), fill = [];
  [from, ...have, now].forEach((t, i, a) => { if (i && t - a[i - 1] > 15 * 6e4) for (let u = Math.ceil((a[i - 1] + 3e5) / 3e5) * 3e5; u < t - 2 * 6e4; u += 3e5) fill.push(u); });
  for (const t of fill) if (!inGap(t)) add(t, model(t) + (Math.random() - .5) * 4);
  let db = null; try { db = JSON.parse(fs.readFileSync(DBF, 'utf8')); } catch {}
  const id = () => crypto.randomBytes(6).toString('hex'), newest = a => (a || []).reduce((m, x) => Math.max(m, x.t || 0), 0);
  // Fylls i efter senaste loggade måltid respektive anteckning, i samma format som appen sparar
  const fromLog = Math.max(newest(db && db.log), now - 30 * 864e5), fromNotes = Math.max(newest(db && db.notes), now - 30 * 864e5), log = [], notes = [];
  for (let d = midnight(Math.min(fromLog, fromNotes)); d < now; d = midnight(d + 36 * 36e5)) {
    const p = plan(d), at = t => Math.round(t / 6e4) * 6e4;
    for (const m of p.meals) if (at(m.t) > fromLog && m.t < now) log.push({ id: id(), t: at(m.t), name: m.name, ins: m.ins, type: 'Fiasp' });
    for (const n of p.notes) if (at(n.t) > fromNotes && n.t < now) notes.push({ id: id(), t: at(n.t), kind: n.kind, text: n.text });
  }
  // Behandlade känningar där demokurvan går under 3.9, så att snabbknapparna med egna mängder syns i demon
  let pv = 999;
  for (const [t, v] of range(fromNotes - 30 * 6e4, now)) {
    if (v < 70 && pv >= 70 && t + 10 * 6e4 > fromNotes && t + 15 * 6e4 < now) notes.push({ id: id(), t: t + 10 * 6e4, kind: 'Low treated', text: ['15 g, Dextro', '15 g', '20 g, juice'][notes.length % 3] }); pv = v;
  }
  notes.sort((a, b) => b.t - a.t); log.reverse();
  if (!db) db = { meals: MENU.flatMap(([, o]) => o).map(([name, ins]) => ({ id: id(), name, ins })), log: [], notes: [], settings: { fast: 'Fiasp', long: 'Tresiba' }, rev: 0 };
  if (log.length || notes.length) { db.log = [...log, ...(db.log || [])]; db.notes = [...notes, ...(db.notes || [])]; db.rev = (db.rev || 0) + 1; fs.writeFileSync(DBF, JSON.stringify(db)); }
}

// ---------- Målområdet ----------
// Settings → Target range: db.settings.lo och hi i mmol/L, standard 3.9–10 (de internationella gränserna). Ett värde
// bedöms på det som visas (en decimal), samma som sidan: med 10 som övre gräns är 10.0 i mål och 10.1 över.
// En känning följer inte målområdet: den är alltid minst 15 min under 70 mg/dL (3.9), så att den betyder samma sak
// oavsett vilket mål man valt. tgtC nollställs när db.json skrivs.
const okTarget = (lo, hi) => typeof lo === 'number' && typeof hi === 'number' && lo >= 3.9 && lo <= 7 && hi <= 13.9 && Math.round((hi - lo) * 10) >= 10;
let tgtC = null;
const target = () => tgtC ??= (s => okTarget(s.lo, s.hi) ? { lo: s.lo, hi: s.hi } : { lo: 3.9, hi: 10 })(readDb().settings || {});
const r1 = v => Math.round(v / 18.016 * 10) / 10, below = v => r1(v) < target().lo, above = v => r1(v) > target().hi;

// ---------- Statistik (tidsvägd, luckor över 15 min räknas inte) ----------
function stats() {
  const now = Date.now(), a = range(now - 2160 * 36e5, Infinity), out = {};
  for (const [k, h] of Object.entries({ '24h': 24, '7d': 168, '14d': 336, '30d': 720, '90d': 2160 })) {
    const from = now - h * 36e5; let w = 0, s = 0, lo = 0, hi = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i][0] < from) continue;
      const d = Math.min((a[i + 1] ? a[i + 1][0] : now) - a[i][0], 15 * 6e4), v = a[i][1];
      w += d; s += v * d; if (below(v)) lo += d; else if (above(v)) hi += d;
    }
    out[k] = w ? { avg: s / w, low: lo / w * 100, high: hi / w * 100, tir: (w - lo - hi) / w * 100, cov: Math.min(100, w / (h * 36e5) * 100) } : null;
  }
  return out;
}

// ---------- Efter en måltid: värdet vid måltiden (senaste 15 min) samt högsta och lägsta inom 3 h ----------
// cut = när en känning behandlades efter måltiden (en "Low treated"-anteckning inom 3 h), annars Infinity.
// Toppen är måltidens egen stigning: den räknas bara fram till en känning eller en behandling. Förut räknades den över
// hela 3 h, så sockret man tog mot en känning kunde bli "toppen" ("6.2 → 7.5" fast kurvan gick ner till 3.6 först).
function outcome(t, cut = Infinity) {
  const t0 = Math.floor(t / 6e4) * 6e4, o = { done: t + 3 * 36e5 <= Date.now() };
  let n = 0, pk, lo, first, end, lowAt = null;
  for (let k = t0 - 15 * 6e4; k <= t0; k += 6e4) if (R.has(k)) o.b = [k, R.get(k)];
  // Åts måltiden under en känning (ofta just för att häva den) räknas en känning först när kurvan har varit tillbaka
  // på minst 3.9; förut fick måltiden skulden för den känning den åts mot ("Very low 2.5 after 2 min").
  let rec = !(o.b && o.b[1] < 70); if (!rec) { o.sl = true; cut = Infinity; } // åt under en känning: behandlingen hör till måltiden
  for (let k = t0 + 6e4; k <= t0 + 3 * 36e5; k += 6e4) {
    const v = R.get(k); if (v === undefined) continue;
    n++; first ??= [k, v];
    if (!rec && v >= 70) rec = true;
    if (rec && v < 70 && lowAt === null) lowAt = k; // en ny känning efter måltiden: stigningen är slut
    if (lowAt === null && k < cut && (!pk || v > pk[1])) pk = [k, v];
    if (rec && (!lo || v < lo[1])) lo = [k, v];
    if (k >= t0 + 2 * 36e5) end = [k, v]; // värdet "efter 3 h": det sista från 2 h och framåt, alltså det närmast 3 h
  }
  // Gick kurvan direkt ner (känning eller behandling före första värdet) är toppen värdet vid måltiden
  if (n > 3) Object.assign(o, { pk: pk || o.b || first, lo, ...(end && { end }) });
  return o;
}
// Första lågbehandlingen inom 3 h efter en måltid (notes = db.notes), till outcome(t, cut)
const treatCut = (t, notes) => { let c = Infinity; for (const n of notes) if (n.kind === 'Low treated' && n.t > t && n.t <= t + 3 * 36e5 && n.t < c) c = n.t; return c; };
// ---------- Efter en behandlad känning ("Low treated"): värdet då, lägsta inom 2 h och när det var tillbaka över 3.9 ----------
// up = första värdet på minst 70 mg/dL efter det lägsta. Gick det aldrig under 70 finns inget "tillbaka".
function treated(t) {
  const t0 = Math.floor(t / 6e4) * 6e4, o = { done: t + 3 * 36e5 <= Date.now() };
  for (let k = t0 - 15 * 6e4; k <= t0; k += 6e4) if (R.has(k)) o.b = [k, R.get(k)];
  let lo = o.b;
  for (let k = t0 + 6e4; k <= t0 + 2 * 36e5; k += 6e4) { const v = R.get(k); if (v !== undefined && (!lo || v < lo[1])) lo = [k, v]; }
  if (lo) o.lo = lo;
  if (lo && lo[1] < 70) for (let k = lo[0] + 6e4; k <= t0 + 3 * 36e5; k += 6e4) { const v = R.get(k); if (v !== undefined && v >= 70) { o.up = [k, v]; break; } }
  return o;
}

// ---------- Dygnsprofil: percentiler per halvtimme ----------
// Ett värde per 15 min, så att dagar med minutdata inte väger tyngre än nätter som bara har 15-minutersvärden.
// [from, to): veckan och månaden under Insights (sedan Patterns-fliken togs bort 2026-11-16); profile(days) = senaste dagarna.
const profile = days => profileRange(Date.now() - days * 864e5, Date.now());
function profileRange(from, to) {
  const slot = new Map(), dates = new Set(), b = Array.from({ length: 48 }, () => []);
  for (const [t, v] of range(from, to)) { const k = Math.floor(t / 9e5); if (!slot.has(k)) slot.set(k, [t, v]); }
  for (const [t, v] of slot.values()) { const d = new Date(t); dates.add(d.toDateString()); b[d.getHours() * 2 + (d.getMinutes() >= 30 ? 1 : 0)].push(v); }
  // Ett fönster på 14 dygn räknat från nu berör 15 kalenderdagar; visa aldrig fler dagar än perioden
  // lo = andel värden under 70 mg/dL per halvtimme (null = för få värden), till remsan "när känningar händer"
  // starts = när varje känning (minst 15 min under 70) började under perioden: samma definition som veckosammanfattningen,
  // så att Mönster och Insikter ger samma svar på "när blir jag låg?"
  const pr = period(sorted(from, to), from, to);
  return { days: Math.min(Math.ceil((to - from) / 864e5), dates.size), starts: pr ? pr.lows.map(l => l[0]) : [], lo: b.map(a => a.length < 5 ? null : a.filter(v => v < 70).length / a.length), b: b.map(a => {
    if (a.length < 5) return null;
    a.sort((x, y) => x - y);
    return [.05, .25, .5, .75, .95].map(p => a[Math.min(a.length - 1, Math.floor(p * a.length))]);
  }) };
}

// ---------- En period: tid i mål, känningar m.m. ----------
// a = mätvärden sorterade på tid inom [from, to). En känning = minst 15 min i följd under 70 mg/dL, och den är slut först
// när värdet har legat på minst 70 i 15 min i följd (den internationella definitionen, Battelino m.fl. 2019/2023). Förut
// avslutades den av första värdet på 3.9, så ett värde som studsade runt 3.9 räknades som två känningar. En lucka över
// 20 min avslutar den också. dur = tiden under 70.
const sorted = (from, to) => range(from, to);
function period(a, from, to) {
  let w = 0, s = 0, lo = 0, hi = 0, ev = null, upAt = null, mn = null, mx = null; const lows = [];
  for (let i = 0; i < a.length; i++) {
    const [t, v] = a[i], next = a[i + 1] ? a[i + 1][0] : to, d = Math.min(next - t, 15 * 6e4);
    w += d; s += v * d; if (below(v)) lo += d; else if (above(v)) hi += d;
    if (!mn || v < mn[1]) mn = [t, v]; if (!mx || v > mx[1]) mx = [t, v];
    if (v < 70) { if (!ev) lows.push(ev = { t, dur: 0, min: v }); ev.dur += d; ev.min = Math.min(ev.min, v); upAt = null; }
    else if (ev) { upAt ??= t; if (next - upAt >= 15 * 6e4) { ev = null; upAt = null; } } // tillbaka på 3.9: slut efter 15 min i följd
    if (ev && next - t > 20 * 6e4) { ev = null; upAt = null; } // en lucka avslutar känningen
  }
  if (!w) return null;
  return { avg: s / w, low: lo / w * 100, high: hi / w * 100, tir: (w - lo - hi) / w * 100, cov: Math.min(100, w / (to - from) * 100), min: mn, max: mx,
    lows: lows.filter(e => e.dur >= 15 * 6e4).map(e => [e.t, e.min, Math.round(e.dur / 6e4)]) };
}
// Tid i mål per kalenderdag i [from, to): [dagens början, procent eller null, perioden]. null = under halva dygnet har värden.
// Samma uträkning för veckan, månaden och Telegram, så att staplarna alltid stämmer med varandra.
function perDay(from, to) {
  const out = [], d = new Date(from);
  while (d.getTime() < to) { const ds = d.getTime(); d.setDate(d.getDate() + 1); const de = Math.min(d.getTime(), to), q = period(range(ds, de), ds, de); out.push([ds, q && q.cov >= 50 ? Math.round(q.tir) : null, q]); }
  return out;
}
// Kvartsvärden per kalenderdag i [from, to): [dagens början, 96 värden i mg/dL (medel i kvarten, null utan värden)].
// Bergskedjan och värmekartan under Insights. Ett dygn med sommartid blir ändå 96 kvartar (23 eller 25 h delat på 96).
function quarters(from, to) {
  const out = [], d = new Date(from);
  while (d.getTime() < to) {
    const ds = d.getTime(); d.setDate(d.getDate() + 1); const de = d.getTime(), q = (de - ds) / 96, s = new Array(96).fill(0), n = new Array(96).fill(0);
    for (const [t, v] of range(ds, Math.min(de, to))) { const i = Math.min(95, Math.floor((t - ds) / q)); s[i] += v; n[i]++; }
    out.push([ds, s.map((x, i) => n[i] ? Math.round(x / n[i]) : null)]);
  }
  return out;
}
// Tid i mål per del av dygnet (natt 00–06, förmiddag 06–12, eftermiddag 12–18, kväll 18–24) i [from, to), för "Parts of
// the day" under Insights. Samma vikter som period(): varje värde räknas fram till nästa, högst 15 min. En del blir null
// när under en femtedel av dess tid har värden.
function dayParts(from, to) {
  const a = range(from, to), acc = [0, 1, 2, 3].map(() => ({ w: 0, lo: 0, hi: 0 })), span = (to - from) / 4;
  for (let i = 0; i < a.length; i++) {
    const [t, v] = a[i], next = a[i + 1] ? a[i + 1][0] : to, d = Math.min(next - t, 15 * 6e4), x = acc[Math.floor(new Date(t).getHours() / 6)];
    x.w += d; if (below(v)) x.lo += d; else if (above(v)) x.hi += d;
  }
  return acc.map(x => x.w >= span * .2 ? { tir: (x.w - x.lo - x.hi) / x.w * 100, low: x.lo / x.w * 100, high: x.hi / x.w * 100 } : null);
}
// Senaste 7 dygnen mot de 7 före, plus hur varje måltid gick (bara de som började i mål, som i appens jämförelse)
function weekly() {
  const now = Date.now(), W = 7 * 864e5, a = sorted(now - 2 * W, now), db = readDb(), part = (f, t) => a.filter(r => r[0] >= f && r[0] < t);
  const meals = new Map(), notes = {};
  for (const m of db.log) {
    if (!(m.t >= now - W && m.t <= now)) continue;
    if (isCorr(m.name)) continue; // korrigeringsdoser är inga måltider
    const o = outcome(m.t, treatCut(m.t, db.notes)); if (!o.done || !o.b || !o.pk || below(o.b[1]) || above(o.b[1])) continue;
    const k = String(m.name).toLowerCase(), x = meals.get(k) || { name: String(m.name), n: 0, hi: 0, lo: 0, peak: 0 };
    x.n++; x.hi += above(o.pk[1]) ? 1 : 0; x.lo += o.lo[1] < 70 ? 1 : 0; x.peak += o.pk[1]; meals.set(k, x);
  }
  for (const n of db.notes) if (n.t >= now - W && n.t <= now) notes[n.kind] = (notes[n.kind] || 0) + 1;
  const d0 = new Date(now); d0.setHours(0, 0, 0, 0); d0.setDate(d0.getDate() - 6);
  const pd = perDay(d0.getTime(), now), ca = part(now - W, now), cur = period(ca, now - W, now);
  return { cur, prev: period(part(now - 2 * W, now - W), now - 2 * W, now - W), ...(cur ? highlights(ca, cur.lows, pd) : {}),
    meals: [...meals.values()].map(x => ({ ...x, peak: x.peak / x.n })), notes, days: pd.map(([t, v]) => [t, v]) };
}

// ---------- Året: tid i mål per dag ----------
// Från måndagen i veckan med första mätvärdet, men högst ett år bakåt. Per dag: [dagens början, procent i mål eller null
// (under halva dygnet har värden), antal känningar, och med värden procent under och över målområdet]. Samma uträkning som dagarna i veckan och månaden (perDay).
function yearly() {
  const now = Date.now(); if (!S.length) return { days: [] };
  const d0 = new Date(Math.max(S[0][0], now - 364 * 864e5)); d0.setHours(0, 0, 0, 0); d0.setDate(d0.getDate() - ((d0.getDay() + 6) % 7));
  const p = period(range(d0.getTime(), now), d0.getTime(), now);
  return { first: S[0][0],
    days: perDay(d0.getTime(), now).map(([t, v, q]) => [t, v, q ? q.lows.length : 0, ...(v != null ? [Math.round(q.low * 10) / 10, Math.round(q.high * 10) / 10] : [])]),
    cur: p && { tir: p.tir, low: p.low, high: p.high, avg: p.avg, cov: p.cov, lows: p.lows.length } };
}

// ---------- Månaden i siffror ("Month in review") ----------
// Bara uträknade fakta om en kalendermånad, inga råd: tid i mål mot månaden före, bästa dagen, längsta tiden i följd i mål,
// flest dagar i rad utan känning, mest loggade rätter och en typisk dag (median per halvtimme). Visas under Insights, kan
// sparas som bild, och skickas av Telegram-boten den 1:a om man slagit på rapporterna.
const mkey = t => ymd(t).slice(0, 7), mstart = k => new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, 1).getTime(), mnext = k => new Date(+k.slice(0, 4), +k.slice(5, 7), 1).getTime();
// Månader med minst ett dygns värden (96 kvartsvärden), äldst först
function monthList() {
  const out = []; if (!S.length) return out;
  for (let t = mstart(mkey(S[0][0])); t <= Date.now(); t = mnext(mkey(t))) { const k = mkey(t); if (lowerBound(mnext(k)) - lowerBound(t) >= 96) out.push(k); }
  return out;
}
// Hur stor del av månaden (hittills) som har värden, i procent
const monthCov = k => { const f = mstart(k), t = Math.min(mnext(k), Date.now()), p = period(range(f, t), f, t); return p ? p.cov : 0; };
// Förvald månad: den förra så länge den nya är under en vecka gammal, annars den nya; har den för lite värden (under 20 %,
// t.ex. ett uppehåll eller bara en gammal import) den senaste månaden som har tillräckligt
const defaultMonth = list => {
  const k = mkey(Date.now()), pk = mkey(mstart(k) - 1), pref = (Date.now() - mstart(k) < 7 * 864e5 ? [pk, k] : [k, pk]).filter(m => list.includes(m));
  return pref.find(m => monthCov(m) >= 20) || [...list].reverse().find(m => monthCov(m) >= 20) || list[list.length - 1];
};
// Höjdpunkter i en period: bästa dagen (minst 70 % täckning), flest dagar i rad utan känning (en dag utan tillräckligt
// med värden bryter raden, eftersom man inte vet hur den gick) och längsta tiden i följd i målområdet (en lucka
// över 20 min avslutar den, precis som för en känning). a = värdena, lows = periodens känningar, pd = perDay().
// Används av veckan (sedan 2026-11-12, så att den börjar med det som gick bra) och månaden.
function highlights(a, lows, pd) {
  const lowDay = new Set(lows.map(l => ymd(l[0]))); let best = null, run = null, noLow = null;
  for (const [ds, v, q] of pd) {
    if (q && q.cov >= 70 && (!best || q.tir >= best.tir)) best = { t: ds, tir: Math.round(q.tir) };
    if (v !== null && !lowDay.has(ymd(ds))) { run = run ? { ...run, to: ds, n: run.n + 1 } : { from: ds, to: ds, n: 1 }; if (!noLow || run.n > noLow.n) noLow = run; } else run = null;
  }
  let inR = null, s = null;
  for (let i = 0; i < a.length; i++) {
    const [t, v] = a[i], ok = !below(v) && !above(v);
    if (ok && (!s || t - a[i - 1][0] > 20 * 6e4)) s = t;
    if (!ok) s = null; else if (!inR || t - s > inR.min * 6e4) inR = { t: s, min: Math.round((t - s) / 6e4) };
  }
  return { best, noLow, inR };
}
function monthly(k) {
  const now = Date.now(), from = mstart(k), to = Math.min(mnext(k), now), a = range(from, to), p = period(a, from, to);
  if (!p || from >= now) return null;
  const pf = mstart(mkey(from - 1)), pp = period(range(pf, from), pf, from);
  // Dag för dag: tid i mål (null = under halva dygnet har värden), och höjdpunkterna
  const pd = perDay(from, to), days = pd.map(([ds, v]) => [ds, v]), { best, noLow, inR } = highlights(a, p.lows, pd);
  // Måltider: flest gånger, och den som höll sig lägst efteråt (minst 3 gånger, började i mål, 3 h värden efter)
  const db = readDb(), cnt = new Map(), calm = new Map();
  for (const m of db.log) {
    if (!(m.t >= from && m.t < to) || isCorr(m.name)) continue;
    const key = String(m.name).toLowerCase(), c = cnt.get(key) || { name: String(m.name), n: 0 }; c.n++; cnt.set(key, c);
    const o = outcome(m.t, treatCut(m.t, db.notes)); if (!o.done || !o.b || !o.pk || below(o.b[1]) || above(o.b[1])) continue;
    const x = calm.get(key) || { name: c.name, n: 0, peak: 0 }; x.n++; x.peak += o.pk[1]; calm.set(key, x);
  }
  const steady = [...calm.values()].filter(x => x.n >= 3).map(x => ({ ...x, peak: x.peak / x.n })).sort((x, y) => x.peak - y.peak)[0] || null;
  const notes = {}; let exMin = 0;
  for (const n of db.notes) if (n.t >= from && n.t < to) { notes[n.kind] = (notes[n.kind] || 0) + 1; if (n.kind === 'Exercise' && n.dur) exMin += n.dur; }
  // Typisk dag och när känningarna börjar: samma profil som veckan
  const prof = profileRange(from, to);
  const sum = x => x && { tir: x.tir, low: x.low, high: x.high, avg: x.avg, cov: x.cov, lows: x.lows.length };
  return { m: k, from, to, partial: mnext(k) > now, n: a.length, cur: sum(p), prev: pp && pp.cov >= 20 ? { m: mkey(pf), ...sum(pp) } : null,
    days, best, noLow, inR, top: [...cnt.values()].sort((x, y) => y.n - x.n).slice(0, 3), meals: [...cnt.values()].reduce((x, y) => x + y.n, 0), steady, notes, exMin, prof };
}

// ---------- Lokal AI (Ollama) ----------
// Allt körs på den här datorn. Modellen får en sammanfattning av de senaste 14 dagarna och svarar på frågor om den.
// Den får aldrig ge dosråd; det står i instruktionen och i appen.
const p2 = n => String(n).padStart(2, '0'), hm = t => { const d = new Date(t); return p2(d.getHours()) + ':' + p2(d.getMinutes()); };
const ymd = t => { const d = new Date(t); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
// Ollama startas när dashboarden startar (och igen om den behövs och inte svarar), när den ska köra på den här
// datorn. OLLAMA_AUTOSTART=0 stänger av det. En Ollama som dashboarden själv startat stängs när dashboarden stängs;
// en som redan körde (t.ex. Ollamas egen app) lämnas ifred. Ett nytt startförsök görs tidigast efter en minut.
const cp = require('child_process');
const OLLAMA_HERE = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/i.test(OLLAMA_URL);
const ollamaUp = () => fetch(OLLAMA_URL + '/api/tags', { signal: AbortSignal.timeout(2e3) }).then(r => r.ok, () => false);
let ollamaStarting = null, ollamaChild = null;
function stopOllama() {
  const p = ollamaChild; ollamaChild = null;
  if (!p || p.exitCode !== null) return;
  // Hela trädet: Ollama kör modellen i en egen underprocess som annars blir kvar och håller grafikminnet
  if (process.platform === 'win32') cp.spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  else try { p.kill('SIGTERM'); } catch {}
}
process.on('exit', stopOllama);
// Ctrl+C, stängt konsolfönster (SIGHUP på Windows) eller avstängning: stäng Ollama först, avsluta sedan
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(sig, () => { stopOllama(); process.exit(0); });
function startOllama() {
  if (!OLLAMA_HERE || OLLAMA_AUTOSTART === '0') return Promise.resolve(false);
  return ollamaStarting ||= (async () => {
    if (await ollamaUp()) return true;
    const exe = [path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe'), '/usr/local/bin/ollama', '/opt/homebrew/bin/ollama', '/usr/bin/ollama']
      .find(f => path.isAbsolute(f) && fs.existsSync(f)) || 'ollama';
    const spawned = await new Promise(done => {
      const p = cp.spawn(exe, ['serve'], { stdio: 'ignore', windowsHide: true, env: { ...process.env, OLLAMA_HOST: new URL(OLLAMA_URL).host } });
      p.once('error', e => { console.error('Could not start Ollama:', e.message); done(false); });
      p.once('spawn', () => { ollamaChild = p; p.once('exit', () => { if (ollamaChild === p) ollamaChild = null; }); done(true); });
    });
    if (spawned) for (let i = 0; i < 40; i++) { await sleep(500); if (await ollamaUp()) { console.log('Started Ollama (local AI).'); return true; } }
    return false;
  })().finally(() => setTimeout(() => { ollamaStarting = null; }, 6e4));
}
let tags = { t: 0, names: [] };
async function aiModel() {
  if (Date.now() - tags.t > 6e4) {
    const get = async () => (await (await fetch(OLLAMA_URL + '/api/tags', { signal: AbortSignal.timeout(3e3) })).json()).models || [];
    // Inte igång: starta (på den här datorn) och försök igen. På en annan dator (t.ex. från en Raspberry Pi) betyder
    // ett uteblivet svar att den datorn är av, sover eller inte släpper igenom port 11434.
    let ms; try { ms = await get(); } catch (e) { if (!(await startOllama())) throw OLLAMA_HERE ? e : Object.assign(new Error('x'), { cause: e }); ms = await get(); }
    tags = { t: Date.now(), names: ms.map(m => m.name) };
  }
  const n = tags.names;
  if (OLLAMA_MODEL) { if (n.some(x => x === OLLAMA_MODEL || x === OLLAMA_MODEL + ':latest')) return OLLAMA_MODEL; throw new Error(`The model ${OLLAMA_MODEL} is not installed. Run: ollama pull ${OLLAMA_MODEL}`); }
  const m = n.find(x => x.startsWith('gemma4')) || n.find(x => x.startsWith('gemma')) || n[0];
  if (!m) throw new Error('No AI model is installed. Run: ollama pull gemma4:12b');
  return m;
}
// Utan egen AI-dator och utan autostart (t.ex. en Raspberry Pi utan OLLAMA_URL) finns det ingen Ollama att starta här
const aiErr = e => e.name === 'TimeoutError' ? 'The local AI took too long to answer. Try again.'
  : e.cause || e.name === 'TypeError' ? (OLLAMA_HERE ? (OLLAMA_AUTOSTART === '0' && !process.env.OLLAMA_URL ? 'No local AI is set up for this dashboard. Free text still works with the simple reader.' : 'The local AI is not running. Start Ollama and try again.')
    : `The AI computer (${new URL(OLLAMA_URL).hostname}) is not answering. It may be off or asleep.`) : e.message;
// Ollamas standardfönster är ofta bara 4096 tokens, och då kapas BÖRJAN av texten (dagens datum, sammanfattningen och de
// senaste måltiderna) utan varning. Samma storlek i alla anrop, annars laddar Ollama om modellen mellan dem.
const NUM_CTX = 16384;
async function ollama(o, signal) {
  const r = await fetch(OLLAMA_URL + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, signal,
    body: JSON.stringify({ model: await aiModel(), keep_alive: '15m', think: false, ...o, options: { ...o.options, num_ctx: NUM_CTX } }) });
  if (!r.ok) throw new Error(`The local AI answered HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r;
}
// Hur många tokens den lokala AI:n använder: en rad per svar i data/ai-tokens.jsonl (bara antal, aldrig texten)
const TOKF = path.join(DIR, 'ai-tokens.jsonl');
const logTokens = (kind, j) => { if (!j || !Number.isFinite(j.eval_count)) return;
  fs.appendFile(TOKF, JSON.stringify({ t: Date.now(), kind, model: j.model, prompt: j.prompt_eval_count || 0, out: j.eval_count, ms: Math.round((j.total_duration || 0) / 1e6) }) + '\n', () => {}); };
// ---------- Modellen laddad bara medan dashboarden är öppen ----------
// Varje öppen sida frågar /api/now varje minut med sitt eget id (c). Så länge någon sida är öppen hålls modellen laddad
// (den tunga delen, flera GB på grafikkortet); när den sista stängs (/api/bye, eller efter 3 min utan anrop) släpps
// den direkt i stället för efter Ollamas egna 5 min. Ollama-programmet själv kan vara igång hela tiden. Telegram och
// fritexten laddar modellen när de behöver den, som förut. OLLAMA_PRELOAD=0 stänger av det här.
const pages = new Map(); let aiWarm = 0;
const aiKeep = keep_alive => aiModel().then(model => fetch(OLLAMA_URL + '/api/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(6e4),
  body: JSON.stringify({ model, keep_alive, options: { num_ctx: NUM_CTX } }) }));
function pageSeen(c) {
  if (!c || process.env.OLLAMA_PRELOAD === '0') return;
  pages.set(String(c).slice(0, 40), Date.now());
  if (Date.now() - aiWarm < 5 * 6e4) return; // laddad: förläng var 5:e minut (keep_alive 10 min)
  aiWarm = Date.now(); aiKeep('10m').catch(() => { aiWarm = Date.now() - 3 * 6e4; }); // datorn av: försök igen om 2 min
}
function pageGone(c) { pages.delete(String(c)); if (!pages.size) aiRelease(); }
function aiRelease() { if (!aiWarm) return; aiWarm = 0; aiKeep(0).then(() => console.log('Released the AI model (no dashboard open).'), () => {}); }
setInterval(() => { for (const [k, t] of pages) if (Date.now() - t > 3 * 6e4) pages.delete(k); if (!pages.size) aiRelease(); }, 6e4).unref();
function aiContext() {
  const now = Date.now(), db = readDb(), mm = v => (v / 18.016).toFixed(1), L = [], T = target(), std = T.lo === 3.9 && T.hi === 10;
  const sum = p => `average ${mm(p.avg)}, in range ${p.tir.toFixed(0)} %, below ${T.lo} ${p.low.toFixed(1)} %, above ${T.hi} ${p.high.toFixed(0)} %, lows ${p.lows.length}, data ${p.cov.toFixed(0)} %`;
  L.push(`Now: ${ymd(now)} ${hm(now)} (${new Date(now).toLocaleDateString('en-GB', { weekday: 'long' })}). Current reading: ${last ? `${mm(last.v)} mmol/L at ${hm(last.t)}` : 'none'}.`,
    `All glucose values are mmol/L. Target range ${T.lo.toFixed(1)}-${T.hi.toFixed(1)}${std ? '' : ' (chosen by the user; the international standard is 3.9-10.0)'}. Goals: in range over 70 %, below ${T.lo} under 4 %, above ${T.hi} under 25 %. A "low" is at least 15 minutes below 3.9, whatever the target range.`);
  const s = db.settings || {}; if (s.fast || s.long) L.push(`Insulin: mealtime ${s.fast || 'not set'}, basal ${s.long || 'not set'}.`);
  const w = weekly();
  // Dagen med veckodag, och "today"/"yesterday": modellen tog annars ibland fel dag på "igår"
  const day0 = new Date(now).setHours(0, 0, 0, 0), dTag = t => { const k = Math.round((day0 - new Date(t).setHours(0, 0, 0, 0)) / 864e5); return `${ymd(t)} ${new Date(t).toLocaleDateString('en-GB', { weekday: 'short' })}${k === 0 ? ' (today)' : k === 1 ? ' (yesterday)' : ''}`; };
  const span = (a, b) => `${ymd(a)} ${hm(a)} to ${ymd(b)} ${hm(b)}`; // skrivs ut så att modellen inte gissar datumen själv
  // Insulinet summerat här: modellen räknade fel när den fick lägga ihop dagarna själv
  const insIn = (a, b) => { const x = db.log.filter(m => m.t >= a && m.t < b), u = Math.round(x.reduce((y, m) => y + (+m.ins || 0), 0) * 10) / 10; return `mealtime insulin ${u} units in ${x.length} doses`; };
  L.push('', 'SUMMARY', `Last 7 days (${span(now - 7 * 864e5, now)}): ${w.cur ? sum(w.cur) : 'no readings'}, ${insIn(now - 7 * 864e5, now)}`,
    `The 7 days before (${span(now - 14 * 864e5, now - 7 * 864e5)}): ${w.prev ? sum(w.prev) : 'no readings'}, ${insIn(now - 14 * 864e5, now - 7 * 864e5)}`);
  L.push('', 'DAYS (newest first; lows listed as start time, lowest value, minutes)');
  const a = sorted(now - 15 * 864e5, now);
  for (let i = 0; i < 14; i++) {
    const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
    const from = d.getTime(); d.setDate(d.getDate() + 1); const to = Math.min(d.getTime(), now);
    const p = period(a.filter(r => r[0] >= from && r[0] < to), from, to), lab = `${dTag(from)}${i === 0 ? ' so far' : ''}`;
    const di = db.log.filter(m => m.t >= from && m.t < to), dIns = Math.round(di.reduce((x, m) => x + (+m.ins || 0), 0) * 10) / 10;
    L.push(p ? `${lab}: ${sum(p)}, mealtime insulin ${dIns} units in ${di.length} ${di.length === 1 ? 'dose' : 'doses'}, lowest ${mm(p.min[1])} at ${hm(p.min[0])}, highest ${mm(p.max[1])} at ${hm(p.max[0])}${p.lows.length ? ', lows: ' + p.lows.map(([t, v, n]) => `${hm(t)} ${mm(v)} ${n} min`).join('; ') : ''}` : `${lab}: no readings`);
  }
  L.push('', `MEALS, last 14 days (glucose at the meal, the peak within 3 h, then the lowest value between the peak and 3 h after the meal, and how many minutes of those 3 h were above ${T.hi})`);
  // Minuter över målområdet inom 3 h efter måltiden, tidsvägt (luckor över 15 min räknas inte). Förut fick AI:n bara toppen
  // och det lägsta värdet, och gissade på frågan "hur länge ligger jag över 10" (i test: "tillbaka i mål inom 3 h" om en
  // pizza som låg på 13,1 efter 3 h).
  const minAbove = (from, to) => { const a = range(from, to); let s = 0; for (let i = 1; i < a.length; i++) { const d = a[i][0] - a[i - 1][0]; if (d <= 15 * 6e4 && above(a[i - 1][1])) s += d; } return Math.round(s / 6e4); };
  // Lägsta värdet efter toppen: det som spelar roll för en känning. Lägsta inom hela 3 h är ofta bara värdet före stigningen.
  const lowAfter = (from, to) => { let lo = null; for (let k = Math.ceil(from / 6e4) * 6e4; k <= to; k += 6e4) { const v = R.get(k); if (v !== undefined && (!lo || v < lo[1])) lo = [k, v]; } return lo; };
  for (const m of db.log.filter(m => m.t >= now - 14 * 864e5 && m.t <= now)) {
    const o = outcome(m.t, treatCut(m.t, db.notes)), min = t => Math.round((t - m.t) / 6e4) + ' min', la = o.pk && lowAfter(o.pk[0], m.t + 3 * 36e5);
    L.push(`${dTag(m.t)} ${hm(m.t)} ${m.name}, ${m.ins} units: ${o.b ? 'at meal ' + mm(o.b[1]) : 'no reading at meal'}${o.pk ? `, peak ${mm(o.pk[1])} after ${min(o.pk[0])}` : ''}${la ? `, then lowest ${mm(la[1])} after ${min(la[0])}` : ''}${o.pk ? ` => ${[above(o.pk[1]) && `went above ${T.hi} (${minAbove(m.t, Math.min(now, m.t + 3 * 36e5))} min above${o.done && la && above(la[1]) ? (la[0] >= m.t + 165 * 6e4 ? ', still above at 3 h' : ', then no readings') : ''})`, la && la[1] < 70 && 'went below 3.9'].filter(Boolean).join(' and ') || 'stayed in range'}` : ''}${o.done ? '' : ' (under 3 h ago)'}`);
  }
  const notes = db.notes.filter(n => n.t >= now - 14 * 864e5 && n.t <= now);
  if (notes.length) L.push('', 'NOTES, last 14 days', ...notes.map(n => `${dTag(n.t)} ${hm(n.t)}${n.dur ? '-' + hm(n.t + n.dur * 6e4) : ''} ${n.kind}${n.text ? ': ' + n.text : ''}`));
  // Varje rätt de senaste 90 dagarna, så att frågor som "hur brukar pizza gå" kan besvaras (förut bara 14 dagar)
  const med = x => { const v = [...x].sort((p, q) => p - q), n = v.length; return n ? (n % 2 ? v[n >> 1] : (v[n / 2 - 1] + v[n / 2]) / 2) : null; }, dish = new Map();
  for (const m of db.log) if (m.t >= now - 90 * 864e5 && m.t <= now && !isCorr(m.name)) { const k = String(m.name).toLowerCase(); if (!dish.has(k)) dish.set(k, { name: m.name, list: [] }); dish.get(k).list.push(m); }
  if (dish.size) L.push('', 'DISHES, last 90 days (times eaten; logged doses; median glucose at the meal and median peak within 3 h; times it went below 3.9 within 3 h)');
  for (const { name, list } of [...dish.values()].sort((p, q) => q.list.length - p.list.length).slice(0, 30)) {
    const os = list.map(m => outcome(m.t, treatCut(m.t, db.notes))), ds = list.map(m => +m.ins || 0), at = os.filter(o => o.b).map(o => o.b[1]), pk = os.filter(o => o.pk).map(o => o.pk[1]);
    L.push(`${name}: ${list.length}x, doses ${Math.min(...ds) === Math.max(...ds) ? Math.min(...ds) : Math.min(...ds) + '-' + Math.max(...ds)} units${at.length ? ', at meal ' + mm(med(at)) : ''}${pk.length ? ', peak ' + mm(med(pk)) : ''}, below 3.9 afterwards ${os.filter(o => o.lo && o.lo[1] < 70).length}x`);
  }
  // Kalendermånaderna det senaste året och dygnets delar de senaste 30 dagarna mot de 30 före
  L.push('', 'MONTHS (calendar months, newest first)');
  for (let i = 0; i < 12; i++) {
    const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(1); d.setMonth(d.getMonth() - i); const from = d.getTime(); d.setMonth(d.getMonth() + 1); const to = Math.min(d.getTime(), now);
    const p = period(range(from, to), from, to); if (p && p.cov >= 20) L.push(`${new Date(from).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}${i === 0 ? ' (so far)' : ''}: ${sum(p)}, ${insIn(from, to)}`);
  }
  const PN = ['Night 00-06', 'Morning 06-12', 'Afternoon 12-18', 'Evening 18-24'], dp = (a, b) => dayParts(a, b).map((x, i) => `${PN[i]}: ${x ? `in range ${x.tir.toFixed(0)} %, below ${T.lo} ${x.low.toFixed(1)} %, above ${T.hi} ${x.high.toFixed(0)} %` : 'too few readings'}`);
  L.push('', 'PARTS OF THE DAY, last 30 days', ...dp(now - 30 * 864e5, now), 'PARTS OF THE DAY, the 30 days before', ...dp(now - 60 * 864e5, now - 30 * 864e5));
  if (sens.starts.length) L.push('', 'SENSOR STARTS (newest last; readings can be less accurate the first day)', sens.starts.slice(-6).map(t => `${ymd(t)} ${hm(t)}`).join(', '));
  const pr = profile(14).b; L.push('', 'TIME OF DAY, last 14 days (typical value and the low end, 5th percentile)');
  for (let h = 0; h < 24; h += 2) {
    const q = pr.slice(h * 2, h * 2 + 4).filter(Boolean);
    if (q.length) L.push(`${p2(h)}-${p2(h + 2)}: typical ${mm(q.reduce((x, y) => x + y[2], 0) / q.length)}, low end ${mm(Math.min(...q.map(x => x[0])))}`);
  }
  return L.join('\n');
}
const ASK = `You are a friendly, knowledgeable assistant in a personal blood glucose dashboard. The user has type 1 diabetes, wears a FreeStyle Libre sensor, logs meals with their mealtime insulin, sometimes long-acting insulin, and notes. Their data is below.
How to answer:
- Base facts and numbers on the data. When the data gives a total or an average, use it as it is. Otherwise you may add up, count, average and compare; say briefly how you got the number.
- Be exact about the target range given at the top of the data: a value above its upper limit is high and one below its lower limit is below range, even for a short time. Under 3.9 is low.
- Explain, don't just list. Point out patterns, compare with earlier periods and say what stands out, good things too.
- When asked why something happened, name possible contributing factors you can see in the data (when and what they ate, a high before a low, exercise, alcohol, illness or stress notes, a new sensor, gaps in readings) and general, well-known type 1 effects (fat and protein can delay and stretch the rise, exercise can lower glucose for hours, stress and illness can raise it). Check the times: only link something to an event that came before it. Say how sure you are. If the data cannot tell, say so plainly.
- Be warm and direct, like a knowledgeable friend. Usually 2 to 6 sentences or a few "- " bullet points. Use mmol/L, dates and times.
- You may end with one thing they could keep an eye on, or bring up with their diabetes team.
Rules, most important first:
1. Never recommend, suggest or estimate an insulin dose, a dose change, an insulin-to-carb ratio, carbohydrate amounts or any other treatment change, not as a range, not as an example and not when asked directly. Doses already logged in the data may be stated, counted and summed as facts.
2. Do not diagnose, and do not judge whether a dose or an insulin is right, works, or is too much or too little.
3. Never invent readings, meals or events that are not in the data.
4. Answer in the language of the question. Plain text: short paragraphs or "- " bullet points, **bold** at most, no headings, no LaTeX or math symbols.

DATA
`;
// Modellen följer inte alltid instruktionen ovan (i test gav den ett dosförslag på en direkt fråga). Därför:
// 1) frågor som ber om en dos besvaras här med ett fast svar och når aldrig modellen,
// 2) regeln upprepas sist i varje fråga, där en liten modell tar störst hänsyn till den.
// Spärren före AI:n stoppar bara frågor om vad man SKA göra med insulinet ("ska jag ta mer insulin", "hur många enheter
// ska jag ta", "behöver jag korrigera", "är 5 enheter lagom"). Frågor om vad som HAR hänt ("hur mycket insulin har jag
// tagit", "tog jag", "brukar jag ta") och varför-frågor går till AI:n, som får räkna på loggade doser men aldrig föreslå
// en. Förut stoppades också faktafrågor med ett fast svar, medan "Behöver jag korrigera nu?" slank igenom.
// Granskningen 2026-11-22 visade att spärren släppte igenom de vanligaste dosfrågorna ("How many units for pizza?",
// "Ge mig en dos för pizza", "Vilken dos passar till tacos?"), och att allt som började med "Varför" gick förbi, även
// "Varför går jag högt? Ska jag ta mer insulin?". Nu bedöms varje mening för sig, och varför-frågor släpps bara förbi
// mönstren som beskriver ett behov ("Varför behöver jag mer insulin på morgonen?"), aldrig de som ber om en dos.
// Frågor om det som HAR hänt ("hur mycket insulin tog jag igår") går fortfarande till AI:n.
const W = '(?![\\p{L}])'; // slutet av ett ord (\b räknar å, ä och ö som ordgräns)
const DOSE_W = `(?<![\\p{L}])(units?|insulin\\w*|doses?|dosing|bolus\\w*|basal|ratio|correct\\w*|enhet\\w*|dos(en|er|erna|era)?|kvot\\w*|korrig\\w*|korrektion\\w*|ie|iu)${W}`;
const DOSE_N = `(?<![\\p{L}])(units?|doses?|dosing|bolus\\w*|ratio|enhet\\w*|dos(en|er|erna|era)?|kvot\\w*)${W}`; // dosen själv, inte ordet insulin
const STRONG = `(should|shall|ought|must|recommend\\w*|suggest\\w*|advi[cs]e\\w*|ska|skall|bör|borde|måste|rekommender\\w*|föreslå\\w*|råd\\w*)${W}`;
const NEEDISH = `(do i need|need to|behöver)${W}`;
const AMOUNT = `(too much|too little|enough|lagom|för mycket|för lite|tillräckligt)${W}`;
// "Which meal needs more insulin than I usually take?" slank förut igenom: "needs" fanns inte bland orden, och
// "more/less insulin" är en fråga om att ändra dosen även utan "should". Därför egna mönster för båda.
const NEED = `(needs?|needed|requires?|kräver|krävs|behövs)${W}`;
const MORE = `(more|less|fewer|extra|higher|lower|mer|mera|mindre|färre|högre|lägre|större)${W}`;
const HOWMUCH = '(how many|how much|hur många|hur mycket)';
const GIVE = `(give|calculate|compute|estimate|work out|figure out|ge|räkna ut|beräkna|uppskatta)${W}`;
const RIGHT = `(right|best|ideal|optimal|good|okay|ok|fits?|suits?|rätt|rätta|bästa|bra|passar|funkar|fungerar)${W}`;
const WHICH = `(which|what|vilken|vilket|vilka)${W}`;
const FOR = `(for|per|för|till|mot)${W}`;
// Det som redan hänt: "did I", "har jag tagit", "brukar jag", "igår". Släpper bara förbi mängdfrågorna (FACT).
const PAST = /(^|[^\p{L}])(did|have i|have you|has|had|took|taken|was|were|used|usually|logged|last time|yesterday|brukar|tog|har jag|hade|tagit|tagits|loggade|loggat|var|blev|förra gången|senast|igår|i går)(?![\p{L}])/iu;
const pat = (...xs) => new RegExp(xs.map(x => `(^|[^\\p{L}])(${x})`).join('|'), 'iu');
// Ber alltid om ett råd eller ett omdöme om en dos
const ASKS = pat(`${STRONG}.{0,60}${DOSE_W}`, `${DOSE_W}.{0,60}${STRONG}`, `${RIGHT}.{0,40}${DOSE_N}`, `${DOSE_N}.{0,40}${RIGHT}`, `${AMOUNT}.{0,30}${DOSE_W}`, `${DOSE_W}.{0,30}${AMOUNT}`);
// Frågar efter en mängd ("how many units for pizza", "ge mig en dos", "vilken dos"): stoppas om den inte gäller det som hänt
const FACT = pat(`${HOWMUCH}.{0,40}${DOSE_W}`, `${DOSE_W}\\s+${FOR}\\s*\\p{L}`, `${GIVE}.{0,40}${DOSE_N}`, `${WHICH}\\s+(\\p{L}+\\s+){0,2}${DOSE_N}`);
// Beskriver ett behov ("behöver mer insulin"): stoppas, utom i en varför-fråga
const DESCRIBE = pat(`${NEEDISH}.{0,60}${DOSE_W}`, `${DOSE_W}.{0,60}${NEEDISH}`, `${NEED}.{0,60}${DOSE_W}`, `${MORE}\\s+(\\p{L}+\\s+)?${DOSE_W}`);
const WHY_Q = /^\s*(varför|why|hur kommer det sig|how come)(?![\p{L}])/iu;
const doseSentence = s => ASKS.test(s) || (FACT.test(s) && !PAST.test(s)) || (DESCRIBE.test(s) && !WHY_Q.test(s));
const doseQ = q => String(q).replace(/(\d),(\d)/g, '$1.$2').split(/[.!?;]+(?=\s|$)|\n+/).some(s => s.trim() && doseSentence(s.trim()));
// Svaret kontrolleras också, mening för mening innan den skickas: en dos eller en kvot som förslag stoppar svaret.
// Doser som redan loggats får nämnas ("du tog 6 enheter"), så meningar i dåtid släpps igenom.
const OUT_DOSE = /\d+(?:[.,]\d+)?\s*(?:units?|u|e|ie|iu|enheter|enhet)(?![\p{L}])/iu;
const OUT_RATIO = /(?:1\s*(?:units?|u|e|enhet)?\s*(?:per|\/|:)\s*\d+\s*(?:g|gram|grams)\b)|(?:\d+\s*(?:g|gram|grams)\s*(?:per|\/)\s*(?:units?|u|e|enhet)\b)|(?:carb ratio|kolhydratkvot|insulinkvot|insulin-to-carb)\D{0,20}\d/iu;
const OUT_ADVICE = /(^|[^\p{L}])(should|could|might|would|try|consider|recommend\w*|suggest\w*|maybe|perhaps|increase|decrease|raise|reduce|lower|add|take|inject|bör|borde|kan|kanske|prova|överväg\w*|rekommender\w*|föreslå\w*|öka|minska|höj|sänk|ta|injicera|lägg till)(?![\p{L}])/iu;
const OUT_PAST = /(^|[^\p{L}])(took|taken|logged|was|were|had|tog|tagit|loggade|loggat|var|hade|blev)(?![\p{L}])/iu;
const adviceOut = s => OUT_RATIO.test(s) || (OUT_DOSE.test(s) && OUT_ADVICE.test(s) && !OUT_PAST.test(s));
const DOSE_NO = sv => sv
  ? 'Jag kan inte ge råd om doser eller ändringar i behandlingen. Det beslutet är ditt och ditt diabetesteams.\n\nNär du loggar en måltid visar appen hur det gick de senaste gångerna du åt samma sak, och under Meals → Compared jämförs dina måltider. Jag kan gärna beskriva vad som hände efter en viss måltid, till exempel: "Hur har det gått de senaste gångerna jag ätit pizza?"'
  : 'I can\'t give advice on doses or treatment changes. That decision is yours and your diabetes team\'s.\n\nWhen you log a meal, the app shows how it went the last times you had the same thing, and Meals → Compared compares your meals. I can describe what happened after a meal, for example: "How did it go the last times I had pizza?"';
const SWEDISH = /[åäö]|\b(jag|ska|hur|vad|och|mina?|varför|när|vilka?)\b/i;
const REMIND = '\n\n(Reminder: never recommend or estimate insulin doses, ratios or treatment changes. Logged doses may be stated and summed.)';

// ---------- Logga med egna ord: "pizza 7,5 enheter", "promenad 45 min" ----------
// Används av textfältet på dashboarden och av Telegram-boten. Den lokala AI:n tolkar texten; är den inte igång tar en
// enkel regelbaserad tolkare över. ref = när texten skrevs, så att "för 20 min sen" blir rätt även när ett
// Telegram-meddelande läses först när datorn startar.
// "Low treated" = snabba kolhydrater mot en känning (samma namn som anteckningstypen på dashboarden)
const KINDS = ['Exercise', 'Alcohol', 'Illness', 'Stress', 'Low treated', 'Long-acting', 'Other'];
const INTERPRET = names => `Turn the user's message into one entry for a diabetes diary. It can be in any language and may be dictated.
Saved meals: ${names.join('; ') || '(none)'}
- type: "meal" if they ate something, "note" for exercise, alcohol, illness, stress, treating a low (dextrose, juice or sweets taken because glucose was low) or a similar event, "other" if it is neither (a question, a greeting, unclear).
- meal: for a meal, the saved meal name exactly if the text refers to one (also in another language or misspelled). Otherwise a short, natural dish name in the user's language: capital first letter, obvious typos fixed, separate foods joined the way people write a dish ("fläskfärs ris" -> "Fläskfärs och ris", "kyckling pasta pesto" -> "Kyckling med pasta och pesto", "chicken rice" -> "Chicken and rice"). Never add or drop foods. "" otherwise.
- Insulin taken without food is a correction dose ("1,5 enheter ingen mat", "2 units correction", "tog 2 e för att jag låg högt"): type "meal", meal "Correction", units = the dose. Never a note.
- units: insulin units taken for the meal. A bare number next to the food usually means units. A number with g, gram or carbs is never units. null if not given.
- Long-acting (basal) insulin is never a meal and never a correction: type "note", note_kind "Long-acting" ("lantus 14", "tresiba 20 e", "basal 12 enheter"), note_text the insulin name and the dose ("Lantus 14 units").
- note_kind: for a note one of Exercise, Alcohol, Illness, Stress, Low treated (sugar taken against a low: "druvsocker 15 g", "känning, drack juice"), Long-acting, Other. "" otherwise.
- note_text: for a note, a short natural description in the user's language with a capital first letter, WITHOUT the duration (the app shows it as a time span): "promenad 5 minuter" -> "Kort promenad", "gymmade en timme" -> "Gym", "promenad 5 km" -> "Promenad 5 km", "tog två öl" -> "Två öl". Keep distances and amounts. "" otherwise.
- duration_minutes: for a note, how long the activity lasted if said ("5 minuter" = 5, "en timme" = 60, "1,5 h" = 90). A distance is not a duration. null otherwise.
- minutes_ago: only when they say it happened some time ago ("för 20 min sen", "20 min ago", "för en halvtimme sen" = 30). Never the length of an activity. null otherwise.
- clock: "HH:MM" in 24 h if a clock time is given, otherwise null.
- days_ago: 1 for "igår"/"i går"/"yesterday", 2 for "i förrgår", otherwise 0.
Never invent numbers.`;
const INTERPRET_SCHEMA = { type: 'object', required: ['type', 'meal', 'units', 'note_kind', 'note_text', 'duration_minutes', 'minutes_ago', 'clock', 'days_ago'], properties: {
  type: { type: 'string', enum: ['meal', 'note', 'other'] }, meal: { type: 'string' }, units: { type: ['number', 'null'] },
  note_kind: { type: 'string', enum: [...KINDS, ''] }, note_text: { type: 'string' }, duration_minutes: { type: ['number', 'null'] },
  minutes_ago: { type: ['number', 'null'] }, clock: { type: ['string', 'null'] }, days_ago: { type: ['number', 'null'] } } };
// En anteckning med längd ("promenad 5 minuter") slutar när den skrevs, om inte en starttid angavs ("kl 17", "för en timme sen")
const okDur = d => Number.isFinite(d) && d >= 1 && d <= 1440 ? Math.round(d) : null;
const noteAt = (kind, text, dur, t, timed, ref) => ({ type: 'note', kind, text: text ? text.charAt(0).toUpperCase() + text.slice(1) : '', ...(dur && { dur }), t: dur && !timed ? ref - dur * 6e4 : t });
const mealNames = db => [...new Map([...db.meals.map(m => m.name), ...db.log.slice(0, 300).map(m => m.name)].map(n => [String(n).toLowerCase(), String(n)])).values()].slice(0, 80);
// En klocktid mer än 5 min efter ref betyder dagen innan ("kl 22" skrivet strax efter midnatt)
const atClock = (h, m, ref) => { const d = new Date(ref); d.setHours(h, m, 0, 0); if (d - ref > 5 * 6e4) d.setDate(d.getDate() - 1); return d.getTime(); };

// Den enkla tolkaren: tal + enhet = dos, "20 min sen"/"kl 18:30" = tid, några ord = anteckning, resten = maten
const UNIT = /^(u|units?|e|enh|enhet|enheter|ie|iu)$/, MINW = /^(m|min|mins|minut|minuter|minute|minutes)$/, HOURW = /^(h|hr|hrs|hour|hours|tim|timme|timmar)$/, AGO = /^(ago|sedan|sen|sedn)$/;
const DIST = /^(km|kilometer|kilometers|mil|meter|steg|steps)$/, GRAM = /^(g|gr|gram|grams|grammes?|kh|carbs?|kolhydrater)$/;
const EDGE = new Set(['till', 'på', 'gick', 'went', 'for', 'did', 'to', 'i', 'had', 'have', 'ate', 'eat', 'eaten', 'took', 'take', 'with', 'and', 'at', 'about', 'around', 'kl', 'klockan', 'för', 'med', 'och', 'tog', 'åt', 'jag', 'har', 'ett', 'en', 'a', 'an', 'the', 'of', 'insulin', 'some', 'lite', 'cirka', 'ca', 'runt', 'typ', 'just', 'nyss', 'now', 'nu', 'plus', 'samt']);
// Känning först: "promenad, känning efteråt" handlar om känningen
const NOTE_WORDS = [['Low treated', /^(druvsocker|dextro|dextrosol|glukos|glukostabletter|glucose|hypo|känning|känningen|känningar)$/], ['Exercise',/^(träna|tränade|träning|gym|gymmade|gymmet|promenad|promenerade|cykel|cyklade|cykling|löpning|sprang|jogga|joggade|simmade|simning|walk|walked|run|ran|running|workout|exercise|bike|biked|cycling|swim|swam|yoga|fotboll|padel|tennis)$/],
  ['Alcohol', /^(öl|vin|alkohol|drink|drinkar|beer|beers|wine|alcohol|cocktail|cider|sprit)$/], ['Illness', /^(sjuk|förkyld|feber|influensa|magsjuk|ill|sick|fever|flu)$/], ['Stress', /^(stress|stressad|stressed)$/]];
const norm = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
// Returnerar [namn, känd]: känd = en sparad eller tidigare loggad rätt
function matchMeal(raw, names) {
  const q = norm(raw), hit = names.find(n => norm(n) === q); if (hit) return [hit, true];
  // Del av ett namn ("pasta" -> "Pasta bolognese"), annars flest gemensamma ord
  const qt = q.split(' '), sc = names.map(n => { const nt = norm(n).split(' '); return { n, s: qt.filter(a => a.length > 2 && nt.some(b => b.startsWith(a) || (a.startsWith(b) && b.length > 2))).length / qt.length }; })
    .filter(x => x.s >= .6).sort((a, b) => b.s - a.s || a.n.length - b.n.length);
  return sc.length ? [sc[0].n, true] : [raw.charAt(0).toUpperCase() + raw.slice(1), false];
}
// Insulin utan mat ("1,5 enheter ingen mat", "2 e korrigering", "2 units"): en korrigeringsdos. Den loggas som en rad i
// måltidsloggen med namnet Correction, så att den räknas i insulinsumman och visar insulintypen, men den jämförs inte
// med måltiderna. Förut blev "1,5 enheter ingen mat" en anteckning (Other) med AI:n och en måltid "Ingen mat" utan.
const CORR = 'Correction';
const NOFOOD = /^(ingen|utan|no|without|not|inte|mat|food|meal|måltid|ate|åt|bara|only|dos|dosen|dose|korr\w*|correct\w*|fiasp|novorapid|humalog|lyumjev|apidra|actrapid|trurapi)$/;
const isCorr = name => String(name).toLowerCase() === CORR.toLowerCase();
// Skälet till en korrektion ("2 enheter för att jag låg högt"): bara sådana ord och en dos är också en korrektion
const WHY = /^(att|eftersom|pga|då|låg|ligger|var|är|blev|högt|hög|höga|high|was|so|because|blodsocker|blodsockret|sockret|bs|bring|it|down|ner|sänka|för)$/;
// Långverkande insulin är ingen måltidsdos. Den sparas som en anteckning "Long-acting" med dosen i texten ("Lantus 14
// units"), så att den inte räknas in i måltidsinsulinet och inte jämförs med måltiderna. Förut blev "lantus 14" en
// måltid på 14 enheter.
const BASAL = /^(lantus|tresiba|toujeo|levemir|abasaglar|semglee|insulatard|basal|basalinsulin|basaldos|basaldosen|långverkande|langverkande|långtidsverkande|long-acting|longacting)$/;
const BASALW = /^(basal|basalinsulin|basaldos|basaldosen|långverkande|langverkande|långtidsverkande|long-acting|longacting)$/;
// Måltidsinsulinets namn hör inte till maträtten ("6e novorapid till middag" -> "Middag")
const BOLUS = /^(fiasp|novorapid|humalog|lyumjev|apidra|actrapid|trurapi|admelog)$/;
// "i morse", "igår kväll": en ungefärlig tid när ingen klocktid anges
const PART = { morse: 8, morning: 8, förmiddag: 10, förmiddagen: 10, eftermiddag: 15, eftermiddagen: 15, afternoon: 15, kväll: 20, kvällen: 20, evening: 20, tonight: 20, natt: 3, natten: 3, night: 3 };
// Frågor och hälsningar är aldrig måltider ("hej", "hur ligger jag?") när den enkla tolkaren används utan AI
const NOT_MEAL = /\?\s*$|^(hej|hejsan|hallå|tja|tjena|tack|hi|hello|hey|thanks|ok|okej|hur|vad|när|varför|vilken|vilka|how|what|when|why|which|is|am|are|do|does|can)(?![\p{L}\d])/iu; // inte \b: den räknar å/ä/ö som ordgräns, så "okänd rätt" lästes som "ok"
function interpretLocal(text, ref, names) {
  // Skiljetecken bort, men inte decimalpunkten i 7.5 ("ris." -> "ris")
  const tk = text.toLowerCase().replace(/(\d),(\d)/g, '$1.$2').replace(/[,;!?]+|\.(?!\d)/g, ' ').split(/\s+/).filter(Boolean);
  let ins = null, ago = null, clock = null, dur = null, day = 0, part = null; const words = [], agoAt = k => AGO.test(tk[k] || '');
  for (let i = 0; i < tk.length; i++) {
    const w = tk[i], nx = tk[i + 1] || ''; let m;
    // Dagen: "igår", "i går", "yesterday", "i förrgår". Dagens del: "i morse", "imorse", "ikväll", "igår kväll", "last night"
    if (/^(igår|igar|yesterday)$/.test(w) || (w === 'i' && /^(går|gar)$/.test(nx))) { day = 1; if (w === 'i') i++; continue; }
    if (w === 'iförrgår' || w === 'förrgår' || (w === 'i' && nx === 'förrgår')) { day = 2; if (w === 'i') i++; continue; }
    if (PART[w] != null || (/^i/.test(w) && PART[w.slice(1)] != null)) { part = PART[w] ?? PART[w.slice(1)]; continue; }
    if (/^(i|this|last|på|in|the)$/.test(w) && PART[nx] != null) { part = PART[nx]; i++; continue; }
    if ((m = w.match(/^(?:kl\.?)?([01]?\d|2[0-3])[:.]([0-5]\d)$/))) { clock = [+m[1], +m[2]]; continue; }
    if ((m = w.match(/^(\d+(?:\.\d+)?)(u|e|ie|iu|units?|enheter|enhet|enh)$/))) { ins = +m[1]; continue; } // "4e", "4u", "4units", "4enhet"
    // "20 min sen" är en tid sedan; "45 min" utan "sen" är en längd (t.ex. en promenad)
    if ((m = w.match(/^(\d+(?:\.\d+)?)(min|m|h|tim)$/))) { const n = /^(h|tim)$/.test(m[2]) ? m[1] * 60 : +m[1]; if (agoAt(i + 1)) { ago = n; i++; } else dur = n; continue; }
    if (/^\d+(?:\.\d+)?(km|k)$/.test(w)) { words.push(w); continue; } // "5km" är en sträcka
    // Gram (kolhydrater, vikt) är aldrig en dos: "30 g choklad" gav förut en måltid med 30 enheter
    // Sparas som { g } så att mängden står kvar i en anteckning ("Druvsocker 15 g") men inte i ett måltidsnamn
    const carbs = () => { if (/^(kh|carbs?|kolhydrater)$/.test(tk[i + 1] || '')) i++; };
    if (/^\d+(?:\.\d+)?(g|gr)$/.test(w)) { words.push({ g: w.replace(/(\d)(g|gr)$/, '$1 g') }); carbs(); continue; }
    if (/^\d+(?:\.\d+)?$/.test(w)) {
      if (UNIT.test(nx)) { ins = +w; i++; }
      else if (MINW.test(nx) || HOURW.test(nx)) { const n = HOURW.test(nx) ? w * 60 : +w; if (agoAt(i + 2)) { ago = n; i += 2; } else { dur = n; i++; } }
      else if (GRAM.test(nx)) { words.push({ g: w + ' g' }); i++; carbs(); } // "15 g"
      else if (DIST.test(nx)) { words.push(w, nx); i++; } // "5 km"
      else words.push({ n: +w }); // ett tal utan enhet: dosen för en måltid, en mängd för en anteckning ("3 öl")
      continue;
    }
    if (/^halvtimm[ae]$/.test(w)) { if (agoAt(i + 1)) { ago = 30; i++; } else dur = 30; continue; }
    if (w === 'half' && /^an?$/.test(nx) && HOURW.test(tk[i + 2] || '')) { if (agoAt(i + 3)) { ago = 30; i += 3; } else { dur = 30; i += 2; } continue; }
    if ((w === 'an' || w === 'en' || w === 'a') && HOURW.test(nx)) { if (agoAt(i + 2)) { ago = 60; i += 2; } else { dur = 60; i++; } continue; }
    if ((w === 'kl' || w === 'klockan' || w === 'at') && /^([01]?\d|2[0-3])$/.test(nx)) { clock = [+nx, 0]; i++; continue; }
    if (!AGO.test(w)) words.push(w);
  }
  const trim = ws => { ws = [...ws]; while (ws.length && EDGE.has(ws[0])) ws.shift(); while (ws.length && EDGE.has(ws[ws.length - 1])) ws.pop(); return ws; };
  // Tiden: en klocktid, annars en del av dagen, annars "för 20 min sen", annars nu; "igår" flyttar den en dag bakåt.
  // En del av dagen som inte har kommit än idag ("i kväll" skrivet kl 18) blir nu.
  const dayAt = (h, mi) => { const d = new Date(ref); d.setDate(d.getDate() - day); d.setHours(h, mi, 0, 0); return d.getTime(); };
  const t = clock ? (day ? dayAt(clock[0], clock[1]) : atClock(clock[0], clock[1], ref)) : part != null ? (day ? dayAt(part, 0) : Math.min(dayAt(part, 0), ref))
    : ago ? ref - ago * 6e4 - day * 864e5 : ref - day * 864e5, timed = !!(clock || ago || day || part != null);
  const strs = words.filter(x => typeof x === 'string'), bare = words.find(x => typeof x === 'object' && 'n' in x), dose = ins ?? (bare ? bare.n : null);
  if (strs.some(w => BASAL.test(w)) || (strs.includes('long') && strs.includes('acting'))) {
    const brand = strs.find(w => BASAL.test(w) && !BASALW.test(w)), n = dose != null ? Math.round(dose * 10) / 10 : null;
    return noteAt('Long-acting', [brand, n != null && n + (n === 1 ? ' unit' : ' units')].filter(Boolean).join(' '), null, t, timed, ref);
  }
  const kind = (NOTE_WORDS.find(([, re]) => strs.some(w => re.test(w))) || [])[0];
  if (kind && ins === null) return noteAt(kind, trim(words).map(x => typeof x === 'string' ? x : x.g || x.n).join(' '), okDur(dur), t, timed, ref);
  // En dos utan mat: "tog 2 enheter", "1.5 korr", "fiasp 4", "2 enheter för att jag låg högt". Ett tal utan "enheter" räcker
  // när ett ord säger att det är insulin eller en korrektion.
  if (dose !== null && !kind && strs.every(w => NOFOOD.test(w) || EDGE.has(w) || WHY.test(w)) && (ins !== null || strs.some(w => NOFOOD.test(w) || WHY.test(w)))) return { type: 'meal', name: CORR, ins: dose, t, corr: true };
  const raw = trim(strs.filter(w => !BOLUS.test(w))).join(' ');
  if (!raw || NOT_MEAL.test(text.trim())) return { type: 'other' };
  // En måltid kräver en dos eller en känd rätt; annars är det troligen inte en måltid ("hej") och inget loggas
  const [name, known] = matchMeal(raw, names);
  // Ett tal utan "units/e/enheter" är en gissning, utom sist efter en känd rätt ("pizza 7"). En gissning sparas aldrig
  // direkt: dashboarden öppnar dialogen ifylld och Telegram frågar (förut blev "2 skivor bröd" 2 enheter).
  const guess = ins === null && bare && !(known && words[words.length - 1] === bare);
  // Ett kort namn utan dos ("kebab") är troligen en måltid: dashboarden och Telegram frågar efter dosen. Förut gav det
  // ett fel, medan en sparad rätt ("pizza") öppnade dialogen. Längre text utan dos är troligen inte en måltid.
  // typed: rätten som den skrevs, före matchningen mot kända rätter. Telegram frågar "Same as …?" när de skiljer sig.
  const typed = raw.charAt(0).toUpperCase() + raw.slice(1);
  if (dose === null && !known) return raw.split(' ').length <= 4 ? { type: 'meal', name, ins: null, t, typed } : { type: 'other' };
  return { type: 'meal', name, ins: dose, t, typed, ...(guess && { guess: true }) };
}
async function interpret(text, ref) {
  const names = mealNames(readDb()), L = interpretLocal(text, ref, names);
  if (L.corr || L.kind === 'Long-acting') return { ...L, via: 'rule' }; // en dos utan mat är entydig; AI:n behövs inte (och gjorde en anteckning av den)
  let o;
  try {
    const r = await ollama({ stream: false, format: INTERPRET_SCHEMA, options: { temperature: 0 }, messages: [{ role: 'system', content: INTERPRET(names) }, { role: 'user', content: text }] }, AbortSignal.timeout(45e3));
    const j = await r.json(); logTokens('interpret', j); o = JSON.parse(j.message.content);
  } catch (e) { console.error('Reading the text with the simple reader:', aiErr(e)); return { ...L, via: 'simple' }; }
  const c = typeof o.clock === 'string' && o.clock.match(/^(\d{1,2})[:.](\d{2})$/);
  // "igår kl 19": klockslaget den dagen. Utan klockslag och "för X min sen" gäller den enkla tolkarens tid, som redan
  // förstår "igår", "i morse" och "i kväll"; har bara AI:n hittat dagen flyttas tiden så många dygn bakåt.
  const dago = Number.isFinite(o.days_ago) && o.days_ago >= 1 && o.days_ago <= 7 ? Math.round(o.days_ago) : 0;
  const dayAt = (h, mi) => { const d = new Date(ref); d.setDate(d.getDate() - dago); d.setHours(h, mi, 0, 0); return d.getTime(); };
  const t = c && +c[1] < 24 && +c[2] < 60 ? (dago ? dayAt(+c[1], +c[2]) : atClock(+c[1], +c[2], ref)) : Number.isFinite(o.minutes_ago) && o.minutes_ago > 0 && o.minutes_ago <= 1440 ? ref - o.minutes_ago * 6e4 - dago * 864e5
    : L.t && L.t !== ref ? L.t : ref - dago * 864e5;
  const timed = !!c || (Number.isFinite(o.minutes_ago) && o.minutes_ago > 0) || dago > 0 || (L.t && L.t !== ref);
  if (o.type === 'note' && KINDS.includes(o.note_kind)) return { ...noteAt(o.note_kind, cleanName(o.note_text || '').slice(0, 200), okDur(o.duration_minutes), t, timed, ref), via: 'ai' };
  const name = /^(correction|korrigering|korrektion|correction dose|korrigeringsdos)$/i.test(cleanName(o.meal || '')) ? CORR : cleanName(o.meal || '');
  if (o.type !== 'meal' || !name) return { type: 'other', via: 'ai' };
  // Saknar AI:n en dos som den enkla tolkaren hittade ("kebab 5"), används den
  const ins = Number.isFinite(o.units) && o.units >= 0 ? Math.round(o.units * 10) / 10 : L.type === 'meal' ? L.ins : null;
  const unitWord = /\d\s*(u|e|ie|iu|units?|enheter|enhet|enh)(?![a-zåäö])/i.test(text.replace(/(\d),(\d)/g, '$1.$2'));
  const sure = unitWord || (L.type === 'meal' && !L.guess && L.ins === ins);
  return { type: 'meal', name: names.find(n => n.toLowerCase() === name.toLowerCase()) || name, ins, t, via: 'ai', ...(L.typed && { typed: L.typed }), ...(ins != null && !sure && { guess: true }) };
}
// Sparar en tolkad måltid eller anteckning. Samma id två gånger (ett Telegram-meddelande som läses igen) sparas en gång.
function addEntry(r, id) {
  const db = readDb(), t = Math.min(Math.round(r.t), Date.now());
  if (db.log.some(m => m.id === id) || db.notes.some(n => n.id === id)) return null;
  let e;
  if (r.type === 'meal') {
    if (!(r.ins >= 0 && r.ins <= 100)) throw new Error('bad dose');
    e = { id, t, name: r.name, ins: Math.round(r.ins * 10) / 10, ...(db.settings && db.settings.fast && { type: db.settings.fast }) };
    db.log.push(e); db.log.sort((a, b) => b.t - a.t);
  } else { e = { id, t, kind: r.kind, ...(r.text && { text: r.text }), ...(r.dur && { dur: r.dur }) }; db.notes.push(e); db.notes.sort((a, b) => b.t - a.t); }
  db.rev++; writeDb(db); return e;
}
// "Fläskfärs ris." -> "Fläskfärs ris": AI:n tar ibland med punkten från meningen
function cleanName(s) { return String(s).trim().replace(/[\s.,;:!?]+$/, '').slice(0, 100); }
// "Save to Meals": sparar en loggad rätt bland måltiderna med dosen som vanlig dos. Hade namnet ett skiljetecken
// på slutet rättas det även i loggen, så att rätten känns igen som sparad.
function saveMeal(entryId) {
  const db = readDb(), e = db.log.find(m => m.id === entryId); if (!e) return null;
  const name = cleanName(e.name);
  if (db.meals.some(m => m.name.toLowerCase() === name.toLowerCase())) return { name, already: true };
  db.meals.push({ id: crypto.randomBytes(6).toString('hex'), name, ins: e.ins });
  const old = e.name; if (old !== name) for (const m of db.log) if (m.name === old) m.name = name;
  db.rev++; writeDb(db); return { name, ins: e.ins };
}
// Kontroll av skrivfel (samma regel som på sidan): en dos långt från måltidens vanliga dos (sparad, annars medianen av
// de senaste gångerna) eller över 30 enheter. Ingen rekommendation, bara en extra bekräftelse så att 75 i stället för 7.5
// inte loggas och förstör statistiken.
// Samma måltid redan loggad inom 15 min (t.ex. både från Telegram och i dialogen): fråga innan den räknas två gånger.
function doseCheck(name, ins, db, t) {
  const k = String(name).toLowerCase(), twice = t && db.log.find(m => String(m.name).toLowerCase() === k && Math.abs(m.t - t) < 15 * 6e4);
  if (twice) return `You already logged ${name}, ${twice.ins} units at ${hm(twice.t)}. Is this a second time?`;
  if (!(ins > 0)) return null;
  const saved = db.meals.find(m => m.name.toLowerCase() === k);
  const past = db.log.filter(m => String(m.name).toLowerCase() === k).slice(0, 10).map(m => m.ins).sort((a, b) => a - b);
  const ref = saved ? saved.ins : past.length >= 2 ? past[past.length >> 1] : null;
  if (ref > 0 && (ins >= ref * 2 || ins <= ref / 2) && Math.abs(ins - ref) >= 3)
    return `${ins} units is ${ins > ref ? (ins / ref >= 3 ? Math.round(ins / ref) : (ins / ref).toFixed(1)) + '× your usual' : 'much less than your usual'} ${ref} ${ref === 1 ? 'unit' : 'units'} for ${name}.`;
  return ins > 30 ? `${ins} units is a lot for one meal.` : null;
}
function removeEntry(id) {
  const db = readDb(), n = db.log.length + db.notes.length;
  db.log = db.log.filter(m => m.id !== id); db.notes = db.notes.filter(m => m.id !== id);
  if (db.log.length + db.notes.length === n) return false;
  db.rev++; writeDb(db); return true;
}

// ---------- Telegram: logga genom att skriva till en egen bot ----------
// Datorn hämtar meddelandena själv (long polling), så inget öppnas i routern. Bara den chatt som parkopplats med
// koden från Settings får logga; alla andra ignoreras. Token och chatt sparas i data/telegram.json.
// Inga glukosvärden skickas till Telegram, bara bekräftelser på det du själv skrivit.
// report: veckorapport söndag kväll och månadsrapport den 1:a (av från början, eftersom den skickar siffror via Telegram).
// sentW/sentM: när den senast skickades, så att en omstart samma kväll inte skickar den två gånger.
// fav: favoritknapparna under skrivfältet (på från början, /nofav stänger av). favSent: en bot som kopplades in innan
// knapparna fanns har fått dem en gång.
// alias: namn man skrivit eller slagit ihop, och rätten de hör till ("Same as …?" och Count as one). merges: de 5 senaste
// sammanslagningarna, så att Undo kan ändra tillbaka. mealsSent: en bot som kopplades in innan /all fanns har fått veta det.
// code/codeAt/tries: parkopplingskoden gäller i 15 minuter och för högst 5 felaktiga försök, sedan behövs en ny från Settings
// (förut gällde den tills någon kopplade in, och vem som helst som kände till boten kunde gissa obegränsat).
const TF = path.join(DIR, 'telegram.json'), TG0 = { token: '', bot: '', chat: null, who: '', code: '', codeAt: 0, tries: 0, offset: 0, last: [], report: false, sentW: '', sentM: '', fav: true, favSent: false, staleT: 0, stale: true, piw: true, piKey: '', alias: {}, merges: [], mealsSent: false };
const CODE_MS = 15 * 6e4, CODE_TRIES = 5;
const codeOk = () => !!tg.code && Date.now() - (tg.codeAt || 0) < CODE_MS && (tg.tries || 0) < CODE_TRIES;
const newCode = () => ({ code: String(crypto.randomInt(10000000, 100000000)), codeAt: Date.now(), tries: 0 });
let tg = { ...TG0 }, tgErr = '', tgAbort = null, tgPending = null;
try { tg = { ...TG0, ...JSON.parse(fs.readFileSync(TF, 'utf8')) }; } catch {}
const saveTg = () => { writePrivate(TF + '.tmp', JSON.stringify(tg)); fs.renameSync(TF + '.tmp', TF); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function tgApi(method, body, signal, token = tg.token) {
  const r = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}), signal: signal || AbortSignal.timeout(15e3) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw Object.assign(new Error(j.description || 'HTTP ' + r.status), { code: j.error_code || r.status });
  return j.result;
}
const he = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
// Dagar räknas mellan midnätter (inte 24 h bakåt), så att "yesterday" stämmer även natten efter ett byte till sommartid
const daysAgo = t => { const a = new Date(t), b = new Date(); a.setHours(12, 0, 0, 0); b.setHours(12, 0, 0, 0); return Math.round((b - a) / 864e5); };
const whenTxt = t => { const k = daysAgo(t); return (k === 0 ? '' : k === 1 ? 'yesterday ' : ymd(t) + ' ') + hm(t); };
// Samma namn på anteckningstyperna som på dashboarden ("Low treatment", inte datans "Low treated")
const kindLabel = k => k === 'Low treated' ? 'Low treatment' : k === 'Long-acting' ? 'Long-acting insulin' : k;
const describe = e => e.name !== undefined ? `<b>${he(e.name)}</b> · ${e.ins} ${e.ins === 1 ? 'unit' : 'units'} · ${whenTxt(e.t)}`
  : `<b>${he(kindLabel(e.kind))}</b>${e.text ? ': ' + he(e.text) : ''} · ${whenTxt(e.t)}${e.dur ? '–' + hm(e.t + e.dur * 6e4) : ''}`;
// Ett svar utan egna knappar tar med favoritknapparna, så att de alltid ligger kvar under skrivfältet och följer det man
// ätit på sistone, utan att man behöver skriva /fav. (Ett meddelande kan bara ha en sorts knappar, så svar med Undo
// eller dosknappar lämnar dem som de är.)
const tgSay = (text, extra = {}) => {
  const kb = !extra.reply_markup && tg.fav !== false && tg.chat && favKeyboard();
  return tgApi('sendMessage', { chat_id: tg.chat, text, parse_mode: 'HTML', ...(kb || {}), ...extra }).catch(e => console.error('Telegram send:', e.message));
};
// Knappar under svaret: Undo, och "Save to Meals" när rätten inte redan finns bland måltiderna
// och en rad för att rätta ett skrivfel med ett tryck: Change dose (bara måltider) och Change time
const buttons = (id, save, meal = true) => ({ reply_markup: { inline_keyboard: [[{ text: 'Undo', callback_data: 'u:' + id }, ...(save ? [{ text: 'Save to Meals', callback_data: 's:' + id }] : [])],
  [...(meal ? [{ text: '✏️ Change dose', callback_data: 'v:' + id }] : []), { text: '🕒 Change time', callback_data: 'w:' + id }]] } });
const HELP = 'Tell me what you ate and how much insulin you took, for example:\n<i>pizza 7,5 enheter</i>\n<i>gröt 4e för 20 min sen</i>\n<i>kebab 6 units at 19:30</i>\n\nInsulin without food: <i>1,5 enheter ingen mat</i>.\nNotes work too: <i>promenad 45 min</i>, <i>två öl</i>.\n/undo removes the last thing you logged. The buttons under each log change the dose or the time.\n/fav puts the meals you log most as buttons under the text field.\n/all lists everything you\'ve logged, tap one to log it again. Search with / and a word: <i>/kyckling</i>. <b>Count as one</b> joins meals you wrote in different ways, and <b>Rename</b> changes a name.\n/week and /month send a summary of your numbers.';
const COMMANDS = [{ command: 'fav', description: 'Buttons for the meals you log most' }, { command: 'all', description: 'Everything you have logged. Search: /kyckling' }, { command: 'undo', description: 'Remove the last thing you logged' }, { command: 'week', description: 'Summary of the last 7 days' }, { command: 'month', description: 'Month in review' }, { command: 'help', description: 'How to log' }];

// ---------- Rapporter i Telegram: veckan och månaden i text ----------
// Bara siffror som redan visas på dashboarden. Staplarna är tecken (█░) i en <pre>, så att de står rakt i Telegram.
const mmol = v => (v / 18.016).toFixed(1), pct = v => Math.round(v) + ' %', lowsTxt = n => n === 1 ? '1 low' : n + ' lows';
const bar = v => '█'.repeat(Math.round(v / 10)) + '░'.repeat(10 - Math.round(v / 10));
const dayName = t => new Date(t).toLocaleDateString('en-GB', { weekday: 'short' }), dayDate = t => new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const monthName = k => new Date(mstart(k)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const hmin = m => m < 60 ? m + ' min' : Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '');
function weekText() {
  const now = Date.now(), w = weekly(), c = w.cur, p = w.prev;
  if (!c || c.cov < 20) return '📊 Too few readings in the last 7 days for a summary.';
  const rows = w.days.map(([t, v]) => `${dayName(t)} ${v !== null ? bar(v) + ' ' + pct(v).padStart(5) : '░'.repeat(10) + ' ' + '–'.padStart(5)}`);
  const cnt = new Map(); for (const m of readDb().log) if (m.t >= now - 7 * 864e5 && m.t <= now && !isCorr(m.name)) { const k = String(m.name).toLowerCase(), x = cnt.get(k) || { name: String(m.name), n: 0 }; x.n++; cnt.set(k, x); }
  const both = p && p.cov >= 50 && c.cov >= 50, top = [...cnt.values()].sort((x, y) => y.n - x.n).slice(0, 3);
  const ex = w.notes.Exercise;
  return [`📊 <b>Your week</b> · ${dayDate(now - 6 * 864e5)} – ${dayDate(now)}`, '',
    `In range <b>${pct(c.tir)}</b>${both ? ` (week before ${pct(p.tir)})` : ''}`,
    `<b>${lowsTxt(c.lows.length)}</b>${both ? ` (week before ${p.lows.length})` : ''} · average <b>${mmol(c.avg)}</b> mmol/L`,
    '', '<b>Time in range per day</b>', `<pre>${rows.join('\n')}</pre>`,
    ...(top.length ? [`Meals: ${top.map(m => `${he(m.name)} ×${m.n}`).join(', ')}`] : []),
    ...(ex ? [`Exercise logged ${ex === 1 ? 'once' : ex + ' times'}`] : []),
    ...(c.cov < 70 ? [`<i>Readings cover ${pct(c.cov)} of the week.</i>`] : [])].join('\n');
}
function monthText(k) {
  const x = monthly(k); if (!x || x.cur.cov < 20) return `🗓 Too few readings in ${monthName(k)} for a summary.`;
  const c = x.cur, p = x.prev, L = [`🗓 <b>${monthName(k)}${x.partial ? ' so far' : ''}</b>`, '',
    `In range <b>${pct(c.tir)}</b>${p ? ` (${monthName(p.m).split(' ')[0]}: ${pct(p.tir)})` : ''}`,
    `<b>${lowsTxt(c.lows)}</b>${p && !x.partial ? ` (${p.lows} the month before)` : ''} · average <b>${mmol(c.avg)}</b> mmol/L`, ''];
  if (x.best) L.push(`⭐ Best day: <b>${dayDate(x.best.t)}</b>, ${pct(x.best.tir)} in range`);
  if (x.inR && x.inR.min >= 60) L.push(`🟢 Longest time in range: <b>${hmin(x.inR.min)}</b> in a row, from ${dayDate(x.inR.t)} ${hm(x.inR.t)}`);
  if (x.noLow && x.noLow.n >= 2) L.push(`🛡 No lows for <b>${x.noLow.n} days</b> in a row (${dayDate(x.noLow.from)} – ${dayDate(x.noLow.to)})`);
  if (x.top.length) L.push(`🍽 Most logged: ${x.top.map(m => `${he(m.name)} ×${m.n}`).join(', ')}`);
  if (x.steady) L.push(`〰 Lowest peaks after eating: ${he(x.steady.name)}, ${mmol(x.steady.peak)} on average`);
  if (x.notes.Exercise) L.push(`🚶 Exercise logged ${x.notes.Exercise === 1 ? 'once' : x.notes.Exercise + ' times'}${x.exMin ? ` (${hmin(x.exMin)} where you wrote how long)` : ''}`);
  L.push('', `<i>${x.n.toLocaleString('en-GB')} readings · sensor active ${pct(c.cov)}. The full card is under Insights on the dashboard.</i>`);
  return L.join('\n');
}
// Söndag från 19:00 och den 1:a från 09:00. Var servern av då skickas den när den startar samma dag.
function reportTick() {
  if (!tg.token || !tg.chat || !tg.report) return;
  const d = new Date(), day = ymd(d), mk = mkey(mstart(mkey(d)) - 1);
  if (d.getDay() === 0 && d.getHours() >= 19 && tg.sentW !== day) { tg.sentW = day; saveTg(); tgSay(weekText()); }
  if (d.getDate() === 1 && d.getHours() >= 9 && tg.sentM !== mk) { tg.sentM = mk; saveTg(); tgSay(monthText(mk)); }
}
// Varning när mätvärdena slutar komma (utloggad, LibreLinkUp svarar inte, sensorbyte, telefonen utom räckhåll): ett
// meddelande när det senaste värdet är mer än 30 min gammalt och ett när värdena kommer igen. En gång per avbrott:
// staleT är tiden för det senaste värdet när varningen gick (sparad, så att en omstart inte skickar den igen).
// Bara klockslag, inga glukosvärden. Mellan 23 och 07 kommer meddelandet tyst, utan ljud.
const STALE = 30 * 6e4, bootAt = Date.now();
function staleTick() {
  if (DEMO || !tg.token || !tg.chat) return;
  if (tg.stale === false) { if (tg.staleT) { tg.staleT = 0; saveTg(); } return; } // avstängd under Settings
  const now = Date.now(), lt = S.length ? S[S.length - 1][0] : 0, h = new Date(now).getHours(), quiet = { disable_notification: h >= 23 || h < 7 };
  if (tg.staleT) {
    if (lt > tg.staleT && now - lt < 10 * 6e4) { const from = tg.staleT; tg.staleT = 0; saveTg(); tgSay(`✅ Readings are coming in again. No readings from ${whenTxt(from)} to ${hm(lt)}.`, quiet); }
    return;
  }
  if (now - Math.max(lt, bootAt) < STALE) return;
  const why = !token && !creds ? 'The dashboard is logged out of LibreLinkUp. Open it and log in again.'
    : status !== 'ok' ? `The last try to fetch readings failed: ${he(status)}`
    : 'LibreLinkUp answers but has no new readings. Maybe a sensor change, or the phone is out of reach of the sensor.';
  tg.staleT = lt || bootAt; saveTg();
  tgSay(`⚠️ <b>No new readings since ${lt ? whenTxt(lt) : hm(bootAt) + ', when the dashboard started'}.</b>
${why}`, quiet);
}
// Varning när Raspberry Pi:n får ett problem: det pistatus skriver överst ("! problem", "* varning"), t.ex. hög
// temperatur, nästan fullt minneskort eller ett nätverksfel. Ett meddelande när det börjar och ett när allt är bra igen.
// piKey är problemen utan siffror (så att "82 °C" och "83 °C" räknas som samma), sparad så att en omstart inte skickar
// igen. Samma resultat två kontroller i rad (fem minuter isär) krävs, så att en kort hicka inte skickar något.
// Mätvärden som slutar komma har ett eget meddelande (ovan). Mellan 23 och 07 kommer det tyst.
let piPrev = null;
async function piTick() {
  if (DEMO || !tg.token || !tg.chat || !fs.existsSync(PISTATUS)) return;
  const p = await piStatus(true); if (p.error || p.missing) return;
  const crit = p.crit || [], msgs = [...crit, ...(p.warn || [])], key = msgs.map(m => m.replace(/\d+(?:[.,]\d+)?/g, '#')).sort().join('\n');
  const prev = piPrev; piPrev = key; if (key !== prev || key === (tg.piKey || '')) return;
  const had = !!tg.piKey; tg.piKey = key; saveTg();
  if (tg.piw === false) return;
  const h = new Date().getHours(), quiet = { disable_notification: h >= 23 || h < 7 };
  if (!msgs.length) { if (had) tgSay('✅ <b>The Raspberry Pi is fine again.</b>', quiet); return; }
  tgSay(`${crit.length ? '🔴' : '⚠️'} <b>The Raspberry Pi needs attention.</b>\n${msgs.map(m => '• ' + he(m)).join('\n')}\n<i>More under the Raspberry Pi button on the dashboard.</i>`, quiet);
}
// warn: en ovanlig dos eller en möjlig dubblett. Den loggas ändå direkt (användarens val 2026-11-09: boten ska inte fråga),
// men svaret säger det, med Undo under, så att ett skrivfel (55 i stället för 5,5) är ett tryck att ångra.
async function tgLogged(r, id, late, warn) {
  const e = addEntry(r, id); if (!e) return;
  tg.last = [...tg.last, e.id].slice(-20); saveTg();
  const isMeal = e.name !== undefined, saved = isMeal && (isCorr(e.name) || readDb().meals.some(m => m.name.toLowerCase() === e.name.toLowerCase()));
  await tgSay((isMeal ? '✅ ' : '📝 ') + describe(e)
    + (warn ? `\n⚠ ${he(String(warn).replace(/ Is this a second time\?$/, ''))} Tap Undo if it was a mistake.` : '')
    + (late ? '\n<i>Read when the dashboard started, logged at the time you sent it.</i>' : '')
    + (r.via === 'simple' ? '\n<i>(the local AI was off, so the simple reader was used)</i>' : ''), buttons(e.id, isMeal && !saved, isMeal));
}
// ---------- Favoriter och "How many units?" ----------
// /fav lägger de sex måltider man loggat flest gånger de senaste 30 dagarna (sedan sparade måltider) som knappar under
// skrivfältet. Ett tryck skickar "⭐ Namn", och boten frågar bara efter dosen.
const FAV = '⭐ ';
function favKeyboard() {
  const db = readDb(), since = Date.now() - 30 * 864e5, c = new Map();
  // Loggen är nyast först, så vid lika antal kommer den senast ätna först (Map behåller ordningen, sort är stabil)
  for (const m of db.log) if (m.t >= since && !isCorr(m.name)) { const name = cleanName(m.name), k = name.toLowerCase(), x = c.get(k) || { name, n: 0 }; x.n++; c.set(k, x); }
  const names = [...c.values()].sort((a, b) => b.n - a.n).map(x => x.name);
  for (const m of db.meals) if (names.length < 6 && !names.some(n => n.toLowerCase() === m.name.toLowerCase())) names.push(m.name);
  const b = names.slice(0, 6).map(n => ({ text: FAV + n.slice(0, 60) }));
  if (!b.length) return null;
  const rows = []; b.forEach((x, i) => i % 2 ? rows[rows.length - 1].push(x) : rows.push([x]));
  return { reply_markup: { keyboard: rows, resize_keyboard: true, is_persistent: true, input_field_placeholder: 'Or write, e.g. pizza 7,5 enheter' } };
}
// "How many units?" med en knapp för dosen man sparat för rätten och en för dosen förra gången. Det är ens egna siffror,
// inget förslag; man kan alltid skriva en annan. Knapparna gäller bara den här frågan (nonce).
function askUnits(r) {
  const db = readDb(), k = String(r.name).toLowerCase(), saved = db.meals.find(x => x.name.toLowerCase() === k), last = db.log.find(x => String(x.name).toLowerCase() === k);
  const nonce = crypto.randomBytes(3).toString('hex'), opts = [], uw = v => v === 1 ? 'unit' : 'units';
  if (saved && saved.ins > 0) opts.push([saved.ins, 'saved']);
  if (last && last.ins > 0 && !opts.some(o => o[0] === last.ins)) opts.push([last.ins, 'last time']);
  tgPending = { type: 'meal', name: r.name, t: r.t, via: r.via, at: Date.now(), nonce };
  return tgSay(`How many units did you take for <b>${he(r.name)}</b>? ${opts.length ? 'Tap one or send' : 'Reply with'} a number, or 0 if none.`,
    opts.length ? { reply_markup: { inline_keyboard: [opts.map(([v, w]) => ({ text: `${v} ${uw(v)} (${w})`, callback_data: `d:${nonce}:${v}` }))] } } : {});
}
// Svaret på "How many units?" som ett tal, eller null om texten är något annat (t.ex. en ny måltid). Efter talet får det
// bara stå enhetsord och insulinnamn.
const UNITS_TAIL = /^(u|e|ie|iu|units?|enh|enhet|enheter|insulin|fiasp|novorapid|humalog|lyumjev|apidra|actrapid|trurapi|admelog)$/;
function unitsReply(text) {
  const tk = String(text).toLowerCase().replace(/(\d),(\d)/g, '$1.$2').replace(/[.!]+$/, '').trim().split(/\s+/), m = (tk[0] || '').match(/^(\d+(?:\.\d+)?)([a-z]*)$/);
  if (!m || (m[2] && !UNITS_TAIL.test(m[2])) || !tk.slice(1).every(w => UNITS_TAIL.test(w))) return null;
  return +m[1];
}
// Antal enheter som svar på "How many units?", skrivet eller från en knapp. Långt från det vanliga: fråga en gång till.
async function tgUnits(ins, id) {
  if (!(ins >= 0) || ins > 100) return tgSay('That seems like a lot. Send the number of units again.');
  const p = { ...tgPending, ins }, chk = !tgPending.confirm && doseCheck(p.name, ins, readDb(), p.t);
  tgPending = null; return tgLogged(p, id, false, chk);
}
// Resten av vägen för en tolkad måltid eller anteckning: fråga efter dosen om den saknas, fråga om en gissad dos,
// annars logga (med en varning för en ovanlig dos eller en möjlig dubblett).
async function tgMeal(r, id, late) {
  if (r.type === 'meal' && r.ins == null) return askUnits(r);
  if (r.type === 'meal' && r.ins > 100) return tgSay('That dose seems too high. Send it again with the number of units.');
  // En gissad dos (ett tal utan enhet, "2 skivor bröd") frågas fortfarande om, så att boten aldrig sparar en gissning.
  // En ovanlig dos eller en möjlig dubblett loggas direkt med en varning och Undo.
  if (r.type === 'meal' && r.guess) { tgPending = { ...r, confirm: true, at: Date.now() }; return tgSay(`${he(`Did you take ${r.ins} ${r.ins === 1 ? 'unit' : 'units'} for ${r.name}?`)} Reply <b>yes</b> to log it, or send the right number of units.`); }
  const chk = r.type === 'meal' && doseCheck(r.name, r.ins, readDb(), r.t);
  tgPending = null; return tgLogged(r, id, late, chk);
}

// ---------- Rätterna: /all, sökning, "Same as …?" och "Count as one" ----------
// Allt på dashboarden grupperar loggen på rättens namn, så två stavningar av samma rätt ("Chopchop crispy lime chicken
// med ris" och "Chopchop kyckling ris") räknades som två rätter. Nu frågar boten "Same as …?" när det man skriver liknar
// en rätt man loggat förut, /all visar och söker bland allt man loggat (ett tryck loggar rätten), och "Count as one"
// slår ihop rätter: de gamla loggningarna får ett och samma namn (med Undo), och de gamla namnen kommer ihåg vart de hör
// (tg.alias), så att de loggas som den rätten nästa gång utan fråga.
// Jämförelsen: små bokstäver, utan accenter och fyllnadsord ("med", "och"), vanliga matord på svenska och engelska
// räknas som samma ("kyckling" = "chicken"), början av ett ord räcker ("kycklingen" = "kyckling"), "chop chop" =
// "chopchop", och ett skrivfel i ett långt ord ("chiken") godtas.
const SYN = new Map(Object.entries({
  chicken: 'kyckling chicken', rice: 'ris rice', beef: 'notkott not beef', pork: 'flask flaskkott pork', salmon: 'lax salmon', fish: 'fisk fish',
  cod: 'torsk cod', shrimp: 'rakor raka shrimp shrimps prawn prawns', potato: 'potatis potato potatoes', fries: 'pommes pommesfrites fries',
  bread: 'brod bread', sandwich: 'macka mackor smorgas smorgasar sandwich sandwiches', egg: 'agg egg eggs', cheese: 'ost cheese',
  noodles: 'nudlar noodle noodles', sausage: 'korv sausage sausages', meatballs: 'kottbullar meatball meatballs', porridge: 'grot porridge oatmeal',
  milk: 'mjolk milk', salad: 'sallad salad', soup: 'soppa soup', burger: 'hamburgare burgare hamburger burger burgers', cake: 'tarta cake',
  bun: 'bulle bullar bun buns', pancake: 'pannkaka pannkakor pancake pancakes', waffle: 'vaffla vafflor waffle waffles', yogurt: 'yoghurt yogurt',
  chocolate: 'choklad chocolate', breakfast: 'frukost breakfast', dinner: 'middag dinner', meat: 'kott meat', mince: 'kottfars fars mince minced',
  apple: 'apple apples', banana: 'banan bananer banana bananas', beans: 'bonor beans', vegetables: 'gronsaker veggies vegetables', sauce: 'sas sauce',
  icecream: 'glass icecream',
  // Fler (2026-11-27): kött och fisk, grönsaker, frukt, dryck, frukost och fika, mellanmål
  lamb: 'lamm lamb', turkey: 'kalkon turkey', duck: 'anka ankbrost duck', tuna: 'tonfisk tuna', crab: 'krabba crab', lobster: 'hummer lobster',
  mussels: 'musslor mussels', steak: 'biff steak steaks', stew: 'gryta stew', ham: 'skinka ham', chop: 'kotlett kotletter chop chops',
  tomato: 'tomat tomater tomato tomatoes', onion: 'lok onion onions', garlic: 'vitlok garlic', carrot: 'morot morotter carrot carrots',
  spinach: 'spenat spinach', mushroom: 'svamp champinjoner champinjon mushroom mushrooms', corn: 'majs corn', peas: 'artor peas', cucumber: 'gurka cucumber',
  lemon: 'citron lemon', orange: 'apelsin apelsiner orange oranges', strawberry: 'jordgubbar jordgubbe strawberry strawberries',
  blueberry: 'blabar blueberry blueberries', raspberry: 'hallon raspberry raspberries', grapes: 'vindruvor druvor grapes', pear: 'paron pear pears',
  coffee: 'kaffe coffee', tea: 'te tea', beer: 'ol beer', wine: 'vin wine', water: 'vatten water', soda: 'lask soda', cream: 'gradde cream',
  butter: 'smor butter', sugar: 'socker sugar', honey: 'honung honey', jam: 'sylt jam', peanutbutter: 'jordnotssmor peanutbutter',
  nuts: 'notter nuts', almonds: 'mandel mandlar almond almonds', oats: 'havre havregryn oats', cereal: 'flingor cereal', crispbread: 'knackebrod crispbread',
  toast: 'rostbrod toast', cinnamonbun: 'kanelbulle kanelbullar cinnamonbun', cookie: 'kaka kakor cookie cookies', biscuit: 'kex biscuit biscuits crackers',
  candy: 'godis candy sweets', pie: 'paj pie', lentils: 'linser lentils', chickpeas: 'kikartor chickpeas', sweetpotato: 'sotpotatis sweetpotato',
  mash: 'potatismos mos mash mashed', macaroni: 'makaroner macaroni', scrambledeggs: 'aggrora scrambledeggs', omelette: 'omelett omelette',
  snack: 'mellanmal snack snacks', dessert: 'efterratt dessert', supper: 'kvallsmat supper',
}).flatMap(([c, ws]) => ws.split(' ').map(w => [w, c])));
// Åt andra hållet: alla ord för samma sak ("pork" -> flask, flaskkott, pork), för sökningen
const SYNW = new Map(); for (const [w, c] of SYN) SYNW.set(c, [...(SYNW.get(c) || []), w]);
// Bestämd form och plural på svenska ("kycklingen", "riset", "pannkakorna") slås upp utan ändelsen
const canon = w => SYN.get(w) || (w.length > 4 && ['na', 'arna', 'orna', 'erna', 'en', 'et', 'n', 't'].map(s => w.endsWith(s) && SYN.get(w.slice(0, -s.length))).find(Boolean)) || w;
const STOP = new Set([...EDGE, 'samt', 'plus', 'from', 'fran', 'hos'].map(norm));
const tok = w => ({ w, c: canon(w) });
const dishToks = s => norm(String(s)).split(' ').filter(w => w && !STOP.has(w) && !/^\d+$/.test(w)).map(tok);
function lev(a, b) { // antal bokstäver som skiljer (Levenshtein)
  let p = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { const c = [i]; for (let j = 1; j <= b.length; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = c; }
  return p[b.length];
}
const typo = (a, b) => { const n = Math.min(a.length, b.length), k = n >= 8 ? 2 : 1; return n >= 5 && Math.abs(a.length - b.length) <= k && lev(a, b) <= k; };
const pre = (a, b) => { const [s, l] = a.length <= b.length ? [a, b] : [b, a]; return s.length >= 4 && l.startsWith(s); };
// Samma ord med en annan ändelse ("pizzan", "pannkakorna", "eggs")
const INFL = new Set(['', 's', 'es', 'n', 'en', 'et', 't', 'na', 'ar', 'er', 'or', 'arna', 'orna', 'erna']);
const infl = (a, b) => { const [s, l] = a.length <= b.length ? [a, b] : [b, a]; return s.length >= 3 && l.startsWith(s) && INFL.has(l.slice(s.length)); };
// strict: bara samma ord (andra ändelser, svenska/engelska, ett skrivfel i ett ord på minst 6 bokstäver). Annars räcker
// också början av ett sammansatt ord ("kebab" i "kebabpizza"), vilket bara ger en fråga, aldrig en tyst sammanslagning.
const tokSame = (x, y, strict) => x.c === y.c || infl(x.w, y.w) || infl(x.c, y.c) || (strict ? Math.min(x.w.length, y.w.length) >= 6 && typo(x.w, y.w) : pre(x.w, y.w) || pre(x.c, y.c) || typo(x.w, y.w));
// "chop chop" mot "chopchop": två ord i rad som tillsammans är ett ord på andra sidan räknas som ett
const joinPairs = (a, b) => { const o = []; for (let i = 0; i < a.length; i++) { const j = a[i + 1] && tok(a[i].w + a[i + 1].w); if (j && b.some(y => y.w === j.w || y.c === j.c)) { o.push(j); i++; } else o.push(a[i]); } return o; };
const dishPair = (a, b) => { const ta = dishToks(a), tb = dishToks(b); return [joinPairs(ta, tb), joinPairs(tb, ta)]; };
const cover = (ta, tb, strict) => ta.length ? ta.filter(x => tb.some(y => tokSame(x, y, strict))).length / ta.length : 0;
// Samma rätt med andra ord ("Kyckling ris" = "Kyckling med ris", "Chicken and rice" = "Kyckling med ris", "Pizzan" = "Pizza")
function sameDish(a, b) {
  const [ta, tb] = dishPair(a, b);
  return ta.length && tb.length ? cover(ta, tb, true) === 1 && cover(tb, ta, true) === 1 : norm(String(a)) === norm(String(b));
}
// Hur lika en ny rätt a är en känd rätt b, 0 om de inte liknar varandra: allt i a finns i b ("Chopchop" i "Chopchop
// crispy lime chicken med ris"), allt i b finns i a och täcker minst halva a ("Pad ka pao med ris" och "Pad Ka Pao"),
// eller minst två tredjedelar åt båda håll. Så frågar inte "Två rostbröd och mjölk" om "Mjölk" (som man dricker till allt).
function dishScore(a, b) {
  const [ta, tb] = dishPair(a, b), ra = cover(ta, tb), rb = cover(tb, ta);
  return ra && (ra === 1 || (rb === 1 && ra >= .5) || (ra >= .67 && rb >= .67)) ? (ra + rb) / 2 : 0;
}
// Varje rätt en gång: antal gånger, senast, och om den finns bland de sparade måltiderna (vars stavning gäller).
// Nyast först; sparade som aldrig loggats sist i bokstavsordning. Korrigeringsdoser är ingen rätt.
function dishes(db) {
  const c = new Map();
  for (const m of db.log) {
    const name = cleanName(m.name), k = name.toLowerCase(); if (!k || isCorr(name)) continue;
    const x = c.get(k); if (!x) c.set(k, { name, n: 1, last: m.t }); else { x.n++; if (m.t > x.last) { x.last = m.t; x.name = x.saved ? x.name : name; } }
  }
  for (const m of db.meals) { const name = cleanName(m.name), k = name.toLowerCase(); if (!k || isCorr(name)) continue; const x = c.get(k); if (x) Object.assign(x, { name, saved: true }); else c.set(k, { name, n: 0, last: 0, saved: true }); }
  return [...c.values()].sort((a, b) => b.last - a.last || a.name.localeCompare(b.name));
}
// Sökning: varje ord ska finnas i rätten (början av ett ord, samma ord på svenska/engelska, ett skrivfel, eller inuti
// ett hopskrivet ord). Kommatecken ger flera sökningar på en gång: "chopchop, wok".
function findDishes(q, list) {
  const parts = String(q).split(/[,;/]+/).map(p => norm(p).split(' ').filter(w => w && !STOP.has(w)).map(tok)).filter(p => p.length);
  if (!parts.length) return list;
  return list.filter(d => {
    const dt = dishToks(d.name), flat = norm(d.name).replace(/ /g, '');
    // Ordet självt och dess översättningar ("pork" hittar också "Fläskfärs", "kyckling" också "Chickenwings")
    return parts.some(qt => qt.every(x => { const ws = [x.w, ...(SYNW.get(x.c) || [])].filter((w, i) => !i || w.length >= 4);
      return dt.some(y => ws.some(w => y.w.startsWith(w)) || y.c === x.c || (x.c.length >= 3 && y.c.startsWith(x.c)) || typo(x.w, y.w)) || ws.some(w => w.length >= 4 && flat.includes(w)); }));
  });
}
// "Same as …?": null när ingen fråga behövs (r.name kan då bytas till den kända stavningen), annars kandidaterna
// (högst tre, mest lika först) och det nya namnet om man svarar att det är en ny rätt.
function sameAs(r) {
  if (r.type !== 'meal' || r.corr || isCorr(r.name)) return null;
  const list = dishes(readDb()).map(d => d.name), find = n => n ? list.find(x => norm(x) === norm(String(n))) : undefined;
  const alias = n => { const v = n && tg.alias && tg.alias[norm(String(n))]; return v ? find(v) : undefined; };
  const known = alias(r.typed) || alias(r.name) || find(r.typed); if (known) { r.name = known; return null; }
  const hit = find(r.name);
  if (hit && (!r.typed || sameDish(r.typed, hit))) { r.name = hit; return null; }
  if (!hit) { const same = list.find(x => sameDish(r.name, x) || (r.typed && sameDish(r.typed, x))); if (same) { r.name = same; return null; } }
  const from = hit ? r.typed : r.name, score = list.map(x => [x, Math.max(dishScore(from, x), r.typed ? dishScore(r.typed, x) : 0)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]);
  const cands = [...new Set([...(hit ? [hit] : []), ...score.map(([x]) => x)])].slice(0, 3);
  return cands.length ? { cands, fresh: hit ? r.typed : r.name } : null;
}
// Kommer ihåg att ett namn hör till en rätt. Högst 500 namn; det äldsta försvinner först.
function setAlias(from, to) {
  const k = norm(String(from)); if (!k || k === norm(to)) return;
  tg.alias = { ...(tg.alias || {}) }; delete tg.alias[k]; tg.alias[k] = to;
  const ks = Object.keys(tg.alias); for (const x of ks.slice(0, Math.max(0, ks.length - 500))) delete tg.alias[x];
}
async function askSame(r, late) {
  const { cands, fresh } = r.same, nonce = crypto.randomBytes(3).toString('hex'), one = cands.length === 1;
  tgPending = { ...r, at: Date.now(), nonce, late };
  const dose = r.ins != null ? `\n<i>${r.ins} ${r.ins === 1 ? 'unit' : 'units'}, logged when you answer.</i>` : '';
  const text = one ? `Same as <b>${he(cands[0])}</b>?\nYou wrote <i>${he(fresh)}</i>. Tap <b>Same</b> to count it as that meal, or <b>New meal</b> to keep your name.${dose}`
    : `<i>${he(fresh)}</i> looks like meals you've logged before. Which one is it?${dose}`;
  const kb = one ? [[{ text: '✓ Same', callback_data: `a:${nonce}:0` }, { text: '➕ New meal', callback_data: `a:${nonce}:n` }]]
    : [...cands.map((c, i) => [{ text: '✓ ' + c.slice(0, 60), callback_data: `a:${nonce}:${i}` }]), [{ text: '➕ New: ' + String(fresh).slice(0, 55), callback_data: `a:${nonce}:n` }]];
  return tgSay(text, { reply_markup: { inline_keyboard: kb } });
}
// Svaret på "Same as …?": en kandidat (0, 1, 2) eller "n" för en ny rätt. "Same" kommer ihåg det man skrev.
// Samma för Telegram och textfältet på dashboarden: måltiden med det valda namnet.
function pickSame(p, pick) {
  const { cands, fresh } = p.same, r = { ...p }; delete r.same; delete r.nonce; delete r.at; delete r.late;
  if (pick === 'n') r.name = fresh;
  else {
    // Bara namn som inte själva är en loggad rätt (annars skulle "Pasta bolognese" kunna peka på "Pasta carbonara")
    r.name = cands[+pick] || cands[0]; const known = new Set(dishes(readDb()).map(d => norm(d.name)));
    for (const n of [r.typed, p.name, fresh]) if (n && !known.has(norm(n))) setAlias(n, r.name);
    saveTg();
  }
  return r;
}
async function sameAnswer(pick, id) {
  const p = tgPending; tgPending = null;
  return tgMeal(pickSame(p, pick), id, p.late);
}

// /all och sökningen: en lista med en knapp per rätt (ett tryck loggar den), 8 åt gången. Listan ligger kvar i minnet
// (de 10 senaste) så att knapparna vet vilken rätt de gäller; efter en omstart får man skicka /all igen.
const PAGE = 8, tgLists = new Map(), qlSame = new Map(); // qlSame: "Same as …?" från textfältet på dashboarden
const dayTxt = t => { const k = daysAgo(t), d = new Date(t); return k === 0 ? 'today' : k === 1 ? 'yesterday' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date().getFullYear() && { year: 'numeric' }) }); };
const timesTxt = d => d.n ? `${d.n}× · last ${dayTxt(d.last)}` : 'saved, not logged yet';
const canMerge = L => L.q && L.items.length >= 2 && L.items.length <= 10;
function newList(q, items) {
  const id = crypto.randomBytes(3).toString('hex'), L = { id, q, items, page: 0, sel: null };
  tgLists.set(id, L); for (const k of [...tgLists.keys()].slice(0, Math.max(0, tgLists.size - 10))) tgLists.delete(k);
  return L;
}
function listView(L) {
  const all = L.items, pages = Math.max(1, Math.ceil(all.length / PAGE)), page = L.page = Math.min(Math.max(0, L.page), pages - 1), from = page * PAGE;
  const items = all.slice(from, from + PAGE), many = n => `${n} ${n === 1 ? 'meal' : 'meals'}`;
  const text = [L.q ? `🔎 <b>${many(all.length)} matching “${he(L.q)}”</b>` : `🍽 <b>Everything you've logged</b> · ${many(all.length)}`, '',
    ...items.map((d, i) => `${from + i + 1}. <b>${he(d.name)}</b> · ${timesTxt(d)}`), '',
    `<i>Tap one to log it.${pages > 1 ? ` Page ${page + 1} of ${pages}.` : ''}${canMerge(L) ? ' Same meal under different names? Tap Count as one.' : L.q && all.length > 10 ? ' Add a word to the search to count meals as one.' : !L.q && all.length > PAGE ? ' Search with / and a word: /kyckling' : ''}</i>`].join('\n');
  const kb = items.map((d, i) => [{ text: `${from + i + 1}. ${d.name}`.slice(0, 64), callback_data: `p:${L.id}:${from + i}` }]);
  const nav = [...(page > 0 ? [{ text: '‹ Back', callback_data: `l:${L.id}:${page - 1}` }] : []), ...(page < pages - 1 ? [{ text: 'More ›', callback_data: `l:${L.id}:${page + 1}` }] : [])];
  if (nav.length) kb.push(nav);
  kb.push([...(canMerge(L) ? [{ text: '🔗 Count as one', callback_data: `j:${L.id}` }] : []), { text: '✏️ Rename', callback_data: `r:${L.id}` }]);
  return { text, reply_markup: { inline_keyboard: kb } };
}
// Byt namn: rätterna på sidan man står på, ett tryck väljer, och nästa meddelande är det nya namnet
const renameView = L => { const from = L.page * PAGE; return { text: '✏️ <b>Which meal do you want to rename?</b>',
  reply_markup: { inline_keyboard: [...L.items.slice(from, from + PAGE).map((d, i) => [{ text: d.name.slice(0, 64), callback_data: `e:${L.id}:${from + i}` }]), [{ text: 'Cancel', callback_data: `c:${L.id}` }]] } }; };
// Det nya namnet: samma regler som när en rätt loggas (skiljetecken sist bort, högst 100 tecken). Finns namnet redan
// som en annan rätt blir det en sammanslagning med den rätten (och dess stavning).
async function tgRename(old, text) {
  const name = cleanName(text.startsWith(FAV) ? text.slice(FAV.length) : text);
  if (!/\p{L}/u.test(name) || isCorr(name)) return tgSay('That doesn\'t work as a name. Send another one, or /cancel.');
  if (name === old) { tgPending = null; return tgSay('That is already the name. Nothing changed.'); }
  tgPending = null;
  const other = dishes(readDb()).find(d => d.name.toLowerCase() === name.toLowerCase() && d.name.toLowerCase() !== old.toLowerCase());
  const keep = other ? other.name : name, m = mergeDishes(keep, [old]);
  if (!m) return tgSay(`${he(old)} is no longer in the log. Nothing changed.`);
  const cnt = m.rec.log.length;
  return tgSay(other ? `🔗 <i>${he(old)}</i> now counts as one meal with <b>${he(keep)}</b>: ${cnt} logged ${cnt === 1 ? 'meal' : 'meals'} renamed.`
    : `✏️ Renamed <i>${he(old)}</i> to <b>${he(keep)}</b>: ${cnt} logged ${cnt === 1 ? 'meal' : 'meals'}${m.rec.ren.length ? ' and the saved meal' : ''}.`,
    { reply_markup: { inline_keyboard: [[{ text: 'Undo', callback_data: 'x:' + m.rec.id }]] } });
}
const pickView = L => ({ text: '🔗 <b>Which of these are the same meal?</b>\nTap to select them, then Next.',
  reply_markup: { inline_keyboard: [...L.items.map((d, i) => [{ text: `${L.sel.has(i) ? '☑' : '☐'} ${d.name}`.slice(0, 58) + ` (${d.n}×)`, callback_data: `t:${L.id}:${i}` }]),
    [{ text: 'Cancel', callback_data: `c:${L.id}` }, { text: 'Next ›', callback_data: `n:${L.id}` }]] } });
const keepView = L => ({ text: '🔗 <b>Which name should they all have?</b>\nThe older logs get that name, and everything counts them as one meal.',
  reply_markup: { inline_keyboard: [...[...L.sel].sort((a, b) => a - b).map(i => [{ text: L.items[i].name.slice(0, 64), callback_data: `k:${L.id}:${i}` }]),
    [{ text: '‹ Back', callback_data: `j:${L.id}` }, { text: 'Cancel', callback_data: `c:${L.id}` }]] } });
async function tgMeals(q) {
  const all = dishes(readDb()), items = q ? findDishes(q, all) : all;
  if (!all.length) return tgSay('Nothing logged yet. Write what you ate, for example <i>pizza 7,5 enheter</i>.');
  if (!items.length) return tgSay(`No logged meals match “${he(q)}”. Try another word, or /all for everything. /help shows the commands.`);
  const v = listView(newList(q, items)); return tgSay(v.text, { reply_markup: v.reply_markup });
}
// "Count as one": alla loggningar med de andra namnen (och andra stavningar av namnet man behåller) får namnet man valt.
// En sparad måltid med ett av de andra namnen byter namn, eller tas bort om den man behåller redan är sparad. Allt som
// ändrades sparas (tg.merges, de 5 senaste), så att Undo kan ändra tillbaka.
// Samma sak byter namn på en rätt (others = det gamla namnet), även när bara stora och små bokstäver skiljer.
function mergeDishes(keep, others) {
  const db = readDb(), K = keep.toLowerCase(), O = new Set(others.map(n => cleanName(n).toLowerCase()).filter(k => k && k !== K));
  const log = [], ren = [], rem = [], key = m => cleanName(m.name).toLowerCase();
  db.log = db.log.map(m => (O.has(key(m)) || key(m) === K) && m.name !== keep ? (log.push([m.id, m.name]), { ...m, name: keep }) : m);
  let kept = db.meals.find(m => key(m) === K);
  db.meals = db.meals.flatMap(m => {
    const k = key(m);
    if (k === K) { if (m !== kept) { rem.push(m); return []; } if (m.name === keep) return [m]; ren.push([m.id, m.name]); return [{ ...m, name: keep }]; }
    if (!O.has(k)) return [m];
    if (kept) { rem.push(m); return []; }
    kept = m; ren.push([m.id, m.name]); return [{ ...m, name: keep }];
  });
  const n = log.filter(([, old]) => O.has(cleanName(old).toLowerCase())).length;
  if (!log.length && !ren.length && !rem.length) return null;
  db.rev++; writeDb(db);
  // De gamla namnen loggas som den här rätten nästa gång, och namn som pekade på dem pekar hit. prevAlias: det som
  // ändrades, med det gamla värdet (null = fanns inte), så att Undo kan återställa det.
  const before = { ...(tg.alias || {}) }, prevAlias = {};
  tg.alias = Object.fromEntries(Object.entries(before).map(([k, v]) => [k, O.has(String(v).toLowerCase()) ? keep : v]));
  for (const o of O) setAlias(o, keep);
  for (const k of new Set([...Object.keys(before), ...Object.keys(tg.alias)])) if (before[k] !== tg.alias[k]) prevAlias[k] = k in before ? before[k] : null;
  const rec = { id: crypto.randomBytes(4).toString('hex'), keep, log, ren, rem, prevAlias };
  tg.merges = [...(tg.merges || []), rec].slice(-5); saveTg();
  return { rec, n, names: [...new Set(log.map(([, o]) => cleanName(o)).filter(o => O.has(o.toLowerCase())))] };
}
function unmerge(id) {
  const i = (tg.merges || []).findIndex(r => r.id === id); if (i < 0) return null;
  const r = tg.merges[i], db = readDb(), L = new Map(r.log), R = new Map(r.ren);
  db.log = db.log.map(m => L.has(m.id) && m.name === r.keep ? { ...m, name: L.get(m.id) } : m);
  db.meals = db.meals.map(m => R.has(m.id) && m.name === r.keep ? { ...m, name: R.get(m.id) } : m);
  for (const m of r.rem) if (!db.meals.some(x => x.id === m.id)) db.meals.push(m);
  db.rev++; writeDb(db);
  tg.alias = { ...(tg.alias || {}) };
  for (const [k, v] of Object.entries(r.prevAlias || {})) if (v == null) delete tg.alias[k]; else tg.alias[k] = v;
  tg.merges = tg.merges.filter(x => x.id !== id); saveTg();
  return r;
}
// Knapparna i listan: l = sida, p = logga rätten, j = välj rätter att slå ihop, t = välj/avmarkera, n = vidare till
// namnet, k = behåll det namnet, c = avbryt
async function tgListTap(q, act, arg, answer) {
  const [lid, x] = arg.split(':'), L = tgLists.get(lid), msg = { chat_id: tg.chat, message_id: q.message.message_id };
  const show = v => tgApi('editMessageText', { ...msg, parse_mode: 'HTML', text: v.text, reply_markup: v.reply_markup }).catch(() => {});
  if (!L) return answer('That list has expired. Send /all again.');
  if (act === 'l') { L.page = +x || 0; await answer(''); return show(listView(L)); }
  if (act === 'p') {
    const d = L.items[+x], now = d && dishes(readDb()).find(y => y.name.toLowerCase() === d.name.toLowerCase());
    if (!now) return answer('That meal is no longer in the log. Send /all again.');
    await answer(''); return askUnits({ type: 'meal', name: now.name, t: Date.now(), via: 'list' });
  }
  if (act === 'j') { if (!canMerge(L)) return answer(''); L.sel = L.sel || new Set(); await answer(''); return show(pickView(L)); }
  if (act === 'c') { L.sel = null; if (tgPending && tgPending.rename) tgPending = null; await answer(''); return show(listView(L)); }
  if (act === 'r') { await answer(''); return show(renameView(L)); }
  if (act === 'e') {
    const d = L.items[+x], now = d && dishes(readDb()).find(y => y.name.toLowerCase() === d.name.toLowerCase());
    if (!now) return answer('That meal is no longer in the log. Send /all again.');
    tgPending = { rename: now.name, at: Date.now() }; await answer('');
    return tgSay(`✏️ What should <b>${he(now.name)}</b> be called? Send the new name.\n<i>${now.n} logged ${now.n === 1 ? 'meal' : 'meals'} get the new name. /cancel stops.</i>`, { reply_markup: { force_reply: true, input_field_placeholder: now.name.slice(0, 64) } });
  }
  if (!L.sel) return answer('');
  if (act === 't') { const i = +x; if (L.items[i]) L.sel.has(i) ? L.sel.delete(i) : L.sel.add(i); await answer(''); return show(pickView(L)); }
  if (act === 'n') { if (L.sel.size < 2) return answer('Pick at least two.'); await answer(''); return show(keepView(L)); }
  if (act === 'k') {
    const i = +x; if (!L.sel.has(i)) return answer('');
    const keep = L.items[i].name, m = mergeDishes(keep, [...L.sel].map(j => L.items[j].name));
    tgLists.delete(lid);
    if (!m) { await answer('Nothing to change'); return show({ text: 'Nothing changed: those meals are no longer in the log.', reply_markup: { inline_keyboard: [] } }); }
    await answer('Done');
    return show({ text: `🔗 <b>${he(keep)}</b> now counts as one meal.\n${m.n} logged ${m.n === 1 ? 'meal' : 'meals'} renamed${m.names.length ? ` from ${m.names.map(n => `<i>${he(n)}</i>`).join(', ')}` : ''}. Next time you write one of the old names, it is logged as ${he(keep)}.`,
      reply_markup: { inline_keyboard: [[{ text: 'Undo', callback_data: 'x:' + m.rec.id }]] } });
  }
  return answer('');
}
// ---------- Change dose / Change time: rätta ett skrivfel med ett tryck under bekräftelsen ----------
// Förut fick man trycka Undo och skriva allt igen. v = fråga efter ny dos, w = fråga efter ny tid, m = en tidsknapp
// ("30 min ago"), b = ändra tillbaka (det gamla värdet ligger i knappen: "b:id:d:7" eller "b:id:t:<ms>").
function editEntry(id, patch) {
  const db = readDb(), k = db.log.some(m => m.id === id) ? 'log' : db.notes.some(n => n.id === id) ? 'notes' : null; if (!k) return null;
  const old = db[k].find(m => m.id === id), e = { ...old, ...patch };
  db[k] = db[k].map(m => m.id === id ? e : m).sort((a, b) => b.t - a.t); db.rev++; writeDb(db);
  return { e, old };
}
const findEntry = id => { const db = readDb(); return db.log.find(m => m.id === id) || db.notes.find(n => n.id === id) || null; };
// En tid som svar: "18:30", "kl 18", "18", "igår 19:30", "20 min sen", "1 h ago", "nu". null om det inte är en tid.
function parseWhen(text, ref) {
  let s = String(text).toLowerCase().trim().replace(/[.!]+$/, ''), day = 0;
  if (/^(nu|now|just nu|right now)$/.test(s)) return ref;
  const y = s.match(/^(igår|i går|igar|yesterday)\s*(.*)$/); if (y) { day = 1; s = y[2].replace(/^(kl\.?|klockan|at)\s*/, '').trim(); }
  let m = s.match(/^(?:kl\.?\s*|klockan\s*|at\s*)?([01]?\d|2[0-3])(?:[:.]([0-5]\d))?$/);
  if (m) {
    const h = +m[1], mi = +(m[2] || 0); if (!day) return atClock(h, mi, ref);
    const d = new Date(ref); d.setDate(d.getDate() - 1); d.setHours(h, mi, 0, 0); return d.getTime();
  }
  if (day) return null;
  m = s.match(/^(?:för\s+)?(\d+(?:[.,]\d+)?)\s*(m|min|mins|minut|minuter|minute|minutes|h|tim|timme|timmar|hour|hours)\s*(sen|sedan|ago)?$/);
  if (m) { const n = parseFloat(m[1].replace(',', '.')) * (/^(h|tim|timme|timmar|hour|hours)$/.test(m[2]) ? 60 : 1); if (n >= 0 && n <= 1440) return ref - n * 6e4; }
  return null;
}
const QUICK = [[0, 'Now'], [15, '15 min ago'], [30, '30 min ago'], [60, '1 h ago']];
const backBtn = (id, kind, v) => ({ reply_markup: { inline_keyboard: [[{ text: '↩️ Change back', callback_data: `b:${id}:${kind}:${v}` }]] } });
// Bara de senaste 8 dygnen och aldrig framåt i tiden
const okWhen = t => Number.isFinite(t) && t <= Date.now() + 6e4 && t >= Date.now() - 8 * 864e5;
async function tgChanged(id, patch, kind) {
  const r = editEntry(id, patch); if (!r) return tgSay('That is no longer in the log. Nothing changed.');
  const was = kind === 'd' ? `${r.old.ins} ${r.old.ins === 1 ? 'unit' : 'units'}` : whenTxt(r.old.t);
  const warn = kind === 'd' && r.e.name !== undefined && doseCheck(r.e.name, r.e.ins, readDb(), null); // bara dosen, inte "redan loggad"
  return tgSay(`✏️ Changed: ${describe(r.e)}\n<i>Was ${he(was)}.</i>${warn ? `\n⚠ ${he(warn)}` : ''}`, backBtn(id, kind, kind === 'd' ? r.old.ins : r.old.t));
}
async function tgEditTap(act, arg, answer) {
  const [id, a, b] = arg.split(':'), e = findEntry(id);
  if (!e) return answer('That is no longer in the log.');
  if (act === 'v') {
    if (e.name === undefined) return answer('');
    tgPending = { edit: 'dose', id, at: Date.now() }; await answer('');
    return tgSay(`✏️ How many units did you take for <b>${he(e.name)}</b>? Now <b>${e.ins}</b>. Send the right number.\n<i>/cancel stops.</i>`, { reply_markup: { force_reply: true, input_field_placeholder: String(e.ins) } });
  }
  if (act === 'w') {
    tgPending = { edit: 'time', id, at: Date.now() }; await answer('');
    return tgSay(`🕒 When was <b>${he(e.name !== undefined ? e.name : kindLabel(e.kind))}</b>? Now ${he(whenTxt(e.t))}. Tap one, or send a time like <i>18:30</i>, <i>igår 19:00</i> or <i>20 min sen</i>.\n<i>/cancel stops.</i>`,
      { reply_markup: { inline_keyboard: [QUICK.map(([min, label]) => ({ text: label, callback_data: `m:${id}:${min}` }))] } });
  }
  if (act === 'm') { // tidsknapparna räknar från när man trycker
    if (tgPending && tgPending.edit && tgPending.id === id) tgPending = null;
    await answer(''); return tgChanged(id, { t: Math.round(Date.now() - (+a || 0) * 6e4) }, 't');
  }
  if (act === 'b') {
    const v = parseFloat(b); if (!Number.isFinite(v)) return answer('');
    if (a === 'd' && v >= 0 && v <= 100 && e.name !== undefined) { editEntry(id, { ins: v }); await answer('Changed back'); return tgSay(`↩️ Changed back: ${describe({ ...e, ins: v })}`); }
    if (a === 't' && okWhen(v)) { editEntry(id, { t: v }); await answer('Changed back'); return tgSay(`↩️ Changed back: ${describe({ ...e, t: v })}`); }
  }
  return answer('');
}
// Det skrivna svaret på Change dose eller Change time
async function tgEditReply(p, text) {
  if (!findEntry(p.id)) { tgPending = null; return tgSay('That is no longer in the log. Nothing changed.'); }
  if (p.edit === 'dose') {
    const n = unitsReply(text);
    if (n === null || n > 100) return tgSay('Send the number of units, like <i>6</i> or <i>6,5</i>. /cancel stops.');
    tgPending = null; return tgChanged(p.id, { ins: Math.round(n * 10) / 10 }, 'd');
  }
  const t = parseWhen(text, Date.now());
  if (t === null || !okWhen(t)) return tgSay('Send a time like <i>18:30</i>, <i>igår 19:00</i> or <i>20 min sen</i>. /cancel stops.');
  tgPending = null; return tgChanged(p.id, { t: Math.min(Math.round(t), Date.now()) }, 't');
}
async function tgHandle(u) {
  const q = u.callback_query;
  if (q) { // knapparna Undo (u:), Save to Meals (s:), dosen (d:), "Same as …?" (a:), listan (l p j t n k c) och Undo för Count as one (x:)
    if (!tg.chat || !q.message || q.message.chat.id !== tg.chat) return;
    const [, act, id] = String(q.data || '').match(/^([a-z]):(.+)$/) || [], answer = text => tgApi('answerCallbackQuery', { callback_query_id: q.id, text }).catch(() => {});
    if ('lpjtnkcre'.includes(act || '-')) return tgListTap(q, act, id, answer);
    if (act === 'a') { // "Same as …?": gäller bara den senaste frågan, och knapparna tas bort när man tryckt
      const [nonce, pick] = id.split(':'), ok = tgPending && tgPending.same && tgPending.nonce === nonce && Date.now() - tgPending.at < 30 * 6e4;
      await answer(ok ? '' : 'That question has expired. Send the meal again.');
      await tgApi('editMessageReplyMarkup', { chat_id: tg.chat, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
      if (ok) await sameAnswer(pick, 'tg' + u.update_id);
      return;
    }
    if (act === 'x') {
      const r = unmerge(id);
      await answer(r ? 'Undone' : 'Already undone');
      if (r) await tgApi('editMessageText', { chat_id: tg.chat, message_id: q.message.message_id, parse_mode: 'HTML', text: `<s>${he(q.message.text || '')}</s>\n↩️ Undone. The meals have their old names again.` }).catch(() => {});
      return;
    }
    if (act === 'd') { // en dosknapp under "How many units?": gäller bara den senaste frågan, och knapparna tas bort när man tryckt
      const [nonce, v] = id.split(':'), ok = tgPending && tgPending.nonce === nonce && !tgPending.confirm && Date.now() - tgPending.at < 30 * 6e4;
      await answer(ok ? '' : 'That question has expired. Send the meal again.');
      await tgApi('editMessageReplyMarkup', { chat_id: tg.chat, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
      if (ok) await tgUnits(parseFloat(v), 'tg' + u.update_id);
      return;
    }
    if (act === 's') {
      const s = saveMeal(id);
      await answer(!s ? 'That meal is no longer in the log' : s.already ? `${s.name} is already in Meals` : `Saved ${s.name} to Meals`);
      if (s) await tgApi('editMessageReplyMarkup', { chat_id: tg.chat, message_id: q.message.message_id, ...buttons(id, false) }).catch(() => {});
      return;
    }
    if ('vwmb'.includes(act || '-')) return tgEditTap(act, id, answer);
    const ok = act === 'u' && removeEntry(id);
    await answer(ok ? 'Removed' : 'Already removed');
    if (ok) await tgApi('editMessageText', { chat_id: tg.chat, message_id: q.message.message_id, parse_mode: 'HTML', text: `<s>${he(q.message.text || '')}</s>\n↩️ Removed` }).catch(() => {});
    return;
  }
  const m = u.message; if (!m || !m.chat) return;
  const text = (m.text || '').trim();
  if (m.chat.id !== tg.chat) { // parkoppling: "/start 12345678" med koden från Settings (länken där skickar den), bara i en privat chatt
    const c = text.match(/^\/start\s+(\d{6,8})$/);
    if (tg.chat || !c || m.chat.type !== 'private') return;
    if (!codeOk()) return;
    const a = Buffer.from(c[1]), b = Buffer.from(tg.code);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) { tg.tries = (tg.tries || 0) + 1; saveTg(); return; }
    tg.chat = m.chat.id; tg.who = [m.from && m.from.first_name, m.from && m.from.username && '@' + m.from.username].filter(Boolean).join(' '); tg.code = ''; tg.favSent = true; tg.mealsSent = true; saveTg();
    await tgSay('Connected to your glucose dashboard. 👋\n\n' + HELP);
    return;
  }
  if (!text) return tgSay('I can only read text. Use the microphone on your keyboard to dictate.');
  // Namnbyte och Change dose/time: nästa meddelande är svaret (i 30 min). Ett kommando avbryter det, /cancel säger det.
  if (tgPending && (tgPending.rename || tgPending.edit)) {
    const p = tgPending;
    if (text.startsWith('/')) { tgPending = null; if (/^\/cancel\b/.test(text)) return tgSay(p.rename ? `OK, ${he(p.rename)} keeps its name.` : 'OK, nothing changed.'); }
    else if (Date.now() - p.at < 30 * 6e4) return p.rename ? tgRename(p.rename, text) : tgEditReply(p, text);
    else tgPending = null;
  }
  if (/^\/cancel\b/.test(text)) { const had = tgPending && Date.now() - tgPending.at < 30 * 6e4; tgPending = null; return tgSay(had ? 'OK, stopped. Nothing was logged.' : 'There is nothing to stop.'); }
  if (/^\/(start|help)\b/.test(text)) return tgSay(HELP);
  if (/^\/fav\b/.test(text)) { tg.fav = true; saveTg(); const kb = favKeyboard(); return tgSay(kb ? 'Your most logged meals are buttons under the text field. Tap one to log it. /nofav hides them.' : 'Log a few meals first, then the buttons show up here.', kb || {}); }
  if (/^\/nofav\b/.test(text)) { tg.fav = false; saveTg(); return tgSay('Hid the buttons. Send /fav to get them back.', { reply_markup: { remove_keyboard: true } }); }
  // En favoritknapp ("⭐ Havregrynsgröt"): rätten är känd, så bara dosen frågas efter. Ingen tolkning behövs.
  if (text.startsWith(FAV)) {
    const want = text.slice(FAV.length).trim().toLowerCase(), name = mealNames(readDb()).map(cleanName).find(n => n.toLowerCase().slice(0, 60) === want);
    if (name) return askUnits({ name, t: m.date * 1000, via: 'fav' });
  }
  const ml = text.match(/^\/(all|allt|meals|list|search)(?:@\w+)?(?:\s+([\s\S]*))?$/i);
  if (ml) return tgMeals((ml[2] || '').trim().slice(0, 100));
  if (/^\/week\b/.test(text)) return tgSay(weekText());
  if (/^\/month\b/.test(text)) { const list = monthList(), k = mkey(Date.now()); return tgSay(monthText(list.includes(k) && monthCov(k) >= 20 ? k : defaultMonth(list) || k)); }
  if (/^\/undo\b/.test(text)) {
    const id = tg.last.pop(), db = readDb(), e = id && (db.log.find(x => x.id === id) || db.notes.find(x => x.id === id)); saveTg();
    if (!e) return tgSay('Nothing to undo.');
    removeEntry(id); return tgSay('↩️ Removed ' + describe(e));
  }
  // Allt annat som börjar med / är en sökning: "/kyckling", "/chopchop ris", och bara "/" visar allt. Kortare än
  // "/all kyckling". ("/kyckling@minbot" från en grupp eller menyn: botens namn tas bort.)
  if (text.startsWith('/')) return tgMeals(text.slice(1).replace(/^(\S*?)@\w+/, '$1').trim().slice(0, 100));
  // Svar på "How many units?", på en dos som behövde bekräftas eller på "Same as …?" (gäller i 30 min)
  if (tgPending && Date.now() - tgPending.at < 30 * 6e4) {
    if (tgPending.same) {
      if (/^(yes|ja|j|y|ok|same|samma|japp|jepp)$/i.test(text)) return sameAnswer(0, 'tg' + u.update_id);
      if (/^(no|nej|n|new|ny|nytt|new meal|ny rätt|nope)$/i.test(text)) return sameAnswer('n', 'tg' + u.update_id);
      if (unitsReply(text) !== null) return tgSay('First tap <b>Same</b> or <b>New meal</b> above (or reply <i>yes</i> or <i>no</i>).');
    } else {
      if (tgPending.confirm && /^(yes|ja|j|y|ok)$/i.test(text)) { const p = tgPending; tgPending = null; return tgLogged(p, 'tg' + u.update_id); }
      // Ett tal, gärna med enhet eller insulinnamn ("5,5 enheter", "5.5e", "6 units", "4 enheter fiasp"). Förut godtogs bara
      // ett ensamt tal, så "5,5 enheter" efter en favorit gick vidare som ett nytt meddelande och blev en korrigeringsdos.
      const n = unitsReply(text); if (n !== null) return tgUnits(n, 'tg' + u.update_id);
    }
  }
  // Ett ensamt ja/nej utan öppen fråga (t.ex. efter att frågan gått ut) är ingen rätt. Förut blev "ja" en måltid "Ja".
  if (/^(ja|nej|yes|no|j|n|y|nope|japp|jepp|same|samma)[.!]?$/i.test(text)) return tgSay('There is no open question right now. Send the meal again, for example <i>pizza 7,5 enheter</i>.');
  const r = await interpret((text.startsWith(FAV) ? text.slice(FAV.length) : text).slice(0, 300), m.date * 1000);
  if (r.type === 'other') {
    // "chopchop?" eller "kyckling" som inte blev en måltid: visa de rätter man loggat som passar, så är det ett tryck att logga
    // Inte för frågor, hälsningar och ja/nej ("vad åt jag?", "hej", ett sent "ja" på en fråga som gått ut)
    const plain = text.replace(/[?!.]/g, ' ').replace(/\s+/g, ' ').trim();
    const hits = plain.length <= 40 && !plain.startsWith('/') && !NOT_MEAL.test(plain) && !/^(ja|nej|yes|no|j|n|y|nope|japp|jepp|same|samma)$/i.test(plain) && dishToks(plain).length && findDishes(plain, dishes(readDb()));
    if (hits && hits.length && hits.length <= 20) { const v = listView(newList(plain, hits)); return tgSay(v.text, { reply_markup: v.reply_markup }); }
    return tgSay("I didn't catch a meal or a note there. Try: <i>pizza 7,5 enheter</i>\n/all shows everything you've logged.");
  }
  const late = Date.now() - m.date * 1000 > 10 * 6e4; // >10 min gammalt: datorn var av
  // Liknar det en rätt man loggat förut med ett annat namn: fråga först (dosen följer med och frågas efter sedan om den saknas)
  const same = sameAs(r); if (same) return askSame({ ...r, same }, late);
  return tgMeal(r, 'tg' + u.update_id, late);
}
async function tgLoop() {
  for (;;) {
    if (!tg.token) { await sleep(2e3); continue; }
    const token = tg.token, ac = tgAbort = new AbortController();
    try {
      const ups = await tgApi('getUpdates', { offset: tg.offset, timeout: 50, allowed_updates: ['message', 'callback_query'] }, AbortSignal.any([ac.signal, AbortSignal.timeout(65e3)]), token);
      tgErr = '';
      for (const u of ups) {
        if (token !== tg.token) break; // bortkopplad eller ny bot under tiden
        try { await tgHandle(u); } catch (e) { console.error('Telegram:', e); if (tg.chat) tgSay('Something went wrong, nothing was logged. Try again.'); }
        tg.offset = u.update_id + 1; saveTg();
      }
    } catch (e) {
      if (ac.signal.aborted) continue;
      tgErr = e.code === 401 || e.code === 404 ? 'Telegram no longer accepts the bot token. Disconnect and connect again.'
        : e.code === 409 ? 'Another program is reading this bot\'s messages. Is the dashboard running twice?' : 'No contact with Telegram right now. Retrying.';
      await sleep(e.code === 409 ? 30e3 : 10e3);
    }
  }
}
const LOCALHOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
// Sidan och ikonerna läses från disken vid varje anrop (så att en ny index.html gäller direkt, utan omstart), men med
// ETag: oförändrad fil ger 304 utan innehåll. Text komprimeras med gzip när webbläsaren tar emot det (sidan är ~260 kB).
function file(req, res, f, type) {
  const p = path.join(__dirname, f), miss = () => { res.writeHead(f === 'index.html' ? 500 : 404, { 'content-type': 'text/plain', ...SEC }); res.end(f === 'index.html' ? 'index.html missing' : 'not found'); };
  fs.stat(p, (e, st) => {
    if (e) return miss();
    const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`, h = { 'content-type': type, 'cache-control': 'no-cache', etag, ...SEC };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, h); return res.end(); }
    fs.readFile(p, (e2, d) => {
      if (e2) return miss();
      if (!(zlib && zlib.gzip && /^(text|application\/(manifest\+)?json|image\/svg)/.test(type) && /\bgzip\b/.test(req.headers['accept-encoding'] || ''))) { res.writeHead(200, h); return res.end(d); }
      zlib.gzip(d, (e3, z) => { if (e3) { res.writeHead(200, h); return res.end(d); } res.writeHead(200, { ...h, 'content-encoding': 'gzip', vary: 'accept-encoding' }); res.end(z); });
    });
  });
}

// ---------- Excel-fil (.xlsx) utan paket ----------
// En .xlsx är en zip med några XML-filer. Celler: tal, text, { t: ms } (tid, visas som 2026-11-17 18:05 i serverns
// tidszon) eller { n1: tal } (en decimal). Första raden är rubriker i fetstil och fryses. Komprimeras med zlib när den
// finns (Node); i webbdemon, där servern körs i webbläsaren, sparas filerna okomprimerade, vilket zip också tillåter.
let zlib = null; try { zlib = require('zlib'); } catch {}
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
// Komprimeringen görs asynkront (zlib.deflateRaw i Nodes trådpool), så att en export av flera års värden inte stoppar
// hämtningarna, Telegram och alla andra anrop medan den pågår. Förut deflateRawSync på huvudtråden.
const deflate = raw => zlib && zlib.deflateRaw ? new Promise((ok, fail) => zlib.deflateRaw(raw, (e, d) => e ? fail(e) : ok(new Uint8Array(d)))) : Promise.resolve(null);
async function zip(files) {
  const enc = new TextEncoder(), parts = [], dir = []; let off = 0;
  const hdr = (n, f) => { const b = new Uint8Array(n); f(new DataView(b.buffer)); return b; };
  for (const [name, text] of files) {
    const nm = enc.encode(name), raw = enc.encode(text), crc = crc32(raw);
    const z = await deflate(raw), data = z || raw, method = z ? 8 : 0;
    // Lokalt filhuvud (30 byte) och posten i innehållsförteckningen (46 byte). 0x21 = 1980-01-01, datumet spelar ingen roll.
    parts.push(hdr(30, v => { v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(8, method, true); v.setUint16(12, 0x21, true);
      v.setUint32(14, crc, true); v.setUint32(18, data.length, true); v.setUint32(22, raw.length, true); v.setUint16(26, nm.length, true); }), nm, data);
    dir.push(hdr(46, v => { v.setUint32(0, 0x02014b50, true); v.setUint16(4, 20, true); v.setUint16(6, 20, true); v.setUint16(10, method, true); v.setUint16(14, 0x21, true);
      v.setUint32(16, crc, true); v.setUint32(20, data.length, true); v.setUint32(24, raw.length, true); v.setUint16(28, nm.length, true); v.setUint32(42, off, true); }), nm);
    off += 30 + nm.length + data.length;
  }
  const size = dir.reduce((n, b) => n + b.length, 0);
  const end = hdr(22, v => { v.setUint32(0, 0x06054b50, true); v.setUint16(8, files.length, true); v.setUint16(10, files.length, true); v.setUint32(12, size, true); v.setUint32(16, off, true); });
  const all = [...parts, ...dir, end], out = new Uint8Array(all.reduce((n, b) => n + b.length, 0)); let p = 0;
  for (const b of all) { out.set(b, p); p += b.length; }
  return out;
}
function xlsx(sheets) {
  const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"', REL = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const H = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>', T = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
  const x = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
  // Excels tid: dagar sedan 1899-12-30, i lokal tid (samma klockslag som i appen)
  const serial = t => { const d = new Date(t); return (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()) / 864e5 + 25569).toFixed(10); };
  const cell = (v, ref, head) => v === '' || v == null ? '' : head ? `<c r="${ref}" t="inlineStr" s="3"><is><t>${x(v)}</t></is></c>`
    : typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : v.t !== undefined ? `<c r="${ref}" s="1"><v>${serial(v.t)}</v></c>`
    : v.n1 !== undefined ? `<c r="${ref}" s="2"><v>${v.n1}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${x(v)}</t></is></c>`;
  const sheet = s => `${H}<worksheet ${NS}><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    + `<cols>${s.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>`
    + s.rows.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => cell(v, String.fromCharCode(65 + j) + (i + 1), i === 0)).join('')}</row>`).join('') + '</sheetData></worksheet>';
  return zip([
    ['[Content_Types].xml', `${H}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
    ['_rels/.rels', `${H}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${T}officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `${H}<workbook ${NS} ${REL}><sheets>${sheets.map((s, i) => `<sheet name="${x(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `${H}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="${T}worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="${T}styles" Target="styles.xml"/></Relationships>`],
    // Stilar: 0 vanlig, 1 tid (2026-11-17 18:05), 2 en decimal, 3 fetstil (rubriker)
    ['xl/styles.xml', `${H}<styleSheet ${NS}><numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm"/><numFmt numFmtId="165" formatCode="0.0"/></numFmts>`
      + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
      + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      + '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheet(s)]),
  ]);
}

// ---------- HTTP ----------
// db.json: måltider, logg, anteckningar och inställningar. rev räknas upp vid varje sparning, så att två
// enheter (t.ex. datorn och mobilen) inte skriver över varandras ändringar: en sparning från en äldre
// version avvisas med 409 och den aktuella versionen, och sidan gör om sin ändring på den.
// Varje rad kontrolleras när sidan sparar (PUT /api/db): id, tider, doser och texter av rätt slag och storlek. Förut
// kontrollerades bara att listorna fanns, så vad som helst kunde sparas (en dos som text, ett id med HTML i) och sedan
// visas på sidan. Okända fält får finnas kvar (äldre versioner sparade t.ex. "rise" på en måltid).
const isArr = Array.isArray, isObj = o => !!o && typeof o === 'object' && !isArr(o);
const okId = x => typeof x === 'string' && /^[\w-]{1,64}$/.test(x), okNum = (x, a, b) => typeof x === 'number' && Number.isFinite(x) && x >= a && x <= b;
const okStr = (x, n) => typeof x === 'string' && x.length <= n, optStr = (x, n) => x === undefined || okStr(x, n);
const okTime = t => okNum(t, Date.UTC(2010, 0, 1), Date.now() + 864e5);
const okEntry = { log: m => isObj(m) && okId(m.id) && okTime(m.t) && okStr(m.name, 200) && okNum(m.ins, 0, 100) && optStr(m.type, 60),
  notes: n => isObj(n) && okId(n.id) && okTime(n.t) && okStr(n.kind, 40) && optStr(n.text, 500) && (n.dur === undefined || okNum(n.dur, 1, 1440)),
  meals: m => isObj(m) && okId(m.id) && okStr(m.name, 200) && okNum(m.ins, 0, 100) };
const validDb = o => isObj(o) && isArr(o.meals) && isArr(o.log) && (o.notes === undefined || isArr(o.notes));
// Det som skickas in: samma form som filen, och dessutom varje rad, inställningarna och versionsnumret (krävs)
const dbProblem = o => {
  if (!validDb(o)) return 'bad data';
  if (!Number.isInteger(o.rev)) return 'rev missing';
  for (const k of ['log', 'notes', 'meals']) { const i = (o[k] || []).findIndex(x => !okEntry[k](x)); if (i >= 0) return `bad ${k} entry ${i}`; }
  if (o.settings !== undefined && !isObj(o.settings)) return 'bad settings';
  const s = o.settings || {};
  if (!optStr(s.fast, 60) || !optStr(s.long, 60) || (s.lo !== undefined && !okTarget(s.lo, s.hi))) return 'bad settings';
  return null;
};
// db.json läses om bara när filen har ändrats (tid och storlek), i stället för att läsas och tolkas vid nästan varje
// anrop och varje Telegram-svar. Den som ändrar det som kommer tillbaka sparar med writeDb.
let dbCache = null;
const readDb = () => {
  let st = null; try { st = fs.statSync(DBF); } catch {}
  const key = st && st.mtimeMs + ':' + st.size;
  if (dbCache && key && dbCache.key === key) return { ...dbCache.o };
  let o; try { o = JSON.parse(fs.readFileSync(DBF, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') console.error('db.json could not be read:', e.message); }
  const d = validDb(o) ? { notes: [], settings: {}, rev: 0, ...o } : { meals: [], log: [], notes: [], settings: {}, rev: 0 };
  dbCache = key ? { key, o: d } : null;
  return { ...d };
};
// Skriv till en temporär fil och byt namn, så att ett avbrott mitt i skrivningen aldrig lämnar en halv db.json
const writeDb = o => {
  try { fs.writeFileSync(DBF + '.tmp', JSON.stringify(o)); fs.renameSync(DBF + '.tmp', DBF); } finally { dbCache = null; }
  dbRev = o.rev; tgtC = null;
};
// Senaste versionsnumret, så att sidan kan se om db.json ändrats utan att hämta hela filen varje minut
let dbRev = null;
const currentRev = () => dbRev ??= readDb().rev;
// Säkerhetshuvuden på varje svar: sidan får inte visas i en ram på en annan webbplats (clickjacking), webbläsaren gissar
// aldrig filtyp, och ingen adress skickas vidare när man följer en länk.
const SEC = { 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'", 'referrer-policy': 'no-referrer' };
const send = (res, o, c = 200, extra) => { res.writeHead(c, { 'content-type': 'application/json', 'cache-control': 'no-store', ...SEC, ...extra }); res.end(JSON.stringify(o)); };
// Läser JSON-kroppen. Kräver content-type application/json, så att andra webbsidor i webbläsaren
// inte kan skicka hit anrop (t.ex. falska mätvärden) utan en CORS-förfrågan som servern aldrig godkänner.
// Högst 64 MB för importen och hela db.json (flera års mätvärden), högst 256 kB för allt annat.
const MAX_BODY = 64 * 2 ** 20, MAX_SMALL = 256 * 1024;
const body = (req, res, fn, max = MAX_SMALL) => {
  if (!/^application\/json/.test(req.headers['content-type'] || '')) return send(res, { error: 'expected JSON' }, 415);
  const parts = []; let n = 0;
  req.on('data', c => { n += c.length; if (n <= max) parts.push(c); else parts.length = 0; }); // för stort: läses men sparas inte
  req.on('end', () => {
    if (n > max) return send(res, { error: 'too large' }, 413);
    let o; try { o = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { return send(res, { error: 'invalid JSON' }, 400); }
    // Fångar fel både i vanliga och asynkrona hanterare
    Promise.resolve().then(() => fn(o === null ? {} : o)).catch(e => { console.error(e); if (!res.headersSent) send(res, { error: 'server error' }, 500); else res.end(); });
  });
};
// SITE_NAME=glucose.local: dashboarden har ett eget namn. Andra .local-namn på samma dator (t.ex. Pi:ns eget, raspberrypi.local)
// skickas vidare dit, så att den bara nås på ett namn. IP-adressen och localhost fungerar som förut.
const SITE = (process.env.SITE_NAME || '').toLowerCase();
// Stoppar "DNS rebinding": en främmande webbsida får sitt eget domännamn att peka på dashboardens adress och kan
// sedan läsa dina värden och skriva över loggen. Webbläsaren skickar då det främmande namnet som Host, så bara
// namn som inte kan pekas om utifrån släpps in. Lokalt: bara localhost. I hemnätet dessutom IP-adresser, .local-namn
// (mDNS, svarar bara i det egna nätet), datorns eget namn, SITE_NAME och namn i ALLOWED_HOSTS (kommaseparerade).
const LOCAL = /^(127\.|localhost$|::1$)/.test(HOST);
const ALLOWED = new Set([SITE, os.hostname().toLowerCase(), ...(process.env.ALLOWED_HOSTS || '').toLowerCase().split(',').map(x => x.trim())].filter(Boolean));
const okHost = h => {
  if (LOCALHOST.test(h || '')) return true;
  if (LOCAL) return false;
  const n = String(h || '').toLowerCase().replace(/:\d+$/, '');
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(n) || /^\[[0-9a-f:.]+\]$/.test(n) || n.endsWith('.local') || ALLOWED.has(n);
};
const otherName = h => { const n = String(h || '').toLowerCase().replace(/:\d+$/, ''); return SITE && n.endsWith('.local') && n !== SITE; };
// EXTRA_PORT=3000: en andra port för gamla bokmärken när dashboarden flyttat till PORT=80. Ett .local-namn där skickas
// vidare till http://SITE_NAME/, så att adressen blir en. localhost och IP-adresser svarar som vanligt även där.
const EXTRA = +process.env.EXTRA_PORT || 0;
const oldPort = req => !!(SITE && EXTRA && req.socket.localPort === EXTRA && String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '').endsWith('.local'));
// LAN_IFACE=eth0 (flera med komma): bara klienter på det nätets adresser, och datorn själv via 127.0.0.1, får svar.
// På en Pi som också är WiFi-accesspunkt (wlan0) nådde enheter på det nätet annars dashboarden utan inloggning.
// Att bara lyssna på eth0-adressen räcker inte: Linux tar emot paket till den adressen även när de kommer in via wlan0.
// Saknar nätverkskortet adress (t.ex. kabeln urdragen, eller innan DHCP svarat) får ingen svar utom datorn själv. Förut
// släpptes då alla in, även enheterna på det andra nätet som regeln skulle stänga ute.
const LAN = (process.env.LAN_IFACE || '').split(',').map(x => x.trim()).filter(Boolean);
const ipInt = ip => ip.split('.').reduce((n, x) => ((n << 8) | +x) >>> 0, 0);
function fromLan(addr) {
  if (!LAN.length) return true;
  const ip = String(addr || '').replace(/^::ffff:/, '');
  if (ip === '::1' || ip.startsWith('127.')) return true;
  const nets = LAN.flatMap(n => (os.networkInterfaces()[n] || []).filter(i => i.family === 'IPv4'));
  if (!nets.length) return false;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return false;
  const a = ipInt(ip);
  return nets.some(i => ((a & ipInt(i.netmask)) >>> 0) === ((ipInt(i.address) & ipInt(i.netmask)) >>> 0));
}
// ---------- Lösenord för dashboarden (frivilligt) ----------
// Settings → Passcode. Av från början: då kan alla i hemnätet öppna dashboarden, som förut. På: varje enhet anger koden en
// gång och får en kaka (HttpOnly, SameSite=Strict) som gäller i ett år; utan den svarar /api/* bara 401. Koden sparas
// aldrig, bara en scrypt-hash med salt, i data/auth.json (600), tillsammans med hashar av enheternas nycklar. Datorn själv
// (127.0.0.1, t.ex. kontrollen i pi/deploy.ps1) behöver ingen kod; AUTH_LOCAL_FREE=0 tar bort det undantaget (testerna).
// Det här är inte LibreLinkUp-lösenordet, som fortfarande aldrig sparas.
const AF = path.join(DIR, 'auth.json'), SESSION_MS = 365 * 864e5;
let auth = null; try { const a = JSON.parse(fs.readFileSync(AF, 'utf8')); if (a && a.hash && a.salt) auth = { sessions: [], ...a }; } catch {}
const saveAuth = () => { if (auth) writePrivate(AF, JSON.stringify(auth)); else fs.rmSync(AF, { force: true }); };
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const scrypt = (code, salt) => new Promise((ok, fail) => crypto.scrypt(String(code), salt, 32, (e, k) => e ? fail(e) : ok(k.toString('hex'))));
const cookieOf = req => { const m = String(req.headers.cookie || '').match(/(?:^|;\s*)gsid=([a-f0-9]{64})/); return m ? m[1] : null; };
const isLocal = req => process.env.AUTH_LOCAL_FREE !== '0' && /^(::1|127\.|::ffff:127\.)/.test(String(req.socket.remoteAddress || ''));
const hasSession = req => { const c = cookieOf(req); if (!c || !auth) return false; const h = sha(c); return auth.sessions.some(s => s.h === h && Date.now() - s.t < SESSION_MS); };
const authOk = req => !auth || isLocal(req) || hasSession(req);
// En ny nyckel för den här enheten, som kaka
function newSession(res) {
  const tok = crypto.randomBytes(32).toString('hex');
  auth.sessions = [...auth.sessions.filter(s => Date.now() - s.t < SESSION_MS), { h: sha(tok), t: Date.now() }].slice(-50); saveAuth();
  return { 'set-cookie': `gsid=${tok}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1e3}` };
}
const OPEN = new Set(['/api/auth', '/api/auth/login']); // går att nå utan kod (läget och själva inloggningen)
let authTries = [];

const handler = (req, res) => {
  if (!fromLan(req.socket.remoteAddress)) { res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8', ...SEC }); return res.end('The glucose dashboard only answers on the home network.'); }
  if (!okHost(req.headers.host)) return send(res, { error: 'forbidden host' }, 403);
  if (otherName(req.headers.host) || oldPort(req)) {
    const to = `http://${SITE}${PORT == 80 ? '' : ':' + PORT}${req.method === 'GET' ? req.url : '/'}`;
    if (req.method === 'GET') { res.writeHead(302, { location: to, 'cache-control': 'no-store' }); return res.end(); }
    return send(res, { error: `Open the dashboard at ${to}` }, 421);
  }
  // Sidan och ikonerna kan alltid hämtas (de innehåller inga värden); allt under /api kräver koden när den är på
  const p = String(req.url).split('?')[0];
  if (p.startsWith('/api/') && !OPEN.has(p) && !authOk(req)) { req.resume(); return send(res, { error: 'Enter the passcode.', auth: true }, 401); }
  try { route(req, res); } catch (e) { console.error(e); if (!res.headersSent) send(res, { error: 'server error' }, 500); else res.end(); }
};
const server = http.createServer(handler);
if (EXTRA && EXTRA !== +PORT) {
  const extra = http.createServer(handler);
  // Den andra porten är bara en bekvämlighet: är den upptagen fortsätter dashboarden på PORT ändå
  extra.on('error', e => console.log(`EXTRA_PORT ${EXTRA}: ${e.code || e.message}, only port ${PORT} is used.`));
  extra.listen(EXTRA, HOST, () => console.log(`Also on port ${EXTRA} (.local names there are sent on to port ${PORT}).`));
}
// Körs dashboarden redan (t.ex. startad vid inloggningen)? Då avslutas den här, i stället för att båda läser Telegram.
server.on('error', e => {
  if (e.code === 'EADDRINUSE') { console.log(`Port ${PORT} is already in use, so the dashboard is probably running already: http://localhost:${PORT}`); process.exit(1); }
  throw e;
});
server.listen(PORT, HOST, () => {
  // Den verkliga porten (PORT=0 ger en ledig port, som testerna använder)
  const port = (server.address && server.address() && server.address().port) || PORT;
  console.log(`Dashboard: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${port}${DEMO ? ' (demo mode)' : creds ? '' : token ? ` (saved login: ${user})` : ' (open it and log in)'}`);
  if (!LOCAL) console.log(LAN.length ? 'Answers only clients on ' + LAN.join(', ') + ' (LAN_IFACE).' + (auth ? ' Other devices need the passcode.' : ' Anyone on that network can open the dashboard and see your data (Settings → Passcode turns on a passcode).') : 'Warning: HOST is not 127.0.0.1, so anyone on your network can open the dashboard and see your data.');
  if (tg.token) console.log(`Telegram: @${tg.bot}${tg.chat ? '' : ' (not linked yet, see Settings)'}`);
  // Hämtningar startar först när porten är vår
  tick(); setInterval(tick, 6e4); tgLoop(); startOllama();
  setInterval(reportTick, 6e4); setTimeout(reportTick, 5e3); setInterval(staleTick, 6e4); setInterval(piTick, 5 * 6e4); setTimeout(piTick, 6e4);
  // Kommandomenyn i Telegram (/week och /month kom till senare; en bot som kopplades in förut får dem här)
  if (tg.token) tgApi('setMyCommands', { commands: COMMANDS }).catch(() => {});
  // En bot som kopplades in innan favoritknapparna fanns får dem en gång, utan att man behöver skriva /fav
  if (tg.token && tg.chat && !tg.favSent && tg.fav !== false && favKeyboard()) { tg.favSent = true; saveTg(); tgSay('New: your most logged meals are now buttons under the text field. Tap one to log it. /nofav hides them.'); }
  // Samma sak för /all och "Same as …?": ett meddelande en gång
  if (tg.token && tg.chat && !tg.mealsSent) { tg.mealsSent = true; saveTg(); tgSay("New: /all lists everything you've logged, and / with a word searches: <i>/kyckling</i>. Tap a meal to log it again. Meals you wrote in different ways can be counted as one, and when something you write looks like a meal you've logged before, I ask <i>Same as …?</i>"); }
});

// "Start with Windows": en liten .cmd i Autostart-mappen som startar servern minimerad i aktivitetsfältet vid inloggning.
// Stäng fönstret för att stoppa den. Inga lösenord skrivs dit; inloggningen sparas som vanligt med "Stay logged in".
const STARTUP = process.platform === 'win32' && path.join(process.env.STARTUP_DIR || path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'), 'Glucose dashboard.cmd');
const startupScript = () => {
  const q = s => String(s).replace(/%/g, '%%');
  return ['@echo off', 'rem Starts the glucose dashboard when you log in to Windows. Turn it off under Settings > Startup, or delete this file.',
    `cd /d "${q(__dirname)}"`, ...['PORT', 'HOST', 'LLU_VERSION', 'OLLAMA_URL', 'OLLAMA_MODEL', 'OLLAMA_AUTOSTART'].filter(k => process.env[k]).map(k => `set "${k}=${q(process.env[k])}"`),
    `start "Glucose dashboard" /min "${q(process.execPath)}" server.js`, ''].join('\r\n');
};
// ---------- Pi-status: sidan "Raspberry Pi" ----------
// Kör användarens eget skript pistatus (/usr/local/bin/pistatus, samma rapport som i terminalen) och delar upp texten i
// avsnitt och rader. Rapporten tar några sekunder (den kontrollerar nätverket och DNS), så svaret sparas en minut.
// Dashboardens egen hälsa (mätvärden, LibreLinkUp, Telegram, data) räknas här, så att den finns även utan pistatus.
// pistatus: "== Rubrik ==", rader "  Etikett (26 tecken) värde", underrader med 4 blanksteg, och överst
// "Status: …" med "  ! problem" och "  * varning". Skriptet färgar bara i en terminal, så det körs via script(1) i en
// låtsasterminal: färgen på en rad (grön 32, gul 33, röd 31) blir radens läge (s: ok, warn, crit) på sidan.
const PISTATUS = process.env.PISTATUS || '/usr/local/bin/pistatus';
let piCache = null, piBusy = null;
function parsePistatus(txt) {
  const out = { host: '', crit: [], warn: [], sections: [] }; let sec = null, sub = null;
  for (const raw of txt.split('\n')) {
    const c = (raw.match(/\x1b\[3([123])m/) || [])[1], line = raw.replace(/\x1b\[[0-9;]*m/g, '').replace(/\s+$/, ''); if (!line) continue;
    const st = c && { 1: 'crit', 3: 'warn', 2: 'ok' }[c];
    let m;
    if (!out.host && !sec && (m = line.match(/^(\S+) - \d{4}-\d\d-\d\d \d\d:\d\d$/))) { out.host = m[1]; continue; }
    if (!sec && /^Status:/.test(line)) continue;
    if (!sec && (m = line.match(/^ {2}([!*]) (.+)$/))) { (m[1] === '!' ? out.crit : out.warn).push(m[2]); continue; }
    if ((m = line.match(/^== (.+) ==$/))) { sec = { h: m[1], rows: [] }; sub = null; out.sections.push(sec); continue; }
    if (!sec) continue;
    if (/^ {4}/.test(line)) { if (!sub) { sub = { k: '', list: [] }; sec.rows.push(sub); } sub.list.push(line.trim()); continue; }
    const k = line.slice(2, 28).trim(), v = line.slice(28).trim();
    if (!v && /:$/.test(k)) { sub = { k: k.slice(0, -1), list: [] }; sec.rows.push(sub); continue; }
    sub = null; sec.rows.push({ k, v, ...(st && { s: st }) });
  }
  return out;
}
function dirSize(d) { let n = 0; try { for (const f of fs.readdirSync(d, { withFileTypes: true })) n += f.isFile() ? fs.statSync(path.join(d, f.name)).size : 0; } catch {} return n; }
function appHealth() {
  const now = Date.now(), lt = S.length ? S[S.length - 1][0] : 0, age = lt ? now - lt : null, rows = [], warn = [];
  const ago = ms => ms < 6e4 ? 'just now' : ms < 36e5 ? Math.round(ms / 6e4) + ' min ago' : ms < 864e5 ? Math.round(ms / 36e5) + ' h ago' : Math.round(ms / 864e5) + ' days ago';
  rows.push({ k: 'Latest reading', v: lt ? `${ago(age)} (${hm(lt)})` : 'none yet', s: lt && age < 15 * 6e4 ? 'ok' : 'warn' });
  if (!lt || age > STALE) warn.push(lt ? `no new readings for ${ago(age).replace(' ago', '')}` : 'no readings yet');
  rows.push({ k: 'Readings stored', v: `${R.size.toLocaleString('en-GB')}${S.length ? ` since ${ymd(S[0][0])}` : ''}` });
  rows.push({ k: 'LibreLinkUp', v: DEMO ? 'demo mode' : status === 'ok' ? 'connected' : status === 'login' ? 'logged out' : status, s: DEMO || status === 'ok' ? 'ok' : 'warn' });
  if (!DEMO && status !== 'ok' && status !== 'starting') warn.push('LibreLinkUp: ' + (status === 'login' ? 'logged out' : status));
  rows.push({ k: 'Telegram', v: tg.token && tg.chat ? `@${tg.bot}, linked` : tg.token ? `@${tg.bot}, not linked yet` : 'off' });
  const db = readDb();
  rows.push({ k: 'Logged', v: `${db.log.length} meals and doses, ${db.notes.length} notes` });
  rows.push({ k: 'Data folder', v: hb(dirSize(DIR)) });
  rows.push({ k: 'Dashboard running', v: `since ${ymd(bootAt)} ${hm(bootAt)}, Node ${process.version}, ${hb(process.memoryUsage().rss)} RAM` });
  return { rows, warn };
}
const hb = b => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(1) + ' MB';
function piStatus(force) {
  if (!force && piCache && Date.now() - piCache.at < 6e4) return Promise.resolve(piCache);
  return piBusy ||= new Promise(done => {
    if (!fs.existsSync(PISTATUS)) return done({ at: Date.now(), missing: true });
    cp.execFile('script', ['-qec', PISTATUS, '/dev/null'], { timeout: 30e3, maxBuffer: 1 << 20, env: { ...process.env, TERM: 'dumb' } }, (err, stdout) =>
      done(stdout ? { at: Date.now(), ...parsePistatus(String(stdout)) } : { at: Date.now(), error: err ? err.message.split('\n')[0] : 'no output' }));
  }).then(r => { piBusy = null; piCache = r; return r; });
}

// Vilka metoder varje adress tar emot. Annan metod ger 405 med Allow, en okänd /api-adress 404 (förut fick båda sidan
// index.html med 200, så ett stavfel syntes som ett JSON-fel långt senare). Anrop som gör något är POST.
const ROUTES = { '/api/bye': 'POST', '/api/now': 'GET', '/api/llu': 'POST', '/api/export': 'GET', '/api/stats': 'GET', '/api/pi': 'GET', '/api/pi/refresh': 'POST',
  '/api/readings': 'GET', '/api/outcomes': 'GET', '/api/profile': 'GET', '/api/login': 'POST', '/api/logout': 'POST', '/api/import': 'POST', '/api/db': 'GET,PUT',
  '/api/quicklog': 'POST', '/api/dishes': 'GET', '/api/telegram': 'GET,POST', '/api/telegram/off': 'POST', '/api/telegram/code': 'POST', '/api/autostart': 'GET,POST', '/api/telegram/pi': 'POST',
  '/api/telegram/stale': 'POST', '/api/telegram/report': 'POST', '/api/weekly': 'GET', '/api/year': 'GET', '/api/curves': 'GET', '/api/month': 'GET',
  '/api/ai/context': 'GET', '/api/ai': 'GET', '/api/ai/warm': 'POST', '/api/ask': 'POST',
  '/api/auth': 'GET', '/api/auth/login': 'POST', '/api/auth/set': 'POST', '/api/auth/off': 'POST', '/api/auth/logout': 'POST' };
const STATIC = { '/icon.svg': 'image/svg+xml', '/apple-touch-icon.png': 'image/png', '/icon-512.png': 'image/png', '/icon-192.png': 'image/png', '/icon-maskable-512.png': 'image/png', '/manifest.webmanifest': 'application/manifest+json' };
// Inloggning: högst 5 försök per kvart, så att formuläret inte kan användas för att gissa lösenord (och låsa kontot)
let loginTries = [];
function route(req, res) {
  const u = new URL(req.url, 'http://x'), m = req.method === 'HEAD' ? 'GET' : req.method;
  if (STATIC[u.pathname]) return m === 'GET' ? file(req, res, u.pathname.slice(1), STATIC[u.pathname]) : send(res, { error: 'method not allowed' }, 405, { allow: 'GET' });
  if (u.pathname.startsWith('/api/')) {
    const allow = ROUTES[u.pathname];
    if (!allow) return send(res, { error: 'not found' }, 404);
    if (!allow.split(',').includes(m)) return send(res, { error: 'method not allowed' }, 405, { allow });
  }
  // sendBeacon skickar text/plain, så det här anropet läser ingen kropp: id:t står i adressen. Det gör inget annat än att
  // låta servern släppa AI-modellen tidigare.
  if (u.pathname === '/api/bye') { req.resume(); pageGone(u.searchParams.get('c')); res.writeHead(204, SEC); return res.end(); }
  if (u.pathname === '/api/now') pageSeen(u.searchParams.get('c'));
  if (u.pathname === '/api/now') return send(res, { last, status, demo: !!DEMO, user, loginErr, rev: currentRev(), sensor: { starts: sens.starts.slice(-40), warm: sens.warm, life: SENSOR_DAYS }, llu: { version: lluVer, std: LLU_VERSION } });
  // Lösenordet: läget, inloggning med koden (högst 5 försök per kvart), ny kod, av, och logga ut den här enheten
  if (u.pathname === '/api/auth') return send(res, { on: !!auth, ok: authOk(req), local: isLocal(req), demo: !!DEMO });
  if (u.pathname === '/api/auth/login') return body(req, res, async ({ code }) => {
    if (!auth) return send(res, { ok: 1 });
    authTries = authTries.filter(t => Date.now() - t < 15 * 6e4);
    if (authTries.length >= 5) return send(res, { error: 'Too many tries. Wait a few minutes and try again.' }, 429);
    authTries.push(Date.now());
    const h = await scrypt(String(code || '').slice(0, 200), auth.salt);
    if (!crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(auth.hash, 'hex'))) return send(res, { error: 'That is not the passcode.' }, 401);
    authTries = []; send(res, { ok: 1 }, 200, newSession(res));
  });
  if (u.pathname === '/api/auth/set') return body(req, res, async ({ code }) => {
    if (DEMO) return send(res, { error: 'Not available in demo mode.' }, 400);
    if (typeof code !== 'string' || code.length < 6 || code.length > 200) return send(res, { error: 'Use at least 6 characters.' }, 400);
    const salt = crypto.randomBytes(16).toString('hex');
    auth = { hash: await scrypt(code, salt), salt, sessions: [] }; saveAuth(); // en ny kod loggar ut alla andra enheter
    send(res, { ok: 1, on: true }, 200, isLocal(req) ? undefined : newSession(res));
  });
  if (u.pathname === '/api/auth/off') return body(req, res, () => { auth = null; saveAuth(); send(res, { ok: 1, on: false }); });
  if (u.pathname === '/api/auth/logout') return body(req, res, () => {
    const c = cookieOf(req); if (auth && c) { auth.sessions = auth.sessions.filter(s => s.h !== sha(c)); saveAuth(); }
    send(res, { ok: 1 }, 200, { 'set-cookie': 'gsid=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' });
  });
  // Settings → LibreLinkUp: appversionen som skickas. Tom = standard (LLU_VERSION).
  if (u.pathname === '/api/llu' && req.method === 'POST') return body(req, res, ({ version }) => {
    const v = String(version || '').trim();
    if (v && !okVer(v)) return send(res, { error: 'Write the version as numbers with dots, e.g. 4.16.0.' }, 400);
    setVer(v); send(res, { ok: 1, version: lluVer });
  });
  // Settings → Export: en Excel-fil (.xlsx) med två blad, värdena och loggen (måltider och anteckningar). Förut CSV, men
  // där visade Excel tiden som ##### (kolumnen för smal) och svenska Excel kan läsa decimalpunkt och komma fel.
  // Ett blad rymmer 1 048 576 rader i Excel; med minutvärden räcker det ungefär två år. Fler värden delas på flera blad
  // ("Readings", "Readings 2", …), så att filen alltid går att öppna.
  if (u.pathname === '/api/export') {
    const d = readDb();
    const log = [...d.log.map(m => [m.t, 'Meal', m.name, Number.isFinite(m.ins) ? m.ins : '', m.type || '']), ...d.notes.map(n => [n.t, kindLabel(n.kind || 'Note'), n.text || '', '', ''])]
      .filter(r => Number.isFinite(r[0])).sort((a, b) => a[0] - b[0]).map(([t, ...r]) => [{ t }, ...r]);
    const ROWS = 1e6, readings = [];
    for (let i = 0; i === 0 || i < S.length; i += ROWS)
      readings.push({ name: i ? `Readings ${i / ROWS + 1}` : 'Readings', widths: [18, 9, 9], rows: [['Time', 'mmol/L', 'mg/dL'], ...S.slice(i, i + ROWS).map(([t, v]) => [{ t }, { n1: Math.round(v / 18.016 * 10) / 10 }, v])] });
    return xlsx([...readings, { name: 'Meals and notes', widths: [18, 14, 34, 8, 12], rows: [['Time', 'Type', 'What', 'Units', 'Insulin'], ...log] }]).then(file => {
      res.writeHead(200, { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': 'attachment; filename="glucose.xlsx"', 'cache-control': 'no-store', ...SEC });
      res.end(file);
    }, e => { console.error(e); send(res, { error: 'export failed' }, 500); });
  }
  if (u.pathname === '/api/stats') return send(res, stats());
  if (u.pathname === '/api/pi') { piStatus(false).then(p => send(res, { ...p, app: appHealth() })); return; }
  if (u.pathname === '/api/pi/refresh') return body(req, res, () => piStatus(true).then(p => send(res, { ...p, app: appHealth() })));
  // Högst 400 dygn per anrop (sidan ber om ett dygn i taget); förut gav from=0 hela historiken i ett svar
  if (u.pathname === '/api/readings') {
    const q = u.searchParams, to = +q.get('to') || Infinity, from = Math.max(+q.get('from') || Date.now() - Math.min(+q.get('hours') || 24, 9600) * 36e5, Math.min(to, Date.now()) - 400 * 864e5);
    return send(res, range(from, to + 1)); // to är inklusive
  }
  // ?since=ms: bara måltider från och med den tiden. Ett utfall ändras inte efter 3 h, så sidan hämtar alla en gång
  // och därefter bara de senaste varje minut.
  if (u.pathname === '/api/outcomes') {
    const since = +u.searchParams.get('since') || 0;
    const db = readDb(); // måltider och behandlade känningar, nyckel = id
    return send(res, Object.fromEntries([...db.log.filter(m => m.t >= since).map(m => [m.id, outcome(m.t, treatCut(m.t, db.notes))]),
      ...db.notes.filter(n => n.kind === 'Low treated' && n.t >= since).map(n => [n.id, treated(n.t)])]));
  }
  if (u.pathname === '/api/profile') return send(res, profile(Math.min(90, Math.max(1, +u.searchParams.get('days') || 14))));
  if (u.pathname === '/api/login' && req.method === 'POST') return body(req, res, async ({ email, password, remember }) => {
    if (DEMO) return send(res, { error: 'Not available in demo mode.' }, 400);
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) return send(res, { error: 'Enter both email and password.' }, 400);
    loginTries = loginTries.filter(t => Date.now() - t < 15 * 6e4);
    if (loginTries.length >= 5) return send(res, { error: 'Too many attempts. Wait a few minutes and try again.' }, 429);
    loginTries.push(Date.now());
    const c = { email: email.trim(), password, remember: !!remember };
    try {
      await running; // en hämtning som redan pågår hör till den gamla inloggningen
      await login(c); // misslyckas den är den gamla inloggningen orörd och hämtningen fortsätter
      gen++; creds = c; loginErr = ''; status = 'starting'; loginTries = [];
      await poll(); send(res, { ok: 1 });
    } catch (e) { console.error(e.message); send(res, { error: why(e) }, 401); }
  });
  if (u.pathname === '/api/logout' && req.method === 'POST') return body(req, res, () => { logout(); send(res, { ok: 1 }); });
  if (u.pathname === '/api/import' && req.method === 'POST') return body(req, res, rows => {
    if (!isArr(rows)) return send(res, { error: 'bad data' }, 400);
    const before = R.size, lines = [];
    for (const row of rows) {
      if (!isArr(row)) continue;
      const t = Math.floor(Number(row[0]) / 6e4) * 6e4, v = Math.round(Number(row[1]));
      if (okT(t) && okV(v) && !R.has(t)) { R.set(t, v); lines.push(JSON.stringify([t, v])); }
    }
    if (lines.length) { fs.appendFileSync(RF, lines.join('\n') + '\n'); S = [...R].sort((x, y) => x[0] - y[0]); } // en sortering för hela importen
    send(res, { added: R.size - before, skipped: rows.length - (R.size - before) });
  }, MAX_BODY);
  if (u.pathname === '/api/db') {
    // Versionsnumret (rev) krävs: en sparning utan det kunde förut skriva över allt utan kontroll
    if (req.method === 'PUT') return body(req, res, o => {
      const bad = dbProblem(o); if (bad) return send(res, { error: bad }, 400);
      const cur = readDb();
      if (o.rev !== cur.rev) return send(res, { error: 'conflict', db: cur }, 409);
      const rev = cur.rev + 1; writeDb({ ...o, rev }); send(res, { ok: 1, rev });
    }, MAX_BODY);
    return send(res, readDb());
  }
  // Textfältet på dashboarden: "pizza 7,5 enheter" -> sparas direkt (dosen saknas: sidan frågar efter den)
  // Förslag under textfältet medan man skriver: rätter man loggat som passar orden (samma sökning som /kyckling i
  // Telegram), högst 6, med den egna dosen (den sparade, annars den senast loggade) så att ett val kan fylla i den.
  if (u.pathname === '/api/dishes') {
    const q = String(u.searchParams.get('q') || '').slice(0, 100).trim(), db = readDb();
    if (!q) return send(res, { dishes: [] });
    const last = new Map(); for (const m of db.log) { const k = cleanName(m.name).toLowerCase(); if (!last.has(k)) last.set(k, m.ins); }
    return send(res, { dishes: findDishes(q, dishes(db)).slice(0, 6).map(d => { const k = d.name.toLowerCase(), sv = db.meals.find(m => cleanName(m.name).toLowerCase() === k);
      return { name: d.name, n: d.n, last: d.last, ins: sv ? sv.ins : last.get(k) ?? null }; }) });
  }
  // { same: id, pick: 0|1|2|"n" } svarar på "Same as …?" (samma fråga som i Telegram), utan att texten tolkas igen.
  if (u.pathname === '/api/quicklog' && req.method === 'POST') return body(req, res, async ({ text, same, pick }) => {
    let r;
    if (same !== undefined) {
      const p = typeof same === 'string' && qlSame.get(same);
      if (!p || Date.now() - p.at > 30 * 6e4) return send(res, { error: 'That question has expired. Write it again.' }, 410);
      if (!(pick === 'n' || (Number.isInteger(pick) && pick >= 0 && pick < p.same.cands.length))) return send(res, { error: 'bad pick' }, 400);
      qlSame.delete(same); r = pickSame(p, pick);
    } else {
      if (typeof text !== 'string' || !text.trim() || text.length > 300) return send(res, { error: 'Type what you ate, e.g. pizza 7.5 units' }, 400);
      r = await interpret(text.trim(), Date.now());
      if (r.type === 'other') return send(res, { error: 'That doesn\'t look like a meal, a dose or a note. Try: pizza 7.5 units' }, 422);
      // Liknar en rätt man loggat förut med ett annat namn: fråga först. Frågan sparas i minnet (de 20 senaste, 30 min).
      const sm = sameAs(r);
      if (sm) {
        const id = crypto.randomBytes(6).toString('hex'); qlSame.set(id, { ...r, same: sm, at: Date.now() });
        for (const k of [...qlSame.keys()].slice(0, Math.max(0, qlSame.size - 20))) qlSame.delete(k);
        return send(res, { same: { id, cands: sm.cands, fresh: sm.fresh, ins: r.ins } });
      }
    }
    if (r.type === 'meal' && r.ins == null) return send(res, { need: 'units', name: r.name, t: r.t, via: r.via });
    if (r.type === 'meal' && r.ins > 100) return send(res, { error: 'That dose seems too high.' }, 422);
    // Långt från den vanliga dosen: logga inte direkt; sidan öppnar dialogen med kontrollen så att man kan rätta eller bekräfta
    const chk = r.type === 'meal' && (r.guess ? `Is ${r.ins} the number of units you took?` : doseCheck(r.name, r.ins, readDb(), r.t));
    if (chk) return send(res, { check: chk, name: r.name, ins: r.ins, t: r.t, via: r.via });
    send(res, { ok: 1, entry: addEntry(r, 'w' + crypto.randomBytes(6).toString('hex')), via: r.via });
  });
  // Telegram-boten: koppla in med en token från @BotFather, länka chatten med en kod, koppla bort
  if (u.pathname === '/api/telegram' && req.method === 'POST') return body(req, res, async ({ token: t }) => {
    if (typeof t !== 'string' || !/^\d{5,}:[\w-]{30,}$/.test(t.trim())) return send(res, { error: 'That doesn\'t look like a bot token. It looks like 123456789:ABC-def…' }, 400);
    let me; try { me = await tgApi('getMe', {}, AbortSignal.timeout(10e3), t.trim()); } catch (e) { return send(res, { error: e.code === 401 || e.code === 404 ? 'Telegram did not accept that token.' : 'No contact with Telegram.' }, 400); }
    await tgApi('deleteWebhook', {}, undefined, t.trim()).catch(() => {}); // en webhook skulle stoppa hämtningen
    tgApi('setMyCommands', { commands: COMMANDS }, undefined, t.trim()).catch(() => {});
    tg = { ...TG0, token: t.trim(), bot: me.username, ...newCode() }; tgErr = ''; tgPending = null; saveTg();
    if (tgAbort) tgAbort.abort();
    send(res, { ok: 1 });
  });
  // En ny parkopplingskod (den förra har gått ut eller gissats på för många gånger)
  if (u.pathname === '/api/telegram/code') return body(req, res, () => {
    if (!tg.token || tg.chat) return send(res, { error: tg.chat ? 'The bot is already linked.' : 'Connect the bot first.' }, 400);
    Object.assign(tg, newCode()); saveTg(); send(res, { ok: 1 });
  });
  if (u.pathname === '/api/telegram/off' && req.method === 'POST') return body(req, res, () => {
    tg = { ...TG0 }; tgErr = ''; tgPending = null; fs.rmSync(TF, { force: true }); if (tgAbort) tgAbort.abort(); send(res, { ok: 1 });
  });
  if (u.pathname === '/api/autostart') {
    const ok = !!STARTUP && !DEMO, state = () => ({ supported: ok, on: ok && fs.existsSync(STARTUP) });
    if (req.method !== 'POST') return send(res, state());
    return body(req, res, ({ on }) => {
      if (!ok) return send(res, { error: DEMO ? 'Not available in demo mode.' : 'Only on Windows.' }, 400);
      if (on) { fs.mkdirSync(path.dirname(STARTUP), { recursive: true }); fs.writeFileSync(STARTUP, startupScript()); } else fs.rmSync(STARTUP, { force: true });
      send(res, state());
    });
  }
  // Rapporterna på/av. Vid påslag räknas dagens söndag/1:a som redan skickad, så att inget skickas direkt.
  if (u.pathname === '/api/telegram/pi' && req.method === 'POST') return body(req, res, ({ on }) => {
    if (!tg.token) return send(res, { error: 'Connect the bot first.' }, 400);
    tg.piw = !!on; saveTg(); send(res, { ok: 1, piw: tg.piw });
  });
  if (u.pathname === '/api/telegram/stale' && req.method === 'POST') return body(req, res, ({ on }) => {
    if (!tg.token) return send(res, { error: 'Connect the bot first.' }, 400);
    tg.stale = !!on; saveTg(); send(res, { ok: 1, stale: tg.stale });
  });
  if (u.pathname === '/api/telegram/report' && req.method === 'POST') return body(req, res, ({ on }) => {
    if (!tg.token) return send(res, { error: 'Connect the bot first.' }, 400);
    tg.report = !!on; if (on) { tg.sentW = ymd(Date.now()); tg.sentM = mkey(mstart(mkey(Date.now())) - 1); } saveTg(); send(res, { ok: 1, report: tg.report });
  });
  if (u.pathname === '/api/telegram') return send(res, { on: !!tg.token, bot: tg.bot, chat: !!tg.chat, who: tg.who, code: !tg.chat && codeOk() ? tg.code : '', codeEnds: !tg.chat && codeOk() ? tg.codeAt + CODE_MS : 0, error: tgErr, report: !!tg.report, stale: tg.stale !== false, piw: tg.piw !== false });
  if (u.pathname === '/api/weekly') {
    const w = weekly(), n = Date.now(), W = 7 * 864e5;
    return send(res, { ...w, q: w.days.length ? quarters(w.days[0][0], n) : [], prof: profileRange(n - W, n), parts: { cur: dayParts(n - W, n), prev: dayParts(n - 2 * W, n - W) } });
  }
  if (u.pathname === '/api/year') return send(res, yearly());
  // Kurvan efter en måltid (spökkurvorna i detaljvyn): [minuter efter måltiden, mg/dL] från 4 min före till 3 h efter,
  // högst ett värde var 3:e minut (luckor och kvartsvärden från LibreLinkUp blir kvar som de är). ?ids=a,b,c (högst 20).
  if (u.pathname === '/api/curves') {
    const ids = new Set(String(u.searchParams.get('ids') || '').split(',').filter(Boolean).slice(0, 20)), o = {};
    for (const m of readDb().log) if (ids.has(m.id)) { let lt = -Infinity; o[m.id] = range(m.t - 4 * 6e4, m.t + 3 * 36e5 + 1).filter(([t]) => t - lt >= 3 * 6e4 && (lt = t, true)).map(([t, v]) => [Math.round((t - m.t) / 6e4), v]); }
    return send(res, o);
  }
  if (u.pathname === '/api/month') {
    const list = monthList(), q = u.searchParams.get('m'), k = list.includes(q) ? q : defaultMonth(list);
    const x = k && monthly(k);
    return send(res, { months: list, demo: !!DEMO, ...x, ...(x && { q: quarters(x.from, x.to), parts: { cur: dayParts(x.from, x.to), prev: dayParts(mstart(mkey(x.from - 1)), x.from) } }) });
  }
  // Exakt det som skickas till AI:n, så att man kan se vad den svarar utifrån
  if (u.pathname === '/api/ai/context') { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...SEC }); return res.end(ASK + aiContext()); }
  // Är den lokala AI:n igång?
  if (u.pathname === '/api/ai') return aiModel().then(model => send(res, { ok: true, model }), e => send(res, { ok: false, error: aiErr(e) }));
  // Ladda modellen i förväg medan frågan skrivs, så att första svaret inte tar 20 s (POST: det gör något, se ROUTES)
  if (u.pathname === '/api/ai/warm') return body(req, res, () => aiModel().then(model => {
    fetch(OLLAMA_URL + '/api/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(6e4), body: JSON.stringify({ model, keep_alive: '15m', options: { num_ctx: NUM_CTX } }) }).catch(() => {});
    send(res, { ok: true, model });
  }, e => send(res, { ok: false, error: aiErr(e) })));
  if (u.pathname === '/api/ask' && req.method === 'POST') return body(req, res, async ({ messages } = {}) => {
    const msgs = (isArr(messages) ? messages : []).slice(-8).filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map(m => ({ role: m.role, content: m.content.slice(0, 4000) }));
    if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return send(res, { error: 'bad data' }, 400);
    const q = msgs[msgs.length - 1].content, lang = SWEDISH.test(q) ? 'sv' : 'en';
    // Svarets språk i content-language, så att sidan kan sätta lang på svaret (skärmläsare läser svenska med svensk röst)
    const head = { 'content-type': 'text/plain; charset=utf-8', 'content-language': lang, 'cache-control': 'no-store', ...SEC };
    if (doseQ(q)) { res.writeHead(200, head); return res.end(DOSE_NO(lang === 'sv')); }
    msgs[msgs.length - 1] = { role: 'user', content: q + REMIND };
    // Sidan stängd: sluta generera. Högst 3 minuter per svar, så att en Ollama som hänger inte håller anslutningen öppen.
    const ac = new AbortController(); res.on('close', () => { if (!res.writableFinished) ac.abort(); });
    const signal = AbortSignal.any([ac.signal, AbortSignal.timeout(18e4)]);
    let r;
    try { r = await ollama({ stream: true, options: { temperature: 0.5 }, messages: [{ role: 'system', content: ASK + aiContext() }, ...msgs] }, signal); }
    catch (e) { return send(res, { error: aiErr(e) }, 503); }
    res.writeHead(200, head);
    // Texten skickas mening för mening, och varje mening kontrolleras först (adviceOut): ser den ut som ett dosförslag
    // stoppas svaret där, med en förklaring. Förut skyddade bara instruktionen till modellen, som inte alltid följs.
    let held = '', stopped = false;
    const flush = all => {
      const k = all ? held.length : Math.max(...['\n', '. ', '! ', '? '].map(x => held.lastIndexOf(x) + 1));
      if (k <= 0) return;
      const out = held.slice(0, k);
      if (out.split(/(?<=[.!?\n])/).some(adviceOut)) {
        stopped = true; ac.abort();
        res.write('\n\n' + (lang === 'sv' ? '(Resten av svaret visas inte, eftersom det såg ut som ett dosråd. Appen ger aldrig dosråd; prata med ditt diabetesteam.)' : '(The rest of the answer is not shown because it looked like dose advice. The app never gives dosing advice; talk to your diabetes team.)'));
        return;
      }
      res.write(out); held = held.slice(k);
    };
    try { // Ollama skickar en JSON-rad per bit text
      const dec = new TextDecoder(); let buf = '';
      for await (const chunk of r.body) {
        buf += dec.decode(chunk, { stream: true }); let i;
        while ((i = buf.indexOf('\n')) >= 0 && !stopped) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue;
          const j = JSON.parse(line); if (j.message && j.message.content) { held += j.message.content; flush(false); }
          if (j.error) { flush(true); res.write('\n\n(' + j.error + ')'); } if (j.done) logTokens('ask', j);
        }
        if (stopped) break;
      }
      if (!stopped) flush(true);
    } catch (e) { if (!stopped && !ac.signal.aborted) { console.error(e.message); res.write('\n\n(' + (e.name === 'TimeoutError' ? 'The answer took too long and was stopped.' : 'The answer was cut off.') + ')'); } }
    res.end();
  });
  file(req, res, 'index.html', 'text/html; charset=utf-8');
}

const tick = DEMO ? demo : poll;
