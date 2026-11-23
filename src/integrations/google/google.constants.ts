/**
 * Narrowest scope that works: create secondary calendars and manage events on calendars this app
 * created. CalSync never reads or edits the user's other calendars.
 */
export const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/calendar.app.created'];

/** Name of the @nestjs/resilience preset for Google API calls (configured in AppModule). */
export const GOOGLE_RESILIENCE_PRESET = 'google';
