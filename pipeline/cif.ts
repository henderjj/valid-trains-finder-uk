// Parser for the timetable feed's CIF schedule file (.MCA): fixed-width, 80-character records.
// Layout follows the public CIF description on the Open Rail Data Wiki.

export type StpIndicator = 'C' | 'N' | 'O' | 'P';

export interface Call {
  tiploc: string;
  /** Public arrival, minutes after midnight; null if passengers cannot alight. */
  arr: number | null;
  /** Public departure, minutes after midnight; null if passengers cannot board. */
  dep: number | null;
  platform: string;
}

export interface Schedule {
  uid: string;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  /** Seven flags, Monday first. */
  days: string;
  stp: StpIndicator;
  /** P passenger, B bus, F freight, S ship, T trip; 1-5 are their short-term variants. */
  status: string;
  headcode: string;
  operator: string;
  calls: Call[];
}

export interface Tiploc {
  tiploc: string;
  crs: string;
  name: string;
}

export interface CifFile {
  schedules: Schedule[];
  tiplocs: Map<string, Tiploc>;
}

const field = (line: string, start: number, len: number) => line.substr(start, len).trim();

function cifDate(yymmdd: string): string {
  // CIF dates are yymmdd; 999999 means "no end date".
  if (yymmdd === '999999') return '2999-12-31';
  return `20${yymmdd.slice(0, 2)}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`;
}

/** Public times are HHMM; "0000" or blank means no public call. */
function publicTime(hhmm: string): number | null {
  if (!/^\d{4}$/.test(hhmm) || hhmm === '0000') return null;
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2, 4));
}

export function parseCif(text: string): CifFile {
  const parser = new CifParser();
  for (const line of text.split(/\r?\n/)) parser.line(line);
  return parser.result();
}

/** Line-at-a-time parser, so the full timetable (hundreds of MB) can be streamed. */
export class CifParser {
  private readonly schedules: Schedule[] = [];
  private readonly tiplocs = new Map<string, Tiploc>();
  private current: Schedule | null = null;

  result(): CifFile {
    return { schedules: this.schedules, tiplocs: this.tiplocs };
  }

  line(line: string): void {
    const { schedules, tiplocs } = this;
    let current = this.current;
    const type = line.slice(0, 2);
    switch (type) {
      case 'TI':
      case 'TA': {
        const tiploc = field(line, 2, 7);
        tiplocs.set(tiploc, { tiploc, crs: field(line, 53, 3), name: field(line, 18, 26) });
        break;
      }
      case 'BS': {
        current = null;
        // Deletions (D) only matter for incremental updates; the full extract has none to apply.
        if (line[2] === 'D') break;
        current = {
          uid: field(line, 3, 6),
          from: cifDate(line.substr(9, 6)),
          to: cifDate(line.substr(15, 6)),
          days: line.substr(21, 7),
          stp: line[79] as StpIndicator,
          status: line[29] ?? ' ',
          headcode: field(line, 32, 4),
          operator: '',
          calls: [],
        };
        schedules.push(current);
        break;
      }
      case 'BX':
        if (current) current.operator = field(line, 11, 2);
        break;
      case 'LO':
        current?.calls.push({
          tiploc: field(line, 2, 7),
          arr: null,
          dep: publicTime(line.substr(15, 4)),
          platform: field(line, 19, 3),
        });
        break;
      case 'LI': {
        // A pass time means the train does not stop here.
        if (!current || field(line, 20, 5)) break;
        const arr = publicTime(line.substr(25, 4));
        const dep = publicTime(line.substr(29, 4));
        if (arr === null && dep === null) break;
        current.calls.push({ tiploc: field(line, 2, 7), arr, dep, platform: field(line, 33, 3) });
        break;
      }
      case 'LT':
        current?.calls.push({
          tiploc: field(line, 2, 7),
          arr: publicTime(line.substr(15, 4)),
          dep: null,
          platform: field(line, 19, 3),
        });
        current = null;
        break;
    }
    this.current = current;
  }
}

const STP_PRIORITY: Record<StpIndicator, number> = { C: 3, O: 2, N: 1, P: 0 };

function runsOn(s: Schedule, date: string): boolean {
  if (date < s.from || date > s.to) return false;
  const dow = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  return s.days[dow] === '1';
}

/**
 * The schedules that actually run on a date. For each train UID the highest-priority
 * short-term-planning variant wins, and a cancellation (C) removes the train.
 */
export function schedulesForDate(schedules: Schedule[], date: string): Schedule[] {
  const best = new Map<string, Schedule>();
  for (const s of schedules) {
    if (!runsOn(s, date)) continue;
    const prev = best.get(s.uid);
    if (!prev || STP_PRIORITY[s.stp] > STP_PRIORITY[prev.stp]) best.set(s.uid, s);
  }
  return [...best.values()].filter((s) => s.stp !== 'C');
}

export interface Connection {
  from: string;
  to: string;
  dep: number;
  arr: number;
  uid: string;
}

/**
 * Break schedules into consecutive stop-to-stop legs, sorted by departure: the input the
 * Connection Scan Algorithm needs. Times past midnight continue beyond 1440.
 */
export function toConnections(schedules: Schedule[]): Connection[] {
  const out: Connection[] = [];
  for (const s of schedules) {
    let offset = 0;
    let last = -1;
    const at = (t: number) => {
      if (t + offset < last) offset += 1440;
      last = t + offset;
      return last;
    };
    let prev: { tiploc: string; dep: number } | null = null;
    for (const c of s.calls) {
      if (prev && c.arr !== null) {
        out.push({ from: prev.tiploc, to: c.tiploc, dep: prev.dep, arr: at(c.arr), uid: s.uid });
      }
      if (c.dep !== null) prev = { tiploc: c.tiploc, dep: at(c.dep) };
    }
  }
  return out.sort((a, b) => a.dep - b.dep || a.arr - b.arr);
}

/**
 * Minimum connection times, in minutes, by CRS code, from the master station names file
 * (.MSN). Station records ("A") hold the CRS code at columns 50-52 and the time at 64-65.
 */
export function parseChangeTimes(lines: Iterable<string>): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of lines) {
    if (!l.startsWith('A    ')) continue;
    const crs = l.slice(49, 52).trim();
    const time = l.slice(63, 65).trim();
    if (/^[A-Z]{3}$/.test(crs) && /^\d+$/.test(time) && !out.has(crs)) out.set(crs, Number(time));
  }
  return out;
}

/**
 * Station names by CRS code from the master station names file (.MSN): columns 6-35 of the
 * station record, which can be fuller than the timetable's 26-character location names.
 * A station's own record (interchange type 0-3) wins over its extra locations (type 9).
 */
export function parseStationNames(lines: Iterable<string>): Map<string, string> {
  const out = new Map<string, string>();
  const main = new Set<string>();
  for (const l of lines) {
    if (!l.startsWith('A    ')) continue;
    const crs = l.slice(49, 52).trim();
    const name = l.slice(5, 35).trim();
    if (!/^[A-Z]{3}$/.test(crs) || !name || main.has(crs)) continue;
    if (l[35] !== '9') main.add(crs);
    else if (out.has(crs)) continue;
    out.set(crs, name);
  }
  return out;
}
