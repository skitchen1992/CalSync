import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FIXTURES_DIR = resolve(import.meta.dirname, '../fixtures');

/** Parses a captured response from test/fixtures/<path>. Returns a fresh copy on every call. */
export function loadFixture<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(resolve(FIXTURES_DIR, path), 'utf8')) as T;
}

/** A captured text response (CSV, ICS) from test/fixtures/<path>, byte for byte. */
export function loadTextFixture(path: string): string {
  return readFileSync(resolve(FIXTURES_DIR, path), 'utf8');
}
