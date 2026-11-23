# HTTP Layer: Controllers, Validation & Request Pipeline

CalSync's HTTP surface is small: the Google OAuth callback, the Telegram webhook (in webhook mode) and
`/health`. Most of the work starts from the bot or the scheduler. Keep the HTTP layer thin and strict.

## Controllers
- A controller handler does exactly three things: receive validated input, call **one** service
  method, return the result. No business logic, no repository or Drizzle access, no SDK or
  `HttpClient` calls in controllers.
- Return plain serializable objects. Map to an explicit response shape. Never return DB rows
  or objects that hold tokens, encrypted secrets or internal ids the client does not need.
- Set the status explicitly when it is not the default: `@HttpCode(200)` on a POST that is not a
  creation (for example, the Telegram webhook must answer 200 quickly).
- Use `@Redirect()` or a returned redirect for OAuth flows. Do not write to the raw `res` object
  (library-specific mode disables interceptors and makes the handler platform-bound).
- Telegram bot handlers in `bot/` follow the same rules as controllers: they are entry points.

## Validation: Schema-First with Zod
CalSync validates with Zod everywhere (env, request input, external responses, LLM output). Nest v12
supports this natively through the Standard Schema `schema` option on route parameter decorators,
enforced by the built-in `StandardSchemaValidationPipe`.

```ts
// app.module.ts — bind once, as a provider, so it applies in e2e tests too
providers: [{ provide: APP_PIPE, useClass: StandardSchemaValidationPipe }],
```
```ts
// auth.schemas.ts
export const oauthCallbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});
export type OAuthCallbackQuery = z.infer<typeof oauthCallbackQuerySchema>;
```
```ts
// auth.controller.ts
@Get('google/callback')
async googleCallback(@Query({ schema: oauthCallbackQuerySchema }) query: OAuthCallbackQuery) {
  return this.googleAuthService.completeAuthorization(query);
}

@Get('sources/:id')
findOne(@Param('id', { schema: z.uuid() }) id: string) { … }
```
- **Every** `@Body()`, `@Query()` and `@Param()` gets a schema. An unvalidated parameter is a bug.
- The handler receives the schema's output, so coercion, defaults and transforms take effect.
  Coerce query and path numbers with `z.coerce.number()`.
- Object schemas are strict about what reaches the service: use `z.object()` (unknown keys
  are stripped) or `z.strictObject()` when extra keys must be rejected. Never `z.looseObject()` /
  `.passthrough()` for request input.
- Schemas live in `<feature>.schemas.ts`. Their types come from `z.infer`. Do not hand-write a parallel
  interface for the same shape.
- An application uses either `class-validator` + `ValidationPipe` or Standard Schema, never both. This
  repo uses Zod. Do not add `class-validator` / `class-transformer` DTO classes.

## Request Pipeline
Nest runs a request through: middleware → guards → interceptors (before) → pipes → handler →
interceptors (after) → exception filters. Put each concern where the pipeline expects it:

| Concern | Mechanism | Example in CalSync |
| --- | --- | --- |
| Can this caller run this handler? | Guard (`CanActivate`) | Telegram webhook secret check, throttling |
| Validate or transform input | Pipe | `StandardSchemaValidationPipe`, `ParseUUIDPipe` |
| Cross-cutting before/after logic | Interceptor | Request timing, response mapping, timeouts |
| Turn exceptions into responses | Exception filter | Domain error → HTTP status (see 103) |
| Raw request plumbing | Middleware | `helmet` (applied in `main.ts`) |

- Authorization never lives in middleware or interceptors: middleware does not know which handler
  will run, and interceptors run after guards.
- Global enhancers are registered as `APP_GUARD`, `APP_PIPE`, `APP_INTERCEPTOR`, `APP_FILTER` providers
  in `AppModule` (they get DI and apply under `Test.createTestingModule`). Route-specific ones use
  `@UseGuards()` / `@UseInterceptors()` on the controller or handler, passing the class (not an
  instance) so Nest can inject its dependencies.
- Custom decorators that read from the request (for example, `@TelegramUpdate()`) are built with
  `createParamDecorator` in `common/decorators/` and combined with `applyDecorators` when several
  decorators always go together.

## Exceptions in the HTTP Layer
- Controllers and guards may throw Nest's built-in HTTP exceptions (`BadRequestException`,
  `UnauthorizedException`, `ForbiddenException`, `NotFoundException`, `ConflictException`, …). Pass
  the original error as `{ cause }`: it is logged, not serialized to the client.
- Services do not throw HTTP exceptions (they are also called from cron jobs and the bot). They throw
  domain errors, and a filter maps those to HTTP (see `103-errors-logging.md`).
- Error responses never contain stack traces, SQL, upstream response bodies or secrets.
