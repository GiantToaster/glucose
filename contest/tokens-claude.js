// Summerar tokens till tävlingen och skriver contest/tokens-claude.md.
//   Molnet: Claude Code-transkripten (dubbletter per message.id räknas en gång, underagenter ingår).
//   Lokalt: dashboardens logg över anrop till Ollama (data/ai-tokens.jsonl från Pi:n, bara antal, aldrig text).
// Kör:  node contest/tokens-claude.js [sökväg till ai-tokens.jsonl]
//       Utan sökväg används den senaste contest/underlag/ai-tokens-*.jsonl (sparas av contest/spara-underlag.ps1).
const fs = require('fs'), path = require('path'), os = require('os');
const projects = path.join(os.homedir(), '.claude', 'projects');
// Claude Code sparar loggarna i en mapp per projektsökväg, med - i stället för allt utom bokstäver och siffror.
// Projektmappen hette BG_Dashboard till 16 november och heter Glucose sedan dess, så båda läses.
const here = path.resolve(__dirname, '..'), slug = p => p.replace(/[^A-Za-z0-9]/g, '-');
const roots = [path.join(path.dirname(here), 'BG_Dashboard'), here].map(p => path.join(projects, slug(p))).filter(r => fs.existsSync(r));
const files = [];
const walk = (root, d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(root, p); else if (f.name.endsWith('.jsonl')) files.push({ root, p }); } };
for (const r of roots) walk(r, r);
const seen = new Set(), rows = [];
for (const { root, p } of files) {
  const sess = path.relative(root, p).split(path.sep)[0].replace('.jsonl', '').slice(0, 8), sub = p.includes('subagents');
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    if (!line.includes('"usage"')) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const m = o.message; if (!m || !m.usage || o.type !== 'assistant') continue;
    const id = m.id || o.requestId || o.uuid; if (seen.has(id)) continue; seen.add(id);
    const u = m.usage;
    rows.push({ day: (o.timestamp || '').slice(0, 10), sess, sub, model: m.model || '?',
      inp: u.input_tokens || 0, out: u.output_tokens || 0, cw: u.cache_creation_input_tokens || 0, cr: u.cache_read_input_tokens || 0 });
  }
}
const agg = key => { const g = {}; for (const r of rows) { const k = key(r); const a = g[k] ||= { n: 0, inp: 0, out: 0, cw: 0, cr: 0 }; a.n++; a.inp += r.inp; a.out += r.out; a.cw += r.cw; a.cr += r.cr; } return g; };
const fmt = n => n.toLocaleString('sv-SE');
const md = [];
const say = s => md.push(s);
const table = (title, g) => {
  say(`\n## ${title}\n\n| | Svar | Input | Output | Cache skriv | Cache läs | Totalt |\n|---|---:|---:|---:|---:|---:|---:|`);
  for (const [k, a] of Object.entries(g).sort()) say(`| ${k} | ${fmt(a.n)} | ${fmt(a.inp)} | ${fmt(a.out)} | ${fmt(a.cw)} | ${fmt(a.cr)} | ${fmt(a.inp + a.out + a.cw + a.cr)} |`);
};

const now = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' }).slice(0, 16);
const all = agg(() => 'alla').alla || { n: 0, inp: 0, out: 0, cw: 0, cr: 0 };
// Allt som modellen tog emot och skrev, även cacheläsning: den kostar också (till en lägre taxa), och en siffra
// utan den skulle se ut som en underskattning bredvid andra bidrag. Uppdelningen står i "Så räknade jag".
const paid = all.inp + all.cw + all.cr + all.out;
say(`# Tokens till tävlingen\n\nFramtaget ${now} med \`node contest/tokens-claude.js\`.`);
say(`\n## Till formuläret\n\n| Fält | Värde |\n|---|---|\n| Tokens betalda i molnet | **${fmt(paid)}** (input ${fmt(all.inp)} + cache-skrivning ${fmt(all.cw)} + cache-läsning ${fmt(all.cr)} + output ${fmt(all.out)}) |`);

// Lokal AI
let local = null, lf = process.argv[2];
if (!lf) {
  const dir = path.join(__dirname, 'underlag');
  const cands = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /^ai-tokens-.*\.jsonl$/.test(f)).sort() : [];
  if (cands.length) lf = path.join(dir, cands[cands.length - 1]);
}
if (lf && fs.existsSync(lf)) {
  const L = fs.readFileSync(lf, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  local = { n: L.length, prompt: 0, out: 0, days: {}, kinds: {}, first: Infinity, last: 0 };
  for (const x of L) {
    local.prompt += x.prompt || 0; local.out += x.out || 0;
    const d = new Date(x.t).toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });
    const a = local.days[d] ||= { n: 0, prompt: 0, out: 0 }; a.n++; a.prompt += x.prompt || 0; a.out += x.out || 0;
    local.kinds[x.kind] = (local.kinds[x.kind] || 0) + 1;
    local.first = Math.min(local.first, x.t); local.last = Math.max(local.last, x.t);
  }
  say(`| Tokens bearbetade lokalt | **${fmt(local.prompt + local.out)}** (minst; ${fmt(local.n)} anrop, ${fmt(local.prompt)} in och ${fmt(local.out)} ut) |`);
} else {
  say('| Tokens bearbetade lokalt | (ingen ai-tokens-fil hittades: kör contest/spara-underlag.ps1 först) |');
}
say(`\nCacheläsning (${fmt(all.cr)}) är text som redan låg i modellens cache, till exempel koden och samtalet hittills, och lästes om vid varje svar. Den räknas med ovan eftersom den också debiteras, men till en lägre taxa. Bara ny text: input + cache-skrivning + output = ${fmt(all.inp + all.cw + all.out)}.`);
say(`\nKällor: ${files.length} loggfiler i Claude Codes ${roots.length === 2 ? 'två loggmappar för projektet (före och efter bytet av mappnamn)' : 'loggmapp för projektet'}, ${fmt(rows.length)} unika svar${lf && local ? `, samt ${path.basename(lf)}` : ''}.`);

table('Molnet per dag', agg(r => r.day));
table('Molnet per session (huvud / underagenter)', agg(r => `${r.sess} ${r.sub ? 'underagenter' : 'huvud'}`));
table('Molnet per modell', agg(r => r.model));
table('Molnet totalt', agg(() => 'alla'));

if (local) {
  say(`\n## Lokalt per dag (Ollama, loggat sedan 6 november)\n\n| | Anrop | In | Ut | Totalt |\n|---|---:|---:|---:|---:|`);
  for (const [d, a] of Object.entries(local.days).sort()) say(`| ${d} | ${a.n} | ${fmt(a.prompt)} | ${fmt(a.out)} | ${fmt(a.prompt + a.out)} |`);
  say(`\nTyper av anrop: ${Object.entries(local.kinds).map(([k, n]) => `${k} ${n}`).join(', ')}. Användningen 3–6 november loggades inte, så det lokala är räknat i underkant.`);
}

const text = md.join('\n') + '\n';
fs.writeFileSync(path.join(__dirname, 'tokens-claude.md'), text);
process.stdout.write(text);
