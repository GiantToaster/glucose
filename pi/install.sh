#!/usr/bin/env bash
# Installs the glucose dashboard as a service on a Raspberry Pi (Raspberry Pi OS / Debian).
# Run from the dashboard folder on the Pi:   sudo bash pi/install.sh
#   HOST=0.0.0.0 sudo -E bash pi/install.sh   reachable from the home network (http://<pi-name>.local:3000)
#   add OLLAMA_URL=http://<pc-name>.local:11434 to use the AI on another computer
# It: sets the time zone (the dashboard counts days and clock times in local time), installs Node.js if it is missing
# or older than 18, and adds a systemd service that starts at boot and restarts if it ever stops.
# Safe to run again (e.g. after copying a newer index.html / server.js).
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run it with sudo: sudo bash pi/install.sh"; exit 1; }

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_AS="${SUDO_USER:-$(stat -c %U "$DIR")}" # the service runs as the normal user, not as root
PORT="${PORT:-3000}"
# 127.0.0.1 = only reachable on the Pi itself. 0.0.0.0 = every device on the home network can open it. The dashboard
# has no password of its own, so only use 0.0.0.0 on a network where you trust the devices.
HOST="${HOST:-127.0.0.1}"
TZ_NAME="${TZ_NAME:-Europe/Stockholm}"
# The local AI on another computer, e.g. OLLAMA_URL=http://MY-PC.local:11434 (that computer runs Ollama with
# OLLAMA_HOST=0.0.0.0). Empty = no AI; free text then uses the simple reader.
OLLAMA_URL="${OLLAMA_URL:-}"

[ -f "$DIR/server.js" ] || { echo "server.js not found in $DIR"; exit 1; }

echo "== Time zone: $TZ_NAME"
timedatectl set-timezone "$TZ_NAME"

node_ok() { command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 18 ]; }
if ! node_ok; then
  echo "== Installing Node.js"
  apt-get update -qq && apt-get install -y -qq nodejs
  if ! node_ok; then # the distribution's version is too old: Node 22 from NodeSource
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y -qq nodejs
  fi
fi
echo "== Node $(node -v)"

mkdir -p "$DIR/data"
chown -R "$RUN_AS": "$DIR"
chmod 700 "$DIR/data" # login key and Telegram token live here

echo "== Service glucose-dashboard (port $PORT, host $HOST, user $RUN_AS)"
cat >/etc/systemd/system/glucose-dashboard.service <<EOF
[Unit]
Description=Glucose dashboard
Wants=network-online.target
After=network-online.target

[Service]
User=$RUN_AS
WorkingDirectory=$DIR
ExecStart=$(command -v node) server.js
Environment=PORT=$PORT HOST=$HOST TZ=$TZ_NAME OLLAMA_AUTOSTART=0${OLLAMA_URL:+ OLLAMA_URL=$OLLAMA_URL}
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable glucose-dashboard >/dev/null
systemctl restart glucose-dashboard
sleep 3
systemctl --no-pager --lines=8 status glucose-dashboard || true
echo
echo "Done. Log:  journalctl -u glucose-dashboard -f"
