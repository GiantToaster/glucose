#!/bin/bash
# Låter användaren pi starta om dashboarden utan lösenord, så att pi/deploy.ps1 på datorn inte behöver fråga.
# Körs en gång, från datorn:   ssh -t pi "sudo bash glucose/pi/allow-restart.sh"
#
# Regeln gäller bara det här enda kommandot (systemctl restart glucose-dashboard); allt annat med sudo frågar
# fortfarande efter lösenordet. Filen kontrolleras med visudo innan den läggs på plats, så att ett fel i den
# aldrig kan låsa sudo. Ta bort regeln igen:   sudo rm /etc/sudoers.d/020_glucose-dashboard
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run with sudo: sudo bash $0" >&2; exit 1; }

USER_NAME="${SUDO_USER:-pi}"
RULE=/etc/sudoers.d/020_glucose-dashboard
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT

printf '%s\n' \
  "# The glucose dashboard: $USER_NAME may restart this one service without a password (pi/deploy.ps1 on the PC)." \
  "$USER_NAME ALL=(root) NOPASSWD: $(command -v systemctl) restart glucose-dashboard" > "$tmp"

visudo -cf "$tmp" >/dev/null
install -m 0440 -o root -g root "$tmp" "$RULE"
visudo -c >/dev/null
echo "Done: $USER_NAME can now run 'sudo systemctl restart glucose-dashboard' without a password."
