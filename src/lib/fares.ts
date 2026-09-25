// Published fares formats, fare lookup and ticket validity checking. Shared by the data
// pipeline (which writes the files) and the app (which reads them).
import { operatorName, operatorsNamed } from './operators.ts';
import type { DirectJourney } from './timetable.ts';

export type TicketKind = 'anytime' | 'offpeak' | 'superoffpeak';

export interface TicketType {
  name: string;
  kind: TicketKind;
  /** 1 first class, 2 standard. */
  cls: 1 | 2;
  ret: boolean;
}

/** fares/<code>.json: destination code -> [route, ticket code, pence, restriction code]. */
export type FareFile = Record<string, [string, string, number, string][]>;

export interface FaresMeta {
  /** Fare location codes for each station, most specific first: station, fare group, clusters. */
  locations: Record<string, string[]>;
  tickets: Record<string, TicketType>;
  routes: Record<string, string>;
}

/** Date band: month-day range (MMDD, inclusive) and Monday-first day flags. */
export interface DateBand {
  from: string;
  to: string;
  days: string;
}

export interface TimeWindow {
  dir: 'O' | 'R';
  /** Minutes after midnight, inclusive. */
  from: number;
  to: number;
  /** D departs, A arrives, V passes through. */
  at: 'D' | 'A' | 'V';
  /** CRS of the station the window applies at; empty means the journey's origin or destination. */
  crs: string;
  /** Only trains of these operators; empty means all. */
  tocs: string[];
  /** Only on these dates; empty means whenever the restriction applies. */
  dates: DateBand[];
}

export interface TrainRule {
  dir: 'O' | 'R';
  uid: string;
  /** Only when boarding (D), alighting (A) or either (B) at these stations; empty means anywhere. */
  at: [string, 'A' | 'D' | 'B'][];
  dates: DateBand[];
}

export interface Restriction {
  desc: string;
  out: string;
  rtn: string;
  /** How listed trains apply per direction: N not valid on them, P valid on them. */
  trainsOut: 'N' | 'P';
  trainsRtn: 'N' | 'P';
  /** When the restriction applies at all; empty means every day. */
  dates: DateBand[];
  windows: TimeWindow[];
  trains: TrainRule[];
}

export interface RestrictionSet {
  /** YYYY-MM-DD, inclusive. */
  from: string;
  to: string;
  restrictions: Record<string, Restriction>;
}

export interface FareOption {
  ticket: string;
  type: TicketType;
  pence: number;
  restriction: string;
  route: string;
  routeName: string;
}

/**
 * The fares on offer between two stations. Where the same ticket and route is priced at
 * several levels (station, fare group, cluster), the most specific pair wins.
 */
export function faresBetween(meta: FaresMeta, files: Map<string, FareFile>, from: string, to: string): FareOption[] {
  const origins = meta.locations[from] ?? [];
  const dests = meta.locations[to] ?? [];
  const best = new Map<string, { rank: number; option: FareOption }>();
  origins.forEach((o, oi) => {
    const file = files.get(o);
    if (!file) return;
    dests.forEach((d, di) => {
      for (const [route, ticket, pence, restriction] of file[d] ?? []) {
        const type = meta.tickets[ticket];
        if (!type) continue;
        const key = `${ticket}/${route}`;
        const rank = oi + di;
        const prev = best.get(key);
        if (!prev || rank < prev.rank || (rank === prev.rank && pence < prev.option.pence)) {
          best.set(key, { rank, option: { ticket, type, pence, restriction, route, routeName: meta.routes[route] ?? route } });
        }
      }
    });
  });
  const kindOrder: TicketKind[] = ['superoffpeak', 'offpeak', 'anytime'];
  return [...best.values()]
    .map((b) => b.option)
    .sort(
      (a, b) =>
        b.type.cls - a.type.cls ||
        Number(a.type.ret) - Number(b.type.ret) ||
        kindOrder.indexOf(a.type.kind) - kindOrder.indexOf(b.type.kind) ||
        a.pence - b.pence,
    );
}

export function restrictionSetFor(sets: RestrictionSet[], date: string): RestrictionSet | undefined {
  return sets.find((s) => s.from <= date && date <= s.to);
}

function inBands(bands: DateBand[], date: string): boolean {
  if (!bands.length) return true;
  const mmdd = date.slice(5, 7) + date.slice(8, 10);
  const dow = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
  return bands.some((b) => {
    const inRange = b.from <= b.to ? mmdd >= b.from && mmdd <= b.to : mmdd >= b.from || mmdd <= b.to;
    return inRange && b.days[dow] === 'Y';
  });
}

const inWindow = (t: number, w: TimeWindow) => {
  const m = ((t % 1440) + 1440) % 1440;
  return w.from <= w.to ? m >= w.from && m <= w.to : m >= w.from || m <= w.to;
};

/**
 * Operator limits read from a route description: "LNER ONLY" allows only those operators,
 * "NOT LNER" excludes them. Other routes (via a station, avoiding one) need routeing checks
 * and are not interpreted here.
 */
export function routeOperators(desc: string): { only?: string[]; not?: string[] } {
  const d = desc.trim().toUpperCase();
  const only = /^(.+?)\s+ONLY$/.exec(d);
  if (only) return { only: operatorsNamed(only[1]) ?? undefined };
  const not = /^(?:NOT|EXCL?\.?|EXCLUDING)\s+(.+)$/.exec(d);
  if (not) return { not: operatorsNamed(not[1]) ?? undefined };
  return {};
}

/** Whether a fare's route lets it be used on this train's operator. */
export function checkRoute(journey: DirectJourney, routeName: string): Validity {
  const { only, not } = routeOperators(routeName);
  if (only && !only.includes(journey.operator)) {
    return { valid: false, reason: `Not valid: this ticket is ${only.map(operatorName).join(' or ')} only` };
  }
  if (not?.includes(journey.operator)) {
    return { valid: false, reason: `Not valid: this ticket is not valid on ${operatorName(journey.operator)}` };
  }
  return { valid: true };
}

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export interface Validity {
  valid: boolean;
  /** Why not, in plain words, when not valid. */
  reason?: string;
}

/**
 * Whether a ticket with this restriction code can be used on a direct journey. `names`
 * turns CRS codes into station names for the explanation.
 */
export function checkValidity(
  journey: DirectJourney,
  restrictionCode: string,
  set: RestrictionSet | undefined,
  date: string,
  dir: 'O' | 'R',
  names: (crs: string) => string,
): Validity {
  if (!restrictionCode.trim()) return { valid: true };
  const r = set?.restrictions[restrictionCode];
  if (!r) return { valid: true, reason: `Restriction ${restrictionCode} not found; check before you travel` };
  if (!inBands(r.dates, date)) return { valid: true };

  const board = journey.calls[0].crs;
  const alight = journey.calls[journey.calls.length - 1].crs;
  const trainsMode = dir === 'O' ? r.trainsOut : r.trainsRtn;
  const listed = r.trains.some(
    (t) =>
      t.dir === dir &&
      t.uid === journey.uid &&
      inBands(t.dates, date) &&
      (!t.at.length || t.at.some(([crs, how]) => (crs === board && how !== 'A') || (crs === alight && how !== 'D'))),
  );
  if (listed && trainsMode === 'N') return { valid: false, reason: 'This train is excluded for this ticket' };
  if (listed && trainsMode === 'P') return { valid: true };

  for (const w of r.windows) {
    if (w.dir !== dir || !inBands(w.dates, date)) continue;
    if (w.tocs.length && !w.tocs.includes(journey.operator)) continue;
    const crs = w.crs || (w.at === 'A' ? alight : board);
    const call = journey.calls.find((c) => c.crs === crs);
    if (!call) continue;
    const time = w.at === 'A' ? call.arr : w.at === 'D' ? call.dep : (call.dep ?? call.arr);
    // A departure window only counts where the passenger is on the train leaving that station.
    if (time === null || (w.at === 'D' && crs === alight) || (w.at === 'A' && crs === board)) continue;
    if (inWindow(time, w)) {
      const verb = w.at === 'A' ? 'arrives at' : w.at === 'D' ? 'departs' : 'passes through';
      return {
        valid: false,
        reason: `Not valid: ${verb} ${names(crs)} at ${hhmm(((time % 1440) + 1440) % 1440)} (restricted ${hhmm(w.from)}–${hhmm(w.to)})`,
      };
    }
  }
  return { valid: true };
}

/** Whether a fare can be used on a direct journey: its route first, then its restriction. */
export function fareValidity(
  journey: DirectJourney,
  fare: FareOption,
  set: RestrictionSet | undefined,
  date: string,
  dir: 'O' | 'R',
  names: (crs: string) => string,
): Validity {
  const route = checkRoute(journey, fare.routeName);
  return route.valid ? checkValidity(journey, fare.restriction, set, date, dir, names) : route;
}
