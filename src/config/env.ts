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
