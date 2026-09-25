# Temporary spike: prints feed structure for connection times, platforms and ticket rules.
set -u
m() { unzip -p data/raw/$1.zip "*.$2"; }
echo "== MSN long change times"; m timetable MSN | grep -E '^A' | awk '{ t=substr($0,64,2)+0; if (t>=15 || t<=2) print }' | head -80
echo "== MSN non-A samples"; m timetable MSN | grep -E '^[LZEM0-]' | head -12
echo "== RRH samples"; m fares RST | grep -E '^RRH' | head -6 | cat -A | cut -c1-240
echo "== RRH columns 136+"; m fares RST | grep -E '^RRHC' | cut -c137-160 | sort | uniq -c | sort -rn | head -20
echo "== RRH line lengths"; m fares RST | grep -E '^RRHC' | awk '{print length($0)}' | sort | uniq -c
echo "== RRR samples"; m fares RST | grep -E '^RRRC' | head -8
echo "== RCA/REC samples"; m fares RST | grep -E '^RECC' | head -5
echo "== walk-up TTY validity codes"; m fares TTY | grep -E '^R' | awk '{ d=substr($0,29,15); v=substr($0,77,2); if (d ~ /ANYTIME|OFF-PEAK|OFF PEAK|SUP OFF|SUPER OFF|OFFPEAK/ && d !~ /ADVANCE|SEASON|GROUP|CARNET|FLEXI|TEST/) print v, d }' | sort | uniq -c | sort -rn | head -60
echo "== TVL for those codes"; m fares TVL | grep -E '^(72|85|88|41|40|87|81|13|10|11|12|20|28|03)'
