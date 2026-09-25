// Parser for the fares feed (RJFAF zip): walk-up ticket types, station locations and
// clusters, flows and fares, routes and restrictions. Record layouts were checked against
// the live feed with pipeline/inspect-fares.ts.
import type {
  DateBand,
  FareFile,
  FaresMeta,
  Restriction,
  RestrictionSet,
  TicketKind,
  TicketType,
  TicketValidity,
} from '../src/lib/fares.ts';

/** ddmmyyyy -> yyyy-mm-dd */
export const feedDate = (d: string) => `${d.slice(4, 8)}-${d.slice(2, 4)}-${d.slice(0, 2)}`;
const current = (end: string, start: string, date: string) => feedDate(start) <= date && date <= feedDate(end);
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2, 4));

const EXCLUDED = /ADVANCE|SEASON|GROUP|CARNET|FLEXI|TEST|NOT FOR TRAVEL|UPGRADE/i;

export function ticketKind(desc: string): TicketKind | null {
  if (EXCLUDED.test(desc)) return null;
  if (/SUP(ER)?\s*OFF/i.test(desc)) return 'superoffpeak';
  if (/OFF.?P(EA)?K/i.test(desc)) return 'offpeak';
  if (/ANYTIME/i.test(desc)) return 'anytime';
  return null;
}

const KIND_LABEL: Record<TicketKind, string> = {
  anytime: 'Anytime',
  offpeak: 'Off-Peak',
  superoffpeak: 'Super Off-Peak',
};

/**
 * Ticket validity periods (.TVL) current on `date`, by validity code. Each record gives the
 * outward and return periods in days and months, how long before the return can be used,
 * and whether a break of journey is allowed each way.
 */
export function parseValidities(lines: Iterable<string>, date: string): Map<string, TicketValidity> {
  const out = new Map<string, TicketValidity>();
  const num = (l: string, at: number) => Number(l.slice(at, at + 2)) || 0;
  for (const l of lines) {
    if (l.length < 54 || !current(l.slice(2, 10), l.slice(10, 18), date)) continue;
    out.set(l.slice(0, 2), {
      out: [num(l, 38), num(l, 40)],
      ret: [num(l, 42), num(l, 44)],
      after: [num(l, 46), num(l, 48), l.slice(50, 52).trim()],
      breakOut: l[52] === 'Y',
      breakRtn: l[53] === 'Y',
    });
  }
  return out;
}

export function parseTicketTypes(lines: Iterable<string>, date: string, validities = new Map<string, TicketValidity>()): Record<string, TicketType> {
  const out: Record<string, TicketType> = {};
  for (const l of lines) {
    if (l[0] !== 'R' || !current(l.slice(4, 12), l.slice(12, 20), date)) continue;
    const desc = l.slice(28, 43).trim();
    const kind = ticketKind(desc);
    const type = l[44];
    if (!kind || (type !== 'S' && type !== 'R')) continue;
    const cls = l[43] === '1' ? 1 : 2;
    const ret = type === 'R';
    const name = [KIND_LABEL[kind], /\bDAY\b/i.test(desc) ? 'Day' : '', ret ? 'Return' : 'Single'].filter(Boolean).join(' ');
    const ticket: TicketType = { name: cls === 1 ? `${name} (First)` : name, kind, cls, ret };
    const valid = validities.get(l.slice(75, 77));
    if (valid) ticket.valid = valid;
    out[l.slice(1, 4)] = ticket;
  }
  return out;
}

/** Each station's fare location codes: its own NLC, its fare group, then clusters of either. */
export function parseLocations(loc: Iterable<string>, fsc: Iterable<string>, date: string): Record<string, string[]> {
  const byNlc = new Map<string, { crs: string; group: string }>();
  for (const l of loc) {
    if (l.slice(0, 2) !== 'RL' || !current(l.slice(9, 17), l.slice(17, 25), date)) continue;
    const crs = l.slice(56, 59).trim();
    if (crs) byNlc.set(l.slice(36, 40), { crs, group: l.slice(69, 75).trim() });
  }
  const clusters = new Map<string, string[]>();
  for (const l of fsc) {
    if (l[0] !== 'R' || !current(l.slice(9, 17), l.slice(17, 25), date)) continue;
    const nlc = l.slice(5, 9);
    const list = clusters.get(nlc) ?? [];
    list.push(l.slice(1, 5));
    clusters.set(nlc, list);
  }
  const out: Record<string, string[]> = {};
  for (const [nlc, { crs, group }] of byNlc) {
    const codes = [nlc];
    if (group && group !== nlc) codes.push(group);
    for (const c of [...codes]) codes.push(...(clusters.get(c) ?? []));
    out[crs] = [...new Set(codes)];
  }
  return out;
}

interface Flow {
  origin: string;
  dest: string;
  route: string;
  reversible: boolean;
}

/**
 * Walk-up adult fares, grouped by origin code. Reversible flows are listed from both ends.
 * FFL holds flow (RF) and fare (RT) records; fares refer to flows by id.
 */
export function parseFares(ffl: Iterable<string>, tickets: Record<string, TicketType>, date: string) {
  const flows = new Map<string, Flow>();
  const fares: [string, string, number, string][] = [];
  for (const l of ffl) {
    if (l.startsWith('RF')) {
      if (l.slice(15, 18) !== '000' || !current(l.slice(20, 28), l.slice(28, 36), date)) continue;
      flows.set(l.slice(42, 49), { origin: l.slice(2, 6), dest: l.slice(6, 10), route: l.slice(10, 15), reversible: l[19] === 'R' });
    } else if (l.startsWith('RT') && tickets[l.slice(9, 12)]) {
      fares.push([l.slice(2, 9), l.slice(9, 12), Number(l.slice(12, 20)), l.slice(20, 22).trim()]);
    }
  }
  const files = new Map<string, FareFile>();
  const add = (from: string, to: string, entry: FareFile[string][number]) => {
    const file = files.get(from) ?? {};
    (file[to] ??= []).push(entry);
    files.set(from, file);
  };
  const routes = new Set<string>();
  const restrictions = new Set<string>();
  for (const [flowId, ticket, pence, restriction] of fares) {
    const flow = flows.get(flowId);
    if (!flow) continue;
    const entry: FareFile[string][number] = [flow.route, ticket, pence, restriction];
    add(flow.origin, flow.dest, entry);
    if (flow.reversible) add(flow.dest, flow.origin, entry);
    routes.add(flow.route);
    if (restriction) restrictions.add(restriction);
  }
  return { files, routes, restrictions };
}

/** Route descriptions (RR records); location records (RL) are not needed yet. */
export function parseRoutes(lines: Iterable<string>, used: Set<string>, date: string): Record<string, string> {
  const out: Record<string, string> = { '00000': 'Any permitted route' };
  for (const l of lines) {
    if (l.slice(0, 2) !== 'RR') continue;
    const code = l.slice(2, 7);
    if (used.has(code) && current(l.slice(7, 15), l.slice(15, 23), date)) out[code] = l.slice(31, 47).trim() || code;
  }
  return out;
}

const band = (from: string, to: string, days: string): DateBand => ({ from, to, days });

/** Restriction sets (current and future) limited to the codes that published fares use. */
export function parseRestrictions(lines: Iterable<string>, used: Set<string>): RestrictionSet[] {
  const sets: Record<string, RestrictionSet> = {};
  const get = (cf: string, code: string): Restriction | undefined => sets[cf]?.restrictions[code];
  const window = (r: Restriction, seq: string, dir: string) => r.windows.find((w) => (w as { seq?: string }).seq === seq && w.dir === dir);
  const train = (r: Restriction, uid: string, dir: string) => r.trains.find((t) => t.uid === uid && t.dir === dir);

  for (const l of lines) {
    const type = l.slice(0, 3);
    const cf = l[3];
    if (type === 'RRD') {
      sets[cf] ??= { from: '', to: '', restrictions: {} };
      sets[cf].from = feedDate(l.slice(4, 12));
      sets[cf].to = feedDate(l.slice(12, 20));
      continue;
    }
    const code = l.slice(4, 6);
    if (!used.has(code)) continue;
    sets[cf] ??= { from: '', to: '', restrictions: {} };
    if (type === 'RRH') {
      sets[cf].restrictions[code] = {
        desc: l.slice(6, 36).trim(),
        out: l.slice(36, 86).trim(),
        rtn: l.slice(86, 136).trim(),
        trainsOut: l[136] === 'P' ? 'P' : 'N',
        trainsRtn: l[137] === 'P' ? 'P' : 'N',
        dates: [],
        windows: [],
        trains: [],
      };
      continue;
    }
    const r = get(cf, code);
    if (!r) continue;
    switch (type) {
      case 'RHD':
        r.dates.push(band(l.slice(6, 10), l.slice(10, 14), l.slice(14, 21)));
        break;
      case 'RTR':
        r.windows.push(
          Object.assign(
            {
              dir: l[10] as 'O' | 'R',
              from: minutes(l.slice(11, 15)),
              to: minutes(l.slice(15, 19)),
              at: l[19] as 'D' | 'A' | 'V',
              crs: l.slice(20, 23).trim(),
              tocs: [],
              dates: [],
            },
            { seq: l.slice(6, 10) },
          ),
        );
        break;
      case 'RTD':
        window(r, l.slice(6, 10), l[10])?.dates.push(band(l.slice(11, 15), l.slice(15, 19), l.slice(19, 26)));
        break;
      case 'RTT':
        window(r, l.slice(6, 10), l[10])?.tocs.push(l.slice(11, 13));
        break;
      case 'RSR':
        r.trains.push({ dir: l[12] as 'O' | 'R', uid: l.slice(6, 12), at: [], dates: [] });
        break;
      case 'RSQ':
        train(r, l.slice(6, 12), l[12])?.at.push([l.slice(13, 16).trim(), (l[17] ?? 'B') as 'A' | 'D' | 'B']);
        break;
      case 'RSD':
        train(r, l.slice(6, 12), l[12])?.dates.push(band(l.slice(13, 17), l.slice(17, 21), l.slice(21, 28)));
        break;
    }
  }
  // The sequence number was only needed to attach date bands and operators.
  for (const s of Object.values(sets)) for (const r of Object.values(s.restrictions)) for (const w of r.windows) delete (w as { seq?: string }).seq;
  return Object.values(sets).filter((s) => s.from);
}

export type { FaresMeta };
