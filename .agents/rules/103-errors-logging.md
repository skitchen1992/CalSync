# Errors, Logging & Health

## Error Model
CalSync code runs in three contexts: HTTP requests, Telegram updates and scheduled jobs. Only the
first has Nest exception filters, so errors are modelled independently of HTTP.

- **Domain errors** are classes in `<feature>.errors.ts` that extend a shared `DomainError`
  (`common/errors/domain-error.ts`). Each one declares a stable `code`, a `kind` (`invalid`,
  `not_found`, `conflict`, `forbidden`, `unavailable`) and the context needed to act on it. Wrap
  the original error in `cause`:
  ```ts
  export class SourceUnavailableError extends DomainError {
    readonly code = 'SOURCE_UNAVAILABLE';
    readonly kind = 'unavailable';
    constructor(readonly sourceId: string, options?: ErrorOptions) {
      super(`Source ${sourceId} is unavailable`, options);
    }
  }

  throw new SourceUnavailableError(source.id, { cause: error });
  ```
- Services and integrations throw domain errors (or let unexpected errors propagate). They never throw
  `HttpException`, because a cron job has no HTTP status to return.
- Each entry point translates errors for its own audience:
  - **HTTP**: `DomainErrorFilter` (`@Catch(DomainError)`) maps `kind` to a status (422 / 404 / 409
    / 403 / 503) and answers `{ statusCode, code, message }`. `CatchEverythingFilter` (`@Catch()`,
    replying through `HttpAdapterHost` so it stays platform-agnostic) passes `HttpException`s
    through unchanged. For anything else it logs the error and returns a generic 500 body. Both are
    `APP_FILTER` providers. Nest tries global filters in reverse registration order, so the
    catch-all is registered first. `test/http-pipeline.e2e-spec.ts` pins this behavior.
  - **Telegram**: the bot error boundary maps domain errors to a short Russian message for the user
    ("Не удалось открыть календарь: ссылка недоступна") and logs the rest. The user never sees stack
    traces or raw upstream messages.
  - **Jobs**: the job boundary catches per unit of work (per source). It logs the error, records the
    failure on the source (`lastSyncStatus`, `lastSyncError`) and continues with the next source. One
    broken source must not stop the others (see 105).

## Handling Rules
- Catch only to **add context** (rethrow a domain error with `cause`), to **translate** at a boundary,
  or to **handle a known recoverable case**. Empty `catch {}` blocks and "log and continue as if
  nothing happened" are forbidden.
- Never lose the original error: always pass it as `cause`.
- Every promise is awaited or explicitly handled. Fire-and-forget calls (`void this.notify(...)`)
  must end with `.catch()` that logs, otherwise an unhandled rejection can crash the process.
- Validation failures of **external** data (unexpected API or sheet shape) are domain errors with
  the source id, not generic `ZodError`s leaking to the top.
- Some library errors are expected control flow, not failures. Handle them where the rules say,
  and never log them as errors:
  - `LockNotAcquiredError`: skip the source or tell the user that a sync is already running (105);
  - `LockLostError` (a lock signal's abort reason): end the run quietly (105);
  - `CircuitOpenError`: stop the run and defer the remaining sources (105, 106);
  - `AiOutputError`: one repair call, then a domain error (106).

## Logging
- Use Nest's `Logger`, one per class, with the class name as context:
  ```ts
  private readonly logger = new Logger(SyncService.name);
  ```
  Never use `console.*` in `src/`.
- The app logger is configured in `main.ts` (see 100): JSON (`new ConsoleLogger({ json: true })`) in
  production, so a log collector can parse records; pretty output locally. Levels come from
  `LOG_LEVELS`.
- **Structured params** (on by default in v12): keep the message a constant phrase and put the data in
  a params object. Never interpolate data into the message string:
  ```ts
  // ✅ structured — searchable, nested under "params" in JSON mode
  this.logger.log('Sync finished', { sourceId, created, updated, deleted, durationMs });

  // ❌ interpolated — every record is a unique string
  this.logger.log(`Sync of ${sourceId} finished: ${created} created`);
  ```
- Log errors with their stack: pass the stack string as the second argument and the params object
  after it. In JSON mode the stack lands in the `stack` field:
  ```ts
  const err = toError(error); // common/errors/to-error.ts: unknown → Error
  this.logger.error('Sync failed', err.stack, { sourceId, errorCode: getErrorCode(err) });
  ```
- Levels:
  - `error`: needs human attention (a source keeps failing, Google auth was revoked).
  - `warn`: degraded but handled (retry succeeded, a row was skipped).
  - `log`: business events (source added or removed, sync summary per run).
  - `debug` / `verbose`: per-event detail, off in production.
- **Never log** OAuth access or refresh tokens, the bot token, API keys, the encryption key, full
  private ICS/CalDAV URLs (they embed credentials), or bulk event contents. Log ids, counts and masked
  URLs (host plus the first characters of the path).

## Health
- `/health` is built with `@nestjs/terminus` (`HealthCheckService` + `@HealthCheck()`) and checks the
  database. Each check has a timeout.
- Custom indicators use the v12 API: inject `HealthIndicatorService`, call `check(key)`, then return
  `indicator.up(details)` or `indicator.down(details)`. Do not throw `HealthCheckError` (old API).
- Health checks never call Google, Telegram or DeepSeek. A slow third party must not make the
  container look dead. Report third-party degradation through logs and the bot `/status` command
  instead.
