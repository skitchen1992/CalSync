# Database: PostgreSQL + Drizzle

Persistence is PostgreSQL accessed through Drizzle ORM with the official `@nestjs/drizzle`
integration. Drizzle has no entity classes and no codegen step: tables are plain objects, and query
result types are inferred from the schema.

Versions: `drizzle-orm` 0.45 (stable) with the node-postgres driver (`pg`). The Nest docs show the
Drizzle 1.0 (beta) `relations` option. On 0.45, relations are declared with `relations()` next to
the tables and passed to the database through `schema`. Switch to `relations` only after upgrading
to Drizzle 1.0 stable.

## Layout
```
src/db/
├── schema.ts          # pgTable + relations() definitions, inferred row types ($inferSelect / $inferInsert)
├── database.ts        # `Database` / `DbTransaction` / `DbExecutor` type aliases used by repositories
├── database.module.ts # DrizzleModule.forRootAsync wiring + DrizzleLockStore provider
└── drizzle-lock.store.ts # LockStore for @nestjs/locks on the `locks` table (see 105)
drizzle/               # Generated SQL migrations + meta/_journal.json (committed)
drizzle.config.ts      # drizzle-kit config: schema path, out dir, dialect, casing (loads .env itself)
```
Split `schema.ts` into `schema/<area>.ts` files re-exported by `schema.ts` when it grows past a few
tables. This is the one place where a re-exporting file is fine: it contains tables, not Nest classes.

## Wiring
`DatabaseModule` (imported once by `AppModule`) registers the database. Config comes through the
`database` namespace (see 101):
```ts
DrizzleModule.forRootAsync({
  inject: [databaseConfig.KEY],
  useFactory: (config: ConfigType<typeof databaseConfig>) => ({
    drizzle,                        // from 'drizzle-orm/node-postgres'
    connection: config.url,
    schema,                         // import * as schema from './schema.js'
    casing: 'snake_case' as const,  // TS camelCase ↔ SQL snake_case (same value in drizzle.config.ts)
  }),
}),
```
The database is registered globally, so any provider can inject it with `@InjectDrizzle()` without
importing a module. Only repositories do that (see below). The module closes the pool on shutdown
and listens for idle-connection errors, so do not add your own `pool.end()` or error listeners.

## Schema Conventions
- Primary keys: `uuid().primaryKey().defaultRandom()`.
- Timestamps: `timestamp({ withTimezone: true })`, stored in UTC. Every table has `createdAt`
  (`.defaultNow()`) and `updatedAt` (`.defaultNow().$onUpdate(() => new Date())`).
- Invariants live in the database, not only in code. Use `notNull()`, `unique()` / composite unique
  indexes, foreign keys with an explicit `onDelete`. Example: `event_links` has a unique index on
  `(source_id, external_uid)`. That index is what makes sync idempotent.
- `jsonb` columns are typed with `.$type<T>()` **and** parsed with Zod when read (stored JSON can
  drift from the current type). Use them for genuinely schemaless data (sheet column mapping, adapter
  options), not as a way to avoid columns.
- Row types come from the schema: `export type Source = typeof sources.$inferSelect;`
  `export type NewSource = typeof sources.$inferInsert;`. Do not redeclare them by hand.
- Columns holding secrets (OAuth refresh tokens, private feed URLs, CalDAV passwords) store
  ciphertext only (see 107). Name them accordingly: `refreshTokenEncrypted`.

## Repositories
- Each aggregate has a repository provider (`sources.repository.ts`, `event-links.repository.ts`) in
  the feature that owns the table. Repositories are the **only** feature code that imports
  `drizzle-orm` query helpers or injects the database. The only other users are infrastructure
  under `src/db/` and `src/health/`: the lock store and the health ping. Services call repository
  methods with domain names (`findDueForSync(now)`, `upsertLinks(...)`).
- Repositories are not exported from their module. Other features go through the owning service.
- Inject the database as `@InjectDrizzle() private readonly db: Database` (from `src/db/database.ts`).
  `Database` is the driver-independent `PgDatabase<PgQueryResultHKT, Schema>`, so the node-postgres
  database in the app and the PGlite database in tests both fit. Never type it as `NodePgDatabase`.
- Methods that may run inside a transaction take an optional `DbExecutor` (`Database | DbTransaction`):
  ```ts
  // event-links.repository.ts
  async upsertMany(links: NewEventLink[], executor: DbExecutor = this.db) {
    if (links.length === 0) return;
    await executor
      .insert(eventLinks)
      .values(links)
      .onConflictDoUpdate({
        target: [eventLinks.sourceId, eventLinks.externalUid],
        set: { googleEventId: sql`excluded.google_event_id`, contentHash: sql`excluded.content_hash` },
      });
  }
  ```
- Select only the columns you need for hot paths. Batch with `inArray()` instead of running a query
  per item in a loop (no N+1 queries).
- Raw SQL only through the `sql` template tag, which parameterizes values. Never build SQL by string
  concatenation.

## Transactions
- Use `this.db.transaction(async (tx) => { … })`. Every query that belongs to the transaction runs
  through `tx`, not the injected `db`. If the callback throws, the transaction rolls back.
- Keep transactions short and local. **Never** call Google, Telegram, DeepSeek or any HTTP endpoint
  inside a transaction, because that holds locks while waiting on the network. The sync engine
  computes the diff, applies changes to Google, then persists the resulting mapping with an
  idempotent upsert.
- Prefer idempotent writes (upsert on a natural key) over "check, then insert". The sync can be
  retried at any point.

## Migrations
- Schema change → `drizzle-kit generate` → **review the generated SQL** → commit the schema and the
  migration together.
- Never edit or delete a migration that has been applied anywhere. Fix forward with a new one.
- Apply migrations with `drizzle-kit migrate` as a separate step before the app starts (container
  entrypoint or deploy step), not in application code. The Nest docs warn that applying migrations on
  startup breaks when several instances start at once.
- `drizzle-kit push` is allowed only against a throwaway local database, never against shared or
  production databases.
- Destructive changes (dropping or renaming columns that hold data) go in two steps: first stop
  using the column, then drop it in a later migration.
