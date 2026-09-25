// Journey planning with changes, using the Connection Scan Algorithm over one day's trains.
// A search runs repeated earliest-arrival scans, each starting just after the previous
// journey's departure, so it lists the best journey for every departure through the day.
import { callsOf, findDirect, type DayFile, type DayTrain, type Journey, type Leg, type Stop } from './timetable.ts';

export type { Journey, Leg };

export interface PlanOptions {
  /** Most trains in one journey. */
  maxLegs?: number;
  /** Minutes allowed to change trains at a station without its own minimum connection time. */
  changeTime?: number;
  /** Minimum connection time in minutes at particular stations, by CRS code. */
  changeTimes?: Record<string, number>;
  /** Longest journey considered, in minutes. */
  maxDuration?: number;
}

/** A day's trains as connections (one train between two consecutive calls), sorted by departure. */
export interface Network {
  stations: Map<string, number>;
  trains: DayTrain[];
  calls: Stop[][];
  /** Per connection: origin and destination station index, times, train and call index. */
  from: Int32Array;
  to: Int32Array;
  dep: Int32Array;
  arr: Int32Array;
  train: Int32Array;
  call: Int32Array;
}

export function buildNetwork(day: DayFile): Network {
  const stations = new Map<string, number>();
  const index = (crs: string) => {
    let i = stations.get(crs);
    if (i === undefined) stations.set(crs, (i = stations.size));
    return i;
  };
  const calls = day.trains.map(callsOf);
  let count = 0;
  for (const cs of calls) count += Math.max(cs.length - 1, 0);
  const raw = { from: new Int32Array(count), to: new Int32Array(count), dep: new Int32Array(count), arr: new Int32Array(count), train: new Int32Array(count), call: new Int32Array(count) };
  let n = 0;
  calls.forEach((cs, t) => {
    for (let i = 0; i + 1 < cs.length; i++) {
      const dep = cs[i].dep ?? cs[i].arr;
      const arr = cs[i + 1].arr ?? cs[i + 1].dep;
      if (dep === null || arr === null) continue;
      raw.from[n] = index(cs[i].crs);
      raw.to[n] = index(cs[i + 1].crs);
      raw.dep[n] = dep;
      raw.arr[n] = arr;
      raw.train[n] = t;
      raw.call[n] = i;
      n++;
    }
  });
  // Sorting an index of typed arrays is much quicker than sorting an array of tuples.
  const order = new Uint32Array(n).map((_, i) => i).sort((a, b) => raw.dep[a] - raw.dep[b] || raw.arr[a] - raw.arr[b]);
  const col = (src: Int32Array) => Int32Array.from(order, (i) => src[i]);
  return {
    stations,
    trains: day.trains,
    calls,
    from: col(raw.from),
    to: col(raw.to),
    dep: col(raw.dep),
    arr: col(raw.arr),
    train: col(raw.train),
    call: col(raw.call),
  };
}

const NONE = 0x3fffffff;

function firstFrom(dep: Int32Array, t: number): number {
  let lo = 0;
  let hi = dep.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dep[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The earliest-arriving journey leaving `from` at or after `after`, using the fewest trains
 * among those arriving earliest, or null when there is none.
 */
function earliest(net: Network, from: number, to: number, after: number, opts: Required<PlanOptions>, scratch: Scratch): Journey | null {
  const { maxLegs, maxDuration } = opts;
  const n = net.stations.size;
  const { best, board, via, change } = scratch;
  best.fill(NONE);
  board.fill(-1);
  // best[k * n + s]: earliest arrival at s using exactly k trains; k = 0 is the origin itself.
  best[from] = after;
  let target = NONE;
  const limit = after + maxDuration;

  for (let c = firstFrom(net.dep, after); c < net.dep.length; c++) {
    const dep = net.dep[c];
    if (dep >= target || dep > limit) break;
    const t = net.train[c];
    const s = net.from[c];
    // Board here if that takes fewer trains than riding it from where it was boarded.
    const riding = board[t * 2] === -1 ? maxLegs : board[t * 2 + 1] - 1;
    for (let k = 0; k < riding; k++) {
      const ready = best[k * n + s];
      if (ready !== NONE && ready + (k === 0 ? 0 : change[s]) <= dep) {
        board[t * 2] = c;
        board[t * 2 + 1] = k + 1;
        break;
      }
    }
    if (board[t * 2] === -1) continue;
    const k = board[t * 2 + 1];
    const slot = k * n + net.to[c];
    if (net.arr[c] < best[slot]) {
      best[slot] = net.arr[c];
      via[slot * 2] = board[t * 2];
      via[slot * 2 + 1] = c;
      if (net.to[c] === to && net.arr[c] < target) target = net.arr[c];
    }
  }
  if (target === NONE) return null;

  let k = 1;
  while (best[k * n + to] !== target) k++;
  const legs: Leg[] = [];
  for (let s = to; k > 0; k--) {
    const slot = k * n + s;
    const enter = via[slot * 2];
    const exit = via[slot * 2 + 1];
    const t = net.train[enter];
    const train = net.trains[t];
    const calls = net.calls[t].slice(net.call[enter], net.call[exit] + 2);
    legs.unshift({
      uid: train.u,
      operator: train.o,
      headcode: train.h,
      bus: train.b === 1,
      dep: net.dep[enter],
      arr: net.arr[exit],
      stops: calls.length - 2,
      calls,
    });
    s = net.from[enter];
  }
  return { legs, dep: legs[0].dep, arr: legs[legs.length - 1].arr };
}

interface Scratch {
  best: Int32Array;
  board: Int32Array;
  via: Int32Array;
  /** Minutes needed to change trains at each station. */
  change: Int32Array;
}

const DEFAULTS: Required<PlanOptions> = { maxLegs: 3, changeTime: 5, changeTimes: {}, maxDuration: 12 * 60 };

/**
 * Journeys from one station to another leaving on the network's day (00:00 to 23:59): every
 * direct train, plus the fastest journey with changes for each departure through the day.
 * A journey with changes is dropped when another leaves no earlier, arrives no later and has
 * no more changes.
 */
export function planJourneys(net: Network, day: DayFile, fromCrs: string, toCrs: string, options: PlanOptions = {}): Journey[] {
  const opts = { ...DEFAULTS, ...options };
  const direct: Journey[] = findDirect(day, fromCrs, toCrs).map((leg) => ({ legs: [leg], dep: leg.dep, arr: leg.arr }));
  const from = net.stations.get(fromCrs);
  const to = net.stations.get(toCrs);
  if (from === undefined || to === undefined || from === to) return direct;

  const n = net.stations.size;
  const scratch: Scratch = {
    best: new Int32Array((opts.maxLegs + 1) * n),
    board: new Int32Array(net.trains.length * 2),
    via: new Int32Array((opts.maxLegs + 1) * n * 2),
    change: new Int32Array(n).fill(opts.changeTime),
  };
  for (const [crs, i] of net.stations) {
    const minutes = opts.changeTimes[crs];
    if (minutes !== undefined) scratch.change[i] = minutes;
  }
  const found: Journey[] = [];
  for (let after = 0; after < 1440; ) {
    const j = earliest(net, from, to, after, opts, scratch);
    if (!j || j.dep >= 1440) break;
    found.push(j);
    after = j.dep + 1;
  }

  const all = [...direct, ...found.filter((j) => j.legs.length > 1)];
  // Every direct train is kept; a journey with changes must be better in some way.
  const dominated = (a: Journey) =>
    a.legs.length > 1 &&
    all.some((b) => b !== a && b.dep >= a.dep && b.arr <= a.arr && b.legs.length <= a.legs.length && (b.dep > a.dep || b.arr < a.arr || b.legs.length < a.legs.length));
  const key = (j: Journey) => j.legs.map((l) => `${l.uid}@${l.dep}`).join('+');
  const seen = new Set<string>();
  return all
    .filter((j) => !dominated(j) && !seen.has(key(j)) && seen.add(key(j)))
    .sort((a, b) => a.dep - b.dep || a.arr - b.arr || a.legs.length - b.legs.length);
}
