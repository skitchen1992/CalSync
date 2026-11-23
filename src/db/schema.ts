import { sql } from 'drizzle-orm';
import { bigint, index, integer, jsonb, pgSequence, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { SourceOptions } from './source-options.js';

// Drizzle tables. drizzle-kit reads this file (see drizzle.config.ts) and the runtime passes it to
// drizzle() as `schema`. Column names are camelCase here and snake_case in SQL (casing option).

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/** Telegram user ids exceed 2^31; they stay below 2^53, so `number` is exact. */
const telegramUserId = () => bigint({ mode: 'number' });

export const GOOGLE_ACCOUNT_STATUSES = ['connected', 'revoked'] as const;

/** One Google account per Telegram user. The refresh token is stored encrypted (CryptoService). */
export const googleAccounts = pgTable('google_accounts', {
  telegramUserId: telegramUserId().primaryKey(),
  refreshTokenEncrypted: text().notNull(),
  scope: text().notNull(),
  status: text({ enum: GOOGLE_ACCOUNT_STATUSES }).notNull().default('connected'),
  ...timestamps,
});

/** Pending OAuth authorizations. Only the SHA-256 of the `state` value is stored; rows are single-use. */
export const oauthStates = pgTable('oauth_states', {
  stateHash: text().primaryKey(),
  telegramUserId: telegramUserId().notNull(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const SOURCE_TYPES = ['yandex-embed', 'gsheet'] as const;
export const SOURCE_STATUSES = ['pending', 'active'] as const;
export const SYNC_STATUSES = ['ok', 'failed'] as const;

export const sources = pgTable(
  'sources',
  {
    id: uuid().primaryKey().defaultRandom(),
    telegramUserId: telegramUserId().notNull(),
    type: text({ enum: SOURCE_TYPES }).notNull(),
    name: text().notNull(),
    /** The URL the user sent; encrypted because private feed URLs embed credentials. */
    urlEncrypted: text().notNull(),
    /** IANA zone the source's local times are in. */
    timeZone: text().notNull(),
    /**
     * What the adapter needs to read the source, worked out when it was added (a sheet's column
     * mapping); null for sources that need nothing. Parse with `sourceOptionsSchema` before use.
     */
    options: jsonb().$type<SourceOptions>(),
    /** `pending` until the user confirms the preview in the bot. */
    status: text({ enum: SOURCE_STATUSES }).notNull().default('pending'),
    googleCalendarId: text(),
    syncIntervalMinutes: integer().notNull(),
    nextSyncAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastSyncedAt: timestamp({ withTimezone: true }),
    lastSyncStatus: text({ enum: SYNC_STATUSES }),
    lastSyncError: text(),
    consecutiveFailures: integer().notNull().default(0),
    /**
     * Keys of the source's unreadable entries (sheet rows) the user has already been told about,
     * so a sync only reports new ones. Replaced by the current set after every sync.
     */
    reportedSkippedKeys: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    ...timestamps,
  },
  (table) => [
    index('sources_due_idx').on(table.status, table.nextSyncAt),
    index('sources_user_idx').on(table.telegramUserId),
  ],
);

/** Which Google event mirrors which source event. The primary key makes sync upserts idempotent. */
export const eventLinks = pgTable(
  'event_links',
  {
    sourceId: uuid()
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    externalUid: text().notNull(),
    googleEventId: text().notNull(),
    contentHash: text().notNull(),
    /** Start instant (UTC); deletions only apply to links inside the sync window. */
    startsAt: timestamp({ withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [primaryKey({ columns: [table.sourceId, table.externalUid] })],
);

/** Lock records for @nestjs/locks (see DrizzleLockStore). */
export const locksFencingTokenSeq = pgSequence('locks_fencing_token_seq');

export const locks = pgTable('locks', {
  key: text().primaryKey(),
  owner: text(),
  fencingToken: bigint({ mode: 'number' }).notNull(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
});

export type GoogleAccount = typeof googleAccounts.$inferSelect;
export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;
export type SourceType = (typeof SOURCE_TYPES)[number];
export type EventLink = typeof eventLinks.$inferSelect;
export type NewEventLink = typeof eventLinks.$inferInsert;
