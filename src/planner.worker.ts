// Runs journey searches off the main thread, so the page stays responsive while a day's
// connections are scanned.
import { loadDay, loadStations } from './lib/data.ts';
import { buildNetwork, planJourneys, type Network } from './lib/planner.ts';

export interface PlanRequest {
  id: number;
  date: string;
  /** CRS codes of the stations to leave from and to arrive at. */
  from: string[];
  to: string[];
}

export type PlanResponse = { id: number; journeys: import('./lib/timetable.ts').Journey[] } | { id: number; error: string };

const networks = new Map<string, Network>();

/** Each station's minimum connection time, from the station list. */
let changeTimes: Promise<Record<string, number>> | undefined;
const loadChangeTimes = () =>
  (changeTimes ??= loadStations()
    .then((stations) => Object.fromEntries(stations.flatMap((s) => (s.change === undefined ? [] : [[s.crs, s.change]]))))
    .catch(() => {
      changeTimes = undefined;
      return {};
    }));

self.onmessage = async (e: MessageEvent<PlanRequest>) => {
  const { id, date, from, to } = e.data;
  try {
    const [day, times] = await Promise.all([loadDay(date), loadChangeTimes()]);
    let net = networks.get(date);
    if (!net) {
      net = buildNetwork(day);
      // A couple of days is plenty: searches usually stay on one date.
      if (networks.size >= 2) networks.delete(networks.keys().next().value!);
      networks.set(date, net);
    }
    self.postMessage({ id, journeys: planJourneys(net, day, from, to, { changeTimes: times }) } satisfies PlanResponse);
  } catch (err) {
    self.postMessage({ id, error: (err as Error).message } satisfies PlanResponse);
  }
};
