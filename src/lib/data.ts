// Loads the published data files. The service worker caches them, so a day that has been
// searched once also works offline.
import { faresBetween, type FareFile, type FareOption, type FaresMeta, type RestrictionSet } from './fares.ts';
import { Routeing, type PermittedRoutes, type RouteingData } from './routeing.ts';
import type { DataMeta, DayFile, Station } from './timetable.ts';

const base = `${import.meta.env.BASE_URL}data/`;

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(base + path);
  if (!res.ok) throw new Error(`Could not load ${path} (HTTP ${res.status})`);
  return res.json() as Promise<T>;
}

export const loadMeta = () => getJson<DataMeta>('meta.json');
export const loadStations = () => getJson<Station[]>('stations.json');
/** Operator names from the fares feed, by timetable code; empty when not published. */
export const loadOperators = () => getJson<Record<string, string>>('operators.json').catch(() => ({}));

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

const once = <T>(load: () => Promise<T>) => {
  let p: Promise<T> | undefined;
  return () => {
    p ??= load();
    p.catch(() => (p = undefined));
    return p;
  };
};

const loadFaresMeta = once(() => getJson<FaresMeta>('fares-meta.json'));
export const loadRestrictions = once(() => getJson<RestrictionSet[]>('restrictions.json'));

const fareFiles = new Map<string, Promise<FareFile>>();
function loadFareFile(code: string): Promise<FareFile> {
  let file = fareFiles.get(code);
  if (!file) {
    // Most location codes have no fares of their own, so a missing file just means none.
    file = fetch(`${base}fares/${code}.json`).then((res) => (res.ok ? (res.json() as Promise<FareFile>) : {}));
    file.catch(() => fareFiles.delete(code));
    fareFiles.set(code, file);
  }
  return file;
}

const loadRouteingData = once(() => getJson<RouteingData>('routeing.json'));
const routeFiles = new Map<string, Promise<PermittedRoutes>>();

/**
 * The routeing guide, with the permitted routes a journey between two stations needs, or
 * null when the data isn't published.
 */
export async function loadRouteing(from: string, to: string): Promise<Routeing | null> {
  const data = await loadRouteingData().catch(() => null);
  if (!data) return null;
  const codes = new Routeing(data, new Map()).routeFiles(from, to);
  const routes = await Promise.all(
    codes.map(async (code) => {
      let file = routeFiles.get(code);
      if (!file) {
        file = fetch(`${base}routeing/${code}.json`).then((res) => (res.ok ? (res.json() as Promise<PermittedRoutes>) : {}));
        file.catch(() => routeFiles.delete(code));
        routeFiles.set(code, file);
      }
      return [code, await file] as const;
    }),
  );
  return new Routeing(data, new Map(routes));
}

/** Walk-up fares from one station to another. */
export async function loadFares(from: string, to: string): Promise<FareOption[]> {
  const meta = await loadFaresMeta();
  const codes = meta.locations[from] ?? [];
  const files = new Map(await Promise.all(codes.map(async (c) => [c, await loadFareFile(c)] as const)));
  return faresBetween(meta, files, from, to);
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
