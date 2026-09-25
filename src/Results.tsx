import { useMemo, useState } from 'preact/hooks';
import type { RouteFares } from './App.tsx';
import { fareValidity, restrictionSetFor, type FareOption, type Validity } from './lib/fares.ts';
import { operatorName } from './lib/operators.ts';
import { clock, duration, type Journey, type Station } from './lib/timetable.ts';

interface Props {
  from: Station;
  to: Station;
  date: string;
  journeys: Journey[];
  fares: RouteFares | null;
  stations: Station[];
}

type Leg = 'O' | 'R';

const longDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

const price = (pence: number) => `£${(pence / 100).toFixed(2)}`;
const optionKey = (f: FareOption) => `${f.ticket}/${f.route}`;
const optionLabel = (f: FareOption) =>
  `${f.type.name} · ${price(f.pence)}${f.route === '00000' ? '' : ` · ${f.routeName}`}`;

// The last ticket picked, so a new search offers the same kind of ticket again.
let lastTicket = '';

export function Results({ from, to, date, journeys, fares, stations }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [leg, setLeg] = useState<Leg>('O');
  const [picked, setPicked] = useState(lastTicket);
  const [validOnly, setValidOnly] = useState(true);
  const names = useMemo(() => new Map(stations.map((s) => [s.crs, s.name])), [stations]);
  const name = (crs: string) => names.get(crs) ?? crs;

  const options = fares ? (leg === 'O' ? fares.out : fares.back) : [];
  const ticket = options.find((f) => optionKey(f) === picked) ?? options.find((f) => f.ticket === picked.split('/')[0]);

  const validity = useMemo(() => {
    const map = new Map<Journey, Validity>();
    if (!ticket || !fares) return map;
    const set = restrictionSetFor(fares.sets, date);
    for (const j of journeys) map.set(j, fareValidity(j, ticket, set, date, leg, name, fares.routeing ?? undefined));
    return map;
  }, [ticket, fares, journeys, date, leg, names]);

  const validCount = [...validity.values()].filter((v) => v.valid).length;
  const shown = ticket && validOnly ? journeys.filter((j) => validity.get(j)?.valid) : journeys;
  const restriction = ticket?.restriction ? restrictionSetFor(fares?.sets ?? [], date)?.restrictions[ticket.restriction] : undefined;
  const restrictionText = restriction && (leg === 'O' ? restriction.out : restriction.rtn || restriction.out);

  const count = `${journeys.length} ${journeys.length === 1 ? 'journey' : 'journeys'}`;
  const summary = !journeys.length ? 'No journeys found' : ticket ? `${validCount} of ${count} valid` : count;

  return (
    <section class="results" aria-live="polite">
      <h2>
        {from.name} → {to.name}
      </h2>
      <p class="hint">
        {longDate(date)} · {summary}
      </p>

      {fares && (
        <div class="ticket">
          <div class="segmented" role="group" aria-label="Journey leg">
            <button type="button" aria-pressed={leg === 'O'} onClick={() => setLeg('O')}>
              Outward
            </button>
            <button type="button" aria-pressed={leg === 'R'} onClick={() => setLeg('R')}>
              Return
            </button>
          </div>
          <div class="field">
            <label for="ticket">{leg === 'O' ? `Ticket from ${from.name}` : `Return ticket from ${to.name}`}</label>
            <select
              id="ticket"
              value={ticket ? optionKey(ticket) : ''}
              onChange={(e) => {
                const value = (e.currentTarget as HTMLSelectElement).value;
                lastTicket = value;
                setPicked(value);
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
          {options.length === 0 && <p class="hint">No walk-up fares found for this {leg === 'O' ? 'journey' : 'return journey'}.</p>}
          {ticket && (
            <>
              <p class="hint">{restrictionText ? restrictionText : 'No time restrictions: valid on any train on this route.'}</p>
              <label class="check">
                <input type="checkbox" checked={validOnly} onChange={(e) => setValidOnly((e.currentTarget as HTMLInputElement).checked)} />
                Show valid trains only
              </label>
            </>
          )}
        </div>
      )}

      {journeys.length === 0 && <p>No journeys with up to two changes were found on this day.</p>}
      {journeys.length > 0 && shown.length === 0 && (
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
                      {operatorName(leg.operator)}
                      {leg.bus ? ' bus' : ''}
                    </p>
                    <ol class="calls">
                      {leg.calls.map((c, i) => (
                        <li key={`${c.crs}-${i}`}>
                          <span class="call-time">{clock((i === 0 ? c.dep : c.arr) ?? c.dep ?? 0)}</span>
                          <span>{name(c.crs)}</span>
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
