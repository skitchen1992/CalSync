import { Module, StandardSchemaValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule, minutes } from '@nestjs/throttler';
import { CommonModule } from './common/common.module.js';
import { CatchEverythingFilter } from './common/filters/catch-everything.filter.js';
import { DomainErrorFilter } from './common/filters/domain-error.filter.js';
import { appConfig } from './config/app.config.js';
import { databaseConfig } from './config/database.config.js';
import { envSchema } from './config/env.schema.js';
import { DatabaseModule } from './db/database.module.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validationSchema: envSchema,
      load: [appConfig, databaseConfig],
    }),
    ThrottlerModule.forRoot([{ ttl: minutes(1), limit: 60 }]),
    CommonModule,
    DatabaseModule,
    HealthModule,
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
