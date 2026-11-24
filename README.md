# Glucose

En egen dashboard för typ 1-diabetes med en FreeStyle Libre-sensor. Den hämtar värdena från LibreLinkUp varje minut
och visar kurvan med måltider, insulin och anteckningar. Varje måltid följs i tre timmar (start → topp, och en
känning om det blev en), och veckan, månaden och året sammanfattas. Måltider loggas med egna ord i dashboarden
eller via en egen Telegram-bot. En lokal AI (Ollama) tolkar texten och svarar på frågor om datan, utan att något
lämnar hemmet.

**Prova demon:** https://gianttoaster.github.io/glucose/ (en påhittad person, körs helt i webbläsaren, inget sparas).

Byggd med Claude Code som ett bidrag till SweClockers × ASUS ProArt (november 2026). Läs
[hur den byggdes](https://gianttoaster.github.io/glucose/journey.html) och se
[hur den har förändrats](https://gianttoaster.github.io/glucose/historik.html) i nio versioner.

## Viktigt

Det här är ett informationsverktyg för eget bruk. Det ger **aldrig dosråd** och ersätter inte Libre-appen eller dess
larm. Frågor om doser besvaras av servern med ett fast svar innan de når AI:n, och AI:ns svar kontrolleras mening för
mening innan de visas: ser en mening ut som ett dosråd stoppas svaret där.

## Kör den

Node.js 18.17 eller senare, inga paket att installera. Två filer: `server.js` och `index.html`.

```bash
DEMO=1 node server.js     # påhittad person, ingen inloggning: http://localhost:3000
node server.js            # på riktigt: logga in med ett LibreLinkUp-konto
```

Testerna (spärren mot dosfrågor och mot dosråd i svaren, loggningen, inloggningen, kontrollen av det som sparas, skydden,
definitionen av en känning, Excel-exporten och LibreLinkUp-versionen) körs med `node --test` (eller `npm test`) från
projektmappen, också utan paket.

Under Settings finns export av värden, måltider och anteckningar som en Excel-fil, och LibreLinkUp-appens version. Den höjs av sig själv när
LibreLinkUp säger vilken version som krävs. Lägg gärna dashboarden på mobilens hemskärm, då får den en egen ikon.

Hur LibreLinkUp, Telegram och den lokala AI:n sätts upp står överst i `server.js`. Att köra den dygnet runt på en
Raspberry Pi står i [pi/README.md](pi/README.md). Lösenordet sparas aldrig på disk, och dina värden ligger i `data/`,
som aldrig följer med i git.

## Mappar

| | |
|---|---|
| `server.js`, `index.html` | Hela appen |
| `pi/` | Installation och uppdatering på en Raspberry Pi |
| `pc/` | Starta Ollama dolt i Windows |
| `test/` | Testerna: `node --test` |
| `web/`, `docs/` | Webbdemon: `node web/build.js` bygger `docs/` (GitHub Pages). AI-svaren i demon spelas in med `web/record-ai.js` |
| `contest/` | Tävlingsbidraget: resan, tokenräkningen och utkastet |
