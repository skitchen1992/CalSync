import type { AiModelPricing } from '@nestjs/ai';

/**
 * USD per million tokens, from https://api-docs.deepseek.com/quick_start/pricing (2026-11-23).
 * DeepSeek bills peak hours (01:00–04:00 and 06:00–10:00 UTC on weekdays) at twice the off-peak
 * rate; these are the peak rates, so reported costs are an upper bound. A model missing here is
 * reported without cost.
 */
export const DEEPSEEK_PRICING: Readonly<Record<string, AiModelPricing>> = {
  'deepseek-flash': { input: 0.3, cachedInput: 0.006, output: 1.2 },
  'deepseek-v4-pro': { input: 1.32, cachedInput: 0.044, output: 3.96 },
};
