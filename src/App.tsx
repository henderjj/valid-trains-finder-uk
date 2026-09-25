import { useEffect, useState } from 'preact/hooks';
import { Results } from './Results.tsx';
import { StationInput } from './StationInput.tsx';
import { loadFares, loadMeta, loadRestrictions, loadRouteing, loadStations, ukToday } from './lib/data.ts';
import type { FareOption, RestrictionSet } from './lib/fares.ts';
import { planJourneysInBackground } from './lib/plan.ts';
import type { Routeing } from './lib/routeing.ts';
import type { DataMeta, Journey, Station } from './lib/timetable.ts';

interface Route {
  from: Station;
  to: Station;
}

const shortDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

const RECENT_KEY = 'recent-routes';
const MAX_RECENT = 5;

function readRecent(): Route[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as Route[];
  } catch {
    return [];
  }
}

function saveRecent(route: Route): Route[] {
  const same = (r: Route) => r.from.crs === route.from.crs && r.to.crs === route.to.crs;
  const list = [route, ...readRecent().filter((r) => !same(r))].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // Storage can be unavailable (private browsing); recent routes are a convenience only.
  }
  return list;
}

export interface RouteFares {
  /** Tickets bought at the origin, for travelling out. */
  out: FareOption[];
  /** Returns bought at the destination, whose return half comes back this way. */
  back: FareOption[];
  /** Singles bought at the destination, for coming back on a return date. */
  backSingles: FareOption[];
  sets: RestrictionSet[];
  /** The routeing guide's permitted routes, when published. */
  routeing: Routeing | null;
}

/** Fares are optional: without them the app still lists trains. */
const loadRouteFares = (route: Route): Promise<RouteFares | null> =>
  Promise.all([
    loadFares(route.from.crs, route.to.crs),
    loadFares(route.to.crs, route.from.crs),
    loadRestrictions(),
    loadRouteing(route.from.crs, route.to.crs).catch(() => null),
  ])
    .then(([out, back, sets, routeing]) => ({
      out,
      back: back.filter((f) => f.type.ret),
      backSingles: back.filter((f) => !f.type.ret),
      sets,
      routeing,
    }))
    .catch(() => null);

type Status =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; route: Route; date: string; journeys: Journey[]; back?: Trip; fares: RouteFares | null };

/** The journeys coming back, when a return date was given. */
export interface Trip {
  date: string;
  journeys: Journey[];
}

export function App() {
  const [stations, setStations] = useState<Station[]>([]);
  const [meta, setMeta] = useState<DataMeta | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [from, setFrom] = useState<Station | null>(null);
  const [to, setTo] = useState<Station | null>(null);
  const [date, setDate] = useState(ukToday());
  const [returnDate, setReturnDate] = useState('');
  const [recent, setRecent] = useState<Route[]>(readRecent);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  useEffect(() => {
    Promise.all([loadStations(), loadMeta()])
      .then(([s, m]) => {
        setStations(s);
        setMeta(m);
      })
      .catch((err: Error) => setLoadError(err.message));
  }, []);

  const search = async (route: Route, day: string, returnDay: string) => {
    setStatus({ kind: 'loading' });
    try {
      const [journeys, backJourneys, fares] = await Promise.all([
        planJourneysInBackground(day, route.from.crs, route.to.crs),
        returnDay ? planJourneysInBackground(returnDay, route.to.crs, route.from.crs) : null,
        loadRouteFares(route),
      ]);
      const back = backJourneys ? { date: returnDay, journeys: backJourneys } : undefined;
      setStatus({ kind: 'done', route, date: day, journeys, back, fares });
      setRecent(saveRecent(route));
    } catch (err) {
      setStatus({ kind: 'error', message: (err as Error).message });
    }
  };

  const inRange = (d: string) => meta === null || (d >= meta.from && d <= meta.to);
  const outOfRange = !inRange(date) || (returnDate !== '' && !inRange(returnDate));
  const returnTooEarly = returnDate !== '' && returnDate < date;
  const canSearch = from && to && from.crs !== to.crs && !outOfRange && !returnTooEarly;

  return (
    <main>
      <header>
        <h1>Valid Trains Finder</h1>
        <p class="lede">Find which trains your ticket is valid on.</p>
      </header>

      {loadError && <p class="error">Could not load timetable data: {loadError}</p>}

      <form
        class="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (from && to && canSearch) void search({ from, to }, date, returnDate);
        }}
      >
        <StationInput label="From" stations={stations} value={from} onChange={setFrom} />
        <button
          type="button"
          class="swap"
          aria-label="Swap stations"
          onClick={() => {
            setFrom(to);
            setTo(from);
          }}
        >
          ⇅
        </button>
        <StationInput label="To" stations={stations} value={to} onChange={setTo} />
        <div class="field">
          <label for="date">Date</label>
          <input
            id="date"
            type="date"
            value={date}
            min={meta?.from}
            max={meta?.to}
            onInput={(e) => setDate((e.currentTarget as HTMLInputElement).value)}
          />
        </div>
        <div class="field">
          <label for="return-date">Return date (optional)</label>
          <div class="with-clear">
            <input
              id="return-date"
              type="date"
              value={returnDate}
              min={date}
              max={meta?.to}
              onInput={(e) => setReturnDate((e.currentTarget as HTMLInputElement).value)}
            />
            {returnDate && (
              <button type="button" class="clear" aria-label="Clear return date" onClick={() => setReturnDate('')}>
                ✕
              </button>
            )}
          </div>
        </div>
        {returnTooEarly && <p class="hint">The return date must be on or after the outward date.</p>}
        {outOfRange && meta && (
          <p class="hint">
            Timetables are available from {shortDate(meta.from)} to {shortDate(meta.to)}.
          </p>
        )}
        <button type="submit" class="primary" disabled={!canSearch || status.kind === 'loading'}>
          {status.kind === 'loading' ? 'Searching…' : 'Find trains'}
        </button>
      </form>

      {recent.length > 0 && status.kind !== 'done' && (
        <section class="recent">
          <h2>Recent</h2>
          <ul>
            {recent.map((r) => (
              <li key={`${r.from.crs}-${r.to.crs}`}>
                <button
                  type="button"
                  onClick={() => {
                    setFrom(r.from);
                    setTo(r.to);
                    if (!outOfRange && !returnTooEarly) void search(r, date, returnDate);
                  }}
                >
                  {r.from.name} → {r.to.name}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {status.kind === 'error' && <p class="error">{status.message}</p>}
      {status.kind === 'done' && (
        <Results
          key={`${status.route.from.crs}-${status.route.to.crs}-${status.date}-${status.back?.date ?? ''}`}
          from={status.route.from}
          to={status.route.to}
          date={status.date}
          journeys={status.journeys}
          back={status.back}
          fares={status.fares}
          stations={stations}
        />
      )}

      <footer>
        <p>Contains data from National Rail Enquiries.</p>
        <p>
          This is not an official National Rail service. Times are from the planned timetable and may change, and ticket
          validity is worked out from published fares data; always check before you travel.
        </p>
        {meta && <p>Timetable data updated {new Date(meta.built).toLocaleDateString('en-GB')}.</p>}
      </footer>
    </main>
  );
}
