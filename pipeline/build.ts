// Phase 0 spike: turn the downloaded timetable into per-day connection files and report
// their sizes, to decide whether the fully static approach holds up.
// Usage: npm run data:build -- [startDate YYYY-MM-DD] [days]
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { gzipSync } from 'node:zlib';
import { CifParser, schedulesForDate, toConnections, type CifFile } from './cif.ts';

const OUT = 'data/site';

async function readTimetable(zip: string): Promise<CifFile> {
  // Stream the .MCA member through unzip: it is far too large to hold as one string.
  const unzip = spawn('unzip', ['-p', zip, '*.MCA'], { stdio: ['ignore', 'pipe', 'inherit'] });
  const parser = new CifParser();
  for await (const line of createInterface({ input: unzip.stdout, crlfDelay: Infinity })) parser.line(line);
  const code: number = await new Promise((resolve) => unzip.on('close', resolve));
  if (code !== 0) throw new Error(`unzip exited with code ${code}`);
  return parser.result();
}

/** Columnar encoding: stations and trains by index, legs as a flat number array. */
export function encodeDay(legs: ReturnType<typeof toConnections>) {
  const stations: string[] = [];
  const trains: string[] = [];
  const stationIdx = new Map<string, number>();
  const trainIdx = new Map<string, number>();
  const index = (map: Map<string, number>, list: string[], key: string) => {
    let i = map.get(key);
    if (i === undefined) map.set(key, (i = list.push(key) - 1));
    return i;
  };
  const c: number[] = [];
  for (const l of legs) {
    c.push(index(stationIdx, stations, l.from), index(stationIdx, stations, l.to), l.dep, l.arr, index(trainIdx, trains, l.uid));
  }
  return { stations, trains, c };
}

const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;

async function main() {
  const start = process.argv[2] ?? new Date().toISOString().slice(0, 10);
  const days = Number(process.argv[3] ?? 7);
  const cif = await readTimetable('data/raw/timetable.zip');
  console.log(`Parsed ${cif.schedules.length} schedules, ${cif.tiplocs.size} TIPLOCs`);

  await mkdir(`${OUT}/connections`, { recursive: true });
  const stations = [...cif.tiplocs.values()].filter((t) => t.crs);
  await writeFile(`${OUT}/stations.json`, JSON.stringify(stations));

  console.log('date        trains   legs     raw      gzip');
  for (let d = 0; d < days; d++) {
    const date = new Date(Date.parse(`${start}T12:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
    const running = schedulesForDate(cif.schedules, date);
    const legs = toConnections(running);
    const json = JSON.stringify(encodeDay(legs));
    await writeFile(`${OUT}/connections/${date}.json`, json);
    const gz = gzipSync(json).length;
    console.log(`${date}  ${String(running.length).padStart(6)}  ${String(legs.length).padStart(7)}  ${kb(json.length).padStart(7)}  ${kb(gz).padStart(7)}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
