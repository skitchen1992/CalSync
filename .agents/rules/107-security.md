# Security

CalSync holds long-lived Google credentials and fetches URLs that users paste into a chat. The
main threats are someone else controlling the bot, leaked tokens, and the server being tricked into
fetching internal addresses.

## Telegram Access
- The bot is single-tenant. Every update passes an **allowlist check** against
  `TELEGRAM_ALLOWED_USER_IDS` (see 101) before any handler runs. Implement it once, as the bot's
  first middleware or guard, never per command. Updates from unknown users are dropped silently:
  no reply, nothing that confirms the bot exists. Log only the user id.
- Webhook mode: register the webhook with a `secret_token`. A guard on the webhook route compares the
  `X-Telegram-Bot-Api-Secret-Token` header with the configured secret using
  `crypto.timingSafeEqual` (constant time), and rejects on mismatch before parsing the body.
- Long polling is fine for local development and needs no public endpoint.
- Destructive bot actions (remove a source, delete its Google calendar) ask for confirmation with an
  inline button. The callback data carries an opaque id, never a raw URL or a secret.

## Google OAuth
- The authorization URL carries a `state` that is random (`crypto.randomBytes`), bound to the
  Telegram user who requested it, single-use, and short-lived (minutes). The callback rejects a
  missing, unknown, expired or reused `state`.
- Request the narrowest scopes that work: `calendar.app.created` (manage calendars CalSync creates)
  and `spreadsheets.readonly` (read schedule sheets). Do not request full `calendar` access unless a
  feature truly needs it, and document why.
- Request offline access so that a refresh token is issued. Store only the refresh token, encrypted.
  Access tokens live in memory.

## Secrets at Rest
- OAuth refresh tokens, private ICS/CalDAV URLs (they embed credentials) and CalDAV passwords are
  encrypted before they reach the database. Use `CryptoService` (`common/crypto/`): AES-256-GCM
  from `node:crypto`, a random 12-byte IV per value, the auth tag stored with the ciphertext, and the
  key from `ENCRYPTION_KEY` (32 bytes, see 101). Store the format as
  `v1:<iv>:<tag>:<ciphertext>` (base64 parts) so the key can be rotated later.
- Decrypt only at the moment of use, inside the integration that needs the value. Decrypted
  secrets are never logged (see 103), never echoed back in bot messages, and never sent to the LLM
  (see 106). The bot shows URLs masked (`https://calendar.yandex.ru/…/a1b2…`).
- `.env` is git-ignored. Secrets never appear in code, fixtures, test snapshots or commit messages.

## User-Supplied URLs (SSRF)
Users paste URLs that the server then fetches. Every outbound request to a user-supplied URL goes
through one guarded fetch path that:
- allows only `https:` (and `http:` only if explicitly needed for a known public feed);
- resolves the host and **rejects private, loopback, link-local and metadata addresses** (IPv4 and
  IPv6, including `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`,
  `::1`, `fc00::/7`, `fe80::/10`), and pins the connection to the vetted address so DNS cannot
  change between the check and the request;
- re-applies the same checks on every redirect and limits redirects (≤ 3);
- caps response size (for example, 5 MB for an ICS feed) and time (see the timeouts in 106).

Recognize known providers (Google Sheets, Yandex embed) by parsing the URL and extracting ids. Do not
pass the raw string to another service.

## HTTP Hardening
- `helmet()` is the first middleware in `main.ts`.
- CORS stays disabled (Nest's default): CalSync has no browser clients. Enable it only with an
  explicit origin list when a browser client appears.
- Rate limiting: `ThrottlerModule.forRoot([{ ttl: minutes(1), limit: … }])` + `ThrottlerGuard` as
  `APP_GUARD`. Health and the Telegram webhook may use `@SkipThrottle()` (the webhook is protected by
  its secret), and the OAuth callback stays throttled.
- Every request input is schema-validated (see 102), and error responses expose no internals
  (see 103).

## Dependencies
- The lockfile is committed. Add a dependency only when the platform or an existing dependency
  cannot do the job, and prefer official `@nestjs/*` packages.
- Run the package manager's audit in CI. Fix critical findings before merging.
