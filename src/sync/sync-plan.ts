import { createHash } from 'node:crypto';
import type { EventTime } from '../common/types/event-time.js';
import type { NormalizedEvent, SyncWindow } from '../sources/source.types.js';

/** What CalSync remembers about an event it already mirrored. */
export interface ExistingLink {
  externalUid: string;
  googleEventId: string;
  contentHash: string;
  startsAt: Date;
}

export interface PlannedWrite {
  event: NormalizedEvent;
  googleEventId: string;
  contentHash: string;
  /** Whether the Google event should already exist (an update) or not (a create). */
  exists: boolean;
}

export interface SyncPlan {
  writes: PlannedWrite[];
  deletes: ExistingLink[];
  created: number;
  updated: number;
  unchanged: number;
}

const canonicalTime = (time: EventTime) => ('date' in time ? { date: time.date } : { dateTime: time.dateTime, timeZone: time.timeZone });

/** Hash of everything CalSync writes to Google; a changed hash means the event needs an update. */
export function eventContentHash(event: NormalizedEvent): string {
  const content = [
    event.title,
    event.description ?? null,
    event.location ?? null,
    canonicalTime(event.start),
    canonicalTime(event.end),
  ];
  return createHash('sha256').update(JSON.stringify(content)).digest('base64url');
}

/**
 * Diffs a source snapshot against the stored links. Only links inside the window can be
 * deleted: an event outside it is simply not in the snapshot, not deleted at the source.
 * Duplicate uids in the snapshot keep their first occurrence.
 */
export function planSync(
  events: readonly NormalizedEvent[],
  links: readonly ExistingLink[],
  window: SyncWindow,
  googleEventIdFor: (uid: string) => string,
): SyncPlan {
  const linkByUid = new Map(links.map((link) => [link.externalUid, link]));
  const seen = new Set<string>();
  const plan: SyncPlan = { writes: [], deletes: [], created: 0, updated: 0, unchanged: 0 };

  for (const event of events) {
    if (seen.has(event.uid)) {
      continue;
    }
    seen.add(event.uid);
    const contentHash = eventContentHash(event);
    const link = linkByUid.get(event.uid);
    if (!link) {
      plan.writes.push({ event, contentHash, googleEventId: googleEventIdFor(event.uid), exists: false });
      plan.created++;
    } else if (link.contentHash !== contentHash) {
      plan.writes.push({ event, contentHash, googleEventId: link.googleEventId, exists: true });
      plan.updated++;
    } else {
      plan.unchanged++;
    }
  }

  plan.deletes = links.filter(
    (link) => !seen.has(link.externalUid) && link.startsAt >= window.start && link.startsAt < window.end,
  );
  return plan;
}
