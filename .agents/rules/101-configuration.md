# Configuration

Configuration comes from environment variables, loaded with `@nestjs/config`, validated by one Zod
schema at startup, and consumed through typed `registerAs()` namespaces. A misconfigured app must fail
to start, not fail at 3 a.m. during a sync run.

## Layout
```
src/config/
├── env.schema.ts      # envSchema: the single, complete list of env vars (Zod)
├── env.ts             # loadEnv(): envSchema.parse(process.env), typed result
├── app.config.ts      # registerAs('app', …)      port, log settings
├── database.config.ts # registerAs('database', …) connection URL, pool size
├── google.config.ts   # registerAs('google', …)   OAuth client id/secret, redirect URL
├── telegram.config.ts # registerAs('telegram', …) bot token, webhook secret, allowed user ids
├── deepseek.config.ts # registerAs('deepseek', …) API key, base URL, model, timeouts
└── sync.config.ts     # registerAs('sync', …)     dispatcher cron, sync window, concurrency
```
`src/config/` is the **only** place that reads `process.env`. Everything else gets configuration
through DI.

## Env Schema
The real list lives in `src/config/env.schema.ts`. The example below also shows variables that
features will add later:
```ts
// env.schema.ts
import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'] as const;

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_FORMAT: z.enum(['pretty', 'json']).default('pretty'),
  LOG_LEVELS: z
    .string()
    .default('fatal,error,warn,log')
    .transform((value) => value.split(',').map((level) => level.trim()))
    .pipe(z.array(z.enum(LOG_LEVELS))),
  DATABASE_URL: z.url(),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_ALLOWED_USER_IDS: z
    .string()
    .transform((value) => value.split(',').map(Number))
    .pipe(z.array(z.number().int().positive()).min(1)),
  ENCRYPTION_KEY: z.base64().refine((key) => Buffer.from(key, 'base64').length === 32, 'must be 32 bytes'),
  SYNC_SCHEDULER_ENABLED: z.stringbool().default(true),
  // …
});

export type Env = z.infer<typeof envSchema>;
```
- Environment variables are always strings. Convert numbers with `z.coerce.number()`. Convert
  booleans with `z.stringbool()`, **never** `z.coerce.boolean()`, which turns the string `"false"`
  into `true`.
- Secrets (`*_TOKEN`, `*_SECRET`, `*_KEY`, `DATABASE_URL`) never get a default. If one is missing,
  the app must refuse to start.
- Defaults are only for values that are safe in every environment (port, log level, cron cadence).
- Settings that change at runtime per source (sync interval, target calendar, sheet column mapping)
  belong in the database (see 104), not in env.

## Wiring `ConfigModule`
```ts
// app.module.ts
ConfigModule.forRoot({
  isGlobal: true,
  cache: true,
  validate: validateEnv, // envSchema.parse for fail-fast; returns the raw values unchanged
  load: [appConfig, databaseConfig, googleConfig, telegramConfig, deepseekConfig, syncConfig],
}),
```
- `ConfigModule.forRoot()` is called exactly once, in `AppModule`.
- Use `validate: validateEnv`, **not** `validationSchema: envSchema`. ConfigModule copies whatever
  validation returns into `process.env`, which only holds strings. With `validationSchema`, Zod's
  parsed values (arrays, numbers, booleans) replace the raw strings: lists such as
  `TELEGRAM_ALLOWED_USER_IDS` vanish, and the namespaces then fail to re-parse them. `validateEnv`
  validates with the same schema and returns the raw values.
- `.env` is loaded while `NestFactory.create()` builds the app, **not** when `AppModule` is
  imported. Nothing may read the environment before that. `main.ts` therefore creates the app with
  `bufferLogs: true` and builds the logger from the `app` namespace afterwards (see 100).

## Namespaces
Each namespace maps the parsed env into a small, typed, domain-named object:
```ts
// sync.config.ts
import { registerAs } from '@nestjs/config';
import { loadEnv } from './env.js';

export const syncConfig = registerAs('sync', () => {
  const env = loadEnv(); // typed and coerced by the same schema that validated startup
  return {
    dispatchCron: env.SYNC_DISPATCH_CRON,
    windowPastDays: env.SYNC_WINDOW_PAST_DAYS,
    windowFutureDays: env.SYNC_WINDOW_FUTURE_DAYS,
  };
});
```
Consume a namespace by injecting its `KEY`, typed with `ConfigType`:
```ts
constructor(
  @Inject(syncConfig.KEY)
  private readonly config: ConfigType<typeof syncConfig>,
) {}
```
- Feature code never calls `configService.get('SOME_VAR')` with a string key. String lookups are
  untyped and hide which settings a provider depends on.
- Async module setup injects the namespace too:
  `DrizzleModule.forRootAsync({ inject: [databaseConfig.KEY], useFactory: (db: ConfigType<typeof databaseConfig>) => ({ … }) })`.
- A provider injects only the namespace it needs, never "all config".

## Conditional Modules
Turn a module on or off with `ConditionalModule.registerWhen()` from `@nestjs/config`, not with an
`if` in `AppModule`:
```ts
ConditionalModule.registerWhen(SchedulerModule, 'SYNC_SCHEDULER_ENABLED'),
```
The module loads unless the variable is `false` (case-insensitive). E2E tests set
`SYNC_SCHEDULER_ENABLED=false` so cron jobs do not fire during the test run.

## Adding a Setting
Adding a setting touches three places in one change:
1. Add the variable to `envSchema`, with its type, constraints and default (if it is safe to have one).
2. Add it to `.env.example` with a one-line comment and a placeholder value (never a real secret).
3. Expose it through the namespace that owns the area. Create a new namespace only for a new area.

`.env` is git-ignored. `.env.example` is committed and always lists every variable in `envSchema`.

## Tests
Override a namespace in a testing module instead of mutating `process.env` inside a spec:
```ts
.overrideProvider(syncConfig.KEY)
.useValue({ dispatchCron: '* * * * *', windowPastDays: 7, windowFutureDays: 60 })
```
