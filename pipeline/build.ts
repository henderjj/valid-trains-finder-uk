// Builds the data files the app reads, into public/data/ (git-ignored):
//   stations.json, meta.json and days/YYYY-MM-DD.json for each day in range, and, when the
//   fares feed has been downloaded, fares-meta.json, restrictions.json and fares/<code>.json,
//   and when the routeing guide has, routeing.json and routeing/<routeing point>.json.
// Usage: npm run data:build -- [startDate YYYY-MM-DD, default today in the UK] [days, default 84]
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { gzipSync } from 'node:zlib';
import type { FaresMeta } from '../src/lib/fares.ts';
import type { DataMeta } from '../src/lib/timetable.ts';
import { CifParser, parseChangeTimes, type CifFile } from './cif.ts';
import { parseFares, parseLocations, parseRestrictions, parseRoutes, parseTicketTypes, parseValidities } from './fares.ts';
import { parsePermittedRoutes, parseRouteing } from './routeing.ts';
import { addDays, buildDay, buildStations, crsByTiploc } from './publish.ts';

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

/** Walk-up fares current on `date`, as one file per origin fare location code. */
async function buildFares(zip: string, date: string) {
  const tickets = parseTicketTypes(member(zip, 'TTY'), date, parseValidities(member(zip, 'TVL'), date));
  const { files, routes, restrictions } = parseFares(member(zip, 'FFL'), tickets, date);
  const meta: FaresMeta = {
    locations: parseLocations(member(zip, 'LOC'), member(zip, 'FSC'), date),
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
  await writeFile(`${OUT}/restrictions.json`, JSON.stringify(parseRestrictions(member(zip, 'RST'), restrictions)));
  console.log(
    `Fares: ${Object.keys(tickets).length} ticket types (${Object.values(tickets).filter((t) => t.valid).length} with validity), ${files.size} origin files, ${kb(raw)} raw, ${kb(gz)} gzip; ` +
      `${Object.keys(meta.locations).length} stations, ${restrictions.size} restriction codes`,
  );
}

async function buildRouteing(zip: string) {
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

  console.log('date        trains     raw      gzip');
  for (let d = 0; d < days; d++) {
    const date = addDays(start, d);
    const day = buildDay(cif, date, crsOf);
    for (const t of day.trains) for (let i = 0; i < t.c.length; i += 3) served.add(t.c[i] as string);
    const json = JSON.stringify(day);
    await writeFile(`${OUT}/days/${date}.json`, json);
    console.log(`${date}  ${String(day.trains.length).padStart(6)}  ${kb(json.length).padStart(7)}  ${kb(gzipSync(json).length).padStart(7)}`);
  }

  // Stations without a minimum connection time use the planner's default.
  let changeTimes = new Map<string, number>();
  try {
    changeTimes = parseChangeTimes(member('data/raw/timetable.zip', 'MSN'));
  } catch (err) {
    console.log(`No station change times: ${(err as Error).message}`);
  }
  const stations = buildStations(cif, served, changeTimes);
  await writeFile(`${OUT}/stations.json`, JSON.stringify(stations));
  const unusual = stations.filter((s) => s.change !== undefined && (s.change < 2 || s.change > 15));
  console.log(`Change times: ${stations.filter((s) => s.change !== undefined).length} stations; unusual: ${unusual.map((s) => `${s.crs} ${s.change}`).join(', ')}`);
  const meta: DataMeta = { built: new Date().toISOString(), from: start, to: addDays(start, days - 1) };
  await writeFile(`${OUT}/meta.json`, JSON.stringify(meta));
  console.log(`${stations.length} stations`);

  const faresZip = 'data/raw/fares.zip';
  if (existsSync(faresZip)) await buildFares(faresZip, start);
  else console.log('No fares feed downloaded; skipping fares');

  const routeingZip = 'data/raw/routeing.zip';
  if (existsSync(routeingZip)) await buildRouteing(routeingZip);
  else console.log('No routeing guide downloaded; skipping routeing');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
