# Lagger upp dashboarden pa Pi:n (kors i PowerShell fran projektmappen):  .\pi\deploy.ps1
#
# Kopierar index.html, server.js, icon.svg, pi/README.md och pi/allow-restart.sh, startar om tjansten om server.js har andrats
# (index.html lases vid varje sidladdning, sa den behover ingen omstart) och kontrollerar att filerna pa Pi:n ar
# desamma som har och att dashboarden svarar. -Restart startar om aven nar server.js ar oforandrad.
#
# Inloggningen gar med SSH-nyckeln (se README: "Logga in pa Pi:n fran datorn"). Omstarten kraver sudo: har du kort
# pi/allow-restart.sh pa Pi:n en gang gar den utan losenord, annars fragar Pi:n efter losenordet har i fonstret.
param([switch]$Restart)

$ErrorActionPreference = 'Stop'
$pi = 'pi'                       # namnet i C:\Users\<du>\.ssh\config
$dir = 'glucose'                 # mappen pa Pi:n
$svc = 'glucose-dashboard'
$files = 'index.html', 'server.js', 'icon.svg', 'apple-touch-icon.png', 'icon-512.png', 'manifest.webmanifest'
$pifiles = 'pi/README.md', 'pi/allow-restart.sh'

Push-Location (Split-Path $PSScriptRoot -Parent)
try {
  $hash = { param($f) (Get-FileHash $f -Algorithm SHA256).Hash.ToLower() }
  $remote = { param($f) (ssh -o BatchMode=yes $pi "sha256sum $dir/$f 2>/dev/null | cut -d' ' -f1") }

  $serverChanged = (& $remote 'server.js') -ne (& $hash 'server.js')

  Write-Host "Copying to ${pi}:$dir ..."
  scp -q -o BatchMode=yes $files "${pi}:$dir/"
  if ($LASTEXITCODE) { throw "Could not copy the files. Is the Pi on, and does 'ssh $pi' work?" }
  scp -q -o BatchMode=yes $pifiles "${pi}:$dir/pi/"
  if ($LASTEXITCODE) { throw 'Could not copy the pi folder.' }

  if ($serverChanged -or $Restart) {
    Write-Host $(if ($serverChanged) { 'server.js changed: restarting the dashboard ...' } else { 'Restarting the dashboard ...' })
    ssh -o BatchMode=yes $pi "sudo -n systemctl restart $svc 2>/dev/null"
    if ($LASTEXITCODE) {
      # Ingen losenordsfri omstart: fraga efter losenordet i det har fonstret
      Write-Host 'The Pi asks for the sudo password (run pi/allow-restart.sh on the Pi once to skip this):'
      ssh -t $pi "sudo systemctl restart $svc"
      if ($LASTEXITCODE) { throw 'The dashboard was not restarted. The new server.js is on the Pi but the old one is still running.' }
    }
    Start-Sleep -Seconds 4
  } else {
    Write-Host 'server.js unchanged: no restart needed.'
  }

  # Kontroll: samma filer pa Pi:n som har, tjansten igang och sidan svarar
  $bad = @($files | Where-Object { (& $remote $_) -ne (& $hash $_) })
  $active = ssh -o BatchMode=yes $pi "systemctl is-active $svc"
  $http = ssh -o BatchMode=yes $pi "curl -s -o /dev/null -w '%{http_code}' localhost:3000/"
  if ($bad.Count) { throw "These files differ on the Pi: $($bad -join ', ')" }
  if ($active -ne 'active' -or $http -ne '200') { throw "The files are on the Pi, but the dashboard is not answering (service: $active, HTTP $http). See: ssh $pi `"journalctl -u $svc -n 30`"" }
  Write-Host "Done. The Pi has the same files as this folder, the service is $active and the page answers (HTTP $http)." -ForegroundColor Green
  Write-Host 'Reload the dashboard in the browser to see the change.'
}
finally { Pop-Location }
