import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import type { INestApplication, Type } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import { Test } from '@nestjs/testing';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { AppModule } from '../../src/app.module.js';
import { Notifier } from '../../src/common/notifier/notifier.js';
import * as schema from '../../src/db/schema.js';
import { GoogleCalendarClient } from '../../src/integrations/google/google-calendar.client.js';
import { GoogleOAuthClient } from '../../src/integrations/google/google-oauth.client.js';
import { YandexEmbedAdapter } from '../../src/sources/adapters/yandex-embed/yandex-embed.adapter.js';
import { FakeGoogleCalendarClient, FakeGoogleOAuthClient } from '../fakes/fake-google.js';
import { FakeNotifier } from '../fakes/fake-notifier.js';
import { FakeSourceAdapter } from '../fakes/fake-source-adapter.js';

const MIGRATIONS_FOLDER = resolve(import.meta.dirname, '../../drizzle');

export interface TestApp {
  app: INestApplication;
  /** In-process PostgreSQL behind the app's database; close it to simulate an outage. */
  pglite: PGlite;
  googleCalendar: FakeGoogleCalendarClient;
  notifier: FakeNotifier;
  source: FakeSourceAdapter;
  close(): Promise<void>;
}

/**
 * Boots the real AppModule with only the edges replaced: PostgreSQL becomes an in-memory PGlite
 * migrated with the real migrations; Google, Telegram notifications and the source adapter become
 * in-memory fakes. Global pipes, guards, filters and the lock store run exactly as in production.
 */
export async function createTestApp(options: { controllers?: Type[] } = {}): Promise<TestApp> {
  const pglite = new PGlite();
  const db = drizzle({ client: pglite, schema, casing: 'snake_case' });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  const googleCalendar = new FakeGoogleCalendarClient();
  const notifier = new FakeNotifier();
  const source = new FakeSourceAdapter();

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: options.controllers ?? [],
  })
    .overrideProvider(getDrizzleToken())
    .useValue(db)
    .overrideProvider(GoogleOAuthClient)
    .useValue(new FakeGoogleOAuthClient())
    .overrideProvider(GoogleCalendarClient)
    .useValue(googleCalendar)
    .overrideProvider(Notifier)
    .useValue(notifier)
    .overrideProvider(YandexEmbedAdapter)
    .useValue(source)
    .compile();

  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();

  return {
    app,
    pglite,
    googleCalendar,
    notifier,
    source,
    async close() {
      await app.close();
      if (!pglite.closed) {
        await pglite.close();
      }
    },
  };
}
