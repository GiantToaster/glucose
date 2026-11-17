// Spelar in den lokala AI:ns svar på förslagsfrågorna under Ask AI till web/ai-answers.json, som webbdemon visar.
// 1) Starta demoläget med Ollama igång:  DEMO=1 PORT=3999 node server.js
// 2) Kör:  node web/record-ai.js   och sedan  node web/build.js
// Frågorna tas från knapparna i index.html, så att demon alltid har svar på exakt de frågor som visas.
const fs = require('fs'), path = require('path');
const url = process.argv[2] || 'http://localhost:3999', out = path.join(__dirname, 'ai-answers.json');
const qs = [...fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').matchAll(/<button data-q="([^"]+)">/g)].map(m => m[1]);
(async () => {
  const ai = await (await fetch(url + '/api/ai?warm=1')).json();
  if (!ai.ok) throw new Error('The local AI is not running: ' + ai.error);
  const res = { model: ai.model, at: new Date().toISOString(), answers: {} };
  for (const q of qs) {
    const r = await fetch(url + '/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: q }] }) });
    res.answers[q] = await r.text();
    console.log('Recorded:', q);
  }
  fs.writeFileSync(out, JSON.stringify(res, null, 1) + '\n');
  console.log('Saved', out);
})().catch(e => { console.error(e.message); process.exit(1); });
