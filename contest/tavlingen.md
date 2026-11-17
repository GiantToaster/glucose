# Tävlingen: regler och formulär

Sammanfattat 17 november 2026 ur https://projekt.sweclockers.com/asus (Start, Utmaningen, Villkor, Bidragen, Lämna in och formulärets skript). Sidorna i sin helhet ligger i `contest/underlag/tavlingssidan-<datum>/`. Kör `.\contest\spara-underlag.ps1` för att spara en ny kopia om något verkar ha ändrats.

## Datum

| | |
|---|---|
| Inlämning | 16 oktober till och med **30 november** |
| Ändra bidraget | fram till att röstningen öppnar **1 december** |
| Röstning | 1 december till och med 13 december |
| Underlag från de tre med flest röster | senast **15 december kl. 23.59** |
| Vinnaren presenteras | 17 december, och kontaktas via e-postadressen bidraget lämnades in med. Svar inom 14 dagar, annars förfaller vinsten |

Vinsten är en ASUS ProArt P16 (H7607BA-SE080X), värd cirka 73 000 kr. Eventuell skatt på vinsten betalar vinnaren.

## Vad som bedöms

Communityt röstar: en röst per person, och det går inte att rösta på sitt eget bidrag. Juryn (Geeks AB och ASUS Nordic) väljer inga favoriter. Den tar bara bort bidrag med uppenbara fel. Sidan trycker på tre saker:

- **Det ska fungera till slut**, och bidraget ska visa hur du kom dit.
- **Misslyckandena är halva poängen.** "Det är den delen SweClockers läsare lär sig mest av, och det är den som skiljer ett bidrag från en produktdemo."
- **Forumet:** visa upp bidraget i tävlingstråden. Sajten ger färdig BB-kod, och med användarnamnet kopplas inlägget till bidraget. Bidrag som förverkligar ett önskemål från forumets önskelista lyfts gärna i nyhetsbrev och artiklar.

## Formuläret (fält och gränser ur sajtens skript)

| Fält | Gräns | Hjälptext på sajten |
|---|---|---|
| Vilket spår? | ett av sex | Egen AI-assistent, Rädda något, Verktyget du alltid saknat, 3D och visualisering, Film, bild och musik, Eget spår |
| Rubrik | 120 tecken | "Vad gjorde du?" |
| I en mening | 160 tecken | Visas på bidragskortet. "Gärna det som inte gick för dig förut." |
| Vad byggde du, och hur? | 8 000 tecken | Bygger du vidare på något du hade innan tävlingen, berätta vad som fanns då och vad du har gjort nu |
| Vad gick fel på vägen? | 4 000 tecken | "Det här är halva poängen." |
| Modeller och verktyg | 500 tecken | |
| Hårdvara | 300 tecken | |
| Var kördes AI:n? | lokalt / molnet / både och | |
| Tokens bearbetade lokalt | tal | |
| Tokens betalda i molnet | tal | |
| Hur vet du antalet tokens? | val | exakt (tokenräknare) eller uppskattat. Uppskattade siffror visas med ≈ |
| Så räknade jag | **500 tecken** | Visas på bidraget under "Så räknade jag:" |
| Bilder | 1–10 bilder, PNG, JPG, WebP eller GIF, högst 5 MB per bild | |
| Video på YouTube | valfri | |
| Länk till det du byggt | 300 tecken, valfri | Ger en knapp på bidraget. "Länka gärna till källkoden också, till exempel på GitHub." |
| E-postadress | | Kod skickas hit, visas aldrig publikt |
| Namn vid bidraget | | Visas publikt, alias går bra |
| Användarnamn på SweClockers | valfritt, rekommenderas | |
| Villkoren | kryssruta | Bidraget är ditt eget |

Formuläret sparar ett utkast i webbläsaren (localStorage), men skriv texterna i `contest/inlagg/utkast.md` och klistra in dem därifrån. Du väljer själv när bidraget syns. Ändringar efter godkännandet syns direkt.

## Tokens

- Två tal: bearbetade lokalt och betalda i molnet. Flera verktyg läggs ihop.
- Har verktyget ingen tokenräknare uppskattar du och förklarar hur. På sidan Lämna in finns en färdig prompt att klistra in sist i varje AI-chatt som använts. Den ger en uppskattning för den chatten.
- "Fler tokens ger inga extra poäng, och en ungefärlig siffra räcker."
- "Spara en skärmdump av siffran." En uppenbart felaktig redovisning kan diskvalificera bidraget.

## Upphov och bevis (gäller de tre med flest röster)

- Det du gör med AI ska vara gjort från **16 oktober**. Det som fanns innan får användas, men bidraget ska visa vad som fanns då och vad som är nytt.
- Du ska kunna visa **när** arbetet gjordes, till exempel med daterad historik från AI-tjänsten, molntjänstens förbrukning eller uppladdningar till GitHub.
- Arrangören ger en **personlig kod** som läggs in i projektet (källkod, commit, README eller om-ruta) och visas med skärmdump eller länk. Koden kan tas bort när underlaget är godkänt.
- Underlaget skickas i sajtens formulär: **högst sex bilder** (PNG, JPG eller WebP, högst 5 MB), plus en valfri kommentar ("Länk till där koden syns, vilket verktyg och vilken period"). Det ses bara av arrangören.
- Arrangören kan också be om tidigare versioner, arbetsfiler eller att projektet visas live.
- Formuläret säger: "Spara gärna projektfiler, tidiga versioner och dina AI-chattar."

## Övrigt i villkoren

- Du ska bo i Sverige och vara minst 16 år. En person, ett bidrag och en röst.
- Bidraget lämnas in på svenska.
- Bilder: du ansvarar för rättigheterna. Visar bilderna personer behövs deras tillstånd.
- SweClockers och ASUS får visa och använda bilder och texter från bidraget, globalt och utan ersättning.
- Andras modeller, verktyg och bibliotek får användas, men det ska framgå vad som använts.
