import { describe, expect, it } from 'vitest';
import { annotations, checkData, summary, type BuildSummary } from '../pipeline/checks.ts';
import { parseOperators } from '../pipeline/fares.ts';
import { titleCase } from '../pipeline/publish.ts';

const good: BuildSummary = {
  days: [
    { date: '2026-12-24', trains: 22000 },
    { date: '2026-12-25', trains: 0 },
    { date: '2026-12-26', trains: 900 },
    { date: '2026-12-27', trains: 17000 },
    { date: '2026-12-28', trains: 24000 },
    { date: '2026-12-29', trains: 24500 },
    { date: '2026-12-30', trains: 24600 },
  ],
  stations: 2724,
  changeTimes: 2675,
  fares: { ticketTypes: ['SOS', 'SOR', 'SVR'], originFiles: 4142, restrictionCodes: 317 },
  routeing: { points: 272, fareRoutes: 890 },
  unnamedOperators: [],
  unreadableRoutes: [],
};

describe('checkData', () => {
  it('passes complete data, allowing for Christmas', () => {
    expect(checkData(good)).toEqual({ errors: [], warnings: [] });
  });

  it('fails a short day, a truncated timetable and missing feeds', () => {
    const days = good.days.map((d) => (d.date === '2026-12-28' ? { ...d, trains: 1200 } : d));
    expect(checkData({ ...good, days }).errors).toEqual(['Timetable: 2026-12-28 has only 1200 trains (expected at least 5000)']);
    const empty = good.days.map((d) => ({ ...d, trains: 3000 }));
    expect(checkData({ ...good, days: empty }).errors[0]).toMatch(/a typical day has only 3000 trains/);
    const { errors } = checkData({ ...good, fares: undefined, routeing: undefined });
    expect(errors).toEqual(['Fares: not built', 'Routeing guide: not built']);
  });

  it('fails fares without core tickets or with too few files', () => {
    const { errors } = checkData({ ...good, fares: { ticketTypes: ['SVR'], originFiles: 10, restrictionCodes: 317 } });
    expect(errors).toEqual(['Fares: ticket types SOS, SOR are missing', 'Fares: only 10 origin files (expected at least 2000)']);
  });

  it('warns about operators and routes the app cannot read', () => {
    const result = checkData({ ...good, unnamedOperators: ['ZZ'], unreadableRoutes: ['GBR EAST ONLY (01234)'] });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(2);
    expect(annotations(result)[0]).toMatch(/^::warning title=Data check::Operators with no name .*ZZ/);
    expect(summary(result)).toContain('- ✅ The data looks complete.');
    expect(summary(result)).toContain('GBR EAST ONLY (01234)');
  });
});

describe('parseOperators', () => {
  it('reads operator names, preferring active operators', () => {
    const lines = [
      'FIECGRLONDON NORTH EASTERN RAILWAY  ',
      'TGRLONDON NORTH EASTERN RAILWAY          Y',
      'TLMWEST MIDLANDS TRAINS                  Y',
      'TLMCENTRAL TRAINS LTD.                   N',
      'TLTLONDON UNDERGROUND                    Y',
    ];
    expect(parseOperators(lines, titleCase)).toEqual({
      GR: 'London North Eastern Railway',
      LM: 'West Midlands Trains',
      LT: 'London Underground',
    });
  });
});
