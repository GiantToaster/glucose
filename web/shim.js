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
    statSync: p => ({ size: (files.get(p) || '').length, mtimeMs: Date.now(), isFile: () => true }),
  };
  const path = { join: (...a) => a.join('/').replace(/\/+/g, '/'), dirname: p => p.replace(/\/[^/]*$/, '') || '/', isAbsolute: p => p.startsWith('/') };
  const hex = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
  const nodeCrypto = {
    randomBytes: n => ({ toString: () => hex(n) }),
    randomInt: (a, b) => a + Math.floor(Math.random() * (b - a)),
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
    n => mods[n], process, Buffer, '/app', quiet, offline, timer(setTimeout.bind(window)), timer(setInterval.bind(window)));

  // Sidans anrop till /api/... går till serverns hanterare med en låtsad förfrågan och ett låtsat svar
  const call = (u, init) => new Promise(resolve => {
    const on = {}, h = new Headers(init.headers || {}), body = init.body == null ? '' : String(init.body);
    const req = { method: (init.method || 'GET').toUpperCase(), url: u.pathname + u.search, socket: { remoteAddress: '127.0.0.1' },
      headers: { host: 'localhost', 'content-type': h.get('content-type') || '', 'content-length': String(body.length) },
      on(ev, f) { (on[ev] ||= []).push(f); return req; } };
    let status = 200, head = {}, out = [], closed = [];
    const res = {
      headersSent: false, writableFinished: false,
      writeHead(c, hd) { status = c; head = { ...head, ...hd }; res.headersSent = true; return res; },
      setHeader(k, v) { head[k] = v; },
      write(d) { res.headersSent = true; out.push(String(d)); return true; },
      end(d) {
        if (res.writableFinished) return; if (d != null) out.push(String(d)); res.writableFinished = true;
        const hs = Object.fromEntries(Object.entries(head).map(([k, v]) => [k, String(v)]));
        resolve(new Response([101, 204, 205, 304].includes(status) ? null : out.join(''), { status, headers: hs }));
        closed.forEach(f => f());
      },
      on(ev, f) { if (ev === 'close') closed.push(f); return res; },
    };
    handler(req, res);
    queueMicrotask(() => { if (body) (on.data || []).forEach(f => f(body)); (on.end || []).forEach(f => f()); });
  });
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const u = new URL(typeof input === 'string' ? input : input.url, location.href);
    return u.origin === location.origin && u.pathname.startsWith('/api/') ? call(u, init) : realFetch(input, init);
  };
})();
