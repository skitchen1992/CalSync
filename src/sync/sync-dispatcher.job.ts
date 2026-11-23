import { Injectable, Logger } from '@nestjs/common';
import { OnOneInstance, WithoutOverlapping } from '@nestjs/locks';
import { Cron, CronExpression } from '@nestjs/schedule';
import { toError } from '../common/errors/to-error.js';
import { SyncService } from './sync.service.js';

/** Every minute, syncs the sources whose `next_sync_at` has come. */
@Injectable()
export class SyncDispatcherJob {
  private readonly logger = new Logger(SyncDispatcherJob.name);

  constructor(private readonly sync: SyncService) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'sync-dispatcher' })
  @OnOneInstance({ key: 'sync:dispatcher' })
  @WithoutOverlapping()
  async dispatch(): Promise<void> {
    try {
      const outcomes = await this.sync.runDueSources();
      if (outcomes.length > 0) {
        const count = (status: string) => outcomes.filter((outcome) => outcome.status === status).length;
        this.logger.log('Dispatcher tick', { synced: count('synced'), failed: count('failed'), skipped: count('skipped') });
      }
    } catch (error) {
      // Per-source failures are handled inside; this is the tick itself failing (e.g. no database).
      this.logger.error('Dispatcher tick failed', toError(error).stack);
    }
  }
}
