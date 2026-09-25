# Temporary check: real-data results for change times, platforms and ticket rules.
set -u
D=public/data
node -e "const s=require('./$D/stations.json'); for (const c of ['LGE','DBY','MAN','CLJ','BHM','KGX','YRK','CRE','RDG','EDB']) console.log(JSON.stringify(s.find(x=>x.crs===c)))"
node -e "const t=require('./$D/fares-meta.json').tickets; for (const [k,v] of Object.entries(t)) if (['SOR','SVR','CDR','SOS','SVS','CDS','SSR','SSS','OPR','OPS','GPR','GPS','FOR','FSR'].includes(k)) console.log(k, JSON.stringify(v))"
node -e "const d=require('./$D/days/2026-09-28.json'); const w=d.trains.filter(t=>t.p).length; console.log('trains with platforms', w, 'of', d.trains.length)"
ls -la $D/days | head -4; du -sh $D/days
for r in "LGE SHF" "LGE MAN" "NRW BHM" "KGX EDB"; do echo "=== $r"; npm run -s data:check -- $r 2026-09-29 | grep -vE '^\s+[0-9]{2}:[0-9]{2}-.*(valid|NOT valid)' | head -60; done
