import { useEffect, useState } from 'preact/hooks';
import { Results } from './Results.tsx';
import { StationInput } from './StationInput.tsx';
import { loadDay, loadMeta, loadStations, ukToday } from './lib/data.ts';
import { findDirect, type DataMeta, type DirectJourney, type Station } from './lib/timetable.ts';

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

type Status =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; route: Route; date: string; journeys: DirectJourney[] };

export function App() {
  const [stations, setStations] = useState<Station[]>([]);
  const [meta, setMeta] = useState<DataMeta | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [from, setFrom] = useState<Station | null>(null);
  const [to, setTo] = useState<Station | null>(null);
  const [date, setDate] = useState(ukToday());
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

  const search = async (route: Route, day: string) => {
    setStatus({ kind: 'loading' });
    try {
      const journeys = findDirect(await loadDay(day), route.from.crs, route.to.crs);
      setStatus({ kind: 'done', route, date: day, journeys });
      setRecent(saveRecent(route));
    } catch (err) {
      setStatus({ kind: 'error', message: (err as Error).message });
    }
  };

  const outOfRange = meta !== null && (date < meta.from || date > meta.to);
  const canSearch = from && to && from.crs !== to.crs && !outOfRange;

  return (
    <main>
      <header>
        <h1>Valid Trains Finder</h1>
        <p class="lede">Find the trains between two stations.</p>
      </header>

      {loadError && <p class="error">Could not load timetable data: {loadError}</p>}

      <form
        class="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (from && to && canSearch) void search({ from, to }, date);
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
                    void search(r, date);
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
        <Results from={status.route.from} to={status.route.to} date={status.date} journeys={status.journeys} stations={stations} />
      )}

      <footer>
        <p>Contains data from National Rail Enquiries.</p>
        <p>
          This is not an official National Rail service. Times are from the planned timetable and may change; always
          check before you travel.
        </p>
        {meta && <p>Timetable data updated {new Date(meta.built).toLocaleDateString('en-GB')}.</p>}
      </footer>
    </main>
  );
}
