// Builds the data files the app reads, into public/data/ (git-ignored):
//   stations.json, meta.json and days/YYYY-MM-DD.json for each day in range.
// Usage: npm run data:build -- [startDate YYYY-MM-DD, default today in the UK] [days, default 28]
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { gzipSync } from 'node:zlib';
import type { DataMeta } from '../src/lib/timetable.ts';
import { CifParser, type CifFile } from './cif.ts';
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

const ukToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;

async function main() {
  const start = process.argv[2] || ukToday();
  const days = Number(process.argv[3] || 28);
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

  const stations = buildStations(cif, served);
  await writeFile(`${OUT}/stations.json`, JSON.stringify(stations));
  const meta: DataMeta = { built: new Date().toISOString(), from: start, to: addDays(start, days - 1) };
  await writeFile(`${OUT}/meta.json`, JSON.stringify(meta));
  console.log(`${stations.length} stations`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
