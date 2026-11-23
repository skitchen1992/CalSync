import type { CalendarApi, CalendarEventInput } from '../../src/integrations/google/google-calendar.client.js';
import { GOOGLE_SCOPES } from '../../src/integrations/google/google.constants.js';
import { GoogleAuthorizationIncompleteError } from '../../src/integrations/google/google.errors.js';
import type { GoogleGrant } from '../../src/integrations/google/google-oauth.client.js';

export const FAKE_AUTH_HOST = 'https://accounts.example.com';
/** Authorization code that makes the fake answer like Google without a refresh token. */
export const CODE_WITHOUT_REFRESH_TOKEN = 'code-without-refresh-token';

/** Stands in for GoogleOAuthClient: no network, deterministic tokens. */
export class FakeGoogleOAuthClient {
  authorizationUrl(state: string): string {
    return `${FAKE_AUTH_HOST}/o/oauth2/auth?state=${encodeURIComponent(state)}`;
  }

  async exchangeCode(code: string): Promise<GoogleGrant> {
    if (code === CODE_WITHOUT_REFRESH_TOKEN) {
      throw new GoogleAuthorizationIncompleteError('Google did not return a refresh token');
    }
    return { refreshToken: `refresh-token-for-${code}`, scope: GOOGLE_SCOPES.join(' ') };
  }
}

interface FakeCalendar {
  summary: string;
  timeZone: string;
  events: Map<string, CalendarEventInput>;
}

/** Stands in for GoogleCalendarClient: an in-memory Google Calendar shared by every account. */
export class FakeGoogleCalendarClient {
  readonly calendars = new Map<string, FakeCalendar>();
  /** When set, every call fails with it (e.g. GoogleAuthRevokedError, CircuitOpenError). */
  failure: Error | undefined;
  private nextCalendar = 1;

  eventsOf(calendarId: string): CalendarEventInput[] {
    return [...(this.calendars.get(calendarId)?.events.values() ?? [])];
  }

  forAccount(_refreshToken: string): CalendarApi {
    const fail = () => {
      if (this.failure) throw this.failure;
    };
    const calendarOf = (calendarId: string) => {
      const calendar = this.calendars.get(calendarId);
      if (!calendar) throw new Error(`No calendar ${calendarId}`);
      return calendar;
    };
    return {
      createCalendar: async ({ summary, timeZone }) => {
        fail();
        const id = `calendar-${this.nextCalendar++}@group.calendar.google.com`;
        this.calendars.set(id, { summary, timeZone, events: new Map() });
        return id;
      },
      deleteCalendar: async (calendarId) => {
        fail();
        this.calendars.delete(calendarId);
      },
      putEvent: async (calendarId, event) => {
        fail();
        calendarOf(calendarId).events.set(event.id, event);
      },
      deleteEvent: async (calendarId, eventId) => {
        fail();
        calendarOf(calendarId).events.delete(eventId);
      },
    };
  }
}
