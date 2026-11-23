import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import type { INestApplication, Type } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import { Test } from '@nestjs/testing';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { AppModule } from '../../src/app.module.js';
import * as schema from '../../src/db/schema.js';

const MIGRATIONS_FOLDER = resolve(import.meta.dirname, '../../drizzle');

export interface TestApp {
  app: INestApplication;
  /** In-process PostgreSQL behind the app's database; close it to simulate an outage. */
  pglite: PGlite;
  close(): Promise<void>;
}

/**
 * Boots the real AppModule with only the edges replaced: PostgreSQL becomes an in-memory PGlite
 * migrated with the real migrations. Global pipes, guards and filters (APP_* providers) run
 * exactly as in production.
 */
export async function createTestApp(options: { controllers?: Type[] } = {}): Promise<TestApp> {
  const pglite = new PGlite();
  const db = drizzle({ client: pglite, schema, casing: 'snake_case' });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: options.controllers ?? [],
  })
    .overrideProvider(getDrizzleToken())
    .useValue(db)
    .compile();

  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();

  return {
    app,
    pglite,
    async close() {
      await app.close();
      if (!pglite.closed) {
        await pglite.close();
      }
    },
  };
}
