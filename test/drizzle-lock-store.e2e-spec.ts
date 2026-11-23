import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import type { LocksStorage } from '@nestjs/locks';
import { lockStoreContract } from '@nestjs/locks/testing';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { DrizzleLockStore } from '../src/db/drizzle-lock.store.js';
import * as schema from '../src/db/schema.js';

// The package's own contract suite, against the real table and sequence from the migrations.
// The expiry cases wait in real time (the store uses the database clock), about 25 s in total.
describe('DrizzleLockStore contract', async () => {
  const pglite = new PGlite();
  const db = drizzle({ client: pglite, schema, casing: 'snake_case' });
  await migrate(db, { migrationsFolder: resolve(import.meta.dirname, '../drizzle') });
  const storage = { registerSource: () => undefined } as unknown as LocksStorage;
  const store = new DrizzleLockStore(db, storage);

  afterAll(async () => {
    await pglite.close();
  });

  for (const contractCase of lockStoreContract(() => store, { concurrent: true })) {
    it(contractCase.name, contractCase.run, 20_000);
  }
});
