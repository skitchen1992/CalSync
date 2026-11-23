import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { FakeModel, overrideModels } from '@nestjs/ai/testing';
import type { INestApplication, Type } from '@nestjs/common';
import { getDrizzleToken } from '@nestjs/drizzle';
import { getHttpClientToken, HttpClient } from '@nestjs/http-client';
import { Test } from '@nestjs/testing';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { AppModule } from '../../src/app.module.js';
import { Clock } from '../../src/common/clock/clock.js';
import { Notifier } from '../../src/common/notifier/notifier.js';
import * as schema from '../../src/db/schema.js';
import { GoogleCalendarClient } from '../../src/integrations/google/google-calendar.client.js';
import { GoogleOAuthClient } from '../../src/integrations/google/google-oauth.client.js';
import { GOOGLE_SHEETS_HTTP } from '../../src/sources/adapters/gsheet/gsheet.adapter.js';
import { YandexEmbedAdapter } from '../../src/sources/adapters/yandex-embed/yandex-embed.adapter.js';
import { FixedClock } from '../fakes/fixed-clock.js';
import { FakeGoogleCalendarClient, FakeGoogleOAuthClient } from '../fakes/fake-google.js';
import { FakeGoogleSheets } from '../fakes/fake-google-sheets.js';
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
  /** Google Sheets behind the real GoogleSheetAdapter (the team sheet fixture). */
  sheets: FakeGoogleSheets;
  /** The `default` language model: queue answers with `llm.reply(...)`, inspect `llm.calls`. */
  llm: FakeModel;
  close(): Promise<void>;
}

/**
 * Boots the real AppModule with only the edges replaced: PostgreSQL becomes an in-memory PGlite
 * migrated with the real migrations; Google, Telegram notifications, the Yandex adapter, the
 * Google Sheets export and the language model become in-memory fakes. Global pipes, guards,
 * filters and the lock store run exactly as in production. `now` pins the Clock (for fixtures
 * with fixed dates).
 */
export async function createTestApp(options: { controllers?: Type[]; now?: Date } = {}): Promise<TestApp> {
  const pglite = new PGlite();
  const db = drizzle({ client: pglite, schema, casing: 'snake_case' });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  const googleCalendar = new FakeGoogleCalendarClient();
  const notifier = new FakeNotifier();
  const source = new FakeSourceAdapter();
  const sheets = new FakeGoogleSheets();
  const llm = new FakeModel();

  let builder = Test.createTestingModule({
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
    .overrideProvider(getHttpClientToken(GOOGLE_SHEETS_HTTP))
    .useValue(new HttpClient({ fetch: sheets.fetch, retry: false, redirect: 'error' }));
  if (options.now) {
    builder = builder.overrideProvider(Clock).useValue(new FixedClock(options.now));
  }
  const moduleRef = await overrideModels(builder, { default: llm }).compile();

  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();

  return {
    app,
    pglite,
    googleCalendar,
    notifier,
    source,
    sheets,
    llm,
    async close() {
      await app.close();
      if (!pglite.closed) {
        await pglite.close();
      }
    },
  };
}
