import type { LogLevel } from '@nestjs/common';
import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'] as const satisfies readonly LogLevel[];

const ENCRYPTION_KEY_BYTES = 32;

/**
 * The single, complete list of environment variables the app reads.
 * Adding a variable: extend this schema, `.env.example`, and the namespace that owns the area.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3100),
  LOG_FORMAT: z.enum(['pretty', 'json']).default('pretty'),
  LOG_LEVELS: z
    .string()
    .default('fatal,error,warn,log')
    .transform((value) => value.split(',').map((level) => level.trim()))
    .pipe(z.array(z.enum(LOG_LEVELS)).min(1)),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  ENCRYPTION_KEY: z
    .base64()
    .refine((key) => Buffer.from(key, 'base64').length === ENCRYPTION_KEY_BYTES, {
      message: `must be ${ENCRYPTION_KEY_BYTES} bytes encoded as base64 (openssl rand -base64 32)`,
    }),

  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_ALLOWED_USER_IDS: z
    .string()
    .transform((value) => value.split(',').map((id) => Number(id.trim())))
    .pipe(z.array(z.number().int().positive()).min(1)),
  TELEGRAM_POLLING_ENABLED: z.stringbool().default(true),

  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REDIRECT_URL: z.url({ protocol: /^https?$/ }),

  SYNC_SCHEDULER_ENABLED: z.stringbool().default(true),
  SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(5).default(15),
  SYNC_WINDOW_PAST_DAYS: z.coerce.number().int().min(0).max(30).default(7),
  SYNC_WINDOW_FUTURE_DAYS: z.coerce.number().int().min(1).max(180).default(60),
});

export type Env = z.infer<typeof envSchema>;
