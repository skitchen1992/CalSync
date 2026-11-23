import { registerAs } from '@nestjs/config';
import { loadEnv } from './env.js';

export const deepseekConfig = registerAs('deepseek', () => {
  const env = loadEnv();
  return {
    apiKey: env.DEEPSEEK_API_KEY,
    model: env.DEEPSEEK_MODEL,
  };
});
