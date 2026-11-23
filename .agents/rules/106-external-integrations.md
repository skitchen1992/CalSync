# External Integrations, Resilience & LLM

CalSync depends on several outside systems: Google Calendar and Sheets, Yandex Calendar,
arbitrary ICS/CalDAV feeds, the Telegram Bot API and DeepSeek. Treat each one as untrusted,
slow and changeable. Isolate it, put a timeout on every call, retry only what is safe to repeat,
and validate its output.

First-party packages used here: `@nestjs/http-client` (plain HTTP), `@nestjs/resilience` (retry,
timeout, circuit breaker for SDK calls) and `@nestjs/ai` (LLM calls). Check the first-party
packages before writing your own retry loop, HTTP wrapper or LLM client.

## Integration Modules (`src/integrations/<system>/`)
- One module per external system (`google/`, `deepseek/`, `telegram-api/`). The module exports a
  **narrow, domain-shaped client**: `GoogleCalendarClient.upsertEvent(calendarId, event, signal)`,
  not the raw SDK. SDK types (`calendar_v3.Schema$Event`, …) never leave the integration module. Map
  them to CalSync types at the boundary.
- Feature code never imports `googleapis` or a bot library directly. Only the integration module
  does.
- SDK clients are created once by a `useFactory` provider under a Symbol token, with config injected
  from the owning namespace (see 100 and 101):
  ```ts
  export const GOOGLE_OAUTH_CLIENT = Symbol('GOOGLE_OAUTH_CLIENT');

  {
    provide: GOOGLE_OAUTH_CLIENT,
    inject: [googleConfig.KEY],
    useFactory: (config: ConfigType<typeof googleConfig>) =>
      new OAuth2Client({ clientId: config.clientId, clientSecret: config.clientSecret, redirectUri: config.redirectUrl }),
  }
  ```
- Errors are translated inside the integration module into domain errors (`GoogleAuthRevokedError`,
  `SourceUnavailableError`, `RateLimitedError`) that carry the original as `cause` (see 103).
- Every client method accepts an `AbortSignal` and passes it down. The sync passes the per-source
  lock's signal (see 105).

## Resilience: One Retry Layer per Call
Retries hidden in several layers multiply: 3 attempts × 3 attempts × 3 SDK retries means 27
requests to a dependency that is already struggling. Each outbound call has **exactly one**
component that retries it:

| Call | Who retries and times out |
| --- | --- |
| SDK calls (Google Calendar / Sheets) | A `@nestjs/resilience` policy at the call site. Turn the SDK's own retries off |
| Plain HTTP (ICS feeds, Yandex embed) | `@nestjs/http-client` (its built-in retry/timeout). No retrying policy around it |
| LLM calls | `@nestjs/ai` (it runs on `@nestjs/resilience`). No policy around `AiService` |

- `ResilienceModule.forRoot()` is imported once in `AppModule`, with one **preset per external
  system** (`google`, `source-fetch`, …) and app-wide `defaults`:
  ```ts
  ResilienceModule.forRoot({
    defaults: { timeout: '10s', retry: { attempts: 3, backoff: { delay: '500ms', maxDelay: '5s' } } },
    presets: {
      google: {
        timeout: '15s',
        retry: { attempts: 3 },
        circuitBreaker: { failureRateThreshold: 50, minimumCalls: 10, openDuration: '1m' },
      },
    },
  }),
  ```
- Inside services, use a **policy object**. Create it once in the constructor and run calls through
  `execute()`, which passes the attempt's `signal`:
  ```ts
  constructor(resilience: ResilienceService, @Inject(GOOGLE_CALENDAR_SDK) private readonly calendar: calendar_v3.Calendar) {
    this.policy = resilience.preset('google');
  }

  upsertEvent(calendarId: string, event: NormalizedEvent, signal: AbortSignal) {
    return this.policy.execute(
      ({ signal: attemptSignal }) => this.calendar.events.update({ calendarId, eventId: …, requestBody: … }, { signal: AbortSignal.any([signal, attemptSignal]) }),
      { source: 'GoogleCalendarClient.upsertEvent' },
    );
  }
  ```
- A policy's retry **always** applies (it cannot tell GET from POST), so wrap only calls that are
  safe to repeat. CalSync makes Google writes repeatable: events are created with a deterministic
  `id` (base32hex of a hash of `sourceId + uid`), so a retried insert answers 409 instead of
  creating a duplicate, and updates and deletes address that id.
- The circuit breaker is per external system. When Google keeps failing, `CircuitOpenError` stops the
  sync run quickly instead of hammering it (see 105 for how the run reacts).
- Resilience **decorators** (`@Timeout()`, `@Retry()`, `@CircuitBreaker()`) belong on entrypoints
  (controllers) only. CalSync's controllers are thin and rarely need them. A non-idempotent POST is
  never retried.
- No hand-written retry loops, `setTimeout` backoffs or ad-hoc `Promise.race` timeouts around
  external calls.

## Plain HTTP: `@nestjs/http-client`
For endpoints without an SDK (ICS feeds, the Yandex embed endpoint), use `@nestjs/http-client`,
which is fetch-based and replaces `@nestjs/axios` in v12. Do not add `@nestjs/axios` or raw
`fetch` calls scattered across services.
```ts
HttpClientModule.register({
  name: 'yandex-embed',
  baseUrl: 'https://calendar.yandex.ru',
  timeout: '10s',
  retry: { attempts: 3, backoff: { delay: '500ms', factor: 2, maxDelay: '5s', jitter: 'full' } },
}),

constructor(@InjectHttpClient('yandex-embed') private readonly http: HttpClient) {}
```
- Every client has an explicit `timeout`. Pass the caller's `signal` on every request.
- Its retries cover idempotent methods only (the default). On `429`, it honors `Retry-After`.
- Clients for user-supplied URLs (ICS feeds, arbitrary calendars) go through the SSRF protection in
  `107-security.md`. They cap response size and the number of redirects.

## Validate at the Boundary
- Every external payload is parsed with a Zod schema (`<adapter>.schemas.ts`) before CalSync code
  uses it: Google responses, ICS-derived objects, Yandex JSON, sheet rows. Parse failures become
  domain errors with the source id.
- Unofficial endpoints (the Yandex `embed/models?_models=get-events` call) are the most fragile. Keep
  them behind their own adapter, validate strictly, fail loudly with a specific error, and keep a
  captured real response as a test fixture. Prefer an official export (ICS link, CalDAV) whenever the
  user can provide one.

## Source Adapters (`src/sources/`)
- Every source type implements one interface and returns normalized events for a time window:
  ```ts
  export interface SourceAdapter {
    readonly type: SourceType; // 'ics' | 'caldav' | 'yandex-embed' | 'gsheet'
    fetch(source: Source, window: SyncWindow, signal: AbortSignal): Promise<NormalizedEvent[]>;
  }
  ```
- `NormalizedEvent` always has a stable `uid`, `title`, `start` / `end` (or `allDay` dates),
  `timeZone`, and optional `location`, `url`, `description`. If the source has no stable id (sheet
  rows), the adapter derives the uid deterministically from normalized content (date + start +
  title), never from a row number.
- Adapters are pure translators: no database writes, no Google calls, no Telegram messages. They are
  registered through the `SOURCE_ADAPTERS` factory provider (see 100).
- Adding a source type means: a new adapter class, its Zod schemas, a fixture-based spec, and an
  entry in the factory's `inject` list. Nothing else in the sync engine changes.

## Google Calendar Specifics
- CalSync writes only to calendars it created (one per source). It never edits the user's primary
  calendar or events it did not create.
- Every event CalSync writes carries an ownership marker in `extendedProperties.private`
  (`calsyncSourceId`, `calsyncUid`) and the deterministic id described above. Updates and deletes
  check the marker. Lost DB mappings can be rebuilt from it.
- Throttle writes with bounded concurrency (see 105) to stay within API quotas.
- When Google rotates the OAuth refresh token, persist the new one (encrypted, see 107). If the grant
  is revoked (`invalid_grant`), mark the account as disconnected and ask the user in the bot to
  reconnect. Do not retry it. It is a client error, so the breaker's default `recordIf` already
  ignores it. Keep it that way if you customize `recordIf`.

## LLM: `@nestjs/ai` + DeepSeek
LLM calls go through `AiService` from `@nestjs/ai`, with DeepSeek plugged in as an AI SDK provider
(`@ai-sdk/deepseek`). Do not use the OpenAI SDK or raw HTTP for model calls.
```ts
// integrations/deepseek/deepseek.module.ts
const usageLogger = new Logger('LlmUsage');

AiModule.forRootAsync({
  isGlobal: true,
  inject: [deepseekConfig.KEY],
  useFactory: (config: ConfigType<typeof deepseekConfig>) => {
    // Pass the key explicitly: by default the provider reads DEEPSEEK_API_KEY from process.env
    // itself, bypassing the validated config.
    const deepseek = createDeepSeek({ apiKey: config.apiKey, baseURL: config.baseUrl });
    return {
      models: {
        default: { model: deepseek(config.model), pricing: config.pricing, maxOutputTokens: 2_000 },
      },
      defaults: { timeout: '30s', retry: { attempts: 3 } },
      onUsage: (event) =>
        usageLogger.log('LLM call', {
          label: event.label, model: event.model.modelId, totalTokens: event.usage.totalTokens, cost: event.cost,
        }),
    };
  },
}),
```
- **Never in the sync hot path.** The LLM is used for one-off tasks: proposing a column mapping when a
  sheet is added, parsing a row the deterministic parser rejected, understanding a free-text bot
  command. A regular sync run makes zero LLM calls.
- Structured results use `ai.generateObject({ label, schema, instructions, prompt })` with a Zod
  schema. Every field has `.describe()` with its meaning and an example: the model reads them.
  The result is already validated and typed.
- An answer that does not match the schema rejects with `AiOutputError`. The module does not retry it
  and does not fall back. Catch it, make **at most one** repair call that includes the validation
  error, then throw a domain error (`LlmOutputInvalidError`). LLM output is data to check, never
  instructions to execute.
- Timeouts, retries (429 / 5xx / timeouts, honoring `retry-after`) and fallback models are configured
  once in `AiModule`. Do not wrap `AiService` calls in another retry.
- Every call has a `label` (`'sheet-mapping'`, `'row-repair'`, `'bot-intent'`) so usage logs tell calls
  apart. Set `pricing` (USD per million tokens, from DeepSeek's price list) so that `onUsage` reports
  cost. Log counts and cost only, never prompt or completion contents.
- Free-text bot commands use agent functions (`@AgentFunction()` with a Zod `inputSchema`) that map
  to existing service methods (list, add, remove, sync). Functions that change or delete something
  only **propose** the action. The user confirms it with an inline button before it runs.
- Persist and reuse LLM results. A confirmed sheet mapping is stored on the source. Row-level
  fallbacks are cached by the hash of the row content. The same input is never sent twice.
- Anything the LLM inferred that changes what lands in the calendar (a new sheet mapping) is shown to
  the user in the bot with a preview and needs an explicit confirmation before the first sync.
- Prompts (`instructions`) are versioned constants in `*.prompts.ts`. Send the minimum data needed:
  header plus a few sample rows, not the whole sheet. Never put tokens, secrets or URLs with
  credentials into a prompt.

## Tests
No test talks to a real external service (see 108):
- Google / Telegram clients are replaced with in-memory fakes.
- HTTP adapters are tested against captured fixtures.
- LLM calls use `FakeModel` from `@nestjs/ai/testing`: `AiModule.forRoot({ models: { default: fake } })`
  in unit tests, `overrideModels(Test.createTestingModule({ imports: [AppModule] }), { default: fake })`
  in e2e. Retries, timeouts, schemas and agent functions still run for real around it.
