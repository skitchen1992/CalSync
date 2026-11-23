import { calendar, type calendar_v3, type MethodOptions } from '@googleapis/calendar';
import { Injectable } from '@nestjs/common';
import { type ResiliencePolicy, ResilienceService } from '@nestjs/resilience';
import type { EventTime } from '../../common/types/event-time.js';
import { GoogleOAuthClient } from './google-oauth.client.js';
import { GOOGLE_RESILIENCE_PRESET } from './google.constants.js';
import { googleErrorStatus, translateGoogleError } from './google.errors.js';

export interface CalendarEventInput {
  /** Deterministic id (see toGoogleEventId), so inserts can be repeated safely. */
  id: string;
  title: string;
  description?: string;
  location?: string;
  start: EventTime;
  end: EventTime;
  /** Stored in `extendedProperties.private`: marks the event as CalSync's. */
  privateProperties: Record<string, string>;
}

/** Calendar operations for one Google account. Every method is safe to repeat. */
export interface CalendarApi {
  createCalendar(input: { summary: string; description?: string; timeZone: string }, signal?: AbortSignal): Promise<string>;
  /** Deletes a calendar; one that is already gone counts as deleted. */
  deleteCalendar(calendarId: string, signal?: AbortSignal): Promise<void>;
  /** Creates or overwrites an event. `exists` only picks which call to try first. */
  putEvent(calendarId: string, event: CalendarEventInput, exists: boolean, signal?: AbortSignal): Promise<void>;
  /** Deletes an event; one that is already gone counts as deleted. */
  deleteEvent(calendarId: string, eventId: string, signal?: AbortSignal): Promise<void>;
}

const GONE = new Set([404, 410]);

const toGoogleBody = (event: CalendarEventInput): calendar_v3.Schema$Event => ({
  id: event.id,
  summary: event.title,
  description: event.description ?? null,
  location: event.location ?? null,
  start: event.start,
  end: event.end,
  // Re-confirms an event that was deleted (cancelled) earlier with the same id.
  status: 'confirmed',
  extendedProperties: { private: event.privateProperties },
});

/**
 * Google Calendar behind CalSync's narrow API. Calls run through the `google` resilience preset
 * (timeout, retry on transient errors, circuit breaker); the SDK's own retries are off, so there
 * is exactly one retry layer.
 */
@Injectable()
export class GoogleCalendarClient {
  private readonly policy: ResiliencePolicy;

  constructor(
    resilience: ResilienceService,
    private readonly oauth: GoogleOAuthClient,
  ) {
    this.policy = resilience.preset(GOOGLE_RESILIENCE_PRESET);
  }

  forAccount(refreshToken: string): CalendarApi {
    const api = calendar({ version: 'v3', auth: this.oauth.forRefreshToken(refreshToken) });
    const run = <T>(operation: string, signal: AbortSignal | undefined, call: (options: MethodOptions) => Promise<T>) =>
      this.policy.execute(({ signal: attemptSignal }) => call({ signal: attemptSignal, retry: false }), {
        source: `GoogleCalendarClient.${operation}`,
        ...(signal ? { signal } : {}),
      });

    return {
      createCalendar: async (input, signal) => {
        try {
          const { data } = await run('createCalendar', signal, (options) =>
            api.calendars.insert({ requestBody: input }, options),
          );
          if (!data.id) {
            throw new Error('Google returned a calendar without an id');
          }
          return data.id;
        } catch (error) {
          throw translateGoogleError(error, 'calendar creation');
        }
      },

      deleteCalendar: async (calendarId, signal) => {
        try {
          await run('deleteCalendar', signal, (options) => api.calendars.delete({ calendarId }, options));
        } catch (error) {
          if (!GONE.has(googleErrorStatus(error) ?? 0)) {
            throw translateGoogleError(error, 'calendar deletion');
          }
        }
      },

      putEvent: async (calendarId, event, exists, signal) => {
        const requestBody = toGoogleBody(event);
        const insert = () =>
          run('insertEvent', signal, (options) => api.events.insert({ calendarId, requestBody }, options));
        const update = () =>
          run('updateEvent', signal, (options) =>
            api.events.update({ calendarId, eventId: event.id, requestBody }, options),
          );
        try {
          if (exists) {
            await update().catch((error: unknown) => (GONE.has(googleErrorStatus(error) ?? 0) ? insert() : Promise.reject(error)));
          } else {
            await insert().catch((error: unknown) => (googleErrorStatus(error) === 409 ? update() : Promise.reject(error)));
          }
        } catch (error) {
          throw translateGoogleError(error, 'event write');
        }
      },

      deleteEvent: async (calendarId, eventId, signal) => {
        try {
          await run('deleteEvent', signal, (options) => api.events.delete({ calendarId, eventId }, options));
        } catch (error) {
          if (!GONE.has(googleErrorStatus(error) ?? 0)) {
            throw translateGoogleError(error, 'event deletion');
          }
        }
      },
    };
  }
}
