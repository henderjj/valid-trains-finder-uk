import { describe, expect, it } from 'vitest';
import { parsePermittedRoutes, parseRouteing } from '../pipeline/routeing.ts';
import { Routeing } from '../src/lib/routeing.ts';
import type { Journey, Leg } from '../src/lib/timetable.ts';

// A small network: Long Eaton to Manchester is shortest via Derby and Stoke (80 miles),
// longer via Chesterfield and Sheffield (86), and much longer via Leicester and Nuneaton (120).
// Derby is in the Derby group (G09) and Manchester stations in G20.
const data = parseRouteing({
  stations: ['/ comment', 'LGE,G09,,,,', 'CHD,SHF,G09,,,', 'DBY,,,,,G09', 'SHF,,,,,', 'SOT,,,,,', 'MAN,,,,,G20', 'MCV,,,,,G20', 'LEI,,,,,', 'NUN,,,,,', 'KGX,,,,,G01'],
  groups: ['G09,DBY', 'G20,MAN', 'G01,KGX'],
  points: ['G09', 'G20', 'SHF', 'SOT', 'LEI', 'NUN', 'G01'],
  nodes: ['G09', 'G20', 'SHF', 'SOT', 'LEI', 'NUN', 'G01'],
  links: ['G09,SOT,XA', 'SOT,G09,XA', 'G20,SOT,XA', 'G09,SHF,YB', 'G20,SHF,YB', 'LEI,NUN,ZC', 'NUN,SOT,ZC'],
  distances: ['LGE,DBY,10', 'DBY,LGE,10', 'DBY,CHD,24', 'CHD,SHF,12', 'SHF,MAN,40', 'LGE,LEI,20', 'LEI,NUN,20', 'NUN,SOT,40', 'SOT,MAN,40', 'DBY,SOT,30', 'MAN,MCV,1'],
  london: ['KGX,Y,Y'],
  newStations: ['LGE,NEW,01012026,31122999'],
  fareRoutes: ['00079,L,3', '00079,D,A,SHF,N,,', '00302,D,E,SHF,N,,', '00400,D,X,,,,XC', '00500,D,A,DBY,Y,,'],
});
const routes = parsePermittedRoutes(['G09,G20,XA', 'G09,G20,YB']);
const routeing = new Routeing(data, routes);

const leg = (operator: string, ...crs: string[]): Leg => ({
  uid: 'X',
  operator,
  headcode: '1A00',
  bus: false,
  dep: 0,
  arr: 0,
  stops: crs.length - 2,
  calls: crs.map((c) => ({ crs: c, arr: 0, dep: 0 })),
});
const journey = (...legs: Leg[]): Journey => ({ legs, dep: 0, arr: 0 });

const viaStoke = journey(leg('EM', 'LGE', 'DBY'), leg('XC', 'DBY', 'SOT', 'MAN'));
const viaSheffield = journey(leg('EM', 'LGE', 'DBY'), leg('EM', 'DBY', 'CHD', 'SHF'), leg('TP', 'SHF', 'MAN'));
const viaLeicester = journey(leg('EM', 'LGE', 'LEI'), leg('XC', 'LEI', 'NUN'), leg('VT', 'NUN', 'SOT', 'MAN'));

describe('routeing guide data', () => {
  it('reads stations, groups, nodes and links', () => {
    expect(data.stations['LGE']).toEqual(['G09']);
    expect(data.groups['MAN']).toBe('G20');
    expect(data.mains['G09']).toBe('DBY');
    expect(data.nodes).toContain('SHF');
    expect(data.links['G20-SOT']).toEqual(['XA']);
    expect(data.distances.filter(([a, b]) => [a, b].sort().join() === 'DBY,LGE')).toHaveLength(1);
    expect(data.london).toBe('G01');
    expect(data.aliases).toEqual({ NEW: 'LGE' });
  });

  it('reads fare routes', () => {
    expect(data.fareRoutes['00079']).toEqual({ all: [['SHF']] });
    expect(data.fareRoutes['00302']).toEqual({ not: [['SHF']] });
    expect(data.fareRoutes['00400']).toEqual({ notTocs: ['XC'] });
    // A group marker takes in every station in the group.
    expect(data.fareRoutes['00500']).toEqual({ all: [['DBY']] });
  });
});

describe('permitted routes', () => {
  it('finds the shortest route', () => {
    expect(routeing.shortest('LGE', 'MAN')).toEqual({ miles: 80, via: ['LGE', 'DBY', 'SOT', 'MAN'] });
  });

  it('permits one train, and the shortest route', () => {
    expect(routeing.check(journey(leg('EM', 'LGE', 'LEI', 'NUN'))).permitted).toBe(true);
    expect(routeing.check(viaStoke).permitted).toBe(true);
  });

  it('permits a longer route that follows a permitted map', () => {
    expect(routeing.check(viaSheffield)).toEqual({ permitted: true, why: 'follows a permitted route from G09 to G20' });
  });

  it('permits the reverse direction', () => {
    const back = journey(leg('TP', 'MAN', 'SHF'), leg('EM', 'SHF', 'CHD', 'DBY'), leg('EM', 'DBY', 'LGE'));
    expect(routeing.check(back).permitted).toBe(true);
  });

  it('rejects a route that misses the routeing points', () => {
    expect(routeing.check(viaLeicester)).toEqual({ permitted: false, why: 'does not pass G09' });
  });

  it('treats a new station like the one whose routeing it takes', () => {
    expect(routeing.check(journey(leg('EM', 'NEW', 'DBY'), leg('EM', 'DBY', 'CHD', 'SHF'), leg('TP', 'SHF', 'MAN'))).permitted).toBe(true);
  });

  it('permits a local journey via the shortest route', () => {
    expect(routeing.check(journey(leg('EM', 'CHD', 'DBY'), leg('EM', 'DBY', 'LGE'))).permitted).toBe(true);
  });

  it('cannot say for stations it does not know', () => {
    expect(routeing.check(journey(leg('EM', 'LGE', 'DBY'), leg('EM', 'DBY', 'XXX'))).permitted).toBeUndefined();
  });
});

describe('fare routes', () => {
  it('requires the places a route goes via', () => {
    expect(routeing.checkFare(viaStoke, '00079')).toEqual({ permitted: false, why: 'does not go via SHF' });
    expect(routeing.checkFare(viaSheffield, '00079').permitted).toBe(true);
  });

  it('rejects places a route avoids', () => {
    expect(routeing.checkFare(viaSheffield, '00302')).toEqual({ permitted: false, why: 'goes via SHF' });
    expect(routeing.checkFare(viaStoke, '00302').permitted).toBe(true);
  });

  it('rejects operators a route excludes', () => {
    expect(routeing.checkFare(viaStoke, '00400')).toEqual({ permitted: false, why: 'uses XC' });
  });

  it('counts a place passed without stopping', () => {
    expect(routeing.checkFare(journey(leg('EM', 'LGE', 'SOT'), leg('XC', 'SOT', 'MAN')), '00500').permitted).toBe(true);
  });

  it('checks the permitted route as well', () => {
    expect(routeing.checkFare(viaLeicester, '00302').permitted).toBe(false);
    expect(routeing.checkFare(viaStoke, 'none').permitted).toBe(true);
  });
});

describe('tracing', () => {
  // Coleshill Parkway (CEH) is drawn on a spur off Water Orton (WTO).
  const spur = new Routeing(
    parseRouteing({
      stations: ['NUN,,,,,', 'CEH,NUN,,,,', 'WTO,NUN,,,,', 'BHM,,,,,'],
      groups: [],
      points: ['NUN', 'BHM'],
      nodes: ['NUN', 'BHM'],
      links: ['NUN,BHM,CS'],
      distances: ['NUN,WTO,10', 'WTO,CEH,2', 'WTO,BHM,8', 'NUN,LEI,20'],
      london: [],
      newStations: [],
      fareRoutes: [],
    }),
    parsePermittedRoutes([]),
  );

  it('ignores a spur the map draws off the line', () => {
    expect(spur.check(journey(leg('XC', 'LEI', 'NUN'), leg('XC', 'NUN', 'CEH', 'BHM')))).toMatchObject({ permitted: true });
  });

  it('says which stations have no track between them', () => {
    expect(spur.check(journey(leg('XC', 'NUN', 'BHM'), leg('XC', 'BHM', 'XXX'))).why).toBe('no track data from BHM to XXX');
  });
});
