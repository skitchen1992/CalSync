import { defineConfig } from 'vitest/config';

// Unit tests: colocated *.spec.ts files, no Nest application and no database.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts'],
  },
});
