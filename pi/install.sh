#!/usr/bin/env bash
# Installs the glucose dashboard as a service on a Raspberry Pi (Raspberry Pi OS / Debian).
# Run from the dashboard folder on the Pi:   sudo bash pi/install.sh
#   HOST=0.0.0.0 sudo -E bash pi/install.sh   reachable from the home network (http://<pi-name>.local:3000)
#   add OLLAMA_URL=http://<pc-name>.local:11434 to use the AI on another computer
#   add LAN_IFACE=eth0 to answer only devices on that network (when the Pi is also a WiFi access point, for example)
# It: installs Node.js from the distribution if it is missing (18.17 or newer is needed), and adds a systemd service that
# starts at boot and restarts if it ever stops. The service gets its own time zone (TZ_NAME, the dashboard counts days
# and clock times in local time); the time zone of the whole Pi is left as it is.
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
# The dashboard's own name on the home network, glucose.local (published by the glucose-name service below). Other .local
# names of this Pi (e.g. its hostname) are sent on to it, so the dashboard has one address. SITE_NAME=other.local picks
# another name; SITE_NAME= (empty) turns both off.
# Only answer clients on this network card's network, e.g. LAN_IFACE=eth0. Use it when the Pi has more than one network
# (a WiFi access point, a guest network): the devices there then get no answer. Empty = every network.
LAN_IFACE="${LAN_IFACE:-}"
SITE_NAME="${SITE_NAME-glucose.local}"; [ "$HOST" = 127.0.0.1 ] && SITE_NAME=""

[ -f "$DIR/server.js" ] || { echo "server.js not found in $DIR"; exit 1; }

# 18.17 or newer (AbortSignal.any). Only from the distribution's signed packages: no script from the internet is run as root.
node_ok() { command -v node >/dev/null 2>&1 && node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 18 || (a === 18 && b >= 17) ? 0 : 1)'; }
if ! node_ok; then
  echo "== Installing Node.js"
  apt-get update -qq && apt-get install -y -qq nodejs
fi
if ! node_ok; then
  echo "Node.js 18.17 or newer is needed, and this system has $(node -v 2>/dev/null || echo none). Install a newer one, for example from NodeSource"
  echo "(https://github.com/nodesource/distributions, with their signed apt repository), then run this script again."
  exit 1
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
Environment=PORT=$PORT HOST=$HOST TZ=$TZ_NAME OLLAMA_AUTOSTART=0${OLLAMA_URL:+ OLLAMA_URL=$OLLAMA_URL}${SITE_NAME:+ SITE_NAME=$SITE_NAME}${LAN_IFACE:+ LAN_IFACE=$LAN_IFACE}
Restart=always
RestartSec=10
# Sandboxing: the system files are read-only for the service, it gets its own /tmp, and new files are private (0600).
# Not NoNewPrivileges/ProtectHome: the dashboard lives in the home folder and runs pistatus, which may use sudo.
UMask=0077
PrivateTmp=yes
ProtectSystem=full
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
LockPersonality=yes

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable glucose-dashboard >/dev/null
systemctl restart glucose-dashboard
sleep 3
systemctl --no-pager --lines=8 status glucose-dashboard || true

# Det gamla namnet bg.local (tjänsten bg-alias, före 23 november 2026) tas bort; namnet heter nu glucose.local
if [ -f /etc/systemd/system/bg-alias.service ]; then
  echo "== Removing the old name bg.local"
  systemctl disable --now bg-alias >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/bg-alias.service /usr/local/sbin/bg-alias
  systemctl daemon-reload
fi

# Ett eget namn i hemnätverket: http://glucose.local:3000 (Pi:ns eget namn fungerar också). SITE_NAME= hoppar över det.
if [ -n "$SITE_NAME" ]; then
  echo "== Name $SITE_NAME"
  apt-get install -y -qq avahi-utils >/dev/null
  install -m 755 "$DIR/pi/site-name.sh" /usr/local/sbin/glucose-name
  cat > /etc/systemd/system/glucose-name.service <<EOF
[Unit]
Description=$SITE_NAME name for the glucose dashboard
After=network-online.target avahi-daemon.service
Wants=network-online.target
Requires=avahi-daemon.service

[Service]
Environment=SITE_NAME=$SITE_NAME IFACE=${LAN_IFACE%%,*}
ExecStart=/usr/local/sbin/glucose-name
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload && systemctl enable --now glucose-name >/dev/null && systemctl restart glucose-name
elif [ -f /etc/systemd/system/glucose-name.service ]; then
  systemctl disable --now glucose-name >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/glucose-name.service /usr/local/sbin/glucose-name
  systemctl daemon-reload
fi
echo
echo "Done. Log:  journalctl -u glucose-dashboard -f"
