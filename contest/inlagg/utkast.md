# Utkast: tävlingsbidrag till SweClockers × ASUS ProArt

Tävlingen: https://projekt.sweclockers.com/asus · Lämna in: https://projekt.sweclockers.com/asus/lamna-in
Sista dag för nya bidrag: **30 november**. Bidraget kan ändras fram till att röstningen öppnar 1 december.

Fälten nedan kommer i samma ordning som i formuläret. Varje text ligger i en egen ruta, så att den kan kopieras rakt in, och teckengränsen står vid rubriken. Det som bara du kan svara på är markerat med **[FYLL I]**. Reglerna och formulärets alla fält står i [contest/tavlingen.md](../tavlingen.md).

---

## Ändrat sedan utkastet skrevs 8 november (17 november)

Dashboarden har fått runt 60 commits sedan dess, så delar av texten och bilderna stämmer inte längre. Det här behöver ses över innan inlämningen. Ta det sist, när appen är klar:

- **Fliken Patterns finns inte längre.** Tid på dygnet och när känningarna börjar ligger nu under Insights, och jämförelsen av måltider under Meals (Compared). Texten nämner "Mönster" och bilden `05-monster.png` visar den gamla fliken.
- **"Spara månaden som bild" är borttaget** (16 november). Texten säger "en bild av månaden att spara", och `07-manadsbild.png` visar funktionen.
- **Flikarna sitter överst**, med en Log-knapp som alltid finns. Alla skärmbilder från 8 november visar den gamla layouten.
- **Nytt som kan nämnas:** årsvy i Insights, eget målområde (till exempel 4–7), sensorns ålder och den nya sensorns första dag i kurvan, statussida och varningar för Pi:n, Telegram-varning när värdena slutar komma, måltidens kurvor jämförda med tidigare gånger, långtidsverkande insulin och en ansvarsfriskrivning överst i varje flik.
- **Siffrorna i "I SIFFROR"**: koden är nu 3 946 rader (inte 2 938), 271 090 sparade mätvärden (inte 259 106) och 3 290 svar från Claude (inte 2 013). Räkna om sista dagen.
- **Tokens** har räknats om nedan, nu med cacheläsningen i molnsiffran.
- **Nytt 17 november:** en webbdemo som vem som helst kan prova (samma serverkod körs i webbläsaren, med en påhittad person), spärren mot dosfrågor täpper till "Which meal needs more insulin…", dashboarden på Pi:n svarar bara på sina egna namn (skydd mot DNS rebinding), och demoläget fyller på sina värden fram till i dag. Nya bilder ligger i `bilder/nya/`.

---

## Spår

**Verktyget du alltid saknat**

(Alternativ: "Egen AI-assistent", om du vill lyfta den lokala AI:n mer. Men verktyget är huvudsaken, och AI:n är en del av det.)

---

## Rubrik (max 120 tecken)

Rekommenderad:

```text
Jag har aldrig kunnat se hur maten påverkar mitt blodsocker. Nu kan jag det.
```

Alternativ:

```text
Min egen blodsockerdashboard för typ 1-diabetes, med lokal AI och Telegram-bot
```

```text
Från Libre-appens siffra till svaret på: hur gick det förra gången jag åt pizza?
```

---

## I en mening (max 160 tecken)

```text
En egen dashboard för min typ 1-diabetes: Libre-värden dygnet runt på en Raspberry Pi, loggning via Telegram och en lokal AI på grafikkortet.
```

---

## Vad byggde du, och hur? (max 8000 tecken)

```text
Jag har typ 1-diabetes och bär en FreeStyle Libre-sensor. Libre-appen visar vad blodsockret är just nu, men inte det jag oftast undrar över: Hur gick det förra gången jag åt pizza och tog 7 enheter? När brukar jag gå lågt? Är det frukosten eller middagen som ställer till det? Ett eget verktyg för det har jag velat ha länge, men aldrig kunnat bygga. Nu har jag gjort det, tillsammans med Claude Code.

VAD DET ÄR

En dashboard som körs hemma, dygnet runt, på en Raspberry Pi 4.

– Värdet just nu med trendpil och läget i ord, till exempel "In range · falling". Kurvan byter färg över 10 och under 3,9, och måltider, promenader och behandlade känningar syns där de hände.
– Varje måltid följs i tre timmar: startvärde → topp, och en känning om det blev en, till exempel "Very low 2.7 after 2 h 50 min". Då ser jag direkt vilka måltider som brukar gå högt.
– Mönster: tid i målområdet, uppskattat HbA1c, en typisk dag och när mina känningar brukar börja, timme för timme.
– Insikter: veckan och månaden i siffror, en stapel per dag och en bild av månaden att spara.
– Fråga AI:n: en lokal språkmodell (gemma4:12b via Ollama på datorns grafikkort) som svarar på frågor om mina värden, måltider och anteckningar. Frågorna lämnar aldrig hemmet, och modellen laddas bara medan dashboarden är öppen.
– En egen Telegram-bot. Var jag än är skriver jag "pizza 7,5 enheter" eller "promenad 45 min", eller trycker på en favoritknapp för det jag äter ofta. Den lokala AI:n tolkar texten, och är datorn av tar en enkel regelbaserad tolkare över. Pi:n hämtar meddelandena själv, så ingen port är öppen i routern. Om jag vill skickar boten veckan i siffror på söndagskvällen.

EN GRÄNS JAG INTE KOMPROMISSAR MED

Appen ger aldrig dosråd. Den beskriver vad som hände, aldrig vad jag borde göra. Frågor om doser besvaras av servern med ett fast svar innan de ens når AI-modellen, och varje fråga till AI:n avslutas med samma påminnelse. Appen ersätter inte heller Libre-appens larm.

HUR DET BYGGDES

All kod är skriven av Claude Code (Claude Opus 5.5). Jag beskrev på svenska vad jag ville ha, tittade på resultatet och sa vad som kändes fel, ofta med en skärmbild. Resultatet är två filer, server.js och index.html, utan ett enda npm-paket att installera.

– 25 oktober: första versionen med [FYLL I: verktyg, till exempel claude.ai]. Den hade en kurva (3–24 timmar), import av historik från LibreView och en logg för måltider med insulindos och ett eget måltidsbibliotek, i två filer på 352 rader. Inloggningen till LibreLinkUp låg i en fil på datorn. Samma kväll tog Claude Code över.
– 25–26 oktober: insulintyper, en dygnsprofil och en första omdesign.
– 3 november: en djup genomgång av hela koden. Inloggningen höll inte, två enheter kunde skriva över varandras ändringar, och andra webbsidor hade kunnat läsa mina värden. Sedan tillkom veckosammanfattning, lokal AI och Telegram-boten.
– 4–5 november: elva designgranskningar med verktyget Impeccable. Det betygsätter sidan mot tio tumregler för användbarhet, och jag åtgärdade fynden ett steg i taget. Poängen gick från 27 till 36 av 40, och den tekniska granskningen (tillgänglighet, prestanda, mobil) från 16 till 19 av 20. På kvällen flyttade servern till Raspberry Pi:n.
– 6 november: månaden i siffror, rapporter i Telegram, versionshantering i git och tydligare utfall efter varje måltid.
– 7 november: känningar per timme, favoritknappar i Telegram och en egen app inuti Telegram, som jag byggde och tog bort samma kväll (se felen).

Claude testade varje ändring i en webbläsare utan skärm och mot en låtsas-Telegram innan något lades ut på Pi:n. Skärmbilderna visar demoläget: en påhittad person med 90 dagars värden, så att mina egna hälsodata aldrig syns.

VAD JAG LÄRDE MIG

– Det svåra var inte koden, utan att bestämma vad appen ska vara. De bästa ändringarna kom när jag skickade en skärmbild och skrev "det här känns otydligt".
– Granskningar hittar sådant man själv inte ser. Efter ett tag hittar de bara nya småsaker, och då är det dags att använda appen i stället.
– En lokal modell på ett vanligt grafikkort räcker långt. Den gör "fläskfärs ris 6,5 enheter" till "Fläskfärs och ris, 6,5 enheter" och svarar på frågor om två veckors data på några sekunder.
– Att ta bort saker är också framsteg. Mobilappen och Telegram-appen fick gå, och verktyget blev enklare utan dem.

I SIFFROR

– 2 filer och 0 npm-paket. Koden växte från 870 till 2 938 rader.
– 259 106 sparade mätvärden på Pi:n.
– 11 designgranskningar och 2 013 svar från Claude.
– Lokal AI på eget grafikkort: inga moln-tokens för det som rör mina värden.
```

---

## Vad gick fel på vägen? (max 4000 tecken)

```text
Dosvarningen som blev en spärr. Den 26 oktober bad jag om en varning när blodsockret ofta blivit högt med en viss dos, "att man kanske bör justera nästa gång man väljer Pizza". Det är precis vad en app inte ska göra. Gränsen blev den motsatta: appen ger aldrig dosråd. I test gav den lokala AI:n ändå ett dosförslag på en direkt fråga. Nu besvaras dosfrågor av servern med ett fast svar innan de når modellen.

AI:n glömde början av frågan. Ollama läser bara 4 096 tokens om man inte säger något annat, och underlaget var cirka 4 600. Dagens datum och sammanfattningen kapades bort utan varning, och svaren handlade om fel dagar. Fönstret är nu 16 384 tokens.

"2 skivor bröd" blev 2 enheter insulin. Ett tal utan enhet lästes som en dos. Nu sparas en gissad dos aldrig, och boten frågar "Did you take 2 units?".

"okänd rätt" lästes som "ok". Mönstret som känner igen hälsningar räknade å, ä och ö som ordgräns, så "okänd" började med "ok". Ett gammalt test hittade det.

"100 % i målområdet" på nästan inga värden. Efter ett uppehåll räknades veckan på en handfull värden och såg perfekt ut. Nu står det att det finns för få värden.

Mobilappen som aldrig blev av. En app som loggar utan nät kräver https i hemnätet, och utanför hemmet nådde den inte servern alls. Telegram löste båda: servern hämtar meddelandena själv, och de väntar hos Telegram om den är av.

Appen i Telegram som jag byggde och tog bort. Jag ville ha större och tydligare knappar, så vi byggde en Mini App på GitHub Pages med stora favoriter och ett textfält. Den fungerade, men gick bara att öppna från knappen i bot-chatten, så den var inte snabbare än att skriva. Jag tog bort den samma kväll.

Två servrar, en bot. När Pi:n tog över fick datorns server inte köra samtidigt, för då tar de meddelanden från varandra. Nu varnar servern om någon annan läser samma bot.

Pi:n nådde inte AI:n. Efter flytten svarade inte grafikkortet på datorn: Ollama lyssnade bara på datorn själv, och brandväggen stoppade porten. Det krävdes en inställning och en brandväggsregel. Nu laddas modellen bara medan dashboarden är öppen, så grafikkortet är ledigt annars.

Rättningar som gav nya fel. Två gånger orsakade Claudes egna ändringar en ny bugg. Ett klassnamn som redan fanns förstörde aktivitetslistan, och en färgvariabel som hamnat i en kommentar fick toppen att gå sönder vid vissa bredder. Sedan dess körs de gamla kontrollerna om efter varje omgång.

Poängjakten som planade ut. Jag ville ha full pott i designgranskningen. Efter sju omgångar låg poängen mellan 33 och 36, eftersom varje ny granskare hittade nya saker. Där slutade jag jaga siffror och började använda appen i stället.
```

---

## Modeller och verktyg (max 500 tecken)

```text
Claude Code med Claude Opus 5.5 (all kod). Ollama med Gemma 4 12B (gemma4:12b) lokalt: tolkar fritext och svarar på frågor om datan. Impeccable (designgranskning i Claude Code). Node.js utan npm-paket, LibreLinkUp (Abbott), Telegram Bot API, Git. Headless Microsoft Edge för automatiska tester och skärmbilder.
```

## Hårdvara (max 300 tecken)

```text
Dator med grafikkort (lokal AI) · Raspberry Pi 4 (servern, dygnet runt) · FreeStyle Libre-sensor och mobil (Libre-appen och Telegram)
```

## Var kördes AI:n?

**Både och**

---

## Tokens

Räknat 17 november kl. 22.21. Kör `.\contest\spara-underlag.ps1` igen sista dagen. Det hämtar den lokala AI:ns logg från Pi:n och räknar om allt till [contest/tokens-claude.md](../tokens-claude.md), med en uppdelning per dag och per session.

Molnsiffran tar nu med cacheläsningen (970 miljoner). Den debiteras också, bara billigare, och utan den såg siffran ut som en underskattning bredvid sajtens exempel (cirka 80 miljoner på 17 dagar). Villkoren varnar för uppenbart fel redovisning, och fler tokens ger inga poäng, så den fulla siffran är den säkra. Bara ny text står kvar i metoden.

| Fält i formuläret | Värde |
|---|---|
| Tokens bearbetade lokalt | **48 965** (minst, se metoden) |
| Tokens betalda i molnet | **993 945 562** |
| Hur vet du antalet tokens? | **Från en tokenräknare** |

"Så räknade jag" (max 500 tecken, just nu 434):

```text
Molnet: summerat ur Claude Codes egna sessionsloggar för projektet, 25 oktober–17 november (3 391 svar). Siffran är allt modellen tog emot och skrev: input, cache-skrivning, output och 970 miljoner tokens som lästes ur cache (billigare, men debiteras också). Bara ny text: 24 miljoner. Lokalt: dashboarden loggar tokens för varje anrop till Ollama sedan 6 november (26 anrop). 3–6 november loggades inte, så det lokala är i underkant.
```

**[FYLL I] Den allra första versionen.** server.js och index.html sparades senast **25 oktober kl. 18.03**, fem timmar före den första Claude Code-sessionen (kl. 23.12, som börjar med "Vad hade du ändrat?"). De gjordes alltså med något annat, troligen en chatt på claude.ai. Datumet ligger inom tävlingsperioden, som började 16 oktober. Om det var en AI-chatt:
1. Öppna den chatten och klistra in tokenprompten från sidan Lämna in sist i den. Lägg till svaret i molnsiffran, eller som en egen mening i metoden (det finns 66 tecken kvar).
2. Spara chatten, till exempel med en skärmdump av början och slutet med datum. Den är bevis på när och hur projektet började.

En kopia av den första versionen, med originaldatumet kvar, ligger i `contest/underlag/forsta-versionen-2026-10-25/`.

---

## Bilder (1–10, PNG, JPG, WebP eller GIF, max 5 MB per bild)

Bilderna ligger i [contest/inlagg/bilder/](bilder/) och visar alla **demoläget**. Ladda upp dem i den här ordningen; den första blir troligen bidragets omslag.

**Nya bilder från 17 november i den nya layouten** ligger i [bilder/nya/](bilder/nya/), tagna i demoläget i dubbel upplösning (mobilen i trefaldig):

| Fil | Vad den visar |
|---|---|
| `nya/01-oversikt.png` | Översikten: värdet, läget i ord, fritextrutan och kurvan med en måltid |
| `nya/02-insikter-veckan.png` | Insights: veckan mot veckan före, en typisk dag, när känningarna börjar och varje dag |
| `nya/03-maltider-jamforda.png` | Meals → Compared: hur det brukar gå efter varje måltid |
| `nya/04-mobil-oversikt.png` | Mobilen: översikten |
| `nya/05-mobil-aktivitet.png` | Mobilen: måltider med start → topp, en behandlad känning och en promenad |
| `nya/06-mobil-insikter.png` | Mobilen: Insights |
| `nya/07-insikter-vecka-manad-ar.gif` | Animation: Insights växlar mellan vecka, månad och år (91 kB) |
| `nya/08-installningar.png` | Settings: tema, insulin, eget målområde, import och export till Excel, Telegram |
| `nya/09-mobil-installningar.png` | Mobilen: målområdet, importen och exporten i Settings |
| `nya/10-sa-har-den-forandrats.png` | Fyra versioner sida vid sida: 25 oktober, 3 november, 6 november och 17 november. Ersätter gärna `02-fore-efter.png` som omslag |

Tabellen nedan är de gamla bilderna från 8 november, med den gamla layouten. `05-monster.png` och `07-manadsbild.png` visar saker som inte finns längre. Behåll gärna `02-fore-efter.png`, `08-fraga-ai.png` och `10-sa-hanger-det-ihop.png`, eftersom de visar resan, AI:n och helheten. Ett förslag på tio: `nya/10-sa-har-den-forandrats` (omslag), `nya/01`, `nya/07` (GIF), `nya/05`, `nya/02`, `nya/03`, `08-fraga-ai`, `10-sa-hanger-det-ihop`, `nya/04` och Telegram-bilden.

| Fil | Vad den visar |
|---|---|
| `02-fore-efter.png` | **Omslaget.** Före (3 nov) och efter (8 nov), sida vid sida |
| `01-oversikt.png` | Översikten: värdet, läget i ord, fritextrutan och kurvan med en måltid |
| `03-mobil.png` | Tre mobilskärmar: kurvan, måltider med utfall och månaden i siffror |
| `04-aktivitet.png` | Aktivitet: varje måltid med start → topp, känningar och behandlingar |
| `05-monster.png` | Mönster: tid i mål, typisk dag och när känningarna börjar, timme för timme |
| `06-insikter-veckan.png` | Insikter: veckan mot veckan före, en stapel per dag, måltiderna |
| `07-manadsbild.png` | Månadsbilden som dashboarden gör och som går att spara |
| `08-fraga-ai.png` | Fråga AI:n: ett riktigt svar från gemma4:12b på mitt grafikkort, på demodatan |
| `10-sa-hanger-det-ihop.png` | Hur sensorn, Pi:n, Telegram och grafikkortet hänger ihop |
| **[FYLL I]** `09-telegram.png` | En skärmbild från Telegram-chatten med boten och favoritknapparna (se nedan) |

**[FYLL I] Telegram-bilden** kan bara du ta, eftersom den visar din egen chatt. Ta den på mobilen när favoritknapparna syns och du nyss loggat något, så att svaret med Undo syns. Den visar bara det du själv skrivit och inga glukosvärden, men beskär bort det du inte vill visa.

---

## Video på YouTube (valfritt)

Ingen video är gjord än. Ett förslag på 60–90 sekunder, inspelat i demoläget på datorn och mobilen:

1. **0–10 s:** Före/efter-bilden. Text: "Libre-appen visar siffran. Jag ville se varför."
2. **10–25 s:** Dashboarden: hovra över kurvan, klicka på en måltid och visa start → topp.
3. **25–40 s:** Mobilen: tryck på en favorit i Telegram, välj dos och se svaret med Undo. Visa sedan måltiden på dashboarden.
4. **40–55 s:** Insights: växla mellan vecka, månad och år, och visa när känningarna börjar. Meals → Compared: vilka måltider som brukar gå högt.
5. **55–75 s:** Ask AI: ställ en fråga och låt svaret skrivas fram. Text: "Lokal AI på eget grafikkort, inget lämnar hemmet."
6. **75–90 s:** Raspberry Pi:n på hyllan. Text: "Dygnet runt. Två filer, inga npm-paket. Aldrig dosråd."

---

## Länk till det du byggt (valfritt)

Beslutat 17 november: koden läggs publikt på GitHub under ett aliaskonto, och webbdemon på GitHub Pages. Länka till demon, och till koden i texten:

```text
https://gianttoaster.github.io/glucose/  (koden: https://github.com/GiantToaster/glucose)
```

Webbdemon kör samma server.js i demoläget direkt i webbläsaren, med en påhittad person. Inget sparas och inget skickas någonstans. Den byggs om med `node web/build.js` efter varje ändring av appen. Bredvid demon ligger resan (`journey.html`) och historiken (`historik.html`), där åtta versioner från 25 oktober till 17 november visas med samma påhittade person.

Anonymiseringen: git-historiken är omskriven så att inga IP-adresser, datornamn, användarnamn eller ditt namn finns kvar, inte heller i commit-författaren. `data/` (dina värden, inloggningsnyckeln och Telegram-token) och `raspberry.txt` har aldrig legat i git. Bilderna visar bara demodata.

---

## Om dig

| Fält | Värde |
|---|---|
| E-postadress | [FYLL I] (visas inte publikt) |
| Namn vid bidraget | [FYLL I] Visas publikt. Ett alias går bra |
| Användarnamn på SweClockers | [FYLL I] Rekommenderas: kopplar ditt inlägg i forumtråden till bidraget |
| Villkoren | Kryssa i att du läst dem och att bidraget är ditt eget |

---

## Inlägg i forumtråden (valfritt)

Tråden: https://www.sweclockers.com/forum/trad/1763887

```text
Hej! Mitt bidrag är en egen blodsockerdashboard för min typ 1-diabetes. Den hämtar Libre-värden dygnet runt på en Raspberry Pi 4, jag loggar måltider genom att skriva till en egen Telegram-bot, och en lokal AI (gemma4:12b på datorns grafikkort) svarar på frågor om mina värden utan att något lämnar hemmet. Allt är skrivet med Claude Code: två filer och inga npm-paket.

Det roligaste var resan: elva designgranskningar (27 → 36 av 40), en mobilapp som aldrig blev av och en Telegram-app som jag byggde och tog bort samma kväll. Och en regel som aldrig fick brytas: appen ger aldrig dosråd.

Bidraget: [länk när det är publicerat]
```

---

## Före inlämningen

- [ ] Fyll i allt som är markerat **[FYLL I]**, särskilt vilket verktyg som gjorde den första versionen 25 oktober.
- [ ] Uppskatta tokens för den första versionen med sajtens prompt, och spara den chatten.
- [ ] Gå igenom "Ändrat sedan 8 november" och uppdatera texterna.
- [x] Ta nya skärmbilder i demoläget (`bilder/nya/`, 17 november). Ta om dem sista dagen om appen ändrats.
- [ ] Telegram-bilden. Lägg den inte i projektmappen: bilder med "telegram" i namnet är utestängda från git.
- [ ] Kör `.\contest\spara-underlag.ps1` sista dagen. Det räknar om tokens och sparar loggarna. Uppdatera tabellen och metoden ovan.
- [ ] Ta en skärmdump av [contest/tokens-claude.md](../tokens-claude.md) (avsnittet "Till formuläret"). Logga in på claude.ai och ta en skärmdump av förbrukningen eller abonnemanget under Settings → Usage, om sidan visar något.
- [x] Koden på GitHub: https://github.com/GiantToaster/glucose, demon på https://gianttoaster.github.io/glucose/
- [ ] Bestäm om det ska bli en video.

## Om bidraget hamnar bland de tre med flest röster

Arrangören vill då se underlag senast 15 december kl. 23.59, i ett formulär på sajten: **högst sex bilder** (PNG, JPG eller WebP) och en kommentar. Kör `.\contest\spara-underlag.ps1` en gång till efter 13 december. Det här finns redan:
- **Tokens:** `contest/tokens-claude.md` (räknat ur Claude Codes sessionsloggar, per dag och session) och `contest/underlag/ai-tokens-<datum>.jsonl` (den lokala AI:n, från Pi:n).
- **När arbetet gjordes:** `contest/underlag/claude-loggar-<datum>.zip` innehåller alla Claude Code-sessioner med tidsstämplar från 25 oktober, och Claude Codes kopior av filerna före varje ändring. Den första versionen ligger i `contest/underlag/forsta-versionen-2026-10-25/`. Git-historiken (75 commits sedan 3 november) ligger både i projektet och som `glucose-git-<datum>.bundle`. Mätvärdena på Pi:n börjar 25 oktober kl. 01.50, importerade från LibreView med den första versionen.
- **Personlig kod:** arrangören skickar en kod som ska in i projektet. Den kan läggas i en commit och i README, och synas på dashboarden under Settings.
- **Demo:** dashboarden kan visas live i demoläget, och webbdemon på GitHub Pages fungerar för vem som helst.

Förslag på sex bilder: tokentabellen, kodens commit och den på dashboarden, första sessionens början med datum (25 oktober kl. 23.12), git-loggen och Pi:ns status- eller tokenlogg.

**Loggarna raderas annars.** Claude Code tar bort sessionsloggar efter 30 dagar som standard, och de första sessionerna från 25–26 oktober hade försvunnit omkring 24 november. Sedan 17 november står `"cleanupPeriodDays": 365` i `%USERPROFILE%\.claude\settings.json`, och zip-filen är en kopia ifall något ändå försvinner. Mappen bytte namn från BG_Dashboard till Glucose 16 november, så loggarna ligger under båda namnen i `.claude\projects`. Skriptet tar med båda.
