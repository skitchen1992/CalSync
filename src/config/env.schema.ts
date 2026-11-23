import type { LogLevel } from '@nestjs/common';
import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'] as const satisfies readonly LogLevel[];

/**
 * The single, complete list of environment variables the app reads.
 * Adding a variable: extend this schema, `.env.example`, and the namespace that owns the area.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_FORMAT: z.enum(['pretty', 'json']).default('pretty'),
  LOG_LEVELS: z
    .string()
    .default('fatal,error,warn,log')
    .transform((value) => value.split(',').map((level) => level.trim()))
    .pipe(z.array(z.enum(LOG_LEVELS)).min(1)),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
});

export type Env = z.infer<typeof envSchema>;
