// Bygger webbdemon i docs/ (GitHub Pages): index.html med server.js inbyggd, som körs i demoläget i webbläsaren.
// Kör efter varje ändring av index.html eller server.js:  node web/build.js
// Länken till källkoden tas från git remote "origin" om den finns.
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const root = path.join(__dirname, '..'), out = path.join(root, 'docs');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
// Byter en bit text och stoppar bygget om den inte finns, så att en ändring i appen inte tyst gör demon fel
const swap = (s, from, to, what) => { if (!s.includes(from)) throw new Error('web/build.js: hittar inte ' + what); return s.split(from).join(to); };

let server = read('server.js');
server = swap(server, "'The local AI is not running. Start Ollama and try again.'",
  "'This web demo has no AI. In the real dashboard a local model (Ollama) answers on your own computer, and nothing leaves it.'", 'AI-meddelandet i server.js');
const shim = read('web/shim.js').replace('__SERVER_SOURCE__', () => JSON.stringify(server).replace(/<\//g, '<\\/'));

let repo = '';
try { repo = execSync('git remote get-url origin', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().replace(/^git@github\.com:/, 'https://github.com/').replace(/\.git$/, ''); } catch {}

let page = read('index.html');
page = swap(page, '<link rel="icon" href="/icon.svg">', '<link rel="icon" href="icon.svg">', 'ikonlänken i index.html');
page = page.replace(/<script>/, () => `<script>\n${shim}\n</script>\n<script>`);
// Ingen Log-knapp i webbdemon (varken i flikraden eller nere till höger på mobilen): där loggar man med textrutan
page = swap(page, '</head>', '<style>.logw{display:none!important}</style>\n</head>', '</head> i index.html');
const note = `<div style="margin:0 auto;max-width:1200px;padding:8px 16px;font-size:.8125rem;color:var(--mut,#999);text-align:center">`
  + `Web demo with a made-up person, computed in your browser. Nothing you log is saved or sent anywhere.`
  + (repo ? ` <a href="${repo}" style="color:inherit">Source code</a>` : '') + `</div>`;
page = page.replace(/<body[^>]*>/, m => m + '\n' + note);

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'index.html'), page);
fs.copyFileSync(path.join(root, 'icon.svg'), path.join(out, 'icon.svg'));
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log(`docs/index.html: ${Math.round(page.length / 1024)} kB${repo ? ', source link ' + repo : ', no source link (no git remote yet)'}`);
