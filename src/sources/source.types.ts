import type { EventTime } from '../common/types/event-time.js';
import type { SourceType } from '../db/schema.js';
import type { SourceOptions } from '../db/source-options.js';

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

/** What an adapter reads a stored source with: the decrypted URL, its zone and its options. */
export interface SourceTarget {
  url: string;
  timeZone: string;
  /** Unverified JSON from the database: adapters parse it with `sourceOptionsSchema`. */
  options: SourceOptions | null;
}

/** What `inspect()` worked out about a new source; it overrides what `recognize()` guessed. */
export interface SourceInspection {
  name: string;
  timeZone: string;
  options: SourceOptions;
  /** 1-based rows the adapter could not read with these options, for the preview. */
  unparsedRows: number[];
}

/**
 * Turns one kind of source into normalized events. Adapters only translate: no DB, no Google
 * Calendar, no Telegram.
 */
export interface SourceAdapter {
  readonly type: SourceType;
  recognize(url: URL): RecognizedSource | undefined;
  /**
   * Runs once, when the user adds the source, for adapters that must learn how to read it (a
   * sheet's column mapping). The result is previewed and stored; `fetch()` never repeats it.
   */
  inspect?(url: string, signal?: AbortSignal): Promise<SourceInspection>;
  fetch(source: SourceTarget, window: SyncWindow, signal?: AbortSignal): Promise<NormalizedEvent[]>;
}
