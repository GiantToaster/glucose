// Bygger webbdemon i docs/ (GitHub Pages): index.html med server.js inbyggd, som körs i demoläget i webbläsaren,
// och bredvid resan (contest/journey.html) och historiken (contest/historik.html). Kör efter varje ändring av appen:  node web/build.js
// contest/ finns bara lokalt (den ligger inte på GitHub). Saknas den behålls resan, historiken och bilderna som redan ligger i docs/.
// Länken till källkoden tas från git remote "origin" om den finns. AI-svaren kommer från web/ai-answers.json
// (spelas in med web/record-ai.js).
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const root = path.join(__dirname, '..'), out = path.join(root, 'docs');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
// Byter en bit text och stoppar bygget om den inte finns, så att en ändring i appen inte tyst gör demon fel
const swap = (s, from, to, what) => { if (!s.includes(from)) throw new Error('web/build.js: hittar inte ' + what); return s.split(from).join(to); };
const js = v => JSON.stringify(v).replace(/<\//g, '<\\/');

let server = read('server.js');
server = swap(server, "'The local AI is not running. Start Ollama and try again.'",
  "'This web demo only has recorded answers to the four suggested questions. In the real dashboard you can ask anything, and a local model (Ollama) answers on your own computer.'", 'AI-meddelandet i server.js');
let answers = null;
try { answers = JSON.parse(read('web/ai-answers.json')); } catch {}
const shim = read('web/shim.js').replace('__SERVER_SOURCE__', () => js(server)).replace('__AI_ANSWERS__', () => js(answers));

let repo = '';
try { repo = execSync('git remote get-url origin', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().replace(/^git@github\.com:/, 'https://github.com/').replace(/\.git$/, ''); } catch {}

let page = read('index.html');
// Sidan ligger i en undermapp på GitHub Pages, så ikoner och manifest hämtas relativt
page = swap(page, '<link rel="icon" href="/icon.svg">', '<link rel="icon" href="icon.svg">', 'ikonlänken i index.html');
page = swap(page, 'href="/apple-touch-icon.png"', 'href="apple-touch-icon.png"', 'hemskärmsikonen i index.html');
page = swap(page, 'href="/manifest.webmanifest"', 'href="manifest.webmanifest"', 'manifestet i index.html');
page = page.replace(/<script>/, () => `<script>\n${shim}\n</script>\n<script>`);
// Log-knappen är dold från början i webbdemon (där loggar man med textrutan), men går att slå på under Settings →
// Log button precis som i appen. Valet sparas i webbläsaren: "show" i stället för att nyckeln tas bort.
page = swap(page, "if (localStorage.getItem('btns') === 'hide')", "if (localStorage.getItem('btns') !== 'show')", 'starten av Log-knappens val');
page = swap(page, "else localStorage.removeItem('btns');", "else localStorage.setItem('btns', 'show');", 'sparandet av Log-knappens val');
// Bannern överst: vad det är, vad man kan prova, och länkar till resan och koden
const a = 'style="color:inherit;white-space:nowrap"';
const note = `<div style="margin:0 auto;max-width:1200px;padding:8px 16px;font-size:.8125rem;line-height:1.5;color:var(--mut,#999);text-align:center">`
  + `Web demo: a made-up person, computed in your browser. Nothing is saved.<br>`
  + `Try <b style="color:var(--fg)">pizza 7 units</b> in the box, or ask the AI.<br>`
  // Länkarna på en egen rad i textfärgen, så att resan och historiken syns
  + `<span style="color:var(--fg)"><a href="journey.html" ${a}>How it was built</a> · <a href="historik.html" ${a}>How it changed</a>` + (repo ? ` · <a href="${repo}" ${a}>Source code</a>` : '') + `</span></div>`;
page = page.replace(/<body[^>]*>/, m => m + '\n' + note);

fs.mkdirSync(path.join(out, 'img'), { recursive: true });
fs.writeFileSync(path.join(out, 'index.html'), page);
if (fs.existsSync(path.join(root, 'contest', 'journey.html'))) {
  // Resan: samma sida som contest/journey.html, med en länk till demon i sidhuvudet
  const sweLink = '<a class="small" href="https://projekt.sweclockers.com/asus" target="_blank" rel="noopener">Bidrag till SweClockers × ASUS ProArt</a>';
  const journey = swap(read('contest/journey.html'), sweLink, `<span class="small"><a href="./">Prova demon</a> · <a href="historik.html">Historik</a> · ${sweLink.replace(' class="small"', '')}</span>`, 'tävlingslänken i journey.html');
  fs.writeFileSync(path.join(out, 'journey.html'), journey);
  // Bilderna till resan och historiken (contest/img med undermappar)
  fs.cpSync(path.join(root, 'contest', 'img'), path.join(out, 'img'), { recursive: true });
  fs.copyFileSync(path.join(root, 'contest', 'historik.html'), path.join(out, 'historik.html'));
}
for (const f of ['icon.svg', 'apple-touch-icon.png', 'icon-512.png', 'icon-192.png', 'icon-maskable-512.png', 'manifest.webmanifest']) fs.copyFileSync(path.join(root, f), path.join(out, f));
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log(`docs/index.html: ${Math.round(page.length / 1024)} kB, AI answers: ${answers ? Object.keys(answers.answers).length : 0}${repo ? ', source link ' + repo : ', no source link (no git remote yet)'}`);
