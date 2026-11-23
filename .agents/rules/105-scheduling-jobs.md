# Scheduling, Locks & Sync Jobs

Periodic sync runs on `@nestjs/schedule`. Runs are coordinated with `@nestjs/locks`: no overlapping
runs, and only one sync per source at a time. The schedule of `@nestjs/schedule` lives in memory and
disappears on restart, so CalSync keeps **when each source is due** in the database and uses a
single dispatcher job to act on it.

## Modules
- `SchedulerModule` registers `ScheduleModule.forRoot()` and the job classes. `AppModule` loads it
  with `ConditionalModule.registerWhen(SchedulerModule, 'SYNC_SCHEDULER_ENABLED')` (see 101).
- `LocksModule.forRoot({ ttl: '30s' })` is imported once in `AppModule` (global by default), **not**
  inside the conditional `SchedulerModule`: the bot's manual `/sync` takes the same locks.
- The lock store is PostgreSQL. `DrizzleLockStore` (`src/db/drizzle-lock.store.ts`) implements
  `LockStore` following the Drizzle recipe in the Nest locks docs: a `locks` table plus a
  `locks_fencing_token_seq` sequence (created by a migration), and `storage.registerSource(this)` in
  its constructor. It is a provider of `DatabaseModule`.
- Without a registered store, `LocksModule` uses an in-memory store and refuses to start with
  `NODE_ENV=production`. Do not set `allowInMemoryStorage: true`: the database store costs
  nothing extra and keeps working when the app runs on several instances.

## Dispatcher Pattern
One dispatcher job fires on a fixed cadence and syncs the sources that are due
(`enabled AND next_sync_at <= now()`). Do not create one cron job per source in memory: per-source
jobs are lost on restart and drift from the database.
```ts
@Injectable()
export class SyncDispatcherJob {
  constructor(private readonly syncService: SyncService) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'sync-dispatcher' })
  @OnOneInstance({ key: 'sync:dispatcher' })
  @WithoutOverlapping()
  async dispatch(): Promise<void> {
    await this.syncService.runDueSources(); // the job is a thin trigger, the service owns logic
  }
}
```
- Every job has `@WithoutOverlapping()`: a run that outlasts its interval makes the next tick skip,
  on **any** instance. `waitForCompletion` of `@nestjs/schedule` only covers its own process.
  Every job also has `@OnOneInstance()`, so with several instances one of them fires per tick. The
  two decorators on one method share the key.
- Job methods are thin triggers that delegate to a service. The same service method is called by
  the bot's manual `/sync` command, so there is one code path.
- Use `SchedulerRegistry` (`addCronJob` / `deleteCronJob`) only for genuinely dynamic in-memory
  timers. Name every job, and remove it when its owner goes away.
- Cron decorator options are static (evaluated at class definition), so config cannot be injected
  into them. To switch jobs off, toggle the whole module (see above). Do not put `process.env` reads
  into decorator arguments.

## Unit of Work: One Source
- `runDueSources()` processes sources with bounded concurrency (a small fixed pool from the `sync`
  config namespace). Do not use an unbounded `Promise.all` over all sources, because it bursts into
  Google API quotas.
- **Per-source lock.** Each source sync runs under
  `locks.withLock(`sync:source:${source.id}`, (lock) => this.syncSource(source, lock.signal))`. The
  dispatcher and `/sync` use the same key. With the default `wait: 0`, a taken key rejects with
  `LockNotAcquiredError`. The dispatcher then skips the source until its next tick, and the bot
  answers "Синхронизация этого источника уже идёт". Never hand-roll locks with a `Map` or advisory
  locks.
- A lock is a **lease**, renewed while the callback runs. If it is lost (the store refused a
  renewal, or `ttl` passed without a confirmed one), `lock.signal` aborts with `LockLostError`.
  Pass that signal to every source fetch and Google call so that a run which lost its lock stops
  instead of writing on.
- Fencing: while CalSync runs as one instance, the signal is enough. Before running several
  instances, store the run's `fencingToken` on `event_links` writes and refuse lower tokens (see
  "Fence the writes" in the Nest locks docs).
- Each source is processed inside its own error boundary (see 103). On failure, record
  `lastSyncStatus` / `lastSyncError`, schedule the next attempt with backoff (`next_sync_at`), log it,
  and continue with the next source. One broken source must not stop the others.
- A `CircuitOpenError` from an integration (Google is down, see 106) is not a source failure. Stop the
  run for the remaining sources, leave their `next_sync_at` as it is, and log once.
- After each run, persist `lastSyncedAt`, counters (created / updated / deleted / skipped) and the
  next due time.

## Idempotency
A sync run must be safe to repeat or interrupt at any point:
- The source produces a full snapshot for the sync window. The engine diffs it against `event_links`
  (keyed by `(source_id, external_uid)` + `content_hash`) and applies create / update / delete.
- Google writes are idempotent: events get a deterministic id, and updates are matched through
  the stored `google_event_id` and the private ownership marker (see 106). Rerunning after a crash
  updates instead of duplicating.
- Deletions apply only to events CalSync created for **that** source (ownership marker) and only
  inside the sync window. An event that falls outside the window is not "deleted at the source".
- If the source fetch fails or returns an obviously broken snapshot (zero events where there were
  many), abort the run for that source without deleting anything. A failed fetch must never wipe
  the user's calendar.

## Time
- The server works in UTC: the container sets `TZ=UTC`, timestamps are stored as `timestamptz`, and
  comparisons use UTC instants.
- Source data is interpreted in the source's explicit IANA time zone (stored on the source, for
  example `Europe/Moscow` for the team sheet). Never rely on the server's local zone.
- Code gets the current time from the injected `Clock` (`common/clock/clock.ts`, provided globally
  by `CommonModule`), never `new Date()` / `Date.now()` directly in services. Tests control time
  through it (see 108).
- All-day events stay all-day (date, not midnight-to-midnight datetime). Recurring source events are
  expanded to instances in the sync window, unless the adapter can map the recurrence rule exactly.

## Shutdown
On `SIGTERM` (requires `app.enableShutdownHooks()`, see 100), Nest stops the scheduler. In-flight
runs finish and release their locks before `DrizzleModule` closes the pool in
`onApplicationShutdown`. A run must not swallow its signal's abort. Let it end the run.

## When to Add a Queue
`@nestjs/bullmq` (Redis) is **not** used now. Introduce it only for retries that must survive
restarts or work that must not run inside the web process. Several instances alone do not need a
queue: the locks above already coordinate them. Until then, the dispatcher + DB state is the queue.
