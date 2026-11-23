import { CircuitOpenError } from '@nestjs/resilience';
import { GoogleAuthService } from '../src/auth/google-auth.service.js';
import { AUTH_MESSAGES } from '../src/auth/auth.messages.js';
import type { Source } from '../src/db/schema.js';
import { GoogleAuthRevokedError } from '../src/integrations/google/google.errors.js';
import { SourceUnavailableError } from '../src/sources/sources.errors.js';
import { SourcesService } from '../src/sources/sources.service.js';
import { OWNERSHIP_PROPERTIES } from '../src/sync/calendar-event.js';
import { SyncService } from '../src/sync/sync.service.js';
import { createTestApp, type TestApp } from './support/create-test-app.js';
import { connectGoogle, upcomingEvent, USER_ID, YANDEX_EMBED_URL, YANDEX_LAYER_NAME } from './support/scenario.js';

describe('Sync engine', () => {
  let testApp: TestApp;
  let sources: SourcesService;
  let sync: SyncService;

  beforeEach(async () => {
    testApp = await createTestApp();
    sources = testApp.app.get(SourcesService);
    sync = testApp.app.get(SyncService);
    await connectGoogle(testApp);
  });

  afterEach(async () => {
    await testApp.close();
  });

  /** Previews and confirms the Yandex link, as the bot does. */
  const addSource = async (): Promise<Source> => {
    const preview = await sources.preview(USER_ID, YANDEX_EMBED_URL);
    return sources.confirm(USER_ID, preview.source.id);
  };

  const titlesIn = (source: Source) =>
    testApp.googleCalendar.eventsOf(source.googleCalendarId!).map((event) => event.title).sort();

  it('mirrors a new source into its own Google calendar', async () => {
    testApp.source.events = [upcomingEvent('a', 24), upcomingEvent('b', 48)];
    const source = await addSource();

    const outcome = await sync.syncSource(source);

    expect(outcome).toMatchObject({ status: 'synced', created: 2, updated: 0, deleted: 0 });
    expect(testApp.googleCalendar.calendars.get(source.googleCalendarId!)).toMatchObject({
      summary: YANDEX_LAYER_NAME,
      timeZone: 'Europe/Moscow',
    });
    const [event] = testApp.googleCalendar.eventsOf(source.googleCalendarId!);
    expect(event!.privateProperties).toEqual({
      [OWNERSHIP_PROPERTIES.sourceId]: source.id,
      [OWNERSHIP_PROPERTIES.uid]: expect.any(String),
    });
    expect(event!.id).toMatch(/^[0-9a-v]{52}$/);
  });

  it('updates changed events and deletes removed ones on the next run', async () => {
    testApp.source.events = [upcomingEvent('a', 24), upcomingEvent('b', 48), upcomingEvent('c', 72)];
    const source = await addSource();
    await sync.syncSource(source);

    testApp.source.events = [upcomingEvent('a', 24, { title: 'Lecture a (room 301)' }), upcomingEvent('c', 72)];
    const outcome = await sync.syncSource(source);

    expect(outcome).toMatchObject({ status: 'synced', created: 0, updated: 1, deleted: 1, unchanged: 1 });
    expect(titlesIn(source)).toEqual(['Lecture a (room 301)', 'Lecture c']);
  });

  it('changes nothing when the source is unchanged', async () => {
    testApp.source.events = [upcomingEvent('a', 24)];
    const source = await addSource();
    await sync.syncSource(source);

    const outcome = await sync.syncSource(source);

    expect(outcome).toMatchObject({ status: 'synced', created: 0, updated: 0, deleted: 0, unchanged: 1 });
  });

  it('keeps the mirrored events and backs off when the source fails', async () => {
    testApp.source.events = [upcomingEvent('a', 24)];
    const source = await addSource();
    await sync.syncSource(source);

    testApp.source.failure = new SourceUnavailableError('Yandex Calendar is unavailable');
    const outcome = await sync.syncSource(source);

    expect(outcome).toMatchObject({ status: 'failed', error: { code: 'SOURCE_UNAVAILABLE' } });
    expect(titlesIn(source)).toEqual(['Lecture a']);
    const [stored] = await sources.listActive(USER_ID);
    expect(stored).toMatchObject({ lastSyncStatus: 'failed', consecutiveFailures: 1 });
    expect(stored!.nextSyncAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('refuses to wipe the calendar when the source suddenly returns nothing', async () => {
    testApp.source.events = [upcomingEvent('a', 24), upcomingEvent('b', 48), upcomingEvent('c', 72)];
    const source = await addSource();
    await sync.syncSource(source);

    testApp.source.events = [];
    const outcome = await sync.syncSource(source);

    expect(outcome).toMatchObject({ status: 'failed', error: { code: 'SUSPICIOUS_EMPTY_SNAPSHOT' } });
    expect(titlesIn(source)).toHaveLength(3);
  });

  it('skips a source that is already being synced', async () => {
    testApp.source.events = [upcomingEvent('a', 24)];
    const source = await addSource();
    let release!: () => void;
    testApp.source.gate = new Promise((resolve) => (release = resolve));

    const first = sync.syncSource(source);
    await vi.waitFor(() => expect(testApp.source.fetchCount).toBe(1));
    const second = await sync.syncSource(source);
    release();

    expect(second).toMatchObject({ status: 'skipped', reason: 'running' });
    expect(await first).toMatchObject({ status: 'synced', created: 1 });
  });

  it('syncs due sources only', async () => {
    testApp.source.events = [upcomingEvent('a', 24)];
    await addSource();

    expect(await sync.runDueSources()).toEqual([expect.objectContaining({ status: 'synced', created: 1 })]);
    expect(await sync.runDueSources()).toEqual([]);
  });

  it('stops using Google and tells the user when access is revoked', async () => {
    testApp.source.events = [upcomingEvent('a', 24)];
    const source = await addSource();
    testApp.googleCalendar.failure = new GoogleAuthRevokedError('Google access was revoked or expired');

    const outcome = await sync.syncSource(source);

    expect(outcome).toMatchObject({ status: 'failed', error: { code: 'GOOGLE_AUTH_REVOKED' } });
    expect(await testApp.app.get(GoogleAuthService).isConnected(USER_ID)).toBe(false);
    expect(testApp.notifier.textsFor(USER_ID)).toContain(AUTH_MESSAGES.revokedInBot);
  });

  it('keeps the schedule of a source when the Google circuit is open', async () => {
    testApp.source.events = [upcomingEvent('a', 24)];
    const source = await addSource();
    testApp.googleCalendar.failure = new CircuitOpenError('google', 60_000);

    const outcome = await sync.syncSource(source);

    expect(outcome.status).toBe('failed');
    const [stored] = await sources.listActive(USER_ID);
    expect(stored).toMatchObject({ lastSyncStatus: null, consecutiveFailures: 0 });
  });

  it('removes the source together with its Google calendar', async () => {
    testApp.source.events = [upcomingEvent('a', 24)];
    const source = await addSource();
    await sync.syncSource(source);

    expect(await sources.remove(USER_ID, source.id)).toEqual({ calendarKept: false });

    expect(testApp.googleCalendar.calendars.has(source.googleCalendarId!)).toBe(false);
    expect(await sources.listActive(USER_ID)).toEqual([]);
  });
});
