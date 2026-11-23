const MINUTE_MS = 60_000;

export function nextSyncAfterSuccess(now: Date, intervalMinutes: number): Date {
  return new Date(now.getTime() + intervalMinutes * MINUTE_MS);
}

/**
 * Exponential backoff: the interval doubles with every consecutive failure, capped at
 * `maxBackoffMinutes`. `failuresBefore` is the count before this failure.
 */
export function nextSyncAfterFailure(
  now: Date,
  intervalMinutes: number,
  failuresBefore: number,
  maxBackoffMinutes: number,
): Date {
  const minutes = Math.min(intervalMinutes * 2 ** failuresBefore, maxBackoffMinutes);
  return new Date(now.getTime() + minutes * MINUTE_MS);
}
