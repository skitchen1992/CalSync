import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { LockNotAcquiredError, Locks } from '@nestjs/locks';
import { CircuitOpenError } from '@nestjs/resilience';
import { GoogleAuthService } from '../auth/google-auth.service.js';
import { Clock } from '../common/clock/clock.js';
import { DomainError } from '../common/errors/domain-error.js';
import { toError } from '../common/errors/to-error.js';
import { mapWithConcurrency } from '../common/utils/map-with-concurrency.js';
import { syncConfig } from '../config/sync.config.js';
import type { NewEventLink, Source } from '../db/schema.js';
import { GoogleCalendarClient } from '../integrations/google/google-calendar.client.js';
import { GoogleAuthRevokedError } from '../integrations/google/google.errors.js';
import { SourcesService } from '../sources/sources.service.js';
import { googleEventIdFor, toCalendarEvent } from './calendar-event.js';
import { EventLinksRepository } from './event-links.repository.js';
import { SuspiciousSnapshotError } from './sync.errors.js';
import { planSync } from './sync-plan.js';
import { nextSyncAfterFailure, nextSyncAfterSuccess } from './sync-schedule.js';

/** Sources picked up by one dispatcher tick. */
const DUE_BATCH_SIZE = 20;
/** An empty snapshot is trusted only while fewer linked events than this would be deleted. */
const SUSPICIOUS_EMPTY_THRESHOLD = 3;

export interface SyncCounts {
  created: number;
  updated: number;
  deleted: number;
  unchanged: number;
}

export type SyncOutcome =
  | ({ status: 'synced'; sourceId: string; sourceName: string } & SyncCounts)
  | { status: 'skipped'; sourceId: string; sourceName: string; reason: 'running' | 'inactive' | 'deferred' }
  | { status: 'failed'; sourceId: string; sourceName: string; error: Error };

/** A short, stable description for `sources.last_sync_error` (shown in the bot via its code). */
const describeFailure = (error: Error) =>
  error instanceof DomainError ? `${error.code}: ${error.message}` : `INTERNAL: ${error.message}`;

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly sources: SourcesService,
    private readonly links: EventLinksRepository,
    private readonly googleAuth: GoogleAuthService,
    private readonly google: GoogleCalendarClient,
    private readonly locks: Locks,
    private readonly clock: Clock,
    @Inject(syncConfig.KEY) private readonly config: ConfigType<typeof syncConfig>,
  ) {}

  /** One dispatcher tick: syncs the due sources; an open Google circuit defers the rest. */
  async runDueSources(): Promise<SyncOutcome[]> {
    const due = await this.sources.findDue(DUE_BATCH_SIZE);
    if (due.length === 0) {
      return [];
    }

    let circuitOpen = false;
    const outcomes = await mapWithConcurrency(due, this.config.sourceConcurrency, async (source) => {
      if (circuitOpen) {
        return { status: 'skipped', sourceId: source.id, sourceName: source.name, reason: 'deferred' } as const;
      }
      const outcome = await this.syncSource(source);
      if (outcome.status === 'failed' && outcome.error instanceof CircuitOpenError) {
        circuitOpen = true;
      }
      return outcome;
    });

    if (circuitOpen) {
      this.logger.warn('Google circuit is open, remaining sources deferred to the next tick');
    }
    return outcomes;
  }

  /** The bot's /sync: every active source of the user, one after another. */
  async syncAllForUser(telegramUserId: number): Promise<SyncOutcome[]> {
    const outcomes: SyncOutcome[] = [];
    for (const source of await this.sources.listActive(telegramUserId)) {
      outcomes.push(await this.syncSource(source));
    }
    return outcomes;
  }

  /** Syncs one source under its lock; a sync already running for it makes this one a skip. */
  async syncSource(source: Source): Promise<SyncOutcome> {
    try {
      return await this.locks.withLock(`sync:source:${source.id}`, (lock) => this.syncLocked(source.id, lock.signal));
    } catch (error) {
      if (error instanceof LockNotAcquiredError) {
        return { status: 'skipped', sourceId: source.id, sourceName: source.name, reason: 'running' };
      }
      throw error;
    }
  }

  private async syncLocked(sourceId: string, signal: AbortSignal): Promise<SyncOutcome> {
    // Re-read under the lock: the source may have been removed or changed meanwhile.
    const source = await this.sources.getActive(sourceId);
    if (!source?.googleCalendarId) {
      return { status: 'skipped', sourceId, sourceName: source?.name ?? '', reason: 'inactive' };
    }

    const startedAt = this.clock.now();
    try {
      const counts = await this.mirror(source, source.googleCalendarId, signal);
      const finishedAt = this.clock.now();
      await this.sources.recordSyncSuccess(source.id, finishedAt, nextSyncAfterSuccess(finishedAt, source.syncIntervalMinutes));
      this.logger.log('Source synced', { sourceId: source.id, ...counts, durationMs: finishedAt.getTime() - startedAt.getTime() });
      return { status: 'synced', sourceId: source.id, sourceName: source.name, ...counts };
    } catch (caught) {
      const error = toError(caught);
      await this.recordFailure(source, error);
      return { status: 'failed', sourceId: source.id, sourceName: source.name, error };
    }
  }

  private async recordFailure(source: Source, error: Error): Promise<void> {
    if (error instanceof CircuitOpenError) {
      return; // not the source's fault: keep its schedule, the next tick retries
    }
    if (error instanceof GoogleAuthRevokedError) {
      await this.googleAuth.handleRevoked(source.telegramUserId);
    }
    const nextSyncAt = nextSyncAfterFailure(
      this.clock.now(),
      source.syncIntervalMinutes,
      source.consecutiveFailures,
      this.config.maxBackoffMinutes,
    );
    await this.sources.recordSyncFailure(source.id, describeFailure(error), nextSyncAt);

    const params = { sourceId: source.id, failures: source.consecutiveFailures + 1, nextSyncAt: nextSyncAt.toISOString() };
    if (error instanceof DomainError) {
      this.logger.warn('Source sync failed', { ...params, code: error.code, reason: error.message });
    } else {
      this.logger.error('Source sync failed', error.stack, params);
    }
  }

  /** Makes the source's Google calendar match the source inside the sync window. */
  private async mirror(source: Source, calendarId: string, signal: AbortSignal): Promise<SyncCounts> {
    const refreshToken = await this.googleAuth.getRefreshToken(source.telegramUserId);
    const window = this.sources.syncWindow();
    const events = await this.sources.fetchEvents(source, window, signal);
    const plan = planSync(events, await this.links.findBySource(source.id), window, (uid) =>
      googleEventIdFor(source.id, uid),
    );

    if (events.length === 0 && plan.deletes.length >= SUSPICIOUS_EMPTY_THRESHOLD) {
      throw new SuspiciousSnapshotError(
        `The source returned no events, but ${plan.deletes.length} mirrored events are in the window`,
      );
    }

    const calendar = this.google.forAccount(refreshToken);

    // Persist every link whose write succeeded, even when a later write fails: the next run then
    // only retries what is left (and deterministic ids make a repeated write harmless anyway).
    const written: NewEventLink[] = [];
    try {
      await mapWithConcurrency(plan.writes, this.config.writeConcurrency, async (write) => {
        signal.throwIfAborted();
        await calendar.putEvent(calendarId, toCalendarEvent(source.id, write.event, write.googleEventId), write.exists, signal);
        written.push({
          sourceId: source.id,
          externalUid: write.event.uid,
          googleEventId: write.googleEventId,
          contentHash: write.contentHash,
          startsAt: write.event.startsAt,
        });
      });
    } finally {
      await this.links.upsertMany(written);
    }

    const deleted: string[] = [];
    try {
      await mapWithConcurrency(plan.deletes, this.config.writeConcurrency, async (link) => {
        signal.throwIfAborted();
        await calendar.deleteEvent(calendarId, link.googleEventId, signal);
        deleted.push(link.externalUid);
      });
    } finally {
      await this.links.deleteMany(source.id, deleted);
    }

    return { created: plan.created, updated: plan.updated, deleted: deleted.length, unchanged: plan.unchanged };
  }

  /** Mirrored event count, for the bot's source list. */
  async mirroredEventCount(sourceId: string): Promise<number> {
    return this.links.countBySource(sourceId);
  }
}
