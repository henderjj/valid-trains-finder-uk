// Builds the data files the app reads, into public/data/ (git-ignored):
//   stations.json, meta.json and days/YYYY-MM-DD.json for each day in range, and, when the
//   fares feed has been downloaded, fares-meta.json, restrictions.json, operators.json and fares/<code>.json,
//   and when the routeing guide has, routeing.json and routeing/<routeing point>.json.
// It then checks the data looks complete (pipeline/checks.ts) and fails if not, so a broken
// feed is never published. Set DATA_CHECKS=warn to build from partial or sample feeds.
// Usage: npm run data:build -- [startDate YYYY-MM-DD, default today in the UK] [days, default 84]
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { gzipSync } from 'node:zlib';
import type { FaresMeta } from '../src/lib/fares.ts';
import type { DataMeta, Station } from '../src/lib/timetable.ts';
import { CifParser, parseChangeTimes, parseStationNames, type CifFile } from './cif.ts';
import { routeOperators } from '../src/lib/fares.ts';
import { operatorName, registerOperators } from '../src/lib/operators.ts';
import { annotations, checkData, summary, type BuildSummary } from './checks.ts';
import { parseFareGroups, parseFares, parseLocations, parseOperators, parseRestrictions, parseRoutes, parseTicketTypes, parseValidities } from './fares.ts';
import { parsePermittedRoutes, parseRouteing } from './routeing.ts';
import { addDays, buildDay, buildGroups, buildStations, crsByTiploc, titleCase } from './publish.ts';

const OUT = 'public/data';

async function readTimetable(zip: string): Promise<CifFile> {
  // Stream the .MCA member through unzip: it is far too large to hold as one string.
  const unzip = spawn('unzip', ['-p', zip, '*.MCA'], { stdio: ['ignore', 'pipe', 'inherit'] });
  const parser = new CifParser();
  for await (const line of createInterface({ input: unzip.stdout, crlfDelay: Infinity })) parser.line(line);
  const code: number = await new Promise((resolve) => unzip.on('close', resolve));
  if (code !== 0) throw new Error(`unzip exited with code ${code}`);
  return parser.result();
}

/** Lines of the feed zip member with this extension, without comment lines. */
function member(zip: string, ext: string): string[] {
  const unzip = (...args: string[]) => execFileSync('unzip', args, { maxBuffer: 2 ** 30, encoding: 'latin1' });
  const name = unzip('-Z1', zip)
    .split('\n')
    .find((n) => n.endsWith(`.${ext}`));
  if (!name) throw new Error(`No .${ext} file in ${zip}`);
  return unzip('-p', zip, name)
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('/'));
}

/** Like member(), but an empty list (and a note) when the feed has no such file. */
function optionalMember(zip: string, ext: string): string[] {
  try {
    return member(zip, ext);
  } catch (err) {
    console.log(`${(err as Error).message}; carrying on without it`);
    return [];
  }
}

/** Walk-up fares current on `date`, as one file per origin fare location code. */
async function buildFares(zip: string, date: string, stations: Station[]): Promise<{ summary: NonNullable<BuildSummary['fares']>; routes: Record<string, string> }> {
  // Operator names first, so route descriptions naming a new operator can be read.
  const operators = parseOperators(optionalMember(zip, 'TOC'), titleCase);
  registerOperators(operators);
  await writeFile(`${OUT}/operators.json`, JSON.stringify(operators));
  const tickets = parseTicketTypes(member(zip, 'TTY'), date, parseValidities(optionalMember(zip, 'TVL'), date));
  const { files, routes, restrictions } = parseFares(member(zip, 'FFL'), tickets, date);
  const loc = member(zip, 'LOC');
  const meta: FaresMeta = {
    locations: parseLocations(loc, member(zip, 'FSC'), date),
    tickets,
    routes: parseRoutes(member(zip, 'RTE'), routes, date),
  };
  await mkdir(`${OUT}/fares`, { recursive: true });
  let raw = 0;
  let gz = 0;
  for (const [code, file] of files) {
    const json = JSON.stringify(file);
    raw += json.length;
    gz += gzipSync(json).length;
    await writeFile(`${OUT}/fares/${code}.json`, json);
  }
  await writeFile(`${OUT}/fares-meta.json`, JSON.stringify(meta));
  // Cities' fare groups, offered as "all stations" places.
  const groups = buildGroups(parseFareGroups(loc, date), stations);
  await writeFile(`${OUT}/groups.json`, JSON.stringify(groups));
  console.log(`Station groups: ${groups.map((g) => `${g.name} ${g.crs} (${g.members.join(' ')})`).join(', ')}`);
  await writeFile(`${OUT}/restrictions.json`, JSON.stringify(parseRestrictions(member(zip, 'RST'), restrictions)));
  console.log(
    `Fares: ${Object.keys(tickets).length} ticket types (${Object.values(tickets).filter((t) => t.valid).length} with validity), ${files.size} origin files, ${kb(raw)} raw, ${kb(gz)} gzip; ` +
      `${Object.keys(meta.locations).length} stations, ${restrictions.size} restriction codes, ${Object.keys(operators).length} operator names`,
  );
  return {
    summary: { ticketTypes: Object.keys(tickets), originFiles: files.size, restrictionCodes: restrictions.size },
    routes: meta.routes,
  };
}

async function buildRouteing(zip: string): Promise<{ summary: NonNullable<BuildSummary['routeing']>; fareRoutes: Set<string> }> {
  const data = parseRouteing({
    stations: member(zip, 'RGS'),
    groups: member(zip, 'RGG'),
    points: member(zip, 'RGP'),
    nodes: member(zip, 'RGN'),
    links: member(zip, 'RGL'),
    distances: member(zip, 'RGD'),
    london: member(zip, 'RGC'),
    newStations: member(zip, 'RGX'),
    fareRoutes: member(zip, 'RGK'),
  });
  const routes = parsePermittedRoutes(member(zip, 'RGR'));
  await mkdir(`${OUT}/routeing`, { recursive: true });
  let gz = 0;
  for (const [point, byDest] of routes) {
    const json = JSON.stringify(byDest);
    gz += gzipSync(json).length;
    await writeFile(`${OUT}/routeing/${point}.json`, json);
  }
  const json = JSON.stringify(data);
  await writeFile(`${OUT}/routeing.json`, json);
  console.log(
    `Routeing: ${Object.keys(data.stations).length} stations, ${data.points.length} routeing points, ` +
      `${Object.keys(data.fareRoutes).length} fare routes, London group ${data.london}, ` +
      `${kb(json.length)} (${kb(gzipSync(json).length)} gzip); ${routes.size} route files, ${kb(gz)} gzip`,
  );
  return {
    summary: { points: data.points.length, fareRoutes: Object.keys(data.fareRoutes).length },
    fareRoutes: new Set(Object.keys(data.fareRoutes)),
  };
}

const ukToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;

async function main() {
  const start = process.argv[2] || ukToday();
  const days = Number(process.argv[3] || 84);
  const cif = await readTimetable('data/raw/timetable.zip');
  console.log(`Parsed ${cif.schedules.length} schedules, ${cif.tiplocs.size} TIPLOCs`);

  await rm(OUT, { recursive: true, force: true });
  await mkdir(`${OUT}/days`, { recursive: true });
  const crsOf = crsByTiploc(cif);
  const served = new Set<string>();
  const trainCalls = new Map<string, number>();
  const operators = new Set<string>();
  const dayCounts: BuildSummary['days'] = [];

  console.log('date        trains     raw      gzip');
  for (let d = 0; d < days; d++) {
    const date = addDays(start, d);
    const day = buildDay(cif, date, crsOf);
    for (const t of day.trains) {
      operators.add(t.o);
      for (let i = 0; i < t.c.length; i += 3) {
        const crs = t.c[i] as string;
        served.add(crs);
        if (!t.b) trainCalls.set(crs, (trainCalls.get(crs) ?? 0) + 1);
      }
    }
    dayCounts.push({ date, trains: day.trains.length });
    const json = JSON.stringify(day);
    await writeFile(`${OUT}/days/${date}.json`, json);
    console.log(`${date}  ${String(day.trains.length).padStart(6)}  ${kb(json.length).padStart(7)}  ${kb(gzipSync(json).length).padStart(7)}`);
  }

  // Stations without a minimum connection time use the planner's default.
  const msn = optionalMember('data/raw/timetable.zip', 'MSN');
  const changeTimes = parseChangeTimes(msn);
  const stations = buildStations(cif, served, { changeTimes, names: parseStationNames(msn), trainCalls });
  await writeFile(`${OUT}/stations.json`, JSON.stringify(stations));
  const unusual = stations.filter((s) => s.change !== undefined && (s.change < 2 || s.change > 15));
  console.log(`Change times: ${stations.filter((s) => s.change !== undefined).length} stations; unusual: ${unusual.map((s) => `${s.crs} ${s.change}`).join(', ')}`);
  const meta: DataMeta = { built: new Date().toISOString(), from: start, to: addDays(start, days - 1) };
  await writeFile(`${OUT}/meta.json`, JSON.stringify(meta));
  console.log(`${stations.length} stations`);
  const noted = stations.filter((s) => s.note);
  console.log(`Stations sharing a name: ${noted.map((s) => `${s.name} ${s.crs} (${s.note})`).join(', ') || 'none'}`);

  const faresZip = 'data/raw/fares.zip';
  const fares = existsSync(faresZip) ? await buildFares(faresZip, start, stations) : undefined;
  if (!fares) console.log('No fares feed downloaded; skipping fares');

  const routeingZip = 'data/raw/routeing.zip';
  const routeing = existsSync(routeingZip) ? await buildRouteing(routeingZip) : undefined;
  if (!routeing) console.log('No routeing guide downloaded; skipping routeing');

  // Routes that limit operators in words the app can't read, and that the routeing guide
  // has no data for, can't be checked at all. A few name no train operator at all: fares
  // not for travel, and West Midlands Metro trams, which aren't in the rail timetable.
  const noOperator = /^(?:NOT FOR TRAVEL|DO NOT USE|NOT TO BE USED|MID METRO ONLY)$/;
  const unreadableRoutes = Object.entries(fares?.routes ?? {})
    .filter(([code, desc]) => routeOperators(desc).unread && !routeing?.fareRoutes.has(code) && !noOperator.test(desc.trim()))
    .map(([code, desc]) => `${desc} (${code})`);
  const result = checkData({
    days: dayCounts,
    stations: stations.length,
    changeTimes: changeTimes.size,
    fares: fares?.summary,
    routeing: routeing?.summary,
    unnamedOperators: [...operators].filter((o) => operatorName(o) === o).sort(),
    unreadableRoutes,
  });
  for (const line of annotations(result)) console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary(result));
  if (result.errors.length && process.env.DATA_CHECKS !== 'warn') {
    throw new Error(`${result.errors.length} data check(s) failed, so this data won't be published`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
