import { registerAs } from '@nestjs/config';
import { loadEnv } from './env.js';

export const telegramConfig = registerAs('telegram', () => {
  const env = loadEnv();
  return {
    botToken: env.TELEGRAM_BOT_TOKEN,
    allowedUserIds: env.TELEGRAM_ALLOWED_USER_IDS,
    pollingEnabled: env.TELEGRAM_POLLING_ENABLED,
  };
});
