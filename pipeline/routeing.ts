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
  groups: Iterable<string>;
  points: Iterable<string>;
  nodes: Iterable<string>;
  links: Iterable<string>;
  distances: Iterable<string>;
  london: Iterable<string>;
  newStations: Iterable<string>;
  fareRoutes: Iterable<string>;
}): RouteingData {
  const data: RouteingData = {
    stations: {},
    groups: {},
    mains: {},
    points: [],
    nodes: [],
    links: {},
    distances: [],
    london: '',
    aliases: {},
    fareRoutes: {},
  };
  // RGS: station, up to four routeing points, and the routeing point group it belongs to.
  for (const [crs, ...rest] of rows(files.stations)) {
    const group = rest[4]?.trim();
    data.stations[crs] = rest.slice(0, 4).map((r) => r.trim()).filter(Boolean);
    if (group) data.groups[crs] = group;
  }
  // RGG: group, main station.
  for (const [group, main] of rows(files.groups)) data.mains[group.trim()] = main.trim();
  data.points = [...new Set(rows(files.points).map(([p]) => p.trim()))].sort();
  data.nodes = [...new Set(rows(files.nodes).map(([p]) => p.trim()))].sort();
  // RGL: node, node, map. Listed in both directions.
  for (const [a, b, map] of rows(files.links)) {
    const key = [a, b].sort().join('-');
    const maps = (data.links[key] ??= []);
    if (!maps.includes(map)) maps.push(map);
  }
  // RGD: station, neighbouring station, miles. Usually listed in both directions; keep one.
  const seen = new Set<string>();
  for (const [a, b, miles] of rows(files.distances)) {
    const key = [a, b].sort().join('-');
    if (seen.has(key)) continue;
    seen.add(key);
    data.distances.push([a, b, Number(miles)]);
  }
  // RGC: London station, London terminal (Y/N), cross-London transfer (Y/N). The London
  // group is the group most London terminals are in.
  const count = new Map<string, number>();
  for (const [crs, terminal] of rows(files.london)) {
    const group = data.groups[crs];
    if (terminal === 'Y' && group) count.set(group, (count.get(group) ?? 0) + 1);
  }
  data.london = [...count].sort((x, y) => y[1] - x[1])[0]?.[0] ?? '';
  // RGX: the existing station, the new station that takes its routeing, dates.
  for (const [existing, crs] of rows(files.newStations)) data.aliases[crs] ??= existing;
  // RGK route data: route, D, entry type, CRS, group marker, mode, TOC.
  const members = new Map<string, string[]>();
  for (const [crs, group] of Object.entries(data.groups)) members.set(group, [...(members.get(group) ?? []), crs]);
  for (const [route, type, entry, crs, group, , toc] of rows(files.fareRoutes)) {
    if (type !== 'D') continue;
    const r = (data.fareRoutes[route] ??= {});
    const place = group === 'Y' && data.groups[crs] ? members.get(data.groups[crs])! : [crs];
    if (entry === 'A') (r.all ??= []).push(place);
    else if (entry === 'I') (r.any ??= []).push(place);
    else if (entry === 'E') (r.not ??= []).push(place);
    else if (entry === 'T' && toc) (r.tocs ??= []).push(toc.trim());
    else if (entry === 'X' && toc) (r.notTocs ??= []).push(toc.trim());
  }
  for (const [route, r] of Object.entries(data.fareRoutes)) if (!Object.keys(r).length) delete data.fareRoutes[route];
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
