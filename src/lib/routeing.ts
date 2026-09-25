// Permitted routes from the National Routeing Guide. A journey is on a permitted route when
// it is no more than 3% longer than the shortest route, or when it follows one of the
// routeing guide's permitted maps between the origin's and destination's routeing points.
import type { Journey } from './timetable.ts';

/** routeing.json */
export interface RouteingData {
  /** Routeing points each station uses; an empty list means the station is one itself. */
  stations: Record<string, string[]>;
  /** Station -> routeing point group it belongs to, e.g. "MAN" -> "G20". */
  groups: Record<string, string>;
  /** Codes of stations and groups that are routeing points. */
  points: string[];
  /** "A-B" (codes in sorted order) -> maps the link between two routeing points is on. */
  links: Record<string, string[]>;
  /** Track between neighbouring stations: [station, station, miles]. */
  distances: [string, string, number][];
  /** London stations, for routes that go via London. */
  london: string[];
  /** New stations that take the routeing of an existing one. */
  aliases: Record<string, string>;
}

/** routes/<code>.json: other routeing point -> alternative sets of maps. */
export type PermittedRoutes = Record<string, string[][]>;

/** How much longer than the shortest route a journey may be and still be permitted. */
const TOLERANCE = 1.03;

export class Routeing {
  private readonly points: Set<string>;
  private readonly london: Set<string>;
  private readonly graph = new Map<string, [string, number][]>();
  private readonly paths = new Map<string, { miles: number; via: string[] } | null>();

  constructor(
    readonly data: RouteingData,
    /** Permitted routes keyed by routeing point, for the points this search needs. */
    readonly routes: Map<string, PermittedRoutes>,
  ) {
    this.points = new Set(data.points);
    this.london = new Set(data.london);
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

  /** The routeing points a station uses. */
  pointsOf(crs: string): string[] {
    const s = this.station(crs);
    const own = this.data.stations[s];
    if (own && own.length) return own;
    const group = this.data.groups[s];
    return group ? [group, s] : [s];
  }

  /** The routeing point a station on the way counts as, if it is one. */
  private pointAt(crs: string): string | undefined {
    const s = this.station(crs);
    const group = this.data.groups[s];
    if (group && this.points.has(group)) return group;
    return this.points.has(s) ? s : undefined;
  }

  private at(crs: string, point: string): boolean {
    const s = this.station(crs);
    return s === point || this.data.groups[s] === point;
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
        result = { miles: d, via };
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

  /** Every station a journey passes, following the shortest track between its calls. */
  private trace(journey: Journey): { stations: string[]; miles: number } | null {
    const stations: string[] = [];
    let miles = 0;
    for (const leg of journey.legs) {
      for (let i = 0; i + 1 < leg.calls.length; i++) {
        const p = this.shortest(leg.calls[i].crs, leg.calls[i + 1].crs);
        if (!p) return null;
        miles += p.miles;
        stations.push(...(stations.length ? p.via.slice(1) : p.via));
      }
    }
    return { stations, miles };
  }

  private permittedFor(a: string, b: string): string[][] {
    return [...(this.routes.get(a)?.[b] ?? []), ...(this.routes.get(b)?.[a] ?? [])];
  }

  /**
   * Whether a journey is on a permitted route: true or false, or undefined when the
   * routeing guide doesn't cover it (a station it doesn't know, or no route listed).
   */
  check(journey: Journey): boolean | undefined {
    const first = journey.legs[0].calls[0].crs;
    const lastLeg = journey.legs[journey.legs.length - 1];
    const last = lastLeg.calls[lastLeg.calls.length - 1].crs;
    const direct = this.shortest(first, last);
    const trace = this.trace(journey);
    if (!direct || !trace) return undefined;
    // Rounding in the published distances needs a little slack on short journeys.
    if (trace.miles <= direct.miles * TOLERANCE + 0.5) return true;

    const from = this.pointsOf(first);
    const to = this.pointsOf(last);
    if (from.some((p) => to.includes(p))) return false;

    let listed = false;
    const { stations } = trace;
    for (const o of from) {
      for (const d of to) {
        const alternatives = this.permittedFor(o, d);
        if (!alternatives.length) continue;
        listed = true;
        const i = stations.findIndex((s) => this.at(s, o));
        let j = stations.length - 1;
        while (j >= 0 && !this.at(stations[j], d)) j--;
        if (i === -1 || j === -1 || i > j) continue;
        // Getting to the origin's routeing point, and on from the destination's, must be direct.
        const lead = this.shortest(first, stations[i]);
        const tail = this.shortest(stations[j], last);
        const leadMiles = this.milesAlong(stations, 0, i);
        const tailMiles = this.milesAlong(stations, j, stations.length - 1);
        if (!lead || !tail || leadMiles > lead.miles * TOLERANCE + 0.5 || tailMiles > tail.miles * TOLERANCE + 0.5) continue;

        const passed: string[] = [];
        for (const s of stations.slice(i, j + 1)) {
          const p = this.pointAt(s);
          if (p && p !== passed[passed.length - 1]) passed.push(p);
        }
        const viaLondon = stations.some((s) => this.london.has(s));
        const ok = alternatives.some(
          (maps) =>
            (maps.includes('LO') && viaLondon) ||
            passed.every((p, k) => k === 0 || (this.data.links[[passed[k - 1], p].sort().join('-')] ?? []).some((m) => maps.includes(m))),
        );
        if (ok) return true;
      }
    }
    return listed ? false : undefined;
  }

  private milesAlong(stations: string[], from: number, to: number): number {
    let miles = 0;
    for (let k = from; k < to; k++) miles += this.shortest(stations[k], stations[k + 1])?.miles ?? 0;
    return miles;
  }
}
