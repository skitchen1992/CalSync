/**
 * When an event starts or ends, in the shape Google Calendar uses: a local wall-clock time in an
 * IANA zone for timed events, or a calendar date for all-day events (the end date is exclusive).
 */
export type EventTime = { dateTime: string; timeZone: string } | { date: string };
