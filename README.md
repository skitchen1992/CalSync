# CalSync

Mirrors external calendars (Yandex Calendar, ICS/CalDAV feeds) and schedule tables from Google
Sheets into Google Calendar. Sources are managed from a Telegram bot.

Stack: NestJS 12 (ESM) · TypeScript 6 · PostgreSQL + Drizzle · Zod · Vitest · oxlint.
Architecture and coding rules: [AGENTS.md](AGENTS.md) → [.agents/rules/](.agents/rules/).

## Getting started

Node.js 24 LTS (`.nvmrc`) is recommended. The app runs on 22.12+, but npm 10.9.x fails to install
this dependency tree, and npm 11 ships with Node 24.

```bash
nvm install && nvm use
npm install
cp .env.example .env
docker compose up -d        # PostgreSQL on localhost:5433
npm run db:migrate
npm run start:dev
```

`GET http://localhost:3000/health` reports the database status.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run check` | Typecheck, lint, unit and e2e tests. Run before considering a change done |
| `npm test` / `npm run test:e2e` | Unit tests (`src/**/*.spec.ts`) / e2e tests (`test/**/*.e2e-spec.ts`, in-process PGlite) |
| `npm run typecheck` / `npm run lint` | `tsc --noEmit` / oxlint (type-aware) |
| `npm run db:generate` / `npm run db:migrate` | Generate a migration from `src/db/schema.ts` / apply migrations |
| `npm run build` / `npm run start:prod` | Compile to `dist/` / run the compiled app |
