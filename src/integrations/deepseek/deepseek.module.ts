import { createDeepSeek } from '@ai-sdk/deepseek';
import { Logger, Module } from '@nestjs/common';
import { AiModule } from '@nestjs/ai';
import type { ConfigType } from '@nestjs/config';
import { deepseekConfig } from '../../config/deepseek.config.js';
import { DEEPSEEK_PRICING } from './deepseek.constants.js';
import { LlmClient } from './llm.client.js';

const usageLogger = new Logger('LlmUsage');

/**
 * DeepSeek through @nestjs/ai. Used for one-off tasks only (recognizing a sheet's columns when it
 * is added), never in the sync path. Exports LlmClient; AiService stays an implementation detail.
 */
@Module({
  imports: [
    AiModule.forRootAsync({
      isGlobal: true,
      inject: [deepseekConfig.KEY],
      useFactory: (config: ConfigType<typeof deepseekConfig>) => {
        // The key is passed explicitly: by default the provider reads DEEPSEEK_API_KEY from
        // process.env itself, bypassing the validated config.
        const deepseek = createDeepSeek({ apiKey: config.apiKey });
        const pricing = DEEPSEEK_PRICING[config.model];
        return {
          models: {
            default: { model: deepseek(config.model), maxOutputTokens: 4_000, ...(pricing ? { pricing } : {}) },
          },
          defaults: { timeout: '60s', retry: { attempts: 3 } },
          // Counts and cost only: prompts and answers carry sheet contents.
          onUsage: (event) =>
            usageLogger.log('LLM call', {
              label: event.label,
              model: event.model.modelId,
              attempt: event.attempt,
              totalTokens: event.usage.totalTokens,
              cost: event.cost,
              durationMs: event.durationMs,
            }),
        };
      },
    }),
  ],
  providers: [LlmClient],
  exports: [LlmClient],
})
export class DeepseekModule {}
