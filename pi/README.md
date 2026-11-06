# Dashboarden på Raspberry Pi (24/7)

Pi:n (`raspberrypi`, PI-IP-ADRESS) hämtar mätvärden och läser Telegram dygnet runt, även när datorn är avstängd.
Telegram fungerar var du än är, eftersom servern själv frågar Telegram efter nya meddelanden. Ingen port behöver
öppnas i routern.

## Öppna dashboarden

Från datorn eller mobilen i hemnätet (eller i Pi:ns eget Wi-Fi):

- **http://raspberrypi.local:3000**
- eller **http://PI-IP-ADRESS:3000** om namnet inte fungerar (t.ex. på vissa Android-telefoner)

Lägg gärna till den på mobilens hemskärm. Dashboarden har inget eget lösenord: alla enheter i ditt nätverk kan
öppna den, men den nås inte från internet (den lyssnar bara på IPv4 bakom routern). Ge Pi:n en fast adress i
routern (DHCP-reservation), så att PI-IP-ADRESS inte ändras.

## Kör bara en server

Bara en server åt gången får läsa Telegram-boten. Två servrar med samma bot tar meddelanden från varandra, och
datan glider isär. Starta alltså inte `node server.js` på datorn igen, och slå inte på
**Settings → Startup** där.

## Så installerades den

```powershell
# på datorn
cd C:\Users\me\Desktop\BG_Dashboard
ssh pi@raspberrypi "mkdir -p ~/glucose/pi"
scp index.html server.js icon.svg pi@raspberrypi:glucose/
scp pi/install.sh pi/README.md pi@raspberrypi:glucose/pi/
scp data/db.json data/readings.jsonl data/session.json data/telegram.json pi@raspberrypi:glucose/data/
```

```bash
# på Pi:n
cd ~/glucose && HOST=0.0.0.0 sudo -E bash pi/install.sh
```

Skriptet sätter tidszonen till Europe/Stockholm, installerar Node.js om det saknas och gör dashboarden till
tjänsten `glucose-dashboard`, som startar med Pi:n och startar om sig själv om den stannar.
`HOST=0.0.0.0` gör den nåbar i hemnätet; utan den nås den bara på Pi:n själv.

`data` innehåller mätvärden, måltider, inloggningsnyckeln till LibreLinkUp och Telegram-boten. Inget lösenord
finns i mappen. Kopiera aldrig `raspberry.txt`.

## Bra kommandon (på Pi:n)

```bash
journalctl -u glucose-dashboard -f          # vad den gör just nu
sudo systemctl restart glucose-dashboard    # starta om
sudo systemctl status glucose-dashboard     # körs den?
```

## Uppdatera

`index.html` läses vid varje sidladdning, så den räcker att kopiera. Ändras `server.js` behövs en omstart:

```powershell
scp index.html server.js pi@raspberrypi:glucose/
ssh pi@raspberrypi "sudo systemctl restart glucose-dashboard"
```

## Nätverket

Pi:ns egen trafik
(LibreLinkUp och Telegram) går direkt ut via kabeln.

## Lokal AI (Ollama på datorn)

Pi:n använder Ollama på datorn (`OLLAMA_URL=http://MY-PC.local:11434` i tjänsten). Modellen, den tunga delen
på grafikkortet, laddas när du öppnar dashboarden och släpps när du stänger den sista fliken (efter högst 3 minuter
om fliken försvann utan att säga till). Ollama-programmet i aktivitetsfältet kan vara igång hela tiden; utan modell
använder det knappt något minne.

Är datorn avstängd eller sover använder fritext och Telegram den enkla tolkaren, och frågorna under Insights är
avstängda. En gång på datorn (PowerShell som administratör):

```powershell
[Environment]::SetEnvironmentVariable('OLLAMA_HOST', '0.0.0.0', 'User')   # Ollama lyssnar även i hemnätet
New-NetFirewallRule -DisplayName 'Ollama for the glucose Pi' -Direction Inbound -Protocol TCP -LocalPort 11434 -RemoteAddress PI-IP-ADRESS -Action Allow
```

Avsluta sedan Ollama i aktivitetsfältet (Quit Ollama) och starta det igen. Brandväggsregeln släpper bara in Pi:n.

Vill du att Ollama startar dolt när du loggar in (inget fönster, ingen ikon): kopiera `pc\ollama-hidden.vbs` till
Autostart-mappen (Win+R, skriv `shell:startup`, Enter). Starta inte Ollama-appen samtidigt; båda vill ha port 11434.
Ta bort filen ur Autostart för att sluta.
