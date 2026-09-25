# Temporary check.
set -u
m() { unzip -p data/raw/$1.zip "*.$2"; }
echo "== TOC"; m fares TOC | grep -v '^/' | cat -A | head -120
echo "== timetable operator codes"; m timetable MCA | grep '^BX' | cut -c12-13 | sort | uniq -c | sort -rn
echo "== RTE ONLY/NOT descriptions"; m fares RTE | grep '^RR' | cut -c32-47 | grep -E 'ONLY|NOT|EXC' | sort -u
