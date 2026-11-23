import type { CalendarEventInput } from '../integrations/google/google-calendar.client.js';
import { toGoogleEventId } from '../integrations/google/google-event-id.js';
import type { NormalizedEvent } from '../sources/source.types.js';

/** Ownership marker keys in `extendedProperties.private` of every event CalSync writes. */
export const OWNERSHIP_PROPERTIES = { sourceId: 'calsyncSourceId', uid: 'calsyncUid' } as const;

/** The deterministic Google id of a source event: the same event always maps to the same id. */
export const googleEventIdFor = (sourceId: string, uid: string) => toGoogleEventId(`${sourceId}:${uid}`);

export function toCalendarEvent(sourceId: string, event: NormalizedEvent, googleEventId: string): CalendarEventInput {
  return {
    id: googleEventId,
    title: event.title,
    ...(event.description !== undefined ? { description: event.description } : {}),
    ...(event.location !== undefined ? { location: event.location } : {}),
    start: event.start,
    end: event.end,
    privateProperties: { [OWNERSHIP_PROPERTIES.sourceId]: sourceId, [OWNERSHIP_PROPERTIES.uid]: event.uid },
  };
}
