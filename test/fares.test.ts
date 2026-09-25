import { describe, expect, it } from 'vitest';
import { parseFares, parseLocations, parseRestrictions, parseRoutes, parseTicketTypes, ticketKind } from '../pipeline/fares.ts';
import { checkValidity, faresBetween, restrictionSetFor, type FaresMeta } from '../src/lib/fares.ts';
import type { DirectJourney } from '../src/lib/timetable.ts';

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

const journey = (dep: number, uid = 'C99999', operator = 'EM'): DirectJourney => ({
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
