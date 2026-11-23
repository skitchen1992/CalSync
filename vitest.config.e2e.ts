import { defineConfig } from 'vitest/config';

// E2E tests: the real AppModule over HTTP, PostgreSQL replaced by in-process PGlite and external
// services by fakes (test/support/create-test-app.ts).
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    testTimeout: 30_000,
    // Explicit values win over a developer's .env. Nothing here is ever connected to: the
    // database, Google, Telegram, Google Sheets and DeepSeek are replaced in createTestApp().
    env: {
      NODE_ENV: 'test',
      LOG_LEVELS: 'fatal',
      DATABASE_URL: 'postgres://calsync:calsync@127.0.0.1:5433/calsync_e2e',
      ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
      TELEGRAM_BOT_TOKEN: '123456:e2e-token',
      TELEGRAM_ALLOWED_USER_IDS: '1001',
      TELEGRAM_POLLING_ENABLED: 'false',
      GOOGLE_CLIENT_ID: 'e2e-client-id',
      GOOGLE_CLIENT_SECRET: 'e2e-client-secret',
      GOOGLE_REDIRECT_URL: 'http://localhost:3000/auth/google/callback',
      SYNC_SCHEDULER_ENABLED: 'false',
      DEEPSEEK_API_KEY: 'e2e-deepseek-key',
    },
  },
});
