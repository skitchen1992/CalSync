import { registerAs } from '@nestjs/config';
import { loadEnv } from './env.js';

export const googleConfig = registerAs('google', () => {
  const env = loadEnv();
  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUrl: env.GOOGLE_REDIRECT_URL,
  };
});
