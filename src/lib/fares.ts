// Published fares formats, fare lookup and ticket validity checking. Shared by the data
// pipeline (which writes the files) and the app (which reads them).
import { operatorName, operatorsNamed } from './operators.ts';
import type { Routeing } from './routeing.ts';
import type { Journey } from './timetable.ts';

export type TicketKind = 'anytime' | 'offpeak' | 'superoffpeak';

export interface TicketType {
  name: string;
  kind: TicketKind;
  /** 1 first class, 2 standard. */
  cls: 1 | 2;
  ret: boolean;
  /** How long the ticket lasts and whether it allows a break of journey, when the feed says. */
  valid?: TicketValidity;
}

/** A ticket's validity, from the fares feed's ticket validity file (.TVL). */
export interface TicketValidity {
  /** Days and months the outward portion can be used on, counting the date on the ticket. */
  out: [number, number];
  /** Days and months after the outward date that the return portion can be used by. */
  ret: [number, number];
  /** Days and months before the return can be used, and a weekday (MO to SU) it can't be used before. */
  after: [number, number, string];
  /** Whether a break of journey is allowed on the outward and return portions. */
  breakOut: boolean;
  breakRtn: boolean;
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

/** "09:05" style clock time; wraps past midnight. */
const hhmm = (t: number) => {
  const m = ((t % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

const inWindow = (t: number, w: TimeWindow) => {
  const m = ((t % 1440) + 1440) % 1440;
  return w.from <= w.to ? m >= w.from && m <= w.to : m >= w.from || m <= w.to;
};

/**
 * Operator limits read from a route description: "LNER ONLY" allows only those operators,
 * "NOT LNER" excludes them. Other routes (via a station, avoiding one) are checked with the
 * routeing guide's route data.
 */
export function routeOperators(desc: string): { only?: string[]; not?: string[] } {
  // Descriptions are 16 characters and sometimes end in a full stop or a bracketed code.
  const d = desc
    .toUpperCase()
    .replace(/\(.*?\)|\.+\s*$/g, '')
    .trim();
  const only = /^(.+?)\s+ONLY$/.exec(d);
  if (only) return { only: operatorsNamed(only[1]) ?? undefined };
  const not = /^(?:NOT|EXCL?\.?|EXCLUDING)\s+(.+)$/.exec(d);
  if (not) return { not: operatorsNamed(not[1]) ?? undefined };
  return {};
}

/** Whether a fare's route lets it be used on the operators of every train in the journey. */
export function checkRoute(journey: Journey, routeName: string): Validity {
  const { only, not } = routeOperators(routeName);
  for (const leg of journey.legs) {
    if (only && !only.includes(leg.operator)) {
      const which = journey.legs.length > 1 ? ` (the ${hhmm(leg.dep)} is ${operatorName(leg.operator)})` : '';
      return { valid: false, reason: `Not valid: this ticket is ${only.map(operatorName).join(' or ')} only${which}` };
    }
    if (not?.includes(leg.operator)) {
      return { valid: false, reason: `Not valid: this ticket is not valid on ${operatorName(leg.operator)}` };
    }
  }
  return { valid: true };
}

export interface Validity {
  valid: boolean;
  /** Why not, in plain words, when not valid. */
  reason?: string;
}

/**
 * Whether a ticket with this restriction code can be used on a journey. `names` turns CRS
 * codes into station names for the explanation.
 */
export function checkValidity(
  journey: Journey,
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

  const { legs } = journey;
  const origin = legs[0].calls[0].crs;
  const lastLeg = legs[legs.length - 1];
  const destination = lastLeg.calls[lastLeg.calls.length - 1].crs;
  const trainsMode = dir === 'O' ? r.trainsOut : r.trainsRtn;
  const listed = legs.filter((leg) => {
    const board = leg.calls[0].crs;
    const alight = leg.calls[leg.calls.length - 1].crs;
    return r.trains.some(
      (t) =>
        t.dir === dir &&
        t.uid === leg.uid &&
        inBands(t.dates, date) &&
        (!t.at.length || t.at.some(([crs, how]) => (crs === board && how !== 'A') || (crs === alight && how !== 'D'))),
    );
  });
  if (listed.length && trainsMode === 'N') {
    return { valid: false, reason: `Not valid: the ${hhmm(listed[0].dep)} from ${names(listed[0].calls[0].crs)} is excluded for this ticket` };
  }
  // Trains the restriction lists as permitted can be used whatever the time.
  const checked = trainsMode === 'P' ? legs.filter((leg) => !listed.includes(leg)) : legs;

  for (const w of r.windows) {
    if (w.dir !== dir || !inBands(w.dates, date)) continue;
    const crs = w.crs || (w.at === 'A' ? destination : origin);
    for (const leg of checked) {
      if (w.tocs.length && !w.tocs.includes(leg.operator)) continue;
      const i = leg.calls.findIndex((c) => c.crs === crs);
      if (i === -1) continue;
      // A departure only counts where the passenger boards or stays on, an arrival where
      // they alight or were already on board.
      if ((w.at === 'D' && i === leg.calls.length - 1) || (w.at === 'A' && i === 0)) continue;
      const call = leg.calls[i];
      const time = w.at === 'A' ? call.arr : w.at === 'D' ? call.dep : (call.dep ?? call.arr);
      if (time === null || !inWindow(time, w)) continue;
      const verb = w.at === 'A' ? 'arrives at' : w.at === 'D' ? 'departs' : 'passes through';
      return { valid: false, reason: `Not valid: ${verb} ${names(crs)} at ${hhmm(time)} (restricted ${hhmm(w.from)}–${hhmm(w.to)})` };
    }
  }
  return { valid: true };
}

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** The same day of the month, `n` months later, or the month's last day when it is shorter. */
function addMonths(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last), 12)).toISOString().slice(0, 10);
}

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * The first and last dates the return portion of a return ticket can be used, for an
 * outward journey on `outDate`, or null when the feed gives no return period. A period in
 * months ends the day before the same date that many months later.
 */
export function returnWindow(v: TicketValidity, outDate: string): { first: string; last: string } | null {
  const [days, months] = v.ret;
  if (!days && !months) return null;
  const last = months ? addDays(addMonths(outDate, months), days - 1) : addDays(outDate, days - 1);
  let first = addDays(addMonths(outDate, v.after[1]), v.after[0]);
  const weekday = WEEKDAYS.indexOf(v.after[2]);
  if (weekday >= 0) while (new Date(`${first}T12:00:00Z`).getUTCDay() !== weekday) first = addDays(first, 1);
  return { first, last };
}

const dayName = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Whether the return half of a return ticket can be used on `backDate` after going out on `outDate`. */
export function checkReturnDate(type: TicketType, outDate: string, backDate: string): Validity {
  const window = type.valid && returnWindow(type.valid, outDate);
  if (!window) return { valid: true };
  if (backDate > window.last) {
    const when = window.last === outDate ? 'on the day of the outward journey' : `by ${dayName(window.last)}`;
    return { valid: false, reason: `Not valid: the return half must be used ${when}` };
  }
  if (backDate < window.first) return { valid: false, reason: `Not valid: the return half can't be used before ${dayName(window.first)}` };
  return { valid: true };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The ticket's return period and break of journey rules in words, e.g. "Return within 1 month. Break of journey allowed." */
export function describeTicketRules(type: TicketType): string {
  const v = type.valid;
  if (!v) return '';
  const parts: string[] = [];
  if (type.ret) {
    const [days, months] = v.ret;
    let ret = '';
    if (months) ret = `Return within ${plural(months, 'month')}`;
    else if (days === 1) ret = 'Return the same day';
    else if (days) ret = `Return within ${plural(days, 'day')}, counting the outward day`;
    const weekday = WEEKDAYS.indexOf(v.after[2]);
    if (ret && weekday >= 0) ret += `, not before ${WEEKDAY_NAMES[weekday]}`;
    else if (ret && v.after[0] === 1 && !v.after[1]) ret += ', but not on the outward day';
    else if (ret && (v.after[0] || v.after[1])) {
      const wait = [v.after[1] ? plural(v.after[1], 'month') : '', v.after[0] ? plural(v.after[0], 'day') : ''].filter(Boolean).join(' and ');
      ret += `, from ${wait} after the outward day`;
    }
    if (ret) parts.push(`${ret}.`);
  }
  const breakOut = v.breakOut;
  const breakRtn = type.ret ? v.breakRtn : breakOut;
  if (breakOut && breakRtn) parts.push('Break of journey allowed.');
  else if (!breakOut && !breakRtn) parts.push('No break of journey.');
  else parts.push(`Break of journey allowed on the ${breakOut ? 'outward' : 'return'} journey only.`);
  return parts.join(' ');
}

/**
 * Whether a fare can be used on a journey: the operators its route allows, then the
 * routeing guide's permitted routes (when loaded), then its time restriction.
 */
export function fareValidity(
  journey: Journey,
  fare: FareOption,
  set: RestrictionSet | undefined,
  date: string,
  dir: 'O' | 'R',
  names: (crs: string) => string,
  routeing?: Routeing,
): Validity {
  const route = checkRoute(journey, fare.routeName);
  if (!route.valid) return route;
  const routed = routeing?.checkFare(journey, fare.route);
  if (routed?.permitted === false) {
    if (routed.byFareRoute || journey.legs.length === 1) {
      return { valid: false, reason: `Not valid: doesn't go the way the ticket's route (${fare.routeName.trim()}) requires` };
    }
    const via = journey.legs.slice(1).map((l) => names(l.calls[0].crs));
    return { valid: false, reason: `Not valid: changing at ${via.join(' and ')} is not a permitted route for this ticket` };
  }
  return checkValidity(journey, fare.restriction, set, date, dir, names);
}
