#!/bin/sh
# Ger dashboarden ett eget namn i hemnätverket: http://bg.local:3000 (utöver Pi:ns eget namn, t.ex. raspberrypi.local).
# avahi-publish (paketet avahi-utils) publicerar namnet så länge det körs; -R hoppar över den omvända posten, som
# annars krockar med Pi:ns eget namn på samma adress. Körs av tjänsten bg-alias (se install.sh).
#
# Nätverkskortet: IFACE (install.sh sätter det till LAN_IFACE), annars det som standardvägen går genom (eth0 eller
# wlan0). Förut alltid eth0, så på en Pi med bara WiFi startade tjänsten om var tionde sekund utan att namnet fanns.
# Adressen kontrolleras var 30:e sekund: får Pi:n en ny adress av routern publiceras namnet på den nya.
iface=${IFACE:-$(ip -4 route show default 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "dev") { print $(i + 1); exit }}')}
iface=${iface:-eth0}
addr() { ip -4 -o addr show "$iface" 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1; }
pid=
trap '[ -n "$pid" ] && kill "$pid" 2>/dev/null; exit 0' INT TERM
while :; do
  ip=$(addr)
  if [ -z "$ip" ]; then echo "No IPv4 address on $iface yet" >&2; sleep 10; continue; fi
  echo "bg.local -> $ip ($iface)"
  avahi-publish -a -R bg.local "$ip" & pid=$!
  # Vänta tills adressen ändras eller avahi-publish slutar, och börja då om
  while kill -0 "$pid" 2>/dev/null && [ "$(addr)" = "$ip" ]; do sleep 30; done
  kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null; pid=
  sleep 2
done
