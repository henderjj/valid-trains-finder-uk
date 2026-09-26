import { describe, expect, it } from 'vitest';
import { parseFareGroups, parseFares, parseLocations, parseRestrictions, parseRoutes, parseTicketTypes, parseValidities, ticketKind } from '../pipeline/fares.ts';
import {
  checkReturnDate,
  checkValidity,
  describeTicketRules,
  fareValidity,
  faresBetween,
  restrictionSetFor,
  returnWindow,
  routeOperators,
  type FaresMeta,
  type TicketType,
} from '../src/lib/fares.ts';
import { operatorName, registerOperators } from '../src/lib/operators.ts';
import type { Journey, Leg } from '../src/lib/timetable.ts';

/** Builds a fixed-width record from [position, value] pairs. */
const rec = (...parts: [number, string][]) => {
  const chars: string[] = [];
  for (const [pos, val] of parts) for (let i = 0; i < val.length; i++) chars[pos + i] = val[i];
  return Array.from(chars, (c) => c ?? ' ').join('');
};
const OPEN = '31122999';
const DATE = '2026-10-05'; // a Monday

const tty = [
  rec([0, 'RSOR'], [4, OPEN], [12, '22052017'], [28, 'ANYTIME R'], [43, '2RS']),
  rec([0, 'RSVR'], [4, OPEN], [12, '22052017'], [28, 'OFF-PEAK R'], [43, '2RS']),
  rec([0, 'RCDS'], [4, OPEN], [12, '22052017'], [28, 'OFF-PEAK DAY S'], [43, '2SS']),
  rec([0, 'R2AS'], [4, OPEN], [12, '22052017'], [28, 'ADVANCE'], [43, '2SS']),
  rec([0, 'R7DS'], [4, OPEN], [12, '22052017'], [28, 'SEVEN DAY   STD'], [43, '2NS']),
];
const loc = [
  rec([0, 'RL'], [9, OPEN], [17, '03092026'], [36, '1829'], [40, 'LONG EATON'], [56, 'LGE'], [69, '1829']),
  rec([0, 'RL'], [9, OPEN], [17, '03092026'], [36, '6691'], [40, 'SHEFFIELD'], [56, 'SHF'], [69, '6691']),
];
const fsc = [rec([0, 'RQ171'], [5, '1829'], [9, OPEN], [17, '10041999']), rec([0, 'RQ480'], [5, '6691'], [9, OPEN], [17, '13022013'])];
const ffl = [
  rec([0, 'RF'], [2, '1829'], [6, '6691'], [10, '00472'], [15, '000'], [18, 'AR'], [20, OPEN], [28, '01032026'], [42, '0044653']),
  rec([0, 'RT'], [2, '0044653'], [9, '2AS'], [12, '00000220'], [20, 'AS']),
  rec([0, 'RF'], [2, 'Q171'], [6, 'Q480'], [10, '00000'], [15, '000'], [18, 'AR'], [20, OPEN], [28, '02032025'], [42, '0292306']),
  rec([0, 'RT'], [2, '0292306'], [9, 'SOR'], [12, '00005110']),
  rec([0, 'RT'], [2, '0292306'], [9, 'SVR'], [12, '00002870'], [20, '2O']),
  rec([0, 'RT'], [2, '0292306'], [9, 'CDS'], [12, '00001520'], [20, 'B3']),
];
const rst = [
  rec([0, 'RRDC'], [4, '05072026'], [12, '31102026']),
  rec([0, 'RRDF'], [4, '01112026'], [12, OPEN]),
  rec([0, 'RRHC2O'], [6, 'SMR OFF PEAK'], [36, 'VALID ON ANY TRAIN AFTER 0900 M-F'], [86, 'ANY TRAIN'], [136, 'NNY']),
  rec([0, 'RHDC2O'], [6, '01020325YYYYYNN']),
  rec([0, 'RHDC2O'], [6, '03301222YYYYYNN']),
  rec([0, 'RTRC2O'], [6, '0001O04300900D   TAN']),
  rec([0, 'RRHCB3'], [6, 'OFF-PEAK'], [36, 'VALID AFTER 0859 MON-FRI'], [136, 'PPY']),
  rec([0, 'RTRCB3'], [6, '0002O16001601DPADTAN']),
  rec([0, 'RTTCB3'], [6, '0002OGW']),
  rec([0, 'RSRCB3'], [6, 'C12345ONN']),
  rec([0, 'RRHCXX'], [6, 'UNUSED']),
];

const tickets = parseTicketTypes(tty, DATE);
const { files, routes, restrictions } = parseFares(ffl, tickets, DATE);
const meta: FaresMeta = { locations: parseLocations(loc, fsc, DATE), tickets, routes: parseRoutes([], routes, DATE) };
const sets = parseRestrictions(rst, restrictions);

const leg = (dep: number, uid = 'C99999', operator = 'EM'): Leg => ({
  uid,
  operator,
  headcode: '1F00',
  bus: false,
  dep,
  arr: dep + 50,
  stops: 1,
  calls: [
    { crs: 'LGE', arr: null, dep },
    { crs: 'CHD', arr: dep + 30, dep: dep + 31 },
    { crs: 'SHF', arr: dep + 50, dep: null },
  ],
});
const journey = (dep: number, uid?: string, operator?: string): Journey => {
  const l = leg(dep, uid, operator);
  return { legs: [l], dep: l.dep, arr: l.arr };
};
const name = (crs: string) => ({ LGE: 'Long Eaton', SHF: 'Sheffield' })[crs] ?? crs;

describe('ticket types', () => {
  it('keeps walk-up singles and returns and names them', () => {
    expect(tickets).toEqual({
      SOR: { name: 'Anytime Return', kind: 'anytime', cls: 2, ret: true },
      SVR: { name: 'Off-Peak Return', kind: 'offpeak', cls: 2, ret: true },
      CDS: { name: 'Off-Peak Day Single', kind: 'offpeak', cls: 2, ret: false },
    });
  });

  it('classifies descriptions', () => {
    expect(ticketKind('SUP OFFPK DAYTC')).toBe('superoffpeak');
    expect(ticketKind('ADVANCE 1ST')).toBeNull();
  });
});

describe('fares', () => {
  it('maps stations to their fare location codes', () => {
    expect(meta.locations).toEqual({ LGE: ['1829', 'Q171'], SHF: ['6691', 'Q480'] });
  });

  it('finds fares through clusters in both directions of a reversible flow', () => {
    const lookup = (from: string, to: string) => faresBetween(meta, files, from, to).map((f) => `${f.ticket} ${f.pence} ${f.restriction}`);
    expect(lookup('LGE', 'SHF')).toEqual(['CDS 1520 B3', 'SVR 2870 2O', 'SOR 5110 ']);
    expect(lookup('SHF', 'LGE')).toEqual(lookup('LGE', 'SHF'));
  });
});

describe('restrictions', () => {
  it('reads the current and future sets and only the codes in use', () => {
    expect(sets.map((s) => [s.from, s.to])).toEqual([
      ['2026-07-05', '2026-10-31'],
      ['2026-11-01', '2999-12-31'],
    ]);
    expect(Object.keys(sets[0].restrictions).sort()).toEqual(['2O', 'B3']);
    expect(sets[0].restrictions['B3'].windows[0]).toEqual({ dir: 'O', from: 960, to: 961, at: 'D', crs: 'PAD', tocs: ['GW'], dates: [] });
  });

  const check = (dep: number, date = DATE, code = '2O', uid?: string) =>
    checkValidity(journey(dep, uid), code, restrictionSetFor(sets, date), date, 'O', name);

  it('rejects an off-peak departure inside the peak window, with the reason', () => {
    expect(check(8 * 60 + 12)).toEqual({ valid: false, reason: 'Not valid: departs Long Eaton at 08:12 (restricted 04:30–09:00)' });
  });

  it('accepts trains after the peak', () => {
    expect(check(9 * 60 + 15).valid).toBe(true);
  });

  it('does not apply on days outside the restriction dates', () => {
    expect(check(8 * 60 + 12, '2026-10-03').valid).toBe(true); // Saturday
  });

  it('only applies location windows at that station', () => {
    expect(check(16 * 60, DATE, 'B3').valid).toBe(true);
  });

  it('lets listed trains through when the restriction permits them', () => {
    expect(check(8 * 60, DATE, 'B3', 'C12345').valid).toBe(true);
  });

  it('treats tickets without a restriction as valid on any train', () => {
    expect(check(7 * 60, DATE, '').valid).toBe(true);
  });
});

describe('routes', () => {
  it('reads operator limits from route descriptions', () => {
    expect(routeOperators('LNER ONLY')).toEqual({ only: ['GR'] });
    expect(routeOperators('GC/HT ONLY')).toEqual({ only: ['GC', 'HT'] });
    expect(routeOperators('NOT LUMO')).toEqual({ not: ['LD'] });
    expect(routeOperators('VIA YORK')).toEqual({});
    expect(routeOperators('EMR ONLY.')).toEqual({ only: ['EM'] });
    expect(routeOperators('GWR ONLY (00820)')).toEqual({ only: ['GW'] });
    expect(routeOperators('LNR/WMR &XC ONLY')).toEqual({ only: ['LM', 'LM', 'XC'] });
    expect(routeOperators('NOT HEATHROW EXP')).toEqual({ not: ['HX'] });
    expect(routeOperators('NOT VIA LEEDS')).toEqual({ unread: true });
    expect(routeOperators('NOT VALID ON HS1')).toEqual({ unread: true });
    expect(routeOperators('SOMEWHERE ONLY')).toEqual({ unread: true });
    // Wording seen in the fares feed.
    expect(routeOperators('EMR-ONLY.')).toEqual({ only: ['EM'] });
    expect(routeOperators('LNER TRAINS ONLY')).toEqual({ only: ['GR'] });
    expect(routeOperators('S W RAILWAY ONLY')).toEqual({ only: ['SW'] });
    expect(routeOperators('SW. RAILWAY ONLY')).toEqual({ only: ['SW'] });
    expect(routeOperators('AVANTI WC ONLY..')).toEqual({ only: ['VT'] });
    expect(routeOperators('TP HT GW ONLY')).toEqual({ only: ['TP', 'HT', 'GW'] });
    expect(routeOperators('GW AW TP HT ONLY')).toEqual({ only: ['GW', 'AW', 'TP', 'HT'] });
    expect(routeOperators('EMR & TLGN ONLY')).toEqual({ only: ['EM', 'TL', 'GN'] });
    expect(routeOperators('TFWRS  ONLY')).toEqual({ only: ['AW'] });
    expect(routeOperators('XC & NORTHN ONLY')).toEqual({ only: ['XC', 'NT'] });
    expect(routeOperators('IPS-NRW ONLY')).toEqual({ unread: true });
    expect(routeOperators('NOT UNDERGROUND')).toEqual({ not: ['LT'] });
  });

  it('marks trains of other operators not valid on an operator-only fare', () => {
    const fare = { ...faresBetween(meta, files, 'LGE', 'SHF')[0], routeName: 'LNER ONLY' };
    const set = restrictionSetFor(sets, DATE);
    expect(fareValidity(journey(600, undefined, 'LD'), fare, set, DATE, 'O', name)).toEqual({
      valid: false,
      reason: 'Not valid: this ticket is LNER only',
    });
    expect(fareValidity(journey(600, undefined, 'GR'), fare, set, DATE, 'O', name).valid).toBe(true);
  });

  it("says to check when it can't read the operators a route names", () => {
    const fare = { ...faresBetween(meta, files, 'LGE', 'SHF')[0], routeName: 'GBR EAST ONLY' };
    const set = restrictionSetFor(sets, DATE);
    expect(fareValidity(journey(600, undefined, 'GR'), fare, set, DATE, 'O', name)).toEqual({
      valid: true,
      reason: "The app can't check this ticket's route (GBR EAST ONLY); check before you travel",
    });
  });

  it('reads operator names published with the data', () => {
    registerOperators({ ZZ: 'Great British Railways East' });
    expect(operatorName('ZZ')).toBe('Great British Railways East');
    expect(operatorName('EM')).toBe('East Midlands Railway');
    expect(routeOperators('GREAT BRITISH RAILWAYS EAST ONLY')).toEqual({ only: ['ZZ'] });
  });
});

describe('journeys with changes', () => {
  // Long Eaton 08:40 to Nottingham, then Nottingham 09:10 to Sheffield.
  const first: Leg = { ...leg(0), dep: 520, arr: 530, stops: 0, calls: [{ crs: 'LGE', arr: null, dep: 520 }, { crs: 'NOT', arr: 530, dep: null }] };
  const second: Leg = { ...leg(0, 'C77777', 'NT'), dep: 550, arr: 640, stops: 0, calls: [{ crs: 'NOT', arr: null, dep: 550 }, { crs: 'SHF', arr: 640, dep: null }] };
  const trip: Journey = { legs: [first, second], dep: 520, arr: 640 };
  const set = restrictionSetFor(sets, DATE);

  it('applies an origin departure window to the first train only', () => {
    expect(checkValidity(trip, '2O', set, DATE, 'O', name)).toEqual({
      valid: false,
      reason: 'Not valid: departs Long Eaton at 08:40 (restricted 04:30–09:00)',
    });
    // Leaving Long Eaton at 09:05 instead is fine; the change at Nottingham is not checked.
    const later: Journey = { ...trip, dep: 545, legs: [{ ...first, dep: 545, calls: [{ ...first.calls[0], dep: 545 }, first.calls[1]] }, second] };
    expect(checkValidity(later, '2O', set, DATE, 'O', name).valid).toBe(true);
  });

  it('checks the operator of every train', () => {
    const fare = { ...faresBetween(meta, files, 'LGE', 'SHF')[0], routeName: 'EMR ONLY' };
    expect(fareValidity(trip, fare, set, DATE, 'O', name)).toEqual({
      valid: false,
      reason: 'Not valid: this ticket is East Midlands Railway only (the 09:10 is Northern)',
    });
  });
});

describe('ticket validity periods', () => {
  // Real .TVL records: an Off-Peak Return (1 day out, 1 month back), an Off-Peak Day Return,
  // a single with no break of journey on the way out, and a return from the day after.
  const tvl = [
    '723112299919122000AS ADVERTISED       010000010000  YYAS ADVERTISED AS ADVERTISED ',
    '853112299919122000SEE RESTRICTNS      010001000000  YYSEE RESTRICTNSSEE RESTRICTNS',
    '883112299919122000SEE RESTRICTNS      010000000000  NNSEE RESTRICTNSINVALID       ',
    '293112299912012023OUTDAY1 RTNDAY2     010002000100  NNON DATE SHOWN BEFORE 1200   ',
    '583112299929092022WKND 4 Days         010004000000SUNYOne Day       Four Days     ',
    '863112299919032026OUT1DAY RTN5DYS     010005000000  NNBOOKDTRAINONLYFIVE DAYS     ',
    '861803202613032026OUT1DAY RTN5DYS     010005000000  NYBOOKDTRAINONLYFIVE DAYS     ',
  ];
  const v = parseValidities(tvl, DATE);
  const type = (code: string, ret = true): TicketType => ({ name: 'T', kind: 'offpeak', cls: 2, ret, valid: v.get(code) });

  it('reads the periods current on the date', () => {
    expect(v.get('72')).toEqual({ out: [1, 0], ret: [0, 1], after: [0, 0, ''], breakOut: true, breakRtn: true });
    expect(v.get('58')?.after).toEqual([0, 0, 'SU']);
    expect(v.get('86')?.breakRtn).toBe(false);
  });

  it('attaches them to ticket types by validity code', () => {
    const line = rec([0, 'RSVR'], [4, OPEN], [12, '22052017'], [28, 'OFF-PEAK R'], [43, '2RS'], [75, '72']);
    expect(parseTicketTypes([line], DATE, v).SVR.valid).toEqual(v.get('72'));
  });

  it('works out the return window', () => {
    expect(returnWindow(v.get('72')!, '2026-10-05')).toEqual({ first: '2026-10-05', last: '2026-11-04' });
    expect(returnWindow(v.get('72')!, '2026-01-31')).toEqual({ first: '2026-01-31', last: '2026-02-27' });
    expect(returnWindow(v.get('85')!, '2026-10-05')).toEqual({ first: '2026-10-05', last: '2026-10-05' });
    expect(returnWindow(v.get('29')!, '2026-10-05')).toEqual({ first: '2026-10-06', last: '2026-10-06' });
    // Out on a Friday; back from Sunday, within four days.
    expect(returnWindow(v.get('58')!, '2026-10-09')).toEqual({ first: '2026-10-11', last: '2026-10-12' });
    expect(returnWindow(v.get('88')!, '2026-10-05')).toBeNull();
  });

  it('checks the return date', () => {
    expect(checkReturnDate(type('85'), '2026-10-05', '2026-10-05')).toEqual({ valid: true });
    expect(checkReturnDate(type('85'), '2026-10-05', '2026-10-06')).toEqual({
      valid: false,
      reason: 'Not valid: the return half must be used on the day of the outward journey',
    });
    expect(checkReturnDate(type('72'), '2026-10-05', '2026-11-05').reason).toBe('Not valid: the return half must be used by Wed 4 Nov');
    expect(checkReturnDate(type('29'), '2026-10-05', '2026-10-05').reason).toBe("Not valid: the return half can't be used before Tue 6 Oct");
    expect(checkReturnDate({ ...type('72'), valid: undefined }, '2026-10-05', '2027-01-01')).toEqual({ valid: true });
  });

  it('describes the rules', () => {
    expect(describeTicketRules(type('72'))).toBe('Return within 1 month. Break of journey allowed.');
    expect(describeTicketRules(type('85'))).toBe('Return the same day. Break of journey allowed.');
    expect(describeTicketRules(type('88', false))).toBe('No break of journey.');
    expect(describeTicketRules(type('29'))).toBe('Return within 2 days, counting the outward day, but not on the outward day. No break of journey.');
    expect(describeTicketRules(type('58'))).toBe('Return within 4 days, counting the outward day, not before Sunday. Break of journey allowed on the return journey only.');
  });
});

describe('fare groups', () => {
  const grouped = [
    rec([0, 'RL'], [9, OPEN], [17, '03092026'], [36, '0438'], [40, 'MANCHESTER STNS']),
    rec([0, 'RL'], [9, OPEN], [17, '03092026'], [36, '2968'], [40, 'MANCHESTER PICC'], [56, 'MAN'], [69, '0438']),
    rec([0, 'RL'], [9, OPEN], [17, '03092026'], [36, '2963'], [40, 'MANCHESTER OXF R'], [56, 'MCO'], [69, '0438']),
    rec([0, 'RL'], [9, '01012026'], [17, '03092020'], [36, '2966'], [40, 'MANCHESTER OLD'], [56, 'MCX'], [69, '0438']),
    ...loc,
  ];

  it('lists groups with their current stations', () => {
    expect(parseFareGroups(grouped, DATE)).toEqual([{ code: '0438', name: 'MANCHESTER STNS', members: ['MAN', 'MCO'] }]);
  });

  it('makes each group a fare location of its own', () => {
    const locations = parseLocations(grouped, [...fsc, rec([0, 'RQ999'], [5, '0438'], [9, OPEN], [17, '10041999'])], DATE);
    expect(locations['0438']).toEqual(['0438', 'Q999']);
    expect(locations.MAN).toEqual(['2968', '0438', 'Q999']);
  });
});
