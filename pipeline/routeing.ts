// Parser for the routeing guide feed (RJRG zip): comma-separated files of stations and their
// routeing points, maps, links, distances and permitted routes.
import type { PermittedRoutes, RouteingData } from '../src/lib/routeing.ts';

const rows = (lines: Iterable<string>) => {
  const out: string[][] = [];
  for (const l of lines) if (l && !l.startsWith('/')) out.push(l.split(','));
  return out;
};

export function parseRouteing(files: {
  stations: Iterable<string>;
  points: Iterable<string>;
  links: Iterable<string>;
  distances: Iterable<string>;
  london: Iterable<string>;
  newStations: Iterable<string>;
}): RouteingData {
  const data: RouteingData = { stations: {}, groups: {}, points: [], links: {}, distances: [], london: [], aliases: {} };
  // RGS: station, up to four routeing points, and the routeing point group it belongs to.
  for (const [crs, ...rest] of rows(files.stations)) {
    const group = rest[4]?.trim();
    data.stations[crs] = rest.slice(0, 4).map((r) => r.trim()).filter(Boolean);
    if (group) data.groups[crs] = group;
  }
  const points = new Set(rows(files.points).map(([p]) => p.trim()));
  for (const g of Object.values(data.groups)) points.add(g);
  data.points = [...points].sort();
  // RGL: routeing point, routeing point, map.
  for (const [a, b, map] of rows(files.links)) {
    const key = [a, b].sort().join('-');
    const maps = (data.links[key] ??= []);
    if (!maps.includes(map)) maps.push(map);
  }
  // RGD: station, neighbouring station, miles. Listed in both directions; keep one.
  for (const [a, b, miles] of rows(files.distances)) if (a < b) data.distances.push([a, b, Number(miles)]);
  data.london = rows(files.london).map(([crs]) => crs);
  // RGX: new station, the existing station whose routeing it takes, dates.
  for (const [crs, as] of rows(files.newStations)) data.aliases[crs] ??= as;
  return data;
}

/** RGR: routeing point, routeing point, then the maps of one permitted route. Grouped by the first point. */
export function parsePermittedRoutes(lines: Iterable<string>): Map<string, PermittedRoutes> {
  const out = new Map<string, PermittedRoutes>();
  for (const [a, b, ...maps] of rows(lines)) {
    const byDest = out.get(a) ?? {};
    (byDest[b] ??= []).push(maps);
    out.set(a, byDest);
  }
  return out;
}
