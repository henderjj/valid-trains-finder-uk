// Published data formats and the direct-train query. Shared by the data pipeline (which
// writes these files) and the app (which reads them).

export interface Station {
  /** Three-letter CRS code, e.g. "LGE". */
  crs: string;
  name: string;
  /** Minimum minutes to change trains here, when the timetable gives one. */
  change?: number;
  /**
   * Tells apart stations that share a name: "main station", "other station" or "bus stop".
   * "all stations" marks a city's fare group (see `members`).
   */
  note?: string;
  /**
   * For a city's fare group, such as London Terminals, the CRS codes of its stations. `crs`
   * is then the group's fare location code, not a station code.
   */
  members?: string[];
}

/** The stations a place stands for: a group's members, or the station itself. */
export const stationCodes = (s: Station) => s.members ?? [s.crs];

/** A station's name with its note, if it has one, e.g. "Whitchurch (main station)". */
export const stationName = (s: Station) => (s.note ? `${s.name} (${s.note})` : s.name);

/**
 * One train on one day. `c` holds its public calls as flat triples of
 * [crs, arrival, departure], times in minutes after midnight of the file's date. Times can
 * be negative (the train started the day before) or 1440 and above (it runs past midnight).
 */
export interface DayTrain {
  /** Train UID from the timetable. */
  u: string;
  /** Operator code, e.g. "EM". */
  o: string;
  /** Headcode, e.g. "1F99". */
  h: string;
  /** 1 when this is a replacement or scheduled bus. */
  b?: 1;
  c: (string | number | null)[];
  /** Platform at each call ('' when not known); left out when no call has one. */
  p?: string[];
}

export interface DayFile {
  date: string;
  trains: DayTrain[];
}

export interface DataMeta {
  built: string;
  /** First and last dates that have a day file. */
  from: string;
  to: string;
}

export interface Stop {
  crs: string;
  arr: number | null;
  dep: number | null;
  /** Planned platform, when the timetable gives one. */
  platform?: string;
}

export interface DirectJourney {
  uid: string;
  operator: string;
  headcode: string;
  bus: boolean;
  dep: number;
  arr: number;
  /** Intermediate stops between the two stations. */
  stops: number;
  /** Every call from boarding to alighting, inclusive. */
  calls: Stop[];
}

/** One train ridden from boarding to alighting. */
export type Leg = DirectJourney;

/** A journey of one or more trains, changing between them. */
export interface Journey {
  legs: Leg[];
  dep: number;
  arr: number;
}

export function callsOf(train: DayTrain): Stop[] {
  const out: Stop[] = [];
  for (let i = 0; i < train.c.length; i += 3) {
    const stop: Stop = { crs: train.c[i] as string, arr: train.c[i + 1] as number | null, dep: train.c[i + 2] as number | null };
    const platform = train.p?.[i / 3];
    if (platform) stop.platform = platform;
    out.push(stop);
  }
  return out;
}

/**
 * Trains that call at `from` and later at `to`, departing `from` on the file's date
 * (00:00 to 23:59), sorted by departure time.
 */
export function findDirect(day: DayFile, from: string, to: string): DirectJourney[] {
  const out: DirectJourney[] = [];
  for (const train of day.trains) {
    const calls = callsOf(train);
    for (let i = 0; i < calls.length; i++) {
      const board = calls[i];
      if (board.crs !== from || board.dep === null || board.dep < 0 || board.dep >= 1440) continue;
      const j = calls.findIndex((c, k) => k > i && c.crs === to && c.arr !== null);
      if (j === -1) continue;
      out.push({
        uid: train.u,
        operator: train.o,
        headcode: train.h,
        bus: train.b === 1,
        dep: board.dep,
        arr: calls[j].arr!,
        stops: j - i - 1,
        calls: calls.slice(i, j + 1),
      });
      break;
    }
  }
  return out.sort((a, b) => a.dep - b.dep || a.arr - b.arr);
}

/** "0942" style clock time; wraps past midnight. */
export function clock(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}
