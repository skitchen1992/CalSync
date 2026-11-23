import type { EventTime } from '../common/types/event-time.js';
import type { SourceType } from '../db/schema.js';

/** An event as every source adapter returns it, independent of where it came from. */
export interface NormalizedEvent {
  /** Stable across fetches; derived from content when the source has no id. */
  uid: string;
  title: string;
  description?: string;
  location?: string;
  start: EventTime;
  end: EventTime;
  /** Start instant in UTC, for window filtering. */
  startsAt: Date;
}

/** The time range a sync mirrors: [start, end). */
export interface SyncWindow {
  start: Date;
  end: Date;
}

/** What an adapter recognized in a URL the user sent. */
export interface RecognizedSource {
  type: SourceType;
  name: string;
  timeZone: string;
}

/** Turns one kind of source into normalized events. Adapters only translate: no DB, no Google. */
export interface SourceAdapter {
  readonly type: SourceType;
  recognize(url: URL): RecognizedSource | undefined;
  fetch(url: string, window: SyncWindow, signal?: AbortSignal): Promise<NormalizedEvent[]>;
}
