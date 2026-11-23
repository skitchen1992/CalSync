# CalSync

Mirrors external calendars into Google Calendar, managed from a Telegram bot. Each source gets its
own Google calendar, kept up to date every 15 minutes.

Supported sources: Yandex Calendar embed links (`https://calendar.yandex.ru/embed/week?layer_ids=…`).
Next: ICS/CalDAV feeds and Google Sheets schedules.

Stack: NestJS 12 (ESM) · TypeScript 6 · PostgreSQL + Drizzle · Zod · grammY · Vitest · oxlint.
Architecture and coding rules: [AGENTS.md](AGENTS.md) → [.agents/rules/](.agents/rules/).

## How it works

1. `/connect` in the bot → Google consent (scope `calendar.app.created`: CalSync can only create
   calendars and manage events in calendars it created).
2. Send a calendar link → the bot shows a preview → **✅ Добавить** creates a separate Google
   calendar for that source and syncs it.
3. Every minute a dispatcher syncs the sources that are due: it fetches the source window
   (−7…+60 days), diffs it with what was mirrored before, and creates / updates / deletes Google
   events. Re-runs are idempotent (deterministic event ids), a failed or empty fetch never deletes
   anything, and a failing source backs off exponentially.

Bot commands: `/list`, `/sync`, `/remove`, `/status`, `/help`.

## Setup

Node.js 24 LTS (`.nvmrc`) is recommended. The app runs on 22.12+, but npm 10.9.x fails to install
this dependency tree, and npm 11 ships with Node 24.

### 1. Telegram bot
Create a bot with [@BotFather](https://t.me/BotFather) → `TELEGRAM_BOT_TOKEN`. Put your own
Telegram user id (e.g. from [@userinfobot](https://t.me/userinfobot)) into
`TELEGRAM_ALLOWED_USER_IDS`; the bot ignores everyone else.

### 2. Google OAuth client
In [Google Cloud Console](https://console.cloud.google.com/):
1. Create a project and enable the **Google Calendar API**.
2. **OAuth consent screen**: External, add the scope `.../auth/calendar.app.created`, and add your
   Google account under **Test users**.
3. **Credentials → Create OAuth client ID → Web application**, with the authorized redirect URI
   `http://localhost:3000/auth/google/callback` → `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

While the consent screen is in **Testing**, Google expires refresh tokens after 7 days: the bot
then reports that access was revoked, and `/connect` restores it. Publishing the app removes the
limit.

### 3. Run
```bash
nvm install && nvm use
npm install
cp .env.example .env        # fill in the empty values; ENCRYPTION_KEY: openssl rand -base64 32
docker compose up -d        # PostgreSQL on localhost:5433
npm run db:migrate
npm run start:dev
```
Open the bot in Telegram and send `/start`. `GET http://localhost:3000/health` reports the
database status.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run check` | Typecheck, lint, unit and e2e tests. Run before considering a change done |
| `npm test` / `npm run test:e2e` | Unit tests (`src/**/*.spec.ts`) / e2e tests (`test/**/*.e2e-spec.ts`, in-process PGlite, fakes for Google/Telegram) |
| `npm run typecheck` / `npm run lint` | `tsc --noEmit` / oxlint (type-aware) |
| `npm run db:generate` / `npm run db:migrate` | Generate a migration from `src/db/schema.ts` / apply migrations |
| `npm run build` / `npm run start:prod` | Compile to `dist/` / run the compiled app |
