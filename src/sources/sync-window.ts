import type { SyncWindow } from './source.types.js';

const DAY_MS = 86_400_000;

/** The range a sync mirrors around `now`: `pastDays` back, `futureDays` ahead. */
export function computeSyncWindow(now: Date, pastDays: number, futureDays: number): SyncWindow {
  return {
    start: new Date(now.getTime() - pastDays * DAY_MS),
    end: new Date(now.getTime() + futureDays * DAY_MS),
  };
}
