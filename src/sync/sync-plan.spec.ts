import type { NormalizedEvent } from '../sources/source.types.js';
import { eventContentHash, type ExistingLink, planSync } from './sync-plan.js';

const WINDOW = { start: new Date('2026-11-16T00:00:00Z'), end: new Date('2027-01-15T00:00:00Z') };
const idFor = (uid: string) => `gid-${uid}`;

const event = (uid: string, overrides: Partial<NormalizedEvent> = {}): NormalizedEvent => ({
  uid,
  title: `Event ${uid}`,
  start: { dateTime: '2026-11-20T10:00:00', timeZone: 'Europe/Moscow' },
  end: { dateTime: '2026-11-20T11:00:00', timeZone: 'Europe/Moscow' },
  startsAt: new Date('2026-11-20T07:00:00Z'),
  ...overrides,
});

const linkFor = (source: NormalizedEvent, overrides: Partial<ExistingLink> = {}): ExistingLink => ({
  externalUid: source.uid,
  googleEventId: `stored-${source.uid}`,
  contentHash: eventContentHash(source),
  startsAt: source.startsAt,
  ...overrides,
});

describe('planSync', () => {
  it('creates events that have no link, with the deterministic id', () => {
    const plan = planSync([event('a')], [], WINDOW, idFor);

    expect(plan.writes).toEqual([expect.objectContaining({ googleEventId: 'gid-a', exists: false })]);
    expect(plan).toMatchObject({ created: 1, updated: 0, unchanged: 0, deletes: [] });
  });

  it('updates a changed event through its stored Google id', () => {
    const before = event('a');
    const after = event('a', { title: 'Moved to another room' });

    const plan = planSync([after], [linkFor(before)], WINDOW, idFor);

    expect(plan.writes).toEqual([expect.objectContaining({ googleEventId: 'stored-a', exists: true })]);
    expect(plan.updated).toBe(1);
  });

  it('leaves an unchanged event alone', () => {
    const same = event('a');

    const plan = planSync([same], [linkFor(same)], WINDOW, idFor);

    expect(plan.writes).toEqual([]);
    expect(plan.unchanged).toBe(1);
  });

  it('deletes linked events that vanished from the source inside the window', () => {
    const gone = event('gone');

    const plan = planSync([], [linkFor(gone)], WINDOW, idFor);

    expect(plan.deletes.map((link) => link.externalUid)).toEqual(['gone']);
  });

  it('does not delete linked events outside the window', () => {
    const past = event('past', { startsAt: new Date('2026-10-01T07:00:00Z') });

    const plan = planSync([], [linkFor(past)], WINDOW, idFor);

    expect(plan.deletes).toEqual([]);
  });

  it('writes a duplicated uid once', () => {
    const plan = planSync([event('a'), event('a', { title: 'Duplicate' })], [], WINDOW, idFor);

    expect(plan.writes).toHaveLength(1);
    expect(plan.writes[0]!.event.title).toBe('Event a');
  });
});

describe('eventContentHash', () => {
  it('ignores the order of keys in times', () => {
    const a = event('a');
    const reordered = event('a', { start: { timeZone: 'Europe/Moscow', dateTime: '2026-11-20T10:00:00' } });

    expect(eventContentHash(reordered)).toBe(eventContentHash(a));
  });

  it('changes when the location changes', () => {
    expect(eventContentHash(event('a', { location: 'Room 2' }))).not.toBe(eventContentHash(event('a')));
  });
});
