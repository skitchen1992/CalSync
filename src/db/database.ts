import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from 'drizzle-orm/pg-core';
import type * as schema from './schema.js';

export type Schema = typeof schema;

/**
 * The injected database (`@InjectDrizzle()`), typed independently of the driver so the
 * node-postgres database in the app and the PGlite database in tests both fit.
 */
export type Database = PgDatabase<PgQueryResultHKT, Schema>;

export type DbTransaction = PgTransaction<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;

/** What repository methods accept so they can run either standalone or inside a transaction. */
export type DbExecutor = Database | DbTransaction;
