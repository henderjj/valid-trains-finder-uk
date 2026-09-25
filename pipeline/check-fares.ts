// Prints the walk-up fares between two stations and which journeys each is valid on,
// from the built data in public/data/. A quick way to check results against known cases.
// Usage: npm run data:check -- FROM TO [date YYYY-MM-DD, default the first built day]
import { existsSync, readFileSync } from 'node:fs';
import { describeTicketRules, fareValidity, faresBetween, restrictionSetFor, type FareFile, type FaresMeta, type RestrictionSet } from '../src/lib/fares.ts';
import { buildNetwork, planJourneys } from '../src/lib/planner.ts';
import { Routeing, type PermittedRoutes, type RouteingData } from '../src/lib/routeing.ts';
import { clock, type DataMeta, type DayFile, type Station } from '../src/lib/timetable.ts';

const DATA = 'public/data';
const read = <T>(path: string): T => JSON.parse(readFileSync(`${DATA}/${path}`, 'utf8')) as T;

const [from, to, dateArg] = process.argv.slice(2);
if (!from || !to) throw new Error('Usage: data:check -- FROM TO [date]');
const date = dateArg || read<DataMeta>('meta.json').from;
const meta = read<FaresMeta>('fares-meta.json');
const sets = read<RestrictionSet[]>('restrictions.json');
const stations = read<Station[]>('stations.json');
const names = new Map(stations.map((s) => [s.crs, s.name]));
const changeTimes = Object.fromEntries(stations.flatMap((s) => (s.change === undefined ? [] : [[s.crs, s.change]])));
const name = (crs: string) => names.get(crs) ?? crs;
const files = new Map<string, FareFile>();
for (const code of meta.locations[from] ?? []) {
  if (existsSync(`${DATA}/fares/${code}.json`)) files.set(code, read<FareFile>(`fares/${code}.json`));
}

const day = read<DayFile>(`days/${date}.json`);
const started = performance.now();
const net = buildNetwork(day);
const built = performance.now();
const journeys = planJourneys(net, day, from, to, { changeTimes });
const flat = planJourneys(net, day, from, to).length;
console.log(`Change times: ${name(from)} ${changeTimes[from] ?? '-'} min, ${name(to)} ${changeTimes[to] ?? '-'} min; ${journeys.length} journeys (${flat} with 5 minutes everywhere)`);
for (const j of journeys.filter((j) => j.legs.length > 1).slice(0, 5)) {
  const changes = j.legs.slice(1).map((l, i) => `${l.calls[0].crs} ${l.dep - j.legs[i].arr} min (needs ${changeTimes[l.calls[0].crs] ?? 5})`);
  const platforms = j.legs.map((l) => `${l.calls[0].platform ?? '?'}>${l.calls[l.calls.length - 1].platform ?? '?'}`);
  console.log(`  ${clock(j.dep)}-${clock(j.arr)} changes ${changes.join(', ')}; platforms ${platforms.join(' ')}`);
}
let routeing: Routeing | undefined;
if (existsSync(`${DATA}/routeing.json`)) {
  const data = read<RouteingData>('routeing.json');
  const routes = new Map<string, PermittedRoutes>();
  const codes = new Routeing(data, new Map()).routeFiles(from, to);
  for (const code of codes) if (existsSync(`${DATA}/routeing/${code}.json`)) routes.set(code, read<PermittedRoutes>(`routeing/${code}.json`));
  routeing = new Routeing(data, routes);
  const t = performance.now();
  const results = journeys.map((j) => routeing!.check(j));
  console.log(`Routeing points ${codes.join(',')}; checked ${journeys.length} journeys in ${(performance.now() - t).toFixed(0)} ms`);
  journeys.forEach((j, k) => {
    const r = results[k];
    const label = r.permitted === true ? 'permitted' : r.permitted === false ? 'NOT PERMITTED' : 'unknown';
    if (j.legs.length > 1) console.log(`  ${label}: ${clock(j.dep)}-${clock(j.arr)} ${j.legs.map((l) => l.calls[0].crs).join(' > ')} > ${to} (${r.why})`);
  });
}
console.log(`Network ${(built - started).toFixed(0)} ms, search ${(performance.now() - built).toFixed(0)} ms`);
const set = restrictionSetFor(sets, date);
console.log(`${name(from)} → ${name(to)} on ${date}: ${journeys.length} journeys; fare codes ${meta.locations[from]} → ${meta.locations[to]}`);
for (const f of faresBetween(meta, files, from, to)) {
  const r = f.restriction ? set?.restrictions[f.restriction] : undefined;
  console.log(`\n${f.ticket} ${f.type.name} £${(f.pence / 100).toFixed(2)} route ${f.route} (${f.routeName}) restriction ${f.restriction || '-'} ${r ? `"${r.desc}" ${r.out}` : ''}`);
  console.log(`  Rules: ${describeTicketRules(f.type) || 'none in the feed'}`);
  for (const j of journeys) {
    const v = fareValidity(j, f, set, date, 'O', name, routeing);
    console.log(`  ${clock(j.dep)}-${clock(j.arr)} ${j.legs.map((l) => `${l.operator} ${l.calls[0].crs}`).join(' > ')} ${v.valid ? 'valid' : 'NOT valid'}${v.reason ? `: ${v.reason}` : ''}`);
  }
}

if (process.env.LIST_ROUTES) {
  console.log('\nOperator-limited routes:');
  for (const [code, desc] of Object.entries(meta.routes)) if (/ONLY|NOT|EXCL/.test(desc)) console.log(`  ${code} ${desc}`);
}
