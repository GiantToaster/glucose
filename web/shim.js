// Webbdemon: kör server.js i demoläget direkt i webbläsaren, utan server. Byggs in i docs/index.html av web/build.js.
// Node-funktionerna som servern använder ersätts med små motsvarigheter: filerna ligger i minnet (inget sparas,
// en omladdning börjar om), http.createServer ger serverns egen hanterare, och sidans fetch('/api/...') skickas
// dit i stället för till nätet. Servern får en egen fetch som alltid misslyckas, så den når aldrig LibreLinkUp,
// Telegram eller en AI. Demopersonens värden räknas fram för just nu, så kurvan är alltid färsk.
(() => {
  const SRC = __SERVER_SOURCE__;
  const files = new Map(), enoent = p => Object.assign(new Error('ENOENT: ' + p), { code: 'ENOENT' });
  const fs = {
    existsSync: p => files.has(p), mkdirSync() {}, readdirSync: () => [],
    readFileSync: p => { if (!files.has(p)) throw enoent(p); return files.get(p); },
    writeFileSync: (p, d) => { files.set(p, String(d)); },
    appendFileSync: (p, d) => { files.set(p, (files.get(p) || '') + d); },
    appendFile: (p, d, cb) => { files.set(p, (files.get(p) || '') + d); if (cb) cb(null); },
    rmSync: p => { files.delete(p); },
    renameSync: (a, b) => { files.set(b, files.get(a)); files.delete(a); },
    readFile: (p, cb) => setTimeout(() => files.has(p) ? cb(null, files.get(p)) : cb(enoent(p))),
    statSync: p => { if (!files.has(p)) throw enoent(p); return { size: files.get(p).length, mtimeMs: Date.now(), isFile: () => true }; },
    stat: (p, cb) => setTimeout(() => files.has(p) ? cb(null, { size: files.get(p).length, mtimeMs: 0 }) : cb(enoent(p))),
    chmodSync() {},
  };
  const path = { join: (...a) => a.join('/').replace(/\/+/g, '/'), dirname: p => p.replace(/\/[^/]*$/, '') || '/', isAbsolute: p => p.startsWith('/') };
  const hex = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
  const nodeCrypto = {
    randomBytes: n => ({ toString: () => hex(n) }),
    randomInt: (a, b) => a + Math.floor(Math.random() * (b - a)),
    timingSafeEqual: (a, b) => String(a) === String(b),
    createHash: () => ({ update() { return this; }, digest: () => '0'.repeat(64) }),
  };
  const os = { hostname: () => 'demo', networkInterfaces: () => ({}) };
  const child = { on() { return child; }, once() { return child; }, kill() {}, unref() {}, exitCode: 1 };
  const cp = { spawn: () => child, spawnSync: () => ({ status: 1, stdout: '', stderr: '' }), execFile: (...a) => { const cb = a.pop(); setTimeout(() => cb(new Error('not available'), '', '')); } };
  let handler = null;
  const http = { createServer: h => { handler = h; return { on() {}, listen(...a) { const cb = a.pop(); if (typeof cb === 'function') queueMicrotask(cb); } }; } };
  const mods = { fs, path, crypto: nodeCrypto, os, http, child_process: cp };
  const process = {
    env: { DEMO: '1', OLLAMA_AUTOSTART: '0', OLLAMA_URL: 'http://127.0.0.1:11434' }, platform: 'linux', version: 'v20.0.0', execPath: '/node',
    on() {}, exit() {}, memoryUsage: () => ({ rss: 0, heapUsed: 0, heapTotal: 0 }), uptime: () => performance.now() / 1e3,
  };
  const Buffer = { concat: a => ({ toString: () => a.join('') }) };
  const quiet = { ...console, log() {} };
  const offline = () => Promise.reject(new TypeError('The web demo is offline'));
  // Nodes timers har unref(); webbläsarens ger bara ett tal. Objektet blir talet igen när det skickas till clearTimeout.
  const timer = f => (...a) => { const id = f(...a); return { unref() { return this; }, ref() { return this; }, [Symbol.toPrimitive]: () => id }; };
  new Function('require', 'process', 'Buffer', '__dirname', 'console', 'fetch', 'setTimeout', 'setInterval', SRC)(
    n => { if (!(n in mods)) throw new Error(`web/shim.js: no stand-in for require('${n}')`); return mods[n]; }, process, Buffer, '/app', quiet, offline, timer(setTimeout.bind(window)), timer(setInterval.bind(window)));

  // Sidans anrop till /api/... går till serverns hanterare med en låtsad förfrågan och ett låtsat svar
  // Text som text, och binärt (t.ex. Excel-exporten) oförändrat
  const bin = d => d instanceof Uint8Array ? d : String(d);
  const call = (u, init) => new Promise(resolve => {
    const on = {}, h = new Headers(init.headers || {}), body = init.body == null ? '' : String(init.body);
    const req = { method: (init.method || 'GET').toUpperCase(), url: u.pathname + u.search, socket: { remoteAddress: '127.0.0.1' }, resume() {},
      headers: { host: 'localhost', 'content-type': h.get('content-type') || '', 'content-length': String(body.length) },
      on(ev, f) { (on[ev] ||= []).push(f); return req; } };
    let status = 200, head = {}, out = [], closed = [];
    const res = {
      headersSent: false, writableFinished: false,
      writeHead(c, hd) { status = c; head = { ...head, ...hd }; res.headersSent = true; return res; },
      setHeader(k, v) { head[k] = v; },
      write(d) { res.headersSent = true; out.push(bin(d)); return true; },
      end(d) {
        if (res.writableFinished) return; if (d != null) out.push(bin(d)); res.writableFinished = true;
        const hs = Object.fromEntries(Object.entries(head).map(([k, v]) => [k, String(v)]));
        resolve(new Response([101, 204, 205, 304].includes(status) ? null : new Blob(out), { status, headers: hs }));
        closed.forEach(f => f());
      },
      on(ev, f) { if (ev === 'close') closed.push(f); return res; },
    };
    handler(req, res);
    queueMicrotask(() => { if (body) (on.data || []).forEach(f => f(body)); (on.end || []).forEach(f => f()); });
  });
  // Ask AI: riktiga svar från den lokala AI:n på samma påhittade person, inspelade med web/record-ai.js, för de fyra
  // förslagsfrågorna. De skrivs fram bit för bit som i appen. Andra frågor går till servern: dosfrågor får spärrens
  // fasta svar, resten ett besked om att demon bara har de inspelade svaren.
  const AI = __AI_ANSWERS__;
  const day = AI && new Date(AI.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const typed = text => new Response(new ReadableStream({
    async start(c) {
      const enc = new TextEncoder();
      for (let i = 0; i < text.length; i += 6) { c.enqueue(enc.encode(text.slice(i, i + 6))); await new Promise(r => setTimeout(r, 12)); }
      c.close();
    },
  }), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  const recorded = (u, init) => {
    if (u.pathname === '/api/ai' || u.pathname === '/api/ai/warm') return Promise.resolve(Response.json({ ok: true, model: AI.model + ' (recorded answers)' }));
    let q = ''; try { const m = JSON.parse(init.body).messages; q = m[m.length - 1].content; } catch {}
    const a = AI.answers[q];
    if (!a) return call(u, init);
    return Promise.resolve(typed(a + `\n\n(Recorded ${day} from ${AI.model} on a regular graphics card, so the dates and numbers are from this made-up person's data that day.)`));
  };
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const u = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (u.origin !== location.origin || !u.pathname.startsWith('/api/')) return realFetch(input, init);
    return AI && (u.pathname === '/api/ai' || u.pathname === '/api/ai/warm' || u.pathname === '/api/ask') ? recorded(u, init) : call(u, init);
  };
})();
