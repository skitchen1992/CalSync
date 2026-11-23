import { registerAs } from '@nestjs/config';
import { loadEnv } from './env.js';

export const appConfig = registerAs('app', () => {
  const env = loadEnv();
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    logFormat: env.LOG_FORMAT,
    logLevels: env.LOG_LEVELS,
  };
});
