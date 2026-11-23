import { registerAs } from '@nestjs/config';
import { loadEnv } from './env.js';

export const securityConfig = registerAs('security', () => {
  const env = loadEnv();
  return {
    encryptionKey: env.ENCRYPTION_KEY,
  };
});
