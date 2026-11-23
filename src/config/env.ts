import { z } from 'zod';
import { envSchema, type Env } from './env.schema.js';

/**
 * Parses the environment with `envSchema`, returning typed and coerced values.
 * Throws one error that lists every invalid variable.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

/**
 * ConfigModule `validate` hook. Fails fast on an invalid environment, but returns the raw values:
 * ConfigModule copies what this returns into process.env, which only holds strings, so returning
 * the parsed values would drop lists like TELEGRAM_ALLOWED_USER_IDS. The registerAs namespaces
 * parse process.env themselves with loadEnv().
 */
export function validateEnv(raw: Record<string, unknown>): Record<string, unknown> {
  loadEnv(raw as NodeJS.ProcessEnv);
  return raw;
}
