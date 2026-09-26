import { useId, useMemo, useRef, useState } from 'preact/hooks';
import { searchStations } from './lib/data.ts';
import { stationName, type Station } from './lib/timetable.ts';

interface Props {
  label: string;
  stations: Station[];
  value: Station | null;
  onChange: (station: Station | null) => void;
}

/**
 * A suggestion is picked as the tap ends, which closes the list before the browser sends the
 * tap's click. The click would then land on whatever was under the list, such as the date
 * box, which would open. This drops that stray click.
 */
function ignoreStrayClick() {
  const stop = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };
  for (const type of ['mousedown', 'click']) document.addEventListener(type, stop, true);
  setTimeout(() => {
    for (const type of ['mousedown', 'click']) document.removeEventListener(type, stop, true);
  }, 500);
}

/** Text box with a suggestion list; accepts a station name or its three-letter code. */
export function StationInput({ label, stations, value, onChange }: Props) {
  const id = useId();
  const [text, setText] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(false);
  // Where a press on a suggestion started; cleared when the finger moves to scroll instead.
  const press = useRef<{ crs: string; x: number; y: number } | null>(null);
  // A city's group has no station code to show.
  const describe = (s: Station) => (s.members ? stationName(s) : `${s.name} (${s.note ? `${s.note}, ` : ''}${s.crs})`);
  const shown = text ?? (value ? describe(value) : '');
  const found = useMemo(() => (text ? searchStations(stations, text) : []), [stations, text]);
  const matches = focused ? found : [];

  const choose = (s: Station) => {
    onChange(s);
    setText(null);
    setActive(0);
  };

  return (
    <div class="station">
      <label for={id}>{label}</label>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={matches.length > 0}
        aria-controls={`${id}-list`}
        aria-activedescendant={matches.length ? `${id}-${active}` : undefined}
        autocomplete="off"
        placeholder="Station name or code"
        value={shown}
        onFocus={(e) => {
          setFocused(true);
          (e.currentTarget as HTMLInputElement).select();
        }}
        onInput={(e) => {
          setText((e.currentTarget as HTMLInputElement).value);
          setActive(0);
          if (value) onChange(null);
        }}
        onKeyDown={(e) => {
          if (!matches.length) return;
          if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, matches.length - 1));
          else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
          else if (e.key === 'Enter') choose(matches[active]);
          else if (e.key === 'Escape') setText(null);
          else return;
          e.preventDefault();
        }}
        onBlur={() => {
          setFocused(false);
          // Leaving the box with exactly one match picks it.
          if (!value && found.length === 1) choose(found[0]);
        }}
      />
      {matches.length > 0 && (
        <ul id={`${id}-list`} role="listbox" class="suggestions">
          {matches.map((s, i) => (
            <li
              key={s.crs}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === active}
              onPointerDown={(e) => {
                // Keeps the text box focused, so the list stays open.
                e.preventDefault();
                press.current = { crs: s.crs, x: e.clientX, y: e.clientY };
              }}
              onPointerMove={(e) => {
                const p = press.current;
                if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) press.current = null;
              }}
              onPointerCancel={() => (press.current = null)}
              onPointerUp={() => {
                // Only a tap picks: a press that became a scroll doesn't.
                if (press.current?.crs !== s.crs) return;
                press.current = null;
                ignoreStrayClick();
                choose(s);
              }}
            >
              <span>
                {s.name}
                {s.note && <span class="note"> {s.note}</span>}
              </span>
              {!s.members && <span class="crs">{s.crs}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
