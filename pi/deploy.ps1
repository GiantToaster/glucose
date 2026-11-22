# Lagger upp dashboarden pa Pi:n (kors i PowerShell fran projektmappen):  .\pi\deploy.ps1
#
# 1) Kontrollerar koden har forst: node --check och testerna (node --test). -SkipTests hoppar over testerna.
# 2) Kopierar filerna till en tillfallig mapp pa Pi:n (glucose/.incoming), sparar de nuvarande i glucose/.previous och
#    byter sedan ut varje fil med mv (ett namnbyte, sa att en sidladdning aldrig far en halvt kopierad fil).
# 3) Startar om tjansten om server.js har andrats (index.html lases vid varje sidladdning) och kontrollerar att filerna
#    pa Pi:n ar desamma som har och att dashboarden svarar. Svarar den inte laggs de forra filerna tillbaka och tjansten
#    startas om med dem. -Restart startar om aven nar server.js ar oforandrad.
#
# Inloggningen gar med SSH-nyckeln (se README: "Logga in pa Pi:n fran datorn"). Omstarten kraver sudo: har du kort
# pi/allow-restart.sh pa Pi:n en gang gar den utan losenord, annars fragar Pi:n efter losenordet har i fonstret.
param([switch]$Restart, [switch]$SkipTests)

$ErrorActionPreference = 'Stop'
$pi = 'pi'                       # namnet i C:\Users\<du>\.ssh\config
$dir = 'glucose'                 # mappen pa Pi:n
$svc = 'glucose-dashboard'
$files = 'index.html', 'server.js', 'icon.svg', 'apple-touch-icon.png', 'icon-512.png', 'icon-192.png', 'icon-maskable-512.png', 'manifest.webmanifest'
$pifiles = 'pi/README.md', 'pi/allow-restart.sh'

Push-Location (Split-Path $PSScriptRoot -Parent)
try {
  # Forst har: en fil som inte ens gar att lasa, eller ett test som inte gar igenom, laggs aldrig upp
  Write-Host 'Checking the code ...'
  node --check server.js
  if ($LASTEXITCODE) { throw 'server.js has a syntax error. Nothing was copied.' }
  if (-not $SkipTests) {
    node --test 2>&1 | Out-Null
    if ($LASTEXITCODE) { throw 'The tests failed (run: node --test). Nothing was copied.' }
  }

  $hash = { param($f) (Get-FileHash $f -Algorithm SHA256).Hash.ToLower() }
  $remote = { param($f) (ssh -o BatchMode=yes $pi "sha256sum $dir/$f 2>/dev/null | cut -d' ' -f1") }
  $restartCmd = {
    ssh -o BatchMode=yes $pi "sudo -n systemctl restart $svc 2>/dev/null"
    if ($LASTEXITCODE) {
      # Ingen losenordsfri omstart: fraga efter losenordet i det har fonstret
      Write-Host 'The Pi asks for the sudo password (run pi/allow-restart.sh on the Pi once to skip this):'
      ssh -t $pi "sudo systemctl restart $svc"
    }
    $script:rc = $LASTEXITCODE
  }
  $healthy = {
    Start-Sleep -Seconds 4
    $active = ssh -o BatchMode=yes $pi "systemctl is-active $svc"
    $http = ssh -o BatchMode=yes $pi "curl -s -o /dev/null -w '%{http_code}' localhost:3000/"
    return @($active, $http)
  }

  $serverChanged = (& $remote 'server.js') -ne (& $hash 'server.js')

  Write-Host "Copying to ${pi}:$dir/.incoming ..."
  ssh -o BatchMode=yes $pi "mkdir -p $dir/.incoming $dir/.previous $dir/pi"
  if ($LASTEXITCODE) { throw "Could not reach the Pi. Is it on, and does 'ssh $pi' work?" }
  scp -q -o BatchMode=yes $files "${pi}:$dir/.incoming/"
  if ($LASTEXITCODE) { throw 'Could not copy the files. Nothing on the Pi was changed.' }
  scp -q -o BatchMode=yes $pifiles "${pi}:$dir/pi/"
  if ($LASTEXITCODE) { throw 'Could not copy the pi folder.' }

  # De nuvarande filerna till .previous, de nya pa plats med mv (atomiskt inom samma filsystem)
  $names = $files -join ' '
  ssh -o BatchMode=yes $pi "cd $dir && for f in $names; do [ -f `$f ] && cp -p `$f .previous/`$f; mv -f .incoming/`$f `$f; done"
  if ($LASTEXITCODE) { throw 'Could not put the new files in place.' }

  if ($serverChanged -or $Restart) {
    Write-Host $(if ($serverChanged) { 'server.js changed: restarting the dashboard ...' } else { 'Restarting the dashboard ...' })
    & $restartCmd
    if ($script:rc) { throw 'The dashboard was not restarted. The new server.js is on the Pi but the old one is still running.' }
  } else {
    Write-Host 'server.js unchanged: no restart needed.'
  }

  # Kontroll: samma filer pa Pi:n som har, tjansten igang och sidan svarar. Annars tillbaka till de forra filerna.
  $active, $http = & $healthy
  if ($active -ne 'active' -or $http -ne '200') {
    Write-Host "The dashboard is not answering (service: $active, HTTP $http). Putting the previous files back ..." -ForegroundColor Yellow
    ssh -o BatchMode=yes $pi "cd $dir && for f in $names; do [ -f .previous/`$f ] && cp -p .previous/`$f `$f; done"
    & $restartCmd
    $active2, $http2 = & $healthy
    throw "The new version did not start, so the previous one is back (service: $active2, HTTP $http2). See: ssh $pi `"journalctl -u $svc -n 30`""
  }
  $bad = @($files | Where-Object { (& $remote $_) -ne (& $hash $_) })
  if ($bad.Count) { throw "These files differ on the Pi: $($bad -join ', ')" }
  Write-Host "Done. The Pi has the same files as this folder, the service is $active and the page answers (HTTP $http)." -ForegroundColor Green
  Write-Host "The previous files are in ${dir}/.previous on the Pi. Reload the dashboard in the browser to see the change."
}
finally { Pop-Location }
