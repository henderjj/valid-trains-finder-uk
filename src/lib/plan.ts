// Journey search from the page: hands the work to the planner worker.
import type { PlanRequest, PlanResponse } from '../planner.worker.ts';
import type { Journey } from './timetable.ts';

let worker: Worker | undefined;
let nextId = 0;
const pending = new Map<number, { resolve: (j: Journey[]) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../planner.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<PlanResponse>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if ('error' in e.data) p.reject(new Error(e.data.error));
      else p.resolve(e.data.journeys);
    };
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message || 'Journey search failed'));
      pending.clear();
      worker = undefined;
    };
  }
  return worker;
}

export function planJourneysInBackground(date: string, from: string, to: string): Promise<Journey[]> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, date, from, to } satisfies PlanRequest);
  });
}
