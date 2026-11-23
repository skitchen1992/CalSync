import { registerAs } from '@nestjs/config';
import { loadEnv } from './env.js';

export const databaseConfig = registerAs('database', () => {
  const env = loadEnv();
  return {
    url: env.DATABASE_URL,
  };
});
