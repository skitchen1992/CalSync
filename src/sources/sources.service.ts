import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Locks } from '@nestjs/locks';
import { GoogleAuthService } from '../auth/google-auth.service.js';
import { Clock } from '../common/clock/clock.js';
import { CryptoService } from '../common/crypto/crypto.service.js';
import { syncConfig } from '../config/sync.config.js';
import type { Source } from '../db/schema.js';
import { GoogleCalendarClient } from '../integrations/google/google-calendar.client.js';
import { SourceAdapterRegistry } from './source-adapter.registry.js';
import type { NormalizedEvent, SyncWindow } from './source.types.js';
import { SourceNotFoundError } from './sources.errors.js';
import { SourcesRepository } from './sources.repository.js';
import { computeSyncWindow } from './sync-window.js';

const PREVIEW_SAMPLE_SIZE = 3;
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

export interface SourcePreview {
  source: Source;
  eventCount: number;
  /** The next few upcoming events, for the confirmation message. */
  sample: NormalizedEvent[];
  /** 1-based rows of a sheet that could not be read and are left out. */
  unparsedRows: number[];
}

@Injectable()
export class SourcesService {
  private readonly logger = new Logger(SourcesService.name);

  constructor(
    private readonly repository: SourcesRepository,
    private readonly adapters: SourceAdapterRegistry,
    private readonly googleAuth: GoogleAuthService,
    private readonly google: GoogleCalendarClient,
    private readonly crypto: CryptoService,
    private readonly locks: Locks,
    private readonly clock: Clock,
    @Inject(syncConfig.KEY) private readonly config: ConfigType<typeof syncConfig>,
  ) {}

  /**
   * Recognizes the URL, lets the adapter inspect the new source (a sheet's column mapping comes
   * from the LLM here, once), fetches its events and stores it as pending confirmation, together
   * with what the inspection found.
   */
  async preview(telegramUserId: number, rawUrl: string): Promise<SourcePreview> {
    const url = rawUrl.trim();
    const recognized = this.adapters.recognize(url);
    const adapter = this.adapters.get(recognized.type);
    const now = this.clock.now();
    const inspection = adapter.inspect ? await adapter.inspect(url) : undefined;
    const timeZone = inspection?.timeZone ?? recognized.timeZone;
    const options = inspection?.options ?? null;
    const events = await adapter.fetch({ url, timeZone, options }, this.syncWindow());

    await this.repository.deletePendingCreatedBefore(new Date(now.getTime() - PENDING_TTL_MS));
    const source = await this.repository.insertPending({
      telegramUserId,
      type: recognized.type,
      name: inspection?.name ?? recognized.name,
      urlEncrypted: this.crypto.encrypt(url),
      timeZone,
      options,
      syncIntervalMinutes: this.config.intervalMinutes,
    });
    this.logger.log('Source previewed', { sourceId: source.id, type: source.type, eventCount: events.length });

    return {
      source,
      eventCount: events.length,
      sample: events.filter((event) => event.startsAt >= now).slice(0, PREVIEW_SAMPLE_SIZE),
      unparsedRows: inspection?.unparsedRows ?? [],
    };
  }

  /** Creates the source's own Google calendar and activates it. Repeated clicks are harmless. */
  async confirm(telegramUserId: number, sourceId: string): Promise<Source> {
    return this.locks.withLock(`source:confirm:${sourceId}`, async () => {
      const source = await this.repository.findForUser(telegramUserId, sourceId);
      if (source?.status === 'active') {
        return source;
      }
      if (!source) {
        throw new SourceNotFoundError('Source not found or expired');
      }

      const refreshToken = await this.googleAuth.getRefreshToken(telegramUserId);
      const calendarId = await this.google.forAccount(refreshToken).createCalendar({
        summary: source.name,
        timeZone: source.timeZone,
        description: 'Синхронизируется CalSync. Изменения здесь будут перезаписаны.',
      });
      const activated = await this.repository.activate(source.id, calendarId, this.clock.now());
      if (!activated) {
        throw new SourceNotFoundError('Source is no longer pending');
      }
      this.logger.log('Source activated', { sourceId: source.id });
      return activated;
    });
  }

  async cancel(telegramUserId: number, sourceId: string): Promise<void> {
    const source = await this.repository.findForUser(telegramUserId, sourceId);
    if (source?.status === 'pending') {
      await this.repository.delete(source.id);
    }
  }

  async listActive(telegramUserId: number): Promise<Source[]> {
    return this.repository.listActiveForUser(telegramUserId);
  }

  async findForUser(telegramUserId: number, sourceId: string): Promise<Source> {
    const source = await this.repository.findForUser(telegramUserId, sourceId);
    if (!source) {
      throw new SourceNotFoundError('Source not found');
    }
    return source;
  }

  /**
   * Removes the source and its Google calendar. Resolves `calendarKept: true` when Google is not
   * connected, so the calendar could not be deleted.
   */
  async remove(telegramUserId: number, sourceId: string): Promise<{ calendarKept: boolean }> {
    const source = await this.findForUser(telegramUserId, sourceId);
    let calendarKept = false;
    if (source.googleCalendarId) {
      if (await this.googleAuth.isConnected(telegramUserId)) {
        const refreshToken = await this.googleAuth.getRefreshToken(telegramUserId);
        await this.google.forAccount(refreshToken).deleteCalendar(source.googleCalendarId);
      } else {
        calendarKept = true;
      }
    }
    await this.repository.delete(source.id);
    this.logger.log('Source removed', { sourceId: source.id, calendarKept });
    return { calendarKept };
  }

  // ---- Used by the sync engine ----

  syncWindow(): SyncWindow {
    return computeSyncWindow(this.clock.now(), this.config.windowPastDays, this.config.windowFutureDays);
  }

  async findDue(limit: number): Promise<Source[]> {
    return this.repository.findDue(this.clock.now(), limit);
  }

  async getActive(sourceId: string): Promise<Source | undefined> {
    const source = await this.repository.findById(sourceId);
    return source?.status === 'active' ? source : undefined;
  }

  async fetchEvents(source: Source, window: SyncWindow, signal?: AbortSignal): Promise<NormalizedEvent[]> {
    return this.adapters
      .get(source.type)
      .fetch({ url: this.crypto.decrypt(source.urlEncrypted), timeZone: source.timeZone, options: source.options }, window, signal);
  }

  async recordSyncSuccess(sourceId: string, syncedAt: Date, nextSyncAt: Date): Promise<void> {
    await this.repository.recordSuccess(sourceId, syncedAt, nextSyncAt);
  }

  async recordSyncFailure(sourceId: string, error: string, nextSyncAt: Date): Promise<void> {
    await this.repository.recordFailure(sourceId, error, nextSyncAt);
  }
}
