import { registerAs } from '@nestjs/config';
import { loadEnv } from './env.js';

export const syncConfig = registerAs('sync', () => {
  const env = loadEnv();
  return {
    intervalMinutes: env.SYNC_INTERVAL_MINUTES,
    windowPastDays: env.SYNC_WINDOW_PAST_DAYS,
    windowFutureDays: env.SYNC_WINDOW_FUTURE_DAYS,
    /** Sources synced in parallel by one dispatcher tick. */
    sourceConcurrency: 2,
    /** Google writes in flight per source. */
    writeConcurrency: 4,
    /** Upper bound for the failure backoff. */
    maxBackoffMinutes: 6 * 60,
  };
});
