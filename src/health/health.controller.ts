import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { DatabaseHealthIndicator } from './database.health.js';

const DATABASE_PING_TIMEOUT_MS = 1_000;

@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: DatabaseHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    // Only local dependencies: a slow Google or Telegram must not make the container look dead.
    return this.health.check([() => this.database.isHealthy('database', DATABASE_PING_TIMEOUT_MS)]);
  }
}
