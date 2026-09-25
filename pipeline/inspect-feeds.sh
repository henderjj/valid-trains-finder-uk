# Temporary spike: prints feed structure for connection times, platforms and ticket rules.
set -u
for z in timetable fares; do echo "== $z members"; unzip -l data/raw/$z.zip; done
m() { unzip -p data/raw/$1.zip "*.$2"; }
echo "== MSN head"; m timetable MSN | head -8
echo "== MSN stations"; m timetable MSN | grep -E '^A' | grep -E ' (LGE|DBY|MAN|KGX|CLP|BHM|NCL|RDG|SHF|PBO|EDB|CLJ|EUS|STP|XXX)[ 0-9]' | head -30
echo "== MSN change-time distribution"; m timetable MSN | grep -E '^A' | cut -c64-65 | sort | uniq -c | sort -rn | head -20
echo "== MSN record types"; m timetable MSN | cut -c1 | sort | uniq -c
for x in ALF FLF ZTR TSI; do echo "== $x"; m timetable $x | head -12; m timetable $x | wc -l; done
echo "== TSI grep"; m timetable TSI | grep -E '^(DBY|MAN|KGX|CLJ)' | head
echo "== MCA platform sample"; m timetable MCA | grep -E '^L[OIT]DRBY' | head -5
echo "== MCA platform presence (LI with platform)"; m timetable MCA | grep -E '^LI' | head -200000 | cut -c34-36 | awk '{if($0 ~ /[^ ]/) p++; else n++} END {print "with", p, "without", n}'
for x in TVL TTY TAP DIS NFO RLC TJS; do echo "== $x"; m fares $x | grep -v '^/' | head -15; m fares $x | wc -l; done
echo "== TVL all"; m fares TVL | grep -v '^/' | head -120
echo "== TTY for common tickets"; m fares TTY | grep -E 'SDS|SOS|SVR|SOR|CDR|CDS|SSS|SOR|OPR|OPS|GPR|GTR' | head -30
echo "== RST record types"; m fares RST | grep -v '^/' | cut -c1-4 | sort | uniq -c | head -40
echo "== RST sample RH/RD"; m fares RST | grep -E '^R[CH]' | head -10
