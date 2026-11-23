# Testing

Runner: **Vitest 4** (the default for ESM projects in Nest v12). Vite 8 compiles decorators with
metadata natively, so DI works in tests with no SWC plugin. Do not add `unplugin-swc` (older Nest
recipes still show it). `@nestjs/testing` is runner-agnostic. Use `vi.fn()` / `vi.spyOn()`, never
Jest APIs.

| Config | Command | Picks up |
| --- | --- | --- |
| `vitest.config.ts` | `npm test` | `src/**/*.spec.ts`: unit tests, no app, no database |
| `vitest.config.e2e.ts` | `npm run test:e2e` | `test/**/*.e2e-spec.ts`: the real `AppModule` over HTTP |

The e2e config sets explicit env values (`NODE_ENV=test`, a dummy `DATABASE_URL`). Values in
`process.env` take precedence over a developer's `.env`, so e2e runs never depend on local files.

## Test Pyramid
| Layer | Where | What | Nest container |
| --- | --- | --- | --- |
| Unit: pure logic | `src/**/<name>.spec.ts` next to the code | Parsers, event diff, uid derivation, time-zone normalization, env parsing | No |
| Unit: provider | `src/**/<name>.service.spec.ts` | One service with its collaborators replaced | `Test.createTestingModule` |
| E2E | `test/**/*.e2e-spec.ts` | Full `AppModule`: HTTP routes, global pipe/guards/filters, bot update handling, a full sync run against fakes | Yes, real DB (PGlite) |

Most business rules are pure functions (see 100), so most tests are fast, container-free unit tests.

## Unit Tests for Providers
```ts
const moduleRef = await Test.createTestingModule({
  providers: [
    SyncService,
    { provide: SourcesRepository, useValue: sourcesRepositoryFake },
    { provide: Clock, useValue: fixedClock('2026-11-23T09:00:00Z') },
  ],
})
  .useMocker((token) => {
    if (token === GoogleCalendarClient) return new FakeGoogleCalendarClient();
  })
  .compile();

const syncService = moduleRef.get(SyncService);
```
- Provide only what the unit needs. Replace collaborators with `{ provide, useValue }`, or use
  `useMocker()` for the long tail. Never import `AppModule` in a unit test.
- Prefer **fakes over mocks** for integrations. A `FakeGoogleCalendarClient` keeps events in a
  `Map`, so tests assert the resulting calendar state ("event X exists with title Y"), not call
  sequences ("`insert` called twice"). Fakes live in `test/fakes/` and are shared by unit and e2e
  tests.
- Use `vi.fn()` only where the interaction itself is the behavior under test (for example, "a
  failed fetch must not call delete").

## E2E Tests
Every e2e spec boots the app through `createTestApp()` (`test/support/create-test-app.ts`). It:
- creates an in-memory PGlite database (`drizzle-orm/pglite`, same `schema` and `casing`) and applies
  the **real** migrations from `drizzle/`;
- boots the real `AppModule` and overrides only `getDrizzleToken()` with that database;
- accepts extra `controllers`, which lets a spec mount a probe controller to exercise global
  enhancers (see `test/http-pipeline.e2e-spec.ts`);
- exposes `pglite`, so a spec can close it to simulate a database outage (see
  `test/health.e2e-spec.ts`).

It also replaces the integrations with fakes from `test/fakes/` and exposes them on the returned
object: `GoogleOAuthClient`, `GoogleCalendarClient` (an in-memory calendar), `Notifier` (records
messages) and `YandexEmbedAdapter` (events set by the spec). The bot is tested by feeding updates to
the real grammY `Bot` with `bot.handleUpdate()`, with a Bot API transformer that records calls
instead of sending them (`test/bot.e2e-spec.ts`). Shared setup (connecting Google, test events)
lives in `test/support/scenario.ts`. Add new fakes there once, instead of overriding ad hoc per spec:
- further API clients and the `Clock`: `.overrideProvider(...)` with fakes;
- LLM models: wrap the builder in `overrideModels(builder, { default: fakeModel })` from
  `@nestjs/ai/testing`, and expose `fakeModel` so specs can queue answers (`fakeModel.reply(...)`) and
  inspect `fakeModel.calls`;
- locks: nothing to override. `DrizzleLockStore` runs on PGlite (its table comes from the real
  migrations), so lock behavior in e2e is the production behavior.
- Everything between the edges runs for real: global pipes, guards and filters are `APP_*`
  providers, so they apply here exactly as in production. `helmet` and the logger setup live in
  `main.ts` and are not part of e2e tests.
- `SYNC_SCHEDULER_ENABLED=false` goes into the e2e env once the scheduler exists, so the
  dispatcher never fires mid-test. Trigger sync runs explicitly.
- Always close the app (`testApp.close()`) in `afterEach` / `afterAll`. Leaked apps keep handles open
  and hang the runner.
- No test reaches the network. Fakes cover every external client, and a guarded fetch fails the test
  on any unexpected outbound request.

## Fixtures
- Parser and adapter tests run against **captured real data** in `test/fixtures/<source>/`: the team
  schedule sheet export (with its quirks: `15:30 - ?`, `18:30-20:00`, separator rows, multiline
  titles), a real Yandex embed `get-events` response, real ICS files (time zones, all-day,
  recurrences). An invented fixture only proves that the code matches its author's assumptions.
- Scrub personal data and secrets from fixtures before committing (meeting links with tokens, emails).
- When the real format drifts, update the fixture from a new capture and keep the old one if the
  adapter must still accept it.

## Time and Randomness
- Services get "now" from the injected `Clock` (see 105). Tests pass a fixed clock. Use
  `vi.useFakeTimers()` only for code that genuinely waits on timers (backoff, timeouts — see
  `src/common/utils/with-timeout.spec.ts`).
- Ids and hashes in assertions are pinned constants at the top of the spec, not values read back from
  the code under test.

## Authoring Rules
- Every behavior change ships with tests in the same change. A bug fix starts with a spec that
  reproduces the bug.
- Agent-written code is not complete without specs that cover the new or changed behavior. A green
  typecheck + lint is not a substitute.
- While iterating, run only the spec files you are working on (`npx vitest run src/config/env.spec.ts`,
  `npx vitest run --config vitest.config.e2e.ts test/health.e2e-spec.ts`). Run `npm run check` once,
  when the change is finished.
- No `.only` / `.skip` in committed code, and no `setTimeout` sleeps to wait for async work. Await the
  promise, or use `vi.waitFor()` for work that finishes after a response.
- Test names state the behavior: `it('does not delete events when the source fetch fails')`.
