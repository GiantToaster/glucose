// Summerar Claude Code-tokens per dag, session och modell ur transkripten (dubbletter per message.id räknas en gång)
const fs = require('fs'), path = require('path');
const root = 'C:/Users/me/.claude/projects/c--Users-me-Desktop-BG-Dashboard';
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (f.name.endsWith('.jsonl')) files.push(p); } })(root);
const seen = new Set(), rows = [];
for (const f of files) {
  const sess = path.relative(root, f).split(path.sep)[0].replace('.jsonl', '').slice(0, 8), sub = f.includes('subagents');
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
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
const table = (title, g) => {
  console.log(`\n## ${title}\n\n| | Svar | Input | Output | Cache skriv | Cache läs | Totalt |\n|---|---:|---:|---:|---:|---:|---:|`);
  for (const [k, a] of Object.entries(g).sort()) console.log(`| ${k} | ${fmt(a.n)} | ${fmt(a.inp)} | ${fmt(a.out)} | ${fmt(a.cw)} | ${fmt(a.cr)} | ${fmt(a.inp + a.out + a.cw + a.cr)} |`);
};
table('Per dag', agg(r => r.day));
table('Per session (huvud / underagenter)', agg(r => `${r.sess} ${r.sub ? 'underagenter' : 'huvud'}`));
table('Per modell', agg(r => r.model));
table('Totalt', agg(() => 'alla'));
console.log(`\nFiler: ${files.length}, unika svar: ${rows.length}`);
