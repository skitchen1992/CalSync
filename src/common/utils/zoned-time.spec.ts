import { addMinutesToLocal, isValidTimeZone, nextDate, zonedTimeToInstant } from './zoned-time.js';

describe('zonedTimeToInstant', () => {
  it('converts Moscow wall-clock time to UTC', () => {
    expect(zonedTimeToInstant('2026-11-23T20:30:00', 'Europe/Moscow')).toEqual(new Date('2026-11-23T17:30:00Z'));
  });

  it('applies the offset in effect on that date', () => {
    expect(zonedTimeToInstant('2026-07-01T12:00:00', 'Europe/Berlin')).toEqual(new Date('2026-07-01T10:00:00Z'));
    expect(zonedTimeToInstant('2026-12-01T12:00:00', 'Europe/Berlin')).toEqual(new Date('2026-12-01T11:00:00Z'));
  });

  it('resolves a time skipped by the spring DST jump to the instant after it', () => {
    // Berlin jumps from 02:00 to 03:00 on 2026-03-29.
    expect(zonedTimeToInstant('2026-03-29T02:30:00', 'Europe/Berlin')).toEqual(new Date('2026-03-29T01:30:00Z'));
  });
});

describe('wall-clock helpers', () => {
  it('adds minutes across midnight', () => {
    expect(addMinutesToLocal('2026-11-23T23:30:00', 90)).toBe('2026-11-24T01:00:00');
  });

  it('steps to the next date across a year', () => {
    expect(nextDate('2026-12-31')).toBe('2027-01-01');
  });

  it('tells IANA zones from other strings', () => {
    expect(isValidTimeZone('Asia/Tomsk')).toBe(true);
    expect(isValidTimeZone('Moscow time')).toBe(false);
  });
});
