#!/bin/sh
# Ger dashboarden ett eget namn i hemnätverket: http://bg.local:3000 (utöver Pi:ns eget namn, t.ex. raspberrypi.local).
# avahi-publish (paketet avahi-utils) publicerar namnet så länge det körs; -R hoppar över den omvända posten, som
# annars krockar med Pi:ns eget namn på samma adress. Adressen tas från eth0 när tjänsten startar, så att namnet
# följer med om routern ger Pi:n en ny adress. Körs av tjänsten bg-alias (se install.sh).
ip=$(ip -4 -o addr show "${IFACE:-eth0}" | awk '{print $4}' | cut -d/ -f1 | head -1)
[ -n "$ip" ] || { echo "No IPv4 address on ${IFACE:-eth0}" >&2; exit 1; }
echo "bg.local -> $ip"
exec avahi-publish -a -R bg.local "$ip"
