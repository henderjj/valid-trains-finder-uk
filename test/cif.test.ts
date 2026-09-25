import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseChangeTimes, parseCif, schedulesForDate, toConnections } from '../pipeline/cif.ts';

const cif = parseCif(readFileSync(new URL('./fixtures/sample.MCA', import.meta.url), 'utf8'));

describe('parseCif', () => {
  it('reads stations with their CRS codes', () => {
    expect(cif.tiplocs.get('LGEATON')).toEqual({ tiploc: 'LGEATON', crs: 'LGE', name: 'LONG EATON' });
  });

  it('reads schedules, dropping passing points', () => {
    const [permanent] = cif.schedules;
    expect(permanent).toMatchObject({ uid: 'C12345', stp: 'P', days: '1111100', operator: 'EM', headcode: '1F99' });
    expect(permanent.calls.map((c) => c.tiploc)).toEqual(['LGEATON', 'SHEFFLD']);
    expect(permanent.calls[0]).toMatchObject({ dep: 22 * 60 + 50, platform: '2' });
  });
});

describe('schedulesForDate', () => {
  it('uses the permanent schedule on an ordinary weekday', () => {
    const uids = schedulesForDate(cif.schedules, '2026-10-02').map((s) => `${s.uid}/${s.stp}`);
    expect(uids.sort()).toEqual(['C12345/P', 'C22222/P']);
  });

  it('prefers an overlay on its date', () => {
    const s = schedulesForDate(cif.schedules, '2026-10-05').find((s) => s.uid === 'C12345');
    expect(s?.stp).toBe('O');
    expect(s?.calls.map((c) => c.tiploc)).toEqual(['LGEATON', 'CHFD', 'SHEFFLD']);
  });

  it('drops a train cancelled on that date', () => {
    expect(schedulesForDate(cif.schedules, '2026-10-06').map((s) => s.uid)).toEqual(['C12345']);
  });

  it('respects days of the week', () => {
    expect(schedulesForDate(cif.schedules, '2026-10-03').map((s) => s.uid)).toEqual(['C22222']);
  });
});

describe('toConnections', () => {
  it('builds sorted legs and carries times past midnight', () => {
    const legs = toConnections(schedulesForDate(cif.schedules, '2026-10-05'));
    expect(legs).toEqual([
      { from: 'NTNG', to: 'LGEATON', dep: 570, arr: 582, uid: 'C22222' },
      { from: 'LGEATON', to: 'CHFD', dep: 1370, arr: 1410, uid: 'C12345' },
      { from: 'CHFD', to: 'SHEFFLD', dep: 1411, arr: 1450, uid: 'C12345' },
    ]);
  });
});

describe('parseChangeTimes', () => {
  it('reads minimum connection times by CRS, from the first record for each station', () => {
    const lines = [
      '/!! Start of file',
      'A                             FILE-SPEC=05 1.00 22/09/26 18.08.01   969',
      'A    DERBY                         2DRBY   DBY   DBY14362 63356 6',
      'A    CLAPHAM JUNCTION              9CLPHMJ1CLJ   CLJ15272 6175510',
      'A    CLAPHAM JUNCTION              2CLPHMJCCLJ   CLJ15272 6175505',
      'L    DERBY                         DERBY',
    ];
    expect(parseChangeTimes(lines)).toEqual(new Map([['DBY', 6], ['CLJ', 10]]));
  });
});
