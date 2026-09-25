import { describe, expect, it } from 'vitest';
import { searchStations } from '../src/lib/data.ts';

const stations = [
  { crs: 'LGE', name: 'Long Eaton' },
  { crs: 'EAL', name: 'Ealing Broadway' },
  { crs: 'LMS', name: 'Leamington Spa' },
  { crs: 'SHF', name: 'Sheffield' },
];

describe('searchStations', () => {
  it('puts an exact CRS code first', () => {
    expect(searchStations(stations, 'lge')[0].crs).toBe('LGE');
  });

  it('ranks name prefixes, then word prefixes, then substrings', () => {
    expect(searchStations(stations, 'ea').map((s) => s.crs)).toEqual(['EAL', 'LGE', 'LMS']);
  });

  it('returns nothing for blank text', () => {
    expect(searchStations(stations, '  ')).toEqual([]);
  });
});
