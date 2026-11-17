# Dashboarden på Raspberry Pi (24/7)

Pi:n (här kallad `raspberrypi`) hämtar mätvärden och läser Telegram dygnet runt, även när datorn är avstängd.
Telegram fungerar var du än är, eftersom servern själv frågar Telegram efter nya meddelanden. Ingen port behöver
öppnas i routern.

## Öppna dashboarden

Från datorn eller mobilen i hemnätet (eller i Pi:ns eget Wi-Fi):

- **http://bg.local:3000** (dashboardens eget namn, från tjänsten `bg-alias`). Pi:ns eget namn
  (raspberrypi.local:3000) skickas vidare hit (`SITE_NAME=bg.local` i tjänsten), så att dashboarden bara har en adress.
- eller Pi:ns IP-adress med `:3000` efter, om namnet inte fungerar (t.ex. på vissa Android-telefoner)

Lägg gärna till den på mobilens hemskärm. Dashboarden har inget eget lösenord: alla enheter i ditt nätverk kan
öppna den, men den nås inte från internet (den lyssnar bara på IPv4 bakom routern). Ge Pi:n en fast adress i
routern (DHCP-reservation), så att adressen inte ändras.

## Kör bara en server

Bara en server åt gången får läsa Telegram-boten. Två servrar med samma bot tar meddelanden från varandra, och
datan glider isär. Starta alltså inte `node server.js` på datorn igen, och slå inte på
**Settings → Startup** där.

## Så installerades den

```powershell
# på datorn
cd <projektmappen>
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
`HOST=0.0.0.0` gör den nåbar i hemnätet; utan den nås den bara på Pi:n själv. Har Pi:n fler nät (till exempel
en egen WiFi-accesspunkt på wlan0) lägger man till `LAN_IFACE=eth0`: då får bara enheter på hemnätet svar, och
enheterna på det andra nätet får "403".

`data` innehåller mätvärden, måltider, inloggningsnyckeln till LibreLinkUp och Telegram-boten. Inget lösenord
finns i mappen. Kopiera aldrig `raspberry.txt`.

## Logga in på Pi:n från datorn

Datorn har en SSH-nyckel (`%USERPROFILE%\.ssh\id_ed25519`, utan lösenfras) som Pi:n känner igen, och
`%USERPROFILE%\.ssh\config` ger Pi:n det korta namnet `pi`. I PowerShell:

```powershell
ssh pi                                   # ett skal på Pi:n, "exit" för att gå ut
ssh pi "systemctl is-active glucose-dashboard"   # ett enstaka kommando
```

Inget lösenord behövs för att logga in, bara för `sudo` på Pi:n. Ny dator? Skapa en nyckel och lägg in den en gång
(den gången frågar Pi:n efter lösenordet):

```powershell
ssh-keygen -t ed25519
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh pi@raspberrypi "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

Ta bort datorns nyckel från Pi:n: raden som slutar med `glucose-pc` i `~/.ssh/authorized_keys`.

## Bra kommandon (på Pi:n)

```bash
journalctl -u glucose-dashboard -f          # vad den gör just nu
sudo systemctl restart glucose-dashboard    # starta om
sudo systemctl status glucose-dashboard     # körs den?
```

## Uppdatera

Ett kommando i PowerShell, från projektmappen:

```powershell
.\pi\deploy.ps1
```

Det kopierar filerna, startar om tjänsten om `server.js` har ändrats (`index.html` läses vid varje sidladdning, så
den behöver ingen omstart) och kontrollerar att Pi:n har samma filer som datorn och att dashboarden svarar.
`.\pi\deploy.ps1 -Restart` startar om även när `server.js` är oförändrad. Ladda sedan om dashboarden i webbläsaren.

Omstarten kräver `sudo`, så skriptet frågar efter Pi:ns lösenord när den behövs. Vill du slippa det kör du det här
en gång (då frågar den en sista gång):

```powershell
ssh -t pi "sudo bash glucose/pi/allow-restart.sh"
```

Det ger användaren `pi` rätt att köra just `systemctl restart glucose-dashboard` utan lösenord, inget annat.
Efter det behövs lösenordet inte för uppladdningar, och `raspberry.txt` kan tas bort från datorn.
Ångra: `ssh -t pi "sudo rm /etc/sudoers.d/020_glucose-dashboard"`.

För hand går det också:

```powershell
scp index.html server.js pi:glucose/
ssh -t pi "sudo systemctl restart glucose-dashboard"   # -t: så att sudo kan fråga efter lösenordet
```

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

Avsluta sedan Ollama i aktivitetsfältet (Quit Ollama) och starta det igen. Byt PI-IP-ADRESS mot Pi:ns adress. Brandväggsregeln släpper bara in Pi:n.

Vill du att Ollama startar dolt när du loggar in (inget fönster, ingen ikon): kopiera `pc\ollama-hidden.vbs` till
Autostart-mappen (Win+R, skriv `shell:startup`, Enter). Starta inte Ollama-appen samtidigt; båda vill ha port 11434.
Ta bort filen ur Autostart för att sluta.
