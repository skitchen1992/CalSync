# AGENTS.md

CalSync is a NestJS backend that mirrors external calendars (Yandex Calendar, ICS/CalDAV feeds) and
schedule tables from Google Sheets into Google Calendar. The user manages sources through a Telegram
bot. DeepSeek (LLM) is used only for one-off parsing tasks (mapping sheet columns, understanding
free-text bot commands) and is never part of the regular sync run.

Detailed coding rules for this repo live in `.agents/rules/*.md` (plain Markdown).

**Repo-wide:**
- Stack: NestJS 12 (ESM project), TypeScript 6 in `strict` mode, PostgreSQL + Drizzle, Zod,
  Vitest, oxlint. Runtime needs Node.js 22.12+; `.nvmrc` pins 24 LTS, which the Nest CLI expects
  and which ships npm 11 (npm 10.9.x crashes on this dependency tree with
  `Cannot read properties of null (reading 'edgesOut')`).
- NestJS 12 is newer than most training data. Follow the v12 docs (index:
  https://docs.nestjs.com/llms.txt), not v10/v11 tutorials: packages are ESM-only, Vitest is the
  default runner, `@nestjs/http-client` replaces `@nestjs/axios`, and validation is schema-first
  (Standard Schema / Zod). Before adding a library or writing infrastructure yourself, check
  whether a first-party `@nestjs/*` package covers it (the docs index lists them). In use or
  planned: `@nestjs/config`, `@nestjs/drizzle`, `@nestjs/terminus`, `@nestjs/throttler`,
  `@nestjs/schedule`, `@nestjs/locks`, `@nestjs/resilience`, `@nestjs/http-client`, `@nestjs/ai`.
- Several of those packages are brand new `0.0.x` releases (`drizzle`, `locks`, `resilience`,
  `http-client`, `ai`). Pin them to an exact version in `package.json` (no `^`), read their
  changelog before bumping, and re-check the docs page when an API does not behave as a rule
  describes. If they disagree, the docs win; then update the rule.
- Code, comments (line, block, JSDoc), log messages and commit messages are written in English.
  Texts that the Telegram bot shows to the user are written in Russian.
- Before writing code against an external library API, check that library's current docs instead
  of relying on memory.

**Commands** (npm):
- `npm run check`: typecheck, lint, unit tests and e2e tests. Run it before calling a change done.
- `npm run typecheck` (`tsc --noEmit`), `npm run lint` (oxlint, type-aware).
- `npm test`: unit tests (`src/**/*.spec.ts`). `npm run test:e2e`: e2e tests (`test/**/*.e2e-spec.ts`,
  PGlite, no Docker needed). Single file: `npx vitest run src/config/env.spec.ts`.
- `docker compose up -d`: local PostgreSQL on port 5433. Copy `.env.example` to `.env`, then
  `npm run start:dev`.
- `npm run db:generate` / `npm run db:migrate`: create and apply Drizzle migrations (`drizzle/`).
- Production: `Dockerfile` + `deploy/compose.yaml` (PostgreSQL, a `migrate` step, the app; no
  public ports). Server steps in `deploy/README.md`; `deploy/check-access.sh` checks that the
  server can reach Telegram, Google, DeepSeek and the registries.
- CI/CD: `.github/workflows/ci.yml` runs `npm run check` on every push and pull request. A push
  to `main` that passes and changes more than docs builds the images to ghcr.io and runs
  `deploy/update.sh` on the server over SSH (a deploy key restricted to that one command).
  Merging to `main` therefore deploys: keep `main` releasable.

**Before creating or modifying files, read the rule files whose glob patterns match the files you
are working on.** Read `100-architecture.md` first for any non-trivial change in `src/`.

| Rule file | Applies to | Covers |
| --- | --- | --- |
| `.agents/rules/100-architecture.md` | `src/**/*.ts` | Backend architecture: `src/` layout, dependency direction, feature module anatomy, modules and DI, providers and tokens, lifecycle hooks, ESM and naming conventions. |
| `.agents/rules/101-configuration.md` | `src/config/**/*, src/app.module.ts, src/main.ts, .env.example` | Configuration: `@nestjs/config`, Zod env schema, `registerAs` namespaces, typed injection, secrets in env, conditional modules. |
| `.agents/rules/102-http-layer.md` | `src/**/*.controller.ts, src/**/*.schemas.ts, src/common/**/*, src/app.module.ts, src/main.ts` | HTTP layer: thin controllers, schema-first validation (`StandardSchemaValidationPipe`), request pipeline (guards, interceptors, pipes, filters), global enhancers, responses. |
| `.agents/rules/103-errors-logging.md` | `src/**/*.ts` | Errors and logging: domain errors vs `HttpException`, exception filters, error boundaries outside HTTP, structured `Logger`, what must never be logged, health checks. |
| `.agents/rules/104-database-drizzle.md` | `src/db/**/*, src/**/*.repository.ts, drizzle/**/*, drizzle.config.ts` | Database: PostgreSQL + Drizzle via `@nestjs/drizzle`, schema, repositories, transactions, idempotent upserts, migrations. |
| `.agents/rules/105-scheduling-jobs.md` | `src/sync/**/*, src/**/*.scheduler.ts, src/**/*.job.ts, src/db/drizzle-lock.store.ts` | Scheduled work and locks: `@nestjs/schedule` + `@nestjs/locks` (`@OnOneInstance`, `@WithoutOverlapping`, `withLock` per source, PostgreSQL lock store), dispatcher pattern, idempotent sync runs, time zones, shutdown. |
| `.agents/rules/106-external-integrations.md` | `src/integrations/**/*, src/sources/**/*` | External systems: integration modules, one retry layer per call (`@nestjs/resilience` policies, `@nestjs/http-client`), validation at the boundary, source adapters, Google Calendar idempotent writes and ownership markers, LLM via `@nestjs/ai` + DeepSeek with guardrails. |
| `.agents/rules/107-security.md` | `src/**/*.ts, src/main.ts` | Security: Telegram allowlist and webhook secret, Google OAuth `state` and scopes, encrypting secrets at rest, SSRF protection for user-supplied URLs, HTTP hardening. |
| `.agents/rules/108-testing.md` | `src/**/*.spec.ts, test/**/*, vitest.config.ts, vitest.config.e2e.ts` | Testing: Vitest, unit tests for pure logic, `Test.createTestingModule` with overrides, e2e with Supertest and PGlite, fakes for integrations, fixtures, time control. |
