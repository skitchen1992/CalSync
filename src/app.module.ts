import { Module, StandardSchemaValidationPipe } from '@nestjs/common';
import { ConditionalModule, ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { LocksModule } from '@nestjs/locks';
import { ResilienceModule } from '@nestjs/resilience';
import { ThrottlerGuard, ThrottlerModule, minutes } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module.js';
import { BotModule } from './bot/bot.module.js';
import { CommonModule } from './common/common.module.js';
import { CatchEverythingFilter } from './common/filters/catch-everything.filter.js';
import { DomainErrorFilter } from './common/filters/domain-error.filter.js';
import { appConfig } from './config/app.config.js';
import { databaseConfig } from './config/database.config.js';
import { validateEnv } from './config/env.js';
import { googleConfig } from './config/google.config.js';
import { securityConfig } from './config/security.config.js';
import { syncConfig } from './config/sync.config.js';
import { telegramConfig } from './config/telegram.config.js';
import { DatabaseModule } from './db/database.module.js';
import { HealthModule } from './health/health.module.js';
import { GOOGLE_RESILIENCE_PRESET } from './integrations/google/google.constants.js';
import { isRetryableGoogleError } from './integrations/google/google.errors.js';
import { TelegramModule } from './integrations/telegram/telegram.module.js';
import { SchedulerModule } from './sync/scheduler.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Not `validationSchema`: it would copy Zod's parsed values back into process.env (see validateEnv).
      validate: validateEnv,
      load: [appConfig, databaseConfig, securityConfig, telegramConfig, googleConfig, syncConfig],
    }),
    ThrottlerModule.forRoot([{ ttl: minutes(1), limit: 60 }]),
    // One preset per external system; SDK calls run through it (see rule 106).
    ResilienceModule.forRoot({
      presets: {
        [GOOGLE_RESILIENCE_PRESET]: {
          timeout: '20s',
          retry: { attempts: 3, backoff: { delay: '500ms', maxDelay: '5s' }, retryIf: isRetryableGoogleError },
          circuitBreaker: { failureRateThreshold: 50, minimumCalls: 10, openDuration: '1m' },
        },
      },
    }),
    LocksModule.forRoot({ ttl: '30s' }),
    CommonModule,
    DatabaseModule,
    TelegramModule,
    HealthModule,
    AuthModule,
    BotModule,
    ConditionalModule.registerWhen(SchedulerModule, 'SYNC_SCHEDULER_ENABLED'),
  ],
  providers: [
    { provide: APP_PIPE, useClass: StandardSchemaValidationPipe },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Global filters are tried in reverse registration order: the catch-all is registered
    // first so that the more specific DomainErrorFilter gets the first look.
    { provide: APP_FILTER, useClass: CatchEverythingFilter },
    { provide: APP_FILTER, useClass: DomainErrorFilter },
  ],
})
export class AppModule {}
