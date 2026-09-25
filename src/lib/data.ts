// Loads the published data files. The service worker caches them, so a day that has been
// searched once also works offline.
import type { DataMeta, DayFile, Station } from './timetable.ts';

const base = `${import.meta.env.BASE_URL}data/`;

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(base + path);
  if (!res.ok) throw new Error(`Could not load ${path} (HTTP ${res.status})`);
  return res.json() as Promise<T>;
}

export const loadMeta = () => getJson<DataMeta>('meta.json');
export const loadStations = () => getJson<Station[]>('stations.json');

const days = new Map<string, Promise<DayFile>>();
export function loadDay(date: string): Promise<DayFile> {
  let day = days.get(date);
  if (!day) {
    day = getJson<DayFile>(`days/${date}.json`);
    day.catch(() => days.delete(date));
    days.set(date, day);
  }
  return day;
}

export const ukToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());

/** Station search: exact code first, then names starting with the text, then containing it. */
export function searchStations(stations: Station[], text: string, limit = 8): Station[] {
  const q = text.trim().toLowerCase();
  if (!q) return [];
  const rank = (s: Station) => {
    const name = s.name.toLowerCase();
    if (s.crs.toLowerCase() === q) return 0;
    if (name.startsWith(q)) return 1;
    if (name.split(/[\s(-]+/).some((w) => w.startsWith(q))) return 2;
    if (name.includes(q)) return 3;
    return -1;
  };
  return stations
    .map((s) => [rank(s), s] as const)
    .filter(([r]) => r >= 0)
    .sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name))
    .slice(0, limit)
    .map(([, s]) => s);
}
