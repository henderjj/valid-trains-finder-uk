// Permitted routes from the National Routeing Guide, following the rules in its data feed
// specification. A journey is permitted when it is on one train, when it is no more than
// 3 miles longer than the shortest route, or when it reaches a routeing point for its origin,
// follows one of the permitted sequences of maps to a routeing point for its destination,
// and is direct at either end. Checks that need the 1996 baseline fares (whether a routeing
// point is appropriate, doublebacks through the origin or destination) and easements are not
// made, so a journey they would allow may be reported as not permitted, and one they would
// forbid as permitted.
import type { Journey } from './timetable.ts';

/** routeing.json */
export interface RouteingData {
  /** Routeing points each station uses; an empty list means the station is one itself, or its group is. */
  stations: Record<string, string[]>;
  /** Station -> routeing point group it belongs to, e.g. "MAN" -> "G20". */
  groups: Record<string, string>;
  /** Routeing point group -> its main station. */
  mains: Record<string, string>;
  /** Codes of stations and groups that are routeing points. */
  points: string[];
  /** Codes of routeing points and interchanges: the places where links on the maps start and end. */
  nodes: string[];
  /** "A-B" (codes in sorted order) -> maps the link between two nodes is on. */
  links: Record<string, string[]>;
  /** Track between neighbouring stations: [station, station, miles]. */
  distances: [string, string, number][];
  /** The routeing point group of the London stations, for routes via London. */
  london: string;
  /** New stations that take the routeing of an existing one. */
  aliases: Record<string, string>;
  /** Fare route code -> the places and operators its description requires or excludes. */
  fareRoutes: Record<string, FareRoute>;
}

export interface FareRoute {
  /** The journey must pass all of these. Each entry is alternatives: any station in it counts. */
  all?: string[][];
  /** The journey must pass at least one of these. */
  any?: string[][];
  /** The journey must not pass any of these. */
  not?: string[][];
  /** At least one train must be run by one of these operators. */
  tocs?: string[];
  /** No train may be run by these operators. */
  notTocs?: string[];
}

/** routeing/<code>.json: other routeing point -> alternative sequences of maps. */
export type PermittedRoutes = Record<string, string[][]>;

/** How many miles longer than the shortest route a journey may be and still be permitted. */
const MARGIN = 3;
/** The special map for "via London" routes. */
const VIA_LONDON = 'LO';

export interface RouteCheck {
  /** true or false, or undefined when the routeing guide can't say (unknown stations, no routes listed). */
  permitted: boolean | undefined;
  /** Why, in a few words, for checking by hand. */
  why: string;
  /** True when the fare's own route (a place or operator it names) is what rules the journey out. */
  byFareRoute?: boolean;
}

/** A journey as the stations it passes, with where it changes trains. */
interface Path {
  stations: string[];
  /** Miles from the start to each station. */
  miles: number[];
  /** Indexes of stations where the journey changes train. */
  changes: number[];
  operators: string[];
}

export class Routeing {
  private readonly points: Set<string>;
  private readonly nodes: Set<string>;
  private readonly graph = new Map<string, [string, number][]>();
  private readonly paths = new Map<string, { miles: number; via: string[] } | null>();

  constructor(
    readonly data: RouteingData,
    /** Permitted routes keyed by routeing point, for the points this search needs (see routeFiles). */
    readonly routes: Map<string, PermittedRoutes>,
  ) {
    this.points = new Set(data.points);
    this.nodes = new Set([...data.nodes, ...data.points]);
    for (const [a, b, miles] of data.distances) {
      for (const [x, y] of [
        [a, b],
        [b, a],
      ]) {
        const list = this.graph.get(x) ?? [];
        if (!list.some(([s]) => s === y)) list.push([y, miles]);
        this.graph.set(x, list);
      }
    }
  }

  private station(crs: string): string {
    return this.data.aliases[crs] ?? crs;
  }

  /** The routeing point, or node, a station counts as: its group if the group is one, else itself. */
  private nodeOf(crs: string, set: Set<string>): string | undefined {
    const s = this.station(crs);
    const group = this.data.groups[s];
    if (group && set.has(group)) return group;
    return set.has(s) ? s : undefined;
  }

  /** The routeing points related to a station. */
  related(crs: string): string[] {
    const own = this.nodeOf(crs, this.points);
    if (own) return [own];
    return this.data.stations[this.station(crs)] ?? [];
  }

  /** Routeing points whose permitted-route files a search between two stations needs. */
  routeFiles(from: string, to: string): string[] {
    return [...new Set([...this.related(from), ...this.related(to), this.data.london])].filter(Boolean);
  }

  /** Shortest track between two stations, with the stations on the way, or null if none. */
  shortest(from: string, to: string): { miles: number; via: string[] } | null {
    const a = this.station(from);
    const b = this.station(to);
    const key = `${a}>${b}`;
    if (this.paths.has(key)) return this.paths.get(key)!;
    const dist = new Map<string, number>([[a, 0]]);
    const prev = new Map<string, string>();
    const done = new Set<string>();
    // A simple binary heap keeps this quick over the whole network.
    const heap: [number, string][] = [[0, a]];
    const push = (item: [number, string]) => {
      heap.push(item);
      for (let i = heap.length - 1; i > 0; ) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        for (let i = 0; ; ) {
          const l = i * 2 + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    let result: { miles: number; via: string[] } | null = null;
    while (heap.length) {
      const [d, s] = pop();
      if (done.has(s)) continue;
      done.add(s);
      if (s === b) {
        const via = [b];
        for (let x = b; x !== a; ) via.unshift((x = prev.get(x)!));
        result = { miles: Math.round(d * 100) / 100, via };
        break;
      }
      for (const [n, miles] of this.graph.get(s) ?? []) {
        const nd = d + miles;
        if (nd < (dist.get(n) ?? Infinity)) {
          dist.set(n, nd);
          prev.set(n, s);
          push([nd, n]);
        }
      }
    }
    this.paths.set(key, result);
    return result;
  }

  /**
   * Every station a journey passes, following the shortest track between its calls (the
   * timetable lists only stops). Bus legs count as no distance, as the spec allows.
   */
  private trace(journey: Journey): Path | { missing: [string, string] } {
    const path: Path = { stations: [], miles: [], changes: [], operators: journey.legs.map((l) => l.operator) };
    let miles = 0;
    const add = (crs: string) => {
      const n = path.stations.length;
      // The map draws some stations on short spurs off the line (Coleshill Parkway off Water
      // Orton, say), so the shortest track to one and on again runs X, Y, X. Trains don't
      // double back there, so drop the spur unless the journey changes train at it.
      if (n >= 2 && path.stations[n - 2] === crs && !path.changes.includes(n - 1)) {
        path.stations.pop();
        path.miles.pop();
        miles = path.miles[n - 2];
        return;
      }
      path.stations.push(crs);
      path.miles.push(miles);
    };
    for (const [k, leg] of journey.legs.entries()) {
      // Some timetable codes aren't on the map (Tamworth High Level is drawn as Tamworth), so
      // stops in the middle of a leg without track data are passed over.
      const calls = leg.calls.map((c) => this.station(c.crs)).filter((c, i, all) => i === 0 || i === all.length - 1 || leg.bus || this.graph.has(c));
      if (k > 0) path.changes.push(path.stations.length - 1);
      if (!path.stations.length) add(calls[0]);
      for (let i = 0; i + 1 < calls.length; i++) {
        if (leg.bus) {
          add(calls[i + 1]);
          continue;
        }
        const p = this.shortest(calls[i], calls[i + 1]);
        if (!p) return { missing: [calls[i], calls[i + 1]] };
        for (let s = 1; s < p.via.length; s++) {
          miles += this.shortest(p.via[s - 1], p.via[s])!.miles;
          add(p.via[s]);
        }
      }
    }
    return path;
  }

  /** Whether a journey is on a permitted route. */
  check(journey: Journey): RouteCheck {
    if (journey.legs.length === 1) return { permitted: true, why: 'one train' };
    const path = this.trace(journey);
    if ('missing' in path) return { permitted: undefined, why: `no track data from ${path.missing.join(' to ')}` };
    return this.checkPath(path, 0, path.stations.length - 1);
  }

  /**
   * Whether a journey is on a permitted route for a fare, including the places and operators
   * its route description requires or excludes. A fare routed via a place is also valid when
   * each part of the journey, split there, is on a permitted route.
   */
  /** Whether the routeing guide has place or operator data for a fare route. */
  hasFareRoute(route: string): boolean {
    return route in this.data.fareRoutes;
  }

  checkFare(journey: Journey, route: string): RouteCheck {
    const r = this.data.fareRoutes[route];
    const path = r ? this.trace(journey) : null;
    if (!r || !path || 'missing' in path) return this.check(journey);
    const passes = (alternatives: string[]) => path.stations.some((s) => alternatives.includes(s));
    const missing = r.all?.find((a) => !passes(a)) ?? (r.any && !r.any.some(passes) ? r.any.flat() : undefined);
    if (missing) return { permitted: false, why: `does not go via ${missing[0]}`, byFareRoute: true };
    const avoided = r.not?.find(passes);
    if (avoided) return { permitted: false, why: `goes via ${avoided.find((s) => path.stations.includes(s))}`, byFareRoute: true };
    if (r.tocs && !path.operators.some((o) => r.tocs!.includes(o))) return { permitted: false, why: `no ${r.tocs.join('/')} train`, byFareRoute: true };
    const barred = r.notTocs && path.operators.find((o) => r.notTocs!.includes(o));
    if (barred) return { permitted: false, why: `uses ${barred}`, byFareRoute: true };

    if (journey.legs.length === 1) return { permitted: true, why: 'one train' };
    const whole = this.checkPath(path, 0, path.stations.length - 1);
    const vias = [...(r.all ?? []), ...(r.any ?? [])];
    if (whole.permitted !== false || !vias.length) return whole;
    // Split the journey at the places it is routed via, and check each part.
    const at = path.stations.map((s, i) => (vias.some((v) => v.includes(s)) ? i : -1)).filter((i) => i > 0 && i < path.stations.length - 1);
    if (!at.length) return whole;
    const bounds = [0, ...at, path.stations.length - 1];
    for (let k = 1; k < bounds.length; k++) {
      const part = this.checkPath(path, bounds[k - 1], bounds[k]);
      if (part.permitted !== true) return { permitted: part.permitted, why: `split at ${path.stations[bounds[k - 1]]}: ${part.why}` };
    }
    return { permitted: true, why: `split at ${at.map((i) => path.stations[i]).join(', ')}` };
  }

  /** Section 7.1: the general rules, for the part of a path from station a to station b. */
  private checkPath(path: Path, a: number, b: number): RouteCheck {
    const origin = path.stations[a];
    const destination = path.stations[b];
    if (!this.hasChange(path, a, b)) return { permitted: true, why: 'one train' };
    const shortest = this.shortest(origin, destination);
    if (!shortest) return { permitted: undefined, why: 'no track data' };
    if (path.miles[b] - path.miles[a] <= shortest.miles + MARGIN) return { permitted: true, why: 'within 3 miles of the shortest route' };

    const fromPoints = this.related(origin);
    const toPoints = this.related(destination);
    if (!fromPoints.length || !toPoints.length) return { permitted: undefined, why: 'station not in the routeing guide' };
    const common = fromPoints.filter((p) => toPoints.includes(p));
    if (common.length) return this.local(path, a, b, common);

    let orp = -1;
    for (let i = a; i <= b && orp === -1; i++) if (fromPoints.includes(this.nodeOf(path.stations[i], this.points)!)) orp = i;
    let drp = -1;
    for (let i = b; i >= a && drp === -1; i--) if (toPoints.includes(this.nodeOf(path.stations[i], this.points)!)) drp = i;
    if (orp === -1) return { permitted: false, why: `does not pass ${fromPoints.join('/')}` };
    if (drp === -1) return { permitted: false, why: `does not pass ${toPoints.join('/')}` };
    if (drp < orp) return { permitted: false, why: 'reaches the destination routeing point first' };

    const lead = this.local(path, a, orp, []);
    if (lead.permitted !== true) return { permitted: lead.permitted, why: `to ${path.stations[orp]}: ${lead.why}` };
    const tail = this.local(path, drp, b, []);
    if (tail.permitted !== true) return { permitted: tail.permitted, why: `from ${path.stations[drp]}: ${tail.why}` };
    return this.mapJourney(path, orp, drp);
  }

  private hasChange(path: Path, a: number, b: number): boolean {
    return path.changes.some((c) => c > a && c < b);
  }

  /** Section 7.2: local journey rules. `common` lists routeing points shared by both ends. */
  private local(path: Path, a: number, b: number, common: string[]): RouteCheck {
    if (a >= b || !this.hasChange(path, a, b)) return { permitted: true, why: 'one train' };
    const from = path.stations[a];
    const to = path.stations[b];
    const shortest = this.shortest(from, to);
    if (!shortest) return { permitted: undefined, why: 'no track data' };
    if (path.miles[b] - path.miles[a] <= shortest.miles + MARGIN) return { permitted: true, why: 'within 3 miles of the shortest route' };

    // Deviations through stations in the same group as one on the shortest route.
    const endGroups = new Set([this.data.groups[from], this.data.groups[to]]);
    const onShortest = new Set(shortest.via);
    const shortGroups = new Set(shortest.via.map((s) => this.data.groups[s]).filter((g) => g && !endGroups.has(g)));
    const stations = path.stations.slice(a, b + 1);
    if (stations.every((s) => (onShortest.has(s) && stations.indexOf(s) === stations.lastIndexOf(s)) || shortGroups.has(this.data.groups[s]))) {
      return { permitted: true, why: 'shortest route, with a deviation within a station group' };
    }

    // Through trains to and from a common routeing point, changing only there.
    const changes = path.changes.filter((c) => c > a && c < b);
    const at = new Set(changes.map((c) => this.nodeOf(path.stations[c], this.points)));
    const [point] = at;
    if (at.size === 1 && point && common.includes(point)) {
      const viaMiles = (p: string, s = this.data.mains[p] ?? p) => (this.shortest(from, s)?.miles ?? Infinity) + (this.shortest(s, to)?.miles ?? Infinity);
      const best = Math.min(...common.map((p) => viaMiles(p)));
      if (viaMiles(point, path.stations[changes[0]]) <= best + MARGIN) return { permitted: true, why: `changing at routeing point ${point}` };
    }
    return { permitted: false, why: `${Math.round(path.miles[b] - path.miles[a])} miles against ${Math.round(shortest.miles)} by the shortest route` };
  }

  /** Section 7.3: the part from the origin's routeing point to the destination's follows a permitted route. */
  private mapJourney(path: Path, orp: number, drp: number): RouteCheck {
    const from = this.nodeOf(path.stations[orp], this.points)!;
    const to = this.nodeOf(path.stations[drp], this.points)!;
    if (from === to) return { permitted: true, why: 'within one routeing point' };

    // No station twice, except wandering within a station group other than the ends'.
    const endGroups = new Set([this.data.groups[path.stations[0]], this.data.groups[path.stations[path.stations.length - 1]]]);
    const seen = new Set<string>();
    for (let i = orp; i <= drp; i++) {
      const s = path.stations[i];
      const group = this.data.groups[s];
      if (seen.has(s) && !(group && !endGroups.has(group) && group === this.data.groups[path.stations[i - 1]])) {
        return { permitted: false, why: `passes ${s} twice` };
      }
      seen.add(s);
    }

    const nodes: string[] = [];
    for (let i = orp; i <= drp; i++) {
      const n = this.nodeOf(path.stations[i], this.nodes);
      if (n && n !== nodes[nodes.length - 1]) nodes.push(n);
    }
    const routes = this.permitted(from, to);
    if (!routes.length) return { permitted: undefined, why: `no permitted routes listed from ${from} to ${to}` };
    if (routes.some((maps) => this.follows(nodes, maps))) return { permitted: true, why: `follows a permitted route from ${from} to ${to}` };
    return { permitted: false, why: `${nodes.join(' ')} is not a permitted route from ${from} to ${to}` };
  }

  /** Permitted map sequences from one routeing point to another, in that direction. */
  private permitted(from: string, to: string): string[][] {
    const out = [...(this.routes.get(from)?.[to] ?? [])];
    for (const maps of this.routes.get(to)?.[from] ?? []) {
      const reversed = [...maps].reverse();
      if (!out.some((m) => m.join() === reversed.join())) out.push(reversed);
    }
    return out;
  }

  /**
   * Whether the links between consecutive nodes can be given to the maps in order, each map
   * getting at least one link (7.3.5). "Via London" splits the journey at the London group.
   */
  private follows(nodes: string[], maps: string[], depth = 0): boolean {
    if (maps.length === 1 && maps[0] === VIA_LONDON) {
      const london = this.data.london;
      const i = nodes.indexOf(london);
      if (i <= 0 || i >= nodes.length - 1 || depth) return false;
      const first = nodes.slice(0, i + 1);
      const second = nodes.slice(i);
      return (
        this.permitted(nodes[0], london).some((m) => this.follows(first, m, depth + 1)) &&
        this.permitted(london, nodes[nodes.length - 1]).some((m) => this.follows(second, m, depth + 1))
      );
    }
    // Positions in the map sequence the links so far can end on.
    let at = new Set<number>([-1]);
    for (let k = 1; k < nodes.length; k++) {
      const on = this.data.links[[nodes[k - 1], nodes[k]].sort().join('-')] ?? [];
      const next = new Set<number>();
      for (const p of at) {
        if (p >= 0 && on.includes(maps[p])) next.add(p);
        if (p + 1 < maps.length && on.includes(maps[p + 1])) next.add(p + 1);
      }
      if (!next.size) return false;
      at = next;
    }
    return at.has(maps.length - 1);
  }
}
