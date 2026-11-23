import { defineConfig } from 'vitest/config';

// E2E tests: the real AppModule over HTTP, PostgreSQL replaced by in-process PGlite.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    // Explicit values win over a developer's .env. The URL is never connected to:
    // specs swap the database for PGlite (test/support/create-test-app.ts).
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://calsync:calsync@127.0.0.1:5433/calsync_e2e',
    },
  },
});
