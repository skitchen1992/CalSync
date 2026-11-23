import { Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { DrizzleModule } from '@nestjs/drizzle';
import { drizzle } from 'drizzle-orm/node-postgres';
import { databaseConfig } from '../config/database.config.js';
import { DrizzleLockStore } from './drizzle-lock.store.js';
import * as schema from './schema.js';

/**
 * Registers the PostgreSQL database once. The database is global: repositories inject it with
 * `@InjectDrizzle()` without importing this module, and its pool is closed on shutdown.
 * Also registers the lock store that @nestjs/locks (LocksModule, global) uses.
 */
@Module({
  imports: [
    DrizzleModule.forRootAsync({
      inject: [databaseConfig.KEY],
      useFactory: (config: ConfigType<typeof databaseConfig>) => ({
        drizzle,
        connection: config.url,
        schema,
        casing: 'snake_case' as const,
      }),
    }),
  ],
  providers: [DrizzleLockStore],
})
export class DatabaseModule {}
