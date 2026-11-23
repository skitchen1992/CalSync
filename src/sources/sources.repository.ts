import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, asc, eq, lt, lte, sql } from 'drizzle-orm';
import type { Database } from '../db/database.js';
import { type NewSource, type Source, sources } from '../db/schema.js';

@Injectable()
export class SourcesRepository {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async insertPending(values: Omit<NewSource, 'status'>): Promise<Source> {
    const [source] = await this.db
      .insert(sources)
      .values({ ...values, status: 'pending' })
      .returning();
    return source!;
  }

  async findById(id: string): Promise<Source | undefined> {
    const [source] = await this.db.select().from(sources).where(eq(sources.id, id));
    return source;
  }

  async findForUser(telegramUserId: number, id: string): Promise<Source | undefined> {
    const [source] = await this.db
      .select()
      .from(sources)
      .where(and(eq(sources.id, id), eq(sources.telegramUserId, telegramUserId)));
    return source;
  }

  async listActiveForUser(telegramUserId: number): Promise<Source[]> {
    return this.db
      .select()
      .from(sources)
      .where(and(eq(sources.telegramUserId, telegramUserId), eq(sources.status, 'active')))
      .orderBy(asc(sources.createdAt));
  }

  /** Activates a pending source; resolves undefined if it was not pending any more. */
  async activate(id: string, googleCalendarId: string, nextSyncAt: Date): Promise<Source | undefined> {
    const [source] = await this.db
      .update(sources)
      .set({ status: 'active', googleCalendarId, nextSyncAt })
      .where(and(eq(sources.id, id), eq(sources.status, 'pending')))
      .returning();
    return source;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(sources).where(eq(sources.id, id));
  }

  async deletePendingCreatedBefore(before: Date): Promise<void> {
    await this.db.delete(sources).where(and(eq(sources.status, 'pending'), lt(sources.createdAt, before)));
  }

  async findDue(now: Date, limit: number): Promise<Source[]> {
    return this.db
      .select()
      .from(sources)
      .where(and(eq(sources.status, 'active'), lte(sources.nextSyncAt, now)))
      .orderBy(asc(sources.nextSyncAt))
      .limit(limit);
  }

  async recordSuccess(id: string, syncedAt: Date, nextSyncAt: Date): Promise<void> {
    await this.db
      .update(sources)
      .set({
        lastSyncedAt: syncedAt,
        lastSyncStatus: 'ok',
        lastSyncError: null,
        consecutiveFailures: 0,
        nextSyncAt,
      })
      .where(eq(sources.id, id));
  }

  async recordFailure(id: string, error: string, nextSyncAt: Date): Promise<void> {
    await this.db
      .update(sources)
      .set({
        lastSyncStatus: 'failed',
        lastSyncError: error,
        consecutiveFailures: sql`${sources.consecutiveFailures} + 1`,
        nextSyncAt,
      })
      .where(eq(sources.id, id));
  }
}
