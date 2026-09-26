import { describe, expect, it } from 'vitest';
import { buildNetwork, planJourneys, type Journey } from '../src/lib/planner.ts';
import type { DayFile, DayTrain } from '../src/lib/timetable.ts';

const hm = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
/** A train calling at "CRS hh:mm" stops; the time is both arrival and departure. */
const train = (u: string, ...stops: string[]): DayTrain => ({
  u,
  o: 'EM',
  h: '1A00',
  c: stops.flatMap((s, i) => {
    const [crs, time] = s.split(' ');
    return [crs, i === 0 ? null : hm(time), i === stops.length - 1 ? null : hm(time)];
  }),
});

const day: DayFile = {
  date: '2026-10-05',
  trains: [
    train('A', 'LGE 06:00', 'DBY 06:15'),
    train('B', 'DBY 06:25', 'SHF 07:00'),
    train('C', 'LGE 06:05', 'DBY 06:22', 'CHD 07:00', 'SHF 07:30'),
    train('D', 'DBY 06:18', 'SHF 06:50'),
    train('E', 'LGE 07:00', 'NOT 07:15'),
    train('F', 'NOT 07:30', 'SHF 08:30'),
    train('G', 'LGE 07:10', 'SHF 08:00'),
    train('H', 'LGE 09:00', 'NOT 09:10'),
    train('I', 'NOT 09:20', 'DBY 09:40'),
    train('J', 'DBY 09:50', 'SHF 10:20'),
  ],
};
const net = buildNetwork(day);
const describeJourney = (j: Journey) => j.legs.map((l) => `${l.uid} ${l.calls[0].crs}-${l.calls[l.calls.length - 1].crs}`).join(', ');

describe('planJourneys', () => {
  const journeys = planJourneys(net, day, 'LGE', 'SHF');

  it('lists direct trains and faster journeys with changes, in departure order', () => {
    expect(journeys.map(describeJourney)).toEqual([
      'A LGE-DBY, B DBY-SHF',
      'C LGE-SHF',
      'G LGE-SHF',
      'H LGE-NOT, I NOT-DBY, J DBY-SHF',
    ]);
  });

  it('allows time to change trains', () => {
    // A reaches Derby at 06:15, too late for D at 06:18; C reaches it at 06:22, too late for B.
    expect(journeys[0]).toMatchObject({ dep: hm('06:00'), arr: hm('07:00') });
  });

  it('drops a journey with changes when a direct train is at least as good', () => {
    expect(journeys.some((j) => j.legs[0].uid === 'E')).toBe(false);
  });

  it('keeps the calls of each leg', () => {
    expect(journeys[1].legs[0].calls.map((c) => c.crs)).toEqual(['LGE', 'DBY', 'CHD', 'SHF']);
    expect(journeys[0].legs[1].calls.map((c) => c.crs)).toEqual(['DBY', 'SHF']);
  });

  it("uses a station's own minimum connection time", () => {
    // With 2 minutes at Derby, A (06:15) connects into D (06:18) and reaches Sheffield at 06:50.
    const quick = planJourneys(net, day, 'LGE', 'SHF', { changeTimes: { DBY: 2 } });
    expect(quick[0]).toMatchObject({ dep: hm('06:00'), arr: hm('06:50') });
    // With 12 minutes at Derby, A no longer connects into B (06:25).
    const slow = planJourneys(net, day, 'LGE', 'SHF', { changeTimes: { DBY: 12 } });
    expect(slow.map(describeJourney)).not.toContain('A LGE-DBY, B DBY-SHF');
  });

  it('respects the most trains allowed', () => {
    expect(planJourneys(net, day, 'LGE', 'SHF', { maxLegs: 2 }).map(describeJourney)).not.toContain('H LGE-NOT, I NOT-DBY, J DBY-SHF');
  });

  it('returns nothing for unknown stations', () => {
    expect(planJourneys(net, day, 'LGE', 'XXX')).toEqual([]);
  });
});

describe('planJourneys between groups of stations', () => {
  it('lists each train once, boarding at the last of the origin stations it calls at', () => {
    expect(planJourneys(net, day, ['LGE', 'DBY'], ['SHF']).map(describeJourney)).toEqual([
      'D DBY-SHF',
      'C DBY-SHF',
      'B DBY-SHF',
      'G LGE-SHF',
      'J DBY-SHF',
    ]);
  });

  it('leaves at the first of the destination stations a train reaches', () => {
    expect(planJourneys(net, day, 'LGE', ['DBY', 'SHF']).map(describeJourney)).toEqual([
      'A LGE-DBY',
      'C LGE-DBY',
      'G LGE-SHF',
      'H LGE-NOT, I NOT-DBY',
    ]);
  });

  it('does not start from a station that is also a destination', () => {
    expect(planJourneys(net, day, ['LGE', 'DBY'], ['DBY']).every((j) => j.legs[0].calls[0].crs === 'LGE')).toBe(true);
  });
});
