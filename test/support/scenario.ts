import { GoogleAuthService } from '../../src/auth/google-auth.service.js';
import type { NormalizedEvent } from '../../src/sources/source.types.js';
import type { TestApp } from './create-test-app.js';

/** Allowed in the e2e env (TELEGRAM_ALLOWED_USER_IDS). */
export const USER_ID = 1001;
export const STRANGER_ID = 4242;

export const YANDEX_EMBED_URL =
  'https://calendar.yandex.ru/embed/week?layer_ids=38194026&layer_names=%D0%9A%D1%83%D1%80%D1%81&tz_id=Europe%2FMoscow';
export const YANDEX_LAYER_NAME = 'Курс';

/** Completes the OAuth flow for `userId` through the service, as the callback would. */
export async function connectGoogle(testApp: TestApp, userId = USER_ID): Promise<void> {
  const auth = testApp.app.get(GoogleAuthService);
  const url = new URL(await auth.startAuthorization(userId));
  await auth.completeAuthorization({ state: url.searchParams.get('state')!, code: `code-${userId}` });
}

const HOUR_MS = 3_600_000;

/** A timed event `hoursFromNow` ahead, in Moscow time. */
export function upcomingEvent(uid: string, hoursFromNow: number, overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  const startsAt = new Date(Math.floor(Date.now() / HOUR_MS) * HOUR_MS + hoursFromNow * HOUR_MS);
  const local = (instant: Date) => new Date(instant.getTime() + 3 * HOUR_MS).toISOString().slice(0, 19);
  return {
    uid,
    title: `Lecture ${uid}`,
    start: { dateTime: local(startsAt), timeZone: 'Europe/Moscow' },
    end: { dateTime: local(new Date(startsAt.getTime() + HOUR_MS)), timeZone: 'Europe/Moscow' },
    startsAt,
    ...overrides,
  };
}
