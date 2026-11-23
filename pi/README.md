# Dashboarden på Raspberry Pi (24/7)

Pi:n (här kallad `raspberrypi`) hämtar mätvärden och läser Telegram dygnet runt, även när datorn är avstängd.
Telegram fungerar var du än är, eftersom servern själv frågar Telegram efter nya meddelanden. Ingen port behöver
öppnas i routern.

## Öppna dashboarden

Från datorn eller mobilen i hemnätet (eller i Pi:ns eget Wi-Fi):

- **http://glucose.local** (dashboardens eget namn, från tjänsten `glucose-name`). Pi:ns eget namn
  (raspberrypi.local) skickas vidare hit (`SITE_NAME=glucose.local` i tjänsten), så att dashboarden bara har en adress.
  Ett annat namn: `SITE_NAME=annat.local` när install.sh körs.
- eller Pi:ns IP-adress, om namnet inte fungerar (t.ex. på vissa Android-telefoner)

Dashboarden svarar på port 80, så ingen port behöver skrivas. Tjänsten får bara rätten att använda en låg port
(`CAP_NET_BIND_SERVICE`), inte root. Gamla bokmärken med `:3000` fungerar också: port 3000 (`EXTRA_PORT`) skickar
vidare till http://glucose.local. Före 23 november 2026 hette den http://bg.local:3000; det namnet är borttaget, så byt
bokmärket och hemskärmsikonen på mobilen. Vill du ha kvar port 3000 som enda port: `PORT=3000` när install.sh körs.

Lägg gärna till den på mobilens hemskärm. Från början har dashboarden inget eget lösenord: alla enheter i ditt nätverk
kan öppna den, men den nås inte från internet (den lyssnar bara på IPv4 bakom routern). Vill du att andra enheter i
nätverket (gäster, smarta prylar) inte ska komma åt värdena slår du på **Settings → Passcode**: varje enhet anger koden
en gång och kommer ihåg den i ett år. Koden sparas bara som en hash i `data/auth.json`; Pi:n själv behöver den aldrig.
Glömt koden? Ta bort `data/auth.json` på Pi:n och starta om tjänsten. Ge Pi:n en fast adress i routern
(DHCP-reservation), så att adressen inte ändras.

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

Skriptet installerar Node.js från Debians egna paket om det saknas (18.17 eller nyare behövs) och gör dashboarden till
tjänsten `glucose-dashboard`, som startar med Pi:n och startar om sig själv om den stannar. Tjänsten räknar i
Europe/Stockholm (`TZ_NAME`) utan att ändra hela Pi:ns tidszon, och den får läsa men inte ändra systemets filer.
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

Det kör först `node --check` och testerna (`-SkipTests` hoppar över testerna), kopierar sedan filerna till en tillfällig
mapp på Pi:n och byter ut dem med ett namnbyte, så att en sidladdning aldrig får en halvt kopierad fil. De förra filerna
sparas i `glucose/.previous`. Tjänsten startas om om `server.js` har ändrats (`index.html` läses vid varje sidladdning,
så den behöver ingen omstart). Svarar dashboarden inte efteråt läggs de förra filerna tillbaka automatiskt.
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
New-NetFirewallRule -DisplayName 'Ollama for the glucose Pi' -Direction Inbound -Protocol TCP -LocalPort 11434 -RemoteAddress PI-IP-ADRESS -Profile Private -Action Allow
```

Avsluta sedan Ollama i aktivitetsfältet (Quit Ollama) och starta det igen. Byt PI-IP-ADRESS mot Pi:ns adress. Brandväggsregeln släpper bara in Pi:n,
och bara när datorn är på ett nätverk som Windows kallar Privat (hemnätet). Ollama har inget eget lösenord, så på andra nätverk
(Offentligt) når ingen den. Har Windows själv lagt till en regel för ollama.exe när den startades första gången: ta bort den
(Windows Defender-brandväggen → Inkommande regler), annars släpper den in alla.

Vill du att Ollama startar dolt när du loggar in (inget fönster, ingen ikon): kopiera `pc\ollama-hidden.vbs` till
Autostart-mappen (Win+R, skriv `shell:startup`, Enter). Starta inte Ollama-appen samtidigt; båda vill ha port 11434.
Ta bort filen ur Autostart för att sluta.
