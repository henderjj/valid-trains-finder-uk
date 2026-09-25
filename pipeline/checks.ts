// Sanity checks on the built data, run before it is published. Errors mean the data looks
// broken (a truncated or empty feed), so the build stops and the live app keeps its last
// good data. Warnings mean something the app can't fully use yet, such as a new operator.

export interface BuildSummary {
  /** Trains in each day file. */
  days: { date: string; trains: number }[];
  stations: number;
  changeTimes: number;
  /** Absent when the fares feed wasn't built. */
  fares?: { ticketTypes: string[]; originFiles: number; restrictionCodes: number };
  /** Absent when the routeing guide wasn't built. */
  routeing?: { points: number; fareRoutes: number };
  /** Operator codes the timetable uses that have no name. */
  unnamedOperators: string[];
  /** Route descriptions that limit operators in words the app can't read, with no route data to fall back on. */
  unreadableRoutes: string[];
}

export interface CheckResult {
  errors: string[];
  warnings: string[];
}

/** Trains on an ordinary day are in the tens of thousands; Christmas and Boxing Day have few or none. */
const MIN_TRAINS = 5000;
const MIN_MEDIAN_TRAINS = 15000;
const MIN_STATIONS = 2000;
const MIN_CHANGE_TIMES = 1000;
const MIN_FARE_FILES = 2000;
const MIN_RESTRICTIONS = 100;
const MIN_ROUTEING_POINTS = 200;
const MIN_FARE_ROUTES = 100;
/** Walk-up tickets that exist on almost every route: Anytime Single and Anytime Return. */
const CORE_TICKETS = ['SOS', 'SOR'];

export function checkData(s: BuildSummary): CheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const counts = s.days.map((d) => d.trains).sort((a, b) => a - b);
  const median = counts[Math.floor(counts.length / 2)] ?? 0;
  if (median < MIN_MEDIAN_TRAINS) errors.push(`Timetable: a typical day has only ${median} trains (expected at least ${MIN_MEDIAN_TRAINS})`);
  for (const d of s.days) {
    const christmas = /-12-2[56]$/.test(d.date);
    if (!christmas && d.trains < MIN_TRAINS) errors.push(`Timetable: ${d.date} has only ${d.trains} trains (expected at least ${MIN_TRAINS})`);
  }
  if (s.stations < MIN_STATIONS) errors.push(`Stations: only ${s.stations} (expected at least ${MIN_STATIONS})`);
  if (s.changeTimes < MIN_CHANGE_TIMES) errors.push(`Stations: only ${s.changeTimes} have a connection time (expected at least ${MIN_CHANGE_TIMES})`);

  if (!s.fares) errors.push('Fares: not built');
  else {
    const missing = CORE_TICKETS.filter((t) => !s.fares!.ticketTypes.includes(t));
    if (missing.length) errors.push(`Fares: ticket types ${missing.join(', ')} are missing`);
    if (s.fares.originFiles < MIN_FARE_FILES) errors.push(`Fares: only ${s.fares.originFiles} origin files (expected at least ${MIN_FARE_FILES})`);
    if (s.fares.restrictionCodes < MIN_RESTRICTIONS) {
      errors.push(`Fares: only ${s.fares.restrictionCodes} restriction codes (expected at least ${MIN_RESTRICTIONS})`);
    }
  }

  if (!s.routeing) errors.push('Routeing guide: not built');
  else {
    if (s.routeing.points < MIN_ROUTEING_POINTS) errors.push(`Routeing guide: only ${s.routeing.points} routeing points (expected at least ${MIN_ROUTEING_POINTS})`);
    if (s.routeing.fareRoutes < MIN_FARE_ROUTES) errors.push(`Routeing guide: only ${s.routeing.fareRoutes} fare routes (expected at least ${MIN_FARE_ROUTES})`);
  }

  if (s.unnamedOperators.length) {
    warnings.push(`Operators with no name (shown as their code): ${s.unnamedOperators.join(', ')}. Add them to src/lib/operators.ts.`);
  }
  if (s.unreadableRoutes.length) {
    warnings.push(
      `Ticket routes naming operators the app doesn't recognise (treated as valid on any operator, with a "check" note): ${s.unreadableRoutes.join('; ')}. Add the names to src/lib/operators.ts.`,
    );
  }
  return { errors, warnings };
}

/** GitHub Actions annotations, which show on the workflow run's page. */
export const annotations = (result: CheckResult): string[] => [
  ...result.errors.map((e) => `::error title=Data check failed::${e}`),
  ...result.warnings.map((w) => `::warning title=Data check::${w}`),
];

/** Markdown for the workflow run's summary page. */
export function summary(result: CheckResult): string {
  const lines = result.errors.length ? result.errors.map((e) => `- ❌ ${e}`) : ['- ✅ The data looks complete.'];
  return ['## Data checks', '', ...lines, ...result.warnings.map((w) => `- ⚠️ ${w}`), ''].join('\n');
}
