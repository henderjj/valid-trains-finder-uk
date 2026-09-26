import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCif } from '../pipeline/cif.ts';
import { buildDay, buildGroups, buildStations, cityName, crsByTiploc, distinguish, titleCase } from '../pipeline/publish.ts';
import { callsOf, clock, duration, findDirect } from '../src/lib/timetable.ts';

const cif = parseCif(readFileSync(new URL('./fixtures/sample.MCA', import.meta.url), 'utf8'));
const crsOf = crsByTiploc(cif);

describe('buildDay', () => {
  it('encodes calls by CRS with times continuing past midnight', () => {
    const day = buildDay(cif, '2026-10-05', crsOf);
    expect(day.trains).toEqual([
      { u: 'C12345', o: 'EM', h: '1F99', c: ['LGE', null, 1370, 'CHD', 1410, 1411, 'SHF', 1450, null], p: ['2', '1', '5'] },
      { u: 'C22222', o: 'EM', h: '2D10', c: ['NOT', null, 570, 'LGE', 582, null], p: ['4', '1'] },
    ]);
  });

  it('gives each call its platform', () => {
    const [train] = buildDay(cif, '2026-10-05', crsOf).trains;
    expect(callsOf(train).map((c) => c.platform)).toEqual(['2', '1', '5']);
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
    expect(buildStations(cif, new Set(['LGE']), { changeTimes: new Map([['LGE', 5]]) })).toEqual([{ crs: 'LGE', name: 'Long Eaton', change: 5 }]);
  });

  it('tells apart stations that share a name', () => {
    const stations = [
      { crs: 'AAA', name: 'Whitchurch' },
      { crs: 'BBB', name: 'Whitchurch' },
      { crs: 'CCC', name: 'Upton' },
      { crs: 'DDD', name: 'Upton' },
      { crs: 'EEE', name: 'Upton' },
      { crs: 'FFF', name: 'Derby' },
    ];
    distinguish(stations, new Map([['AAA', 'WHITCHURCH (HANTS)'], ['BBB', 'WHITCHURCH (SHROPS)'], ['FFF', 'DERBY MIDLAND']]), new Map([['CCC', 10], ['DDD', 40], ['FFF', 5]]));
    expect(stations).toEqual([
      { crs: 'AAA', name: 'Whitchurch (Hants)' },
      { crs: 'BBB', name: 'Whitchurch (Shrops)' },
      { crs: 'CCC', name: 'Upton', note: 'other station' },
      { crs: 'DDD', name: 'Upton', note: 'main station' },
      { crs: 'EEE', name: 'Upton', note: 'bus stop' },
      { crs: 'FFF', name: 'Derby' },
    ]);
  });

  it('offers fare groups as cities, with the stations trains call at', () => {
    expect(cityName('MANCHESTER STNS')).toBe('Manchester');
    expect(cityName('LONDON TERMINALS')).toBe('London');
    const stations = [{ crs: 'MAN', name: 'Manchester Piccadilly' }, { crs: 'MCO', name: 'Manchester Oxford Road' }, { crs: 'SHF', name: 'Sheffield' }];
    expect(
      buildGroups(
        [
          { code: '0438', name: 'MANCHESTER STNS', members: ['MAN', 'MCO', 'XXX'] },
          { code: '0999', name: 'SHEFFIELD STNS', members: ['SHF', 'YYY'] },
        ],
        stations,
      ),
    ).toEqual([{ crs: '0438', name: 'Manchester', note: 'all stations', members: ['MAN', 'MCO'] }]);
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
