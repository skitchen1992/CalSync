import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/database.js';
import { eventLinks, type NewEventLink } from '../db/schema.js';
import type { ExistingLink } from './sync-plan.js';

@Injectable()
export class EventLinksRepository {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async findBySource(sourceId: string): Promise<ExistingLink[]> {
    return this.db
      .select({
        externalUid: eventLinks.externalUid,
        googleEventId: eventLinks.googleEventId,
        contentHash: eventLinks.contentHash,
        startsAt: eventLinks.startsAt,
      })
      .from(eventLinks)
      .where(eq(eventLinks.sourceId, sourceId));
  }

  async upsertMany(links: NewEventLink[]): Promise<void> {
    if (links.length === 0) {
      return;
    }
    await this.db
      .insert(eventLinks)
      .values(links)
      .onConflictDoUpdate({
        target: [eventLinks.sourceId, eventLinks.externalUid],
        set: {
          googleEventId: sql`excluded.google_event_id`,
          contentHash: sql`excluded.content_hash`,
          startsAt: sql`excluded.starts_at`,
          updatedAt: sql`now()`,
        },
      });
  }

  async deleteMany(sourceId: string, externalUids: string[]): Promise<void> {
    if (externalUids.length === 0) {
      return;
    }
    await this.db
      .delete(eventLinks)
      .where(and(eq(eventLinks.sourceId, sourceId), inArray(eventLinks.externalUid, externalUids)));
  }

  async countBySource(sourceId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(eventLinks)
      .where(eq(eventLinks.sourceId, sourceId));
    return row?.count ?? 0;
  }
}
