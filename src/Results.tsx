import { useMemo, useState } from 'preact/hooks';
import type { RouteFares, Trip } from './App.tsx';
import { ukToday } from './lib/data.ts';
import { checkReturnDate, describeTicketRules, fareValidity, restrictionSetFor, type FareOption, type Validity } from './lib/fares.ts';
import { operatorName } from './lib/operators.ts';
import { clock, duration, stationName, type Journey, type Station } from './lib/timetable.ts';

interface Props {
  from: Station;
  to: Station;
  date: string;
  journeys: Journey[];
  /** The journeys coming back, when a return date was given. */
  back?: Trip;
  fares: RouteFares | null;
  stations: Station[];
}

type Leg = 'O' | 'R';

const longDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const shortDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

const price = (pence: number) => `£${(pence / 100).toFixed(2)}`;
const optionKey = (f: FareOption) => `${f.ticket}/${f.route}`;
const optionLabel = (f: FareOption) =>
  `${f.type.name} · ${price(f.pence)}${f.route === '00000' ? '' : ` · ${f.routeName}`}`;

/** National Rail's live departures between two stations. */
const liveTimes = (from: string, to: string) => `https://www.nationalrail.co.uk/live-trains/departures/${from}/${to}/`;

const pick = (options: FareOption[], key: string) =>
  options.find((f) => optionKey(f) === key) ?? options.find((f) => f.ticket === key.split('/')[0]);

// The last tickets picked and whether only direct trains were wanted, so a new search
// starts the same way.
let lastTicket = '';
let lastBackTicket = '';
let lastDirectOnly = false;

export function Results({ from, to, date, journeys, back, fares, stations }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [leg, setLeg] = useState<Leg>('O');
  const [picked, setPicked] = useState(lastTicket);
  const [pickedBack, setPickedBack] = useState(lastBackTicket);
  const [validOnly, setValidOnly] = useState(true);
  const [directOnly, setDirectOnly] = useState(lastDirectOnly);
  const names = useMemo(() => new Map(stations.map((s) => [s.crs, s.name])), [stations]);
  const name = (crs: string) => names.get(crs) ?? crs;

  // With a return date, "R" shows the journeys back. The return half of a return ticket
  // bought for the outward journey is used for them; otherwise a single bought at the
  // destination. Without one, "R" checks the return half of a return bought at the
  // destination, for travelling this way.
  const coming = back !== undefined && leg === 'R';
  const list = coming ? back.journeys : journeys;
  const day = coming ? back.date : date;
  const [start, end] = coming ? [to, from] : [from, to];
  // With a city's stations at either end, each journey says which stations it uses.
  const grouped = start.members !== undefined || end.members !== undefined;
  const outTicket = fares ? pick(fares.out, picked) : undefined;
  const half = coming && outTicket?.type.ret ? outTicket : undefined;
  const options = !fares ? [] : coming ? (half ? [] : fares.backSingles) : leg === 'O' ? fares.out : fares.back;
  const ticket = half ?? (coming ? pick(options, pickedBack) : leg === 'O' ? outTicket : pick(options, picked));
  const dir: Leg = half || (!back && leg === 'R') ? 'R' : 'O';

  const pool = useMemo(() => (directOnly ? list.filter((j) => j.legs.length === 1) : list), [list, directOnly]);

  const validity = useMemo(() => {
    const map = new Map<Journey, Validity>();
    if (!ticket || !fares) return map;
    // The return half of a return ticket only lasts so long after the outward journey.
    const period = half && checkReturnDate(half.type, date, day);
    const set = restrictionSetFor(fares.sets, day);
    for (const j of pool) map.set(j, period && !period.valid ? period : fareValidity(j, ticket, set, day, dir, name, fares.routeing ?? undefined));
    return map;
  }, [ticket, half, fares, pool, date, day, dir, names]);

  const validCount = [...validity.values()].filter((v) => v.valid).length;
  const shown = ticket && validOnly ? pool.filter((j) => validity.get(j)?.valid) : pool;
  const restriction = ticket?.restriction ? restrictionSetFor(fares?.sets ?? [], day)?.restrictions[ticket.restriction] : undefined;
  const restrictionText = restriction && (dir === 'O' ? restriction.out : restriction.rtn || restriction.out);
  const rules = ticket ? describeTicketRules(ticket.type) : '';

  const today = day === ukToday();
  const kind = directOnly ? 'direct ' : '';
  const count = `${pool.length} ${kind}${pool.length === 1 ? 'journey' : 'journeys'}`;
  const summary = !pool.length ? `No ${kind}journeys found` : ticket ? `${validCount} of ${count} valid` : count;

  return (
    <section class="results" aria-live="polite">
      {back && (
        <div class="segmented trip" role="group" aria-label="Direction">
          <button type="button" aria-pressed={leg === 'O'} onClick={() => setLeg('O')}>
            Out · {shortDate(date)}
          </button>
          <button type="button" aria-pressed={leg === 'R'} onClick={() => setLeg('R')}>
            Back · {shortDate(back.date)}
          </button>
        </div>
      )}
      <h2>
        {stationName(start)} → {stationName(end)}
      </h2>
      <p class="hint">
        {longDate(day)} · {summary}
      </p>

      {fares && (
        <div class="ticket">
          {!back && (
            <div class="segmented" role="group" aria-label="Journey leg">
              <button type="button" aria-pressed={leg === 'O'} onClick={() => setLeg('O')}>
                Outward
              </button>
              <button type="button" aria-pressed={leg === 'R'} onClick={() => setLeg('R')}>
                Return
              </button>
            </div>
          )}
          {half ? (
            <p class="half">
              Using the return half of your {half.type.name} ({price(half.pence)}
              {half.route === '00000' ? '' : ` · ${half.routeName}`}). Pick a single on the Out tab to choose a different ticket
              for coming back.
            </p>
          ) : (
            <div class="field">
              <label for="ticket">
                {coming ? `Single from ${stationName(to)}` : leg === 'O' ? `Ticket from ${stationName(from)}` : `Return ticket from ${stationName(to)}`}
              </label>
              <select
                id="ticket"
                value={ticket ? optionKey(ticket) : ''}
                onChange={(e) => {
                  const value = (e.currentTarget as HTMLSelectElement).value;
                  if (coming) {
                    lastBackTicket = value;
                    setPickedBack(value);
                  } else {
                    lastTicket = value;
                    setPicked(value);
                  }
                }}
              >
                <option value="">Any ticket (show all trains)</option>
                {options.map((f) => (
                  <option key={optionKey(f)} value={optionKey(f)}>
                    {optionLabel(f)}
                  </option>
                ))}
              </select>
            </div>
          )}
          {!half && options.length === 0 && (
            <p class="hint">No walk-up fares found for this {leg === 'O' || coming ? 'journey' : 'return journey'}.</p>
          )}
          {ticket && (
            <>
              <p class="hint">{restrictionText ? restrictionText : 'No time restrictions: valid on any train on this route.'}</p>
              {rules && <p class="hint">{rules}</p>}
              <label class="check">
                <input type="checkbox" checked={validOnly} onChange={(e) => setValidOnly((e.currentTarget as HTMLInputElement).checked)} />
                Show valid trains only
              </label>
            </>
          )}
        </div>
      )}

      {list.length > 0 && (
        <label class="check">
          <input
            type="checkbox"
            checked={directOnly}
            onChange={(e) => {
              lastDirectOnly = (e.currentTarget as HTMLInputElement).checked;
              setDirectOnly(lastDirectOnly);
            }}
          />
          Direct trains only
        </label>
      )}

      {list.length === 0 && <p>No journeys with up to two changes were found on this day.</p>}
      {list.length > 0 && pool.length === 0 && <p>There are no direct trains on this day. Untick "Direct trains only" to see journeys with changes.</p>}
      {pool.length > 0 && shown.length === 0 && (
        <p>None of these journeys are valid with this ticket. Untick "Show valid trains only" to see them all.</p>
      )}
      <ol class="journeys">
        {shown.map((j) => {
          const key = j.legs.map((l) => `${l.uid}-${l.dep}`).join('+');
          const expanded = open === key;
          const v = validity.get(j);
          const changes = j.legs.length - 1;
          const changeAt = j.legs.slice(1).map((l) => name(l.calls[0].crs));
          const operators = [...new Set(j.legs.map((l) => operatorName(l.operator)))].join(', ');
          return (
            <li key={key} class={`journey${v && !v.valid ? ' invalid' : ''}`}>
              <button type="button" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : key)}>
                <span class="times">
                  {clock(j.dep)} → {clock(j.arr)}
                </span>
                <span class="duration">{duration(j.arr - j.dep)}</span>
                {grouped && (
                  <span class="meta">
                    {name(j.legs[0].calls[0].crs)} → {name(j.legs[j.legs.length - 1].calls.at(-1)!.crs)}
                  </span>
                )}
                <span class="meta">
                  {changes === 0
                    ? j.legs[0].stops === 0
                      ? 'Direct, non-stop'
                      : `Direct, ${j.legs[0].stops} ${j.legs[0].stops === 1 ? 'stop' : 'stops'}`
                    : `${changes} ${changes === 1 ? 'change' : 'changes'} at ${changeAt.join(' and ')}`}{' '}
                  · {operators}
                  {j.legs.some((l) => l.bus) && ' · Bus'}
                </span>
                {v && (
                  <span class={`validity ${v.valid ? 'ok' : 'no'}`}>
                    {v.valid ? '✓ Valid' : '✗ Not valid'}
                    {v.reason && <span class="reason">{v.reason.replace(/^Not valid: /, '')}</span>}
                  </span>
                )}
              </button>
              {expanded &&
                j.legs.map((leg, n) => (
                  <div key={`${leg.uid}-${leg.dep}`}>
                    {n > 0 && (
                      <p class="change">
                        Change at {name(leg.calls[0].crs)}, {duration(leg.dep - j.legs[n - 1].arr)} to change
                      </p>
                    )}
                    <p class="leg-title">
                      <span>
                        {operatorName(leg.operator)}
                        {leg.bus ? ' bus' : ''}
                      </span>
                      {today && (
                        <a href={liveTimes(leg.calls[0].crs, leg.calls[leg.calls.length - 1].crs)} target="_blank" rel="noopener">
                          Live times
                        </a>
                      )}
                    </p>
                    <ol class="calls">
                      {leg.calls.map((c, i) => (
                        <li key={`${c.crs}-${i}`}>
                          <span class="call-time">{clock((i === 0 ? c.dep : c.arr) ?? c.dep ?? 0)}</span>
                          <span>{name(c.crs)}</span>
                          {c.platform && <span class="platform">Plat {c.platform}</span>}
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
