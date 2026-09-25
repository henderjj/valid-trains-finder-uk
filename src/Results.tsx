import { useMemo, useState } from 'preact/hooks';
import { operatorName } from './lib/operators.ts';
import { clock, duration, type DirectJourney, type Station } from './lib/timetable.ts';

interface Props {
  from: Station;
  to: Station;
  date: string;
  journeys: DirectJourney[];
  stations: Station[];
}

const longDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

export function Results({ from, to, date, journeys, stations }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const names = useMemo(() => new Map(stations.map((s) => [s.crs, s.name])), [stations]);

  return (
    <section class="results" aria-live="polite">
      <h2>
        {from.name} → {to.name}
      </h2>
      <p class="hint">
        {longDate(date)} · {journeys.length ? `${journeys.length} direct ${journeys.length === 1 ? 'train' : 'trains'}` : 'No direct trains'}
      </p>
      {journeys.length === 0 && <p>Journeys with changes are coming in a later version.</p>}
      <ol class="journeys">
        {journeys.map((j) => {
          const key = `${j.uid}-${j.dep}`;
          const expanded = open === key;
          return (
            <li key={key} class="journey">
              <button type="button" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : key)}>
                <span class="times">
                  {clock(j.dep)} → {clock(j.arr)}
                </span>
                <span class="duration">{duration(j.arr - j.dep)}</span>
                <span class="meta">
                  {j.stops === 0 ? 'Non-stop' : `${j.stops} ${j.stops === 1 ? 'stop' : 'stops'}`} · {operatorName(j.operator)}
                  {j.bus && ' · Bus'}
                </span>
              </button>
              {expanded && (
                <ol class="calls">
                  {j.calls.map((c, i) => (
                    <li key={`${c.crs}-${i}`}>
                      <span class="call-time">{clock((i === 0 ? c.dep : c.arr) ?? c.dep ?? 0)}</span>
                      <span>{names.get(c.crs) ?? c.crs}</span>
                    </li>
                  ))}
                </ol>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
