// Wall-clock times in IANA zones, with Intl only (the server runs in UTC, see rule 105).

const MINUTE_MS = 60_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** How far the zone's wall clock is ahead of UTC at `instant`, in ms. */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = formatterFor(timeZone).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((candidate) => candidate.type === type)!.value);
  const wallClock = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
  return wallClock - Math.floor(instant / 1000) * 1000;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false; // RangeError: not a zone Intl knows
  }
}

/**
 * The UTC instant of a wall-clock time (`2026-11-23T20:30:00`) in `timeZone`. A time skipped by a
 * DST jump resolves to the instant after the jump, an ambiguous one to its first occurrence.
 */
export function zonedTimeToInstant(localDateTime: string, timeZone: string): Date {
  const asUtc = Date.parse(`${localDateTime}Z`);
  const firstGuess = asUtc - zoneOffsetMs(asUtc, timeZone);
  const offset = zoneOffsetMs(firstGuess, timeZone);
  return new Date(asUtc - offset);
}

/** `2026-11-23T20:30:00` + 90 minutes, as wall-clock arithmetic (no zone involved). */
export function addMinutesToLocal(localDateTime: string, minutes: number): string {
  return new Date(Date.parse(`${localDateTime}Z`) + minutes * MINUTE_MS).toISOString().slice(0, 19);
}

/** The calendar date after `date` (`2026-12-31` → `2027-01-01`). */
export function nextDate(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 24 * 60 * MINUTE_MS).toISOString().slice(0, 10);
}
