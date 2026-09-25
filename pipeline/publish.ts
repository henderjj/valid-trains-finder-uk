// Turns parsed timetable data into the published day files and station list.
import type { DayFile, DayTrain, Station } from '../src/lib/timetable.ts';
import { schedulesForDate, type CifFile, type Schedule } from './cif.ts';

/** Passenger trains and buses, including their short-term-planning variants. */
const PASSENGER = new Set(['P', '1', 'B', '5']);
const BUS = new Set(['B', '5']);

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Calls as flat [crs, arr, dep] triples, with times made continuous across midnight. */
function encodeCalls(s: Schedule, crsOf: Map<string, string>, shift: number): DayTrain['c'] {
  const out: DayTrain['c'] = [];
  let offset = 0;
  let last = -Infinity;
  const at = (t: number | null) => {
    if (t === null) return null;
    if (t + offset < last) offset += 1440;
    last = t + offset;
    return last + shift;
  };
  for (const call of s.calls) {
    const arr = at(call.arr);
    const dep = at(call.dep);
    const crs = crsOf.get(call.tiploc);
    if (!crs) continue;
    const n = out.length;
    if (n && out[n - 3] === crs) {
      // Two timing points at one station: keep the first arrival and the last departure.
      out[n - 1] = dep;
      continue;
    }
    out.push(crs, arr, dep);
  }
  return out;
}

function toDayTrain(s: Schedule, crsOf: Map<string, string>, shift: number): DayTrain | null {
  if (!PASSENGER.has(s.status)) return null;
  const c = encodeCalls(s, crsOf, shift);
  if (c.length < 6) return null;
  const train: DayTrain = { u: s.uid, o: s.operator, h: s.headcode, c };
  if (BUS.has(s.status)) train.b = 1;
  return train;
}

/**
 * Everything running on `date`, plus trains that started the day before and are still
 * running after midnight (with their times shifted back a day).
 */
export function buildDay(cif: CifFile, date: string, crsOf: Map<string, string>): DayFile {
  const trains: DayTrain[] = [];
  for (const s of schedulesForDate(cif.schedules, date)) {
    const t = toDayTrain(s, crsOf, 0);
    if (t) trains.push(t);
  }
  for (const s of schedulesForDate(cif.schedules, addDays(date, -1))) {
    const t = toDayTrain(s, crsOf, -1440);
    // Keep it only if it still calls somewhere after midnight.
    if (t && t.c.some((v, i) => i % 3 !== 0 && typeof v === 'number' && v >= 0)) trains.push(t);
  }
  return { date, trains };
}

export function crsByTiploc(cif: CifFile): Map<string, string> {
  const map = new Map<string, string>();
  for (const t of cif.tiplocs.values()) if (t.crs) map.set(t.tiploc, t.crs);
  return map;
}

const KEEP_UPPER = new Set(['UK', 'DLR', 'NHS', 'II', 'III']);

/** "LONG EATON" -> "Long Eaton"; keeps a few abbreviations upper case. */
export function titleCase(name: string): string {
  return name
    .toLowerCase()
    .replace(/[a-z][a-z']*/g, (w) => (KEEP_UPPER.has(w.toUpperCase()) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)));
}

/** One entry per CRS code that trains actually call at, sorted by name. */
export function buildStations(cif: CifFile, served: Set<string>): Station[] {
  const byCrs = new Map<string, Station>();
  for (const t of cif.tiplocs.values()) {
    if (!t.crs || !served.has(t.crs) || byCrs.has(t.crs)) continue;
    byCrs.set(t.crs, { crs: t.crs, name: titleCase(t.name) });
  }
  return [...byCrs.values()].sort((a, b) => a.name.localeCompare(b.name));
}
