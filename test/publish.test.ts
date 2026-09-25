import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCif } from '../pipeline/cif.ts';
import { buildDay, buildStations, crsByTiploc, titleCase } from '../pipeline/publish.ts';
import { clock, duration, findDirect } from '../src/lib/timetable.ts';

const cif = parseCif(readFileSync(new URL('./fixtures/sample.MCA', import.meta.url), 'utf8'));
const crsOf = crsByTiploc(cif);

describe('buildDay', () => {
  it('encodes calls by CRS with times continuing past midnight', () => {
    const day = buildDay(cif, '2026-10-05', crsOf);
    expect(day.trains).toEqual([
      { u: 'C12345', o: 'EM', h: '1F99', c: ['LGE', null, 1370, 'CHD', 1410, 1411, 'SHF', 1450, null] },
      { u: 'C22222', o: 'EM', h: '2D10', c: ['NOT', null, 570, 'LGE', 582, null] },
    ]);
  });

  it("carries the previous evening's trains past midnight with times shifted back a day", () => {
    const day = buildDay(cif, '2026-10-06', crsOf);
    expect(day.trains.map((t) => t.c)).toEqual([
      ['LGE', null, 1370, 'SHF', 1450, null],
      ['LGE', null, -70, 'CHD', -30, -29, 'SHF', 10, null],
    ]);
  });
});

describe('findDirect', () => {
  it('finds trains calling at both stations in order', () => {
    const [j] = findDirect(buildDay(cif, '2026-10-05', crsOf), 'LGE', 'SHF');
    expect(j).toMatchObject({ uid: 'C12345', dep: 1370, arr: 1450, stops: 1, operator: 'EM' });
    expect(j.calls.map((c) => c.crs)).toEqual(['LGE', 'CHD', 'SHF']);
  });

  it('ignores the wrong direction', () => {
    expect(findDirect(buildDay(cif, '2026-10-05', crsOf), 'SHF', 'LGE')).toEqual([]);
  });

  it('only counts departures on the chosen date', () => {
    const journeys = findDirect(buildDay(cif, '2026-10-06', crsOf), 'LGE', 'SHF');
    expect(journeys.map((j) => j.dep)).toEqual([1370]);
    expect(findDirect(buildDay(cif, '2026-10-06', crsOf), 'CHD', 'SHF')).toEqual([]);
  });
});

describe('stations', () => {
  it('lists only served stations, title-cased and sorted', () => {
    expect(buildStations(cif, new Set(['SHF', 'LGE']))).toEqual([
      { crs: 'LGE', name: 'Long Eaton' },
      { crs: 'SHF', name: 'Sheffield' },
    ]);
  });

  it('title-cases names', () => {
    expect(titleCase("KING'S CROSS ST PANCRAS INTL")).toBe("King's Cross St Pancras Intl");
    expect(titleCase('STRATFORD (LONDON) DLR')).toBe('Stratford (London) DLR');
  });
});

describe('formatting', () => {
  it('formats clock times and durations', () => {
    expect(clock(1450)).toBe('00:10');
    expect(clock(582)).toBe('09:42');
    expect(duration(96)).toBe('1h 36m');
    expect(duration(12)).toBe('12m');
  });
});
