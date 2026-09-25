// Prints the walk-up fares between two stations and which direct trains each is valid on,
// from the built data in public/data/. A quick way to check results against known cases.
// Usage: npm run data:check -- FROM TO [date YYYY-MM-DD, default the first built day]
import { existsSync, readFileSync } from 'node:fs';
import { fareValidity, faresBetween, restrictionSetFor, type FareFile, type FaresMeta, type RestrictionSet } from '../src/lib/fares.ts';
import { clock, findDirect, type DataMeta, type DayFile, type Station } from '../src/lib/timetable.ts';

const DATA = 'public/data';
const read = <T>(path: string): T => JSON.parse(readFileSync(`${DATA}/${path}`, 'utf8')) as T;

const [from, to, dateArg] = process.argv.slice(2);
if (!from || !to) throw new Error('Usage: data:check -- FROM TO [date]');
const date = dateArg || read<DataMeta>('meta.json').from;
const meta = read<FaresMeta>('fares-meta.json');
const sets = read<RestrictionSet[]>('restrictions.json');
const names = new Map(read<Station[]>('stations.json').map((s) => [s.crs, s.name]));
const name = (crs: string) => names.get(crs) ?? crs;
const files = new Map<string, FareFile>();
for (const code of meta.locations[from] ?? []) {
  if (existsSync(`${DATA}/fares/${code}.json`)) files.set(code, read<FareFile>(`fares/${code}.json`));
}

const journeys = findDirect(read<DayFile>(`days/${date}.json`), from, to);
const set = restrictionSetFor(sets, date);
console.log(`${name(from)} → ${name(to)} on ${date}: ${journeys.length} direct trains; fare codes ${meta.locations[from]} → ${meta.locations[to]}`);
for (const f of faresBetween(meta, files, from, to)) {
  const r = f.restriction ? set?.restrictions[f.restriction] : undefined;
  console.log(`\n${f.ticket} ${f.type.name} £${(f.pence / 100).toFixed(2)} route ${f.route} (${f.routeName}) restriction ${f.restriction || '-'} ${r ? `"${r.desc}" ${r.out}` : ''}`);
  for (const j of journeys) {
    const v = fareValidity(j, f, set, date, 'O', name);
    console.log(`  ${clock(j.dep)} ${j.operator} ${v.valid ? 'valid' : 'NOT valid'}${v.reason ? `: ${v.reason}` : ''}`);
  }
}

if (process.env.LIST_ROUTES) {
  console.log('\nOperator-limited routes:');
  for (const [code, desc] of Object.entries(meta.routes)) if (/ONLY|NOT|EXCL/.test(desc)) console.log(`  ${code} ${desc}`);
}
