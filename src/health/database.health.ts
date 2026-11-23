import { Injectable, Logger } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { HealthIndicatorService } from '@nestjs/terminus';
import { sql } from 'drizzle-orm';
import { toError } from '../common/errors/to-error.js';
import { withTimeout } from '../common/utils/with-timeout.js';
import type { Database } from '../db/database.js';

@Injectable()
export class DatabaseHealthIndicator {
  private readonly logger = new Logger(DatabaseHealthIndicator.name);

  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy<const TKey extends string>(key: TKey, timeoutMs: number) {
    const indicator = this.healthIndicatorService.check(key);
    try {
      await withTimeout(this.db.execute(sql`select 1`), timeoutMs, 'Database ping');
      return indicator.up();
    } catch (error) {
      // Drizzle wraps driver errors ("Failed query: …"); the actionable reason is in `cause`.
      // The response stays generic because connection errors carry hosts and ports.
      const err = toError(error);
      this.logger.warn('Database ping failed', { reason: toError(err.cause ?? err).message });
      return indicator.down({ reason: 'unreachable' });
    }
  }
}
