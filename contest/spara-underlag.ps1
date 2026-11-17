# Sparar underlaget till tavlingen i contest\underlag\ (git tar inte med mappen). Kors fran projektmappen:
#   .\contest\spara-underlag.ps1
# Kor det igen fore inlamningen 30 november och efter rostningen. Varje korning far egna filer med dagens datum.
#
#  1. Claude Codes sessionsloggar for projektet (bada mappnamnen: BG_Dashboard och Glucose) och Claude Codes
#     kopior av filerna fore varje andring (file-history), i en zip. Det ar den daterade historiken fran AI-tjansten.
#     Claude Code raderar gamla loggar efter cleanupPeriodDays (standard 30 dagar), sa de forsta sessionerna fran
#     25 oktober hade forsvunnit kring 24 november.
#  2. Den allra forsta versionen (server.js och index.html som de sag ut 25 oktober kl. 18:03, fore Claude Code).
#  3. Den lokala AI:ns tokenlogg fran Pi:n (bara antal, aldrig text).
#  4. Tavlingssidorna som de ser ut i dag (regler, utmaning, villkor, inlamningsformularet).
#  5. Hela git-historiken som en bundle-fil.
#  6. Raknar om tokens (contest\tokens-claude.md).
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$out = Join-Path $PSScriptRoot 'underlag'
$day = Get-Date -Format 'yyyy-MM-dd'
$claude = Join-Path $env:USERPROFILE '.claude'
# Claude Code doper loggmappen efter projektets sokvag, med - i stallet for allt utom bokstaver och siffror.
# Projektmappen hette BG_Dashboard till 16 november, sa bada namnen lases.
$projDirs = (Join-Path (Split-Path $root -Parent) 'BG_Dashboard'), $root |
  ForEach-Object { Join-Path $claude ('projects\' + ($_ -replace '[^A-Za-z0-9]', '-')) } | Where-Object { Test-Path $_ }
New-Item -ItemType Directory -Force $out | Out-Null

# 1. Sessionsloggar och file-history i en zip (tar.exe i Windows behaller filernas datum)
$sessions = $projDirs | ForEach-Object { Get-ChildItem $_ -Filter *.jsonl } | ForEach-Object { $_.BaseName }
$stage = Join-Path $env:TEMP "glucose-underlag-$day"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force "$stage\projects", "$stage\file-history" | Out-Null
foreach ($d in $projDirs) { Copy-Item -Recurse $d "$stage\projects\" }
foreach ($s in $sessions) {
  $fh = Join-Path $claude "file-history\$s"
  if (Test-Path $fh) { Copy-Item -Recurse $fh "$stage\file-history\" }
}
# Copy-Item behaller inte mappars datum, men filernas LastWriteTime foljer med
$zip = Join-Path $out "claude-loggar-$day.zip"
if (Test-Path $zip) { Remove-Item $zip }
& "$env:SystemRoot\System32\tar.exe" -a -c -f $zip -C $stage projects file-history
if ($LASTEXITCODE) { throw 'Could not create the zip.' }
Remove-Item -Recurse -Force $stage
Write-Host ("1. Sessions: {0} ({1} sessions, {2:N0} MB)" -f $zip, $sessions.Count, ((Get-Item $zip).Length / 1MB))

# 2. Forsta versionen, ur Claude Codes kopia fore den forsta andringen 25 oktober
$first = Join-Path $out 'forsta-versionen-2026-10-25'
$fh1 = Join-Path $claude 'file-history\7f210c22-2e3d-4206-aafc-e287bb570445'
if (-not (Test-Path "$first\server.js") -and (Test-Path "$fh1\59b1bb64e0a71db0@v1")) {
  New-Item -ItemType Directory -Force $first | Out-Null
  Copy-Item "$fh1\59b1bb64e0a71db0@v1" "$first\server.js"
  Copy-Item "$fh1\6aa6626d3c4b190b@v1" "$first\index.html"
}
if (Test-Path "$first\server.js") {
  Write-Host ("2. First version: {0} (last saved {1})" -f $first, (Get-Item "$first\server.js").LastWriteTime)
} else { Write-Host '2. First version: not found (file-history is gone)' -ForegroundColor Yellow }

# 3. Lokal AI: tokenloggen fran Pi:n
$tok = Join-Path $out "ai-tokens-$day.jsonl"
scp -q -o BatchMode=yes -o ConnectTimeout=8 'pi:glucose/data/ai-tokens.jsonl' $tok
if ($LASTEXITCODE) { Write-Host '3. Local AI: could not reach the Pi (ssh pi). Run again when it is on.' -ForegroundColor Yellow }
else { Write-Host ("3. Local AI: {0} ({1} calls)" -f $tok, (Get-Content $tok | Measure-Object -Line).Lines) }

# 4. Tavlingssidorna
$web = Join-Path $out "tavlingssidan-$day"
New-Item -ItemType Directory -Force $web | Out-Null
$base = 'https://projekt.sweclockers.com'
$pages = '/asus', '/asus/utmaningen', '/asus/villkor', '/asus/priset', '/asus/bidrag', '/asus/lamna-in', '/asus/kontakt'
foreach ($p in $pages) {
  $name = ($p.Trim('/') -replace '/', '_') + '.html'
  try { Invoke-WebRequest -UseBasicParsing "$base$p" -OutFile (Join-Path $web $name) } catch { Write-Host "   could not fetch $p" -ForegroundColor Yellow }
}
# Formularet byggs i JavaScript: spara skriptet som har falten och teckengranserna
try {
  $html = (Invoke-WebRequest -UseBasicParsing "$base/asus/lamna-in").Content
  foreach ($m in [regex]::Matches($html, '/assets/(asus\.lamna-in|my-submission-tools)-[\w-]+\.js')) {
    Invoke-WebRequest -UseBasicParsing "$base$($m.Value)" -OutFile (Join-Path $web (Split-Path $m.Value -Leaf))
  }
} catch { Write-Host '   could not fetch the form script' -ForegroundColor Yellow }
Write-Host "4. Contest pages: $web"

# 5. Git-historiken
$bundle = Join-Path $out "glucose-git-$day.bundle"
git -C $root bundle create $bundle --all 2>$null
if ($LASTEXITCODE) { Write-Host '5. Git: could not create the bundle' -ForegroundColor Yellow }
else { Write-Host "5. Git history: $bundle ($(git -C $root rev-list --count HEAD) commits)" }

# 6. Tokens
if (Test-Path $tok) { node (Join-Path $PSScriptRoot 'tokens-claude.js') $tok | Out-Null } else { node (Join-Path $PSScriptRoot 'tokens-claude.js') | Out-Null }
Write-Host '6. Tokens counted again: contest\tokens-claude.md'
Write-Host "Done. Everything is in $out" -ForegroundColor Green
