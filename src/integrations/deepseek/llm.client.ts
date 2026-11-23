import { Injectable, Logger } from '@nestjs/common';
import { AiBudgetExceededError, AiModelError, AiOutputError, AiService } from '@nestjs/ai';
import type { z } from 'zod';
import { LlmOutputInvalidError, LlmUnavailableError } from './deepseek.errors.js';

export interface StructuredRequest<T> {
  /** Names the call in usage logs ('sheet-mapping'). */
  label: string;
  /** What the answer must be; every field's `.describe()` tells the model what it means. */
  schema: z.ZodType<T>;
  /** The system prompt: a versioned constant from a `*.prompts.ts` file. */
  instructions: string;
  /** The data to work on. Never secrets or URLs with credentials. */
  prompt: string;
  signal?: AbortSignal;
}

/**
 * The language model behind a narrow API. Timeouts and retries of failed calls are configured once
 * in AiModule (DeepseekModule); this client adds the one thing the module leaves to the caller:
 * an answer that does not match the schema gets exactly one repair call, then fails.
 */
@Injectable()
export class LlmClient {
  private readonly logger = new Logger(LlmClient.name);

  constructor(private readonly ai: AiService) {}

  async generateObject<T>(request: StructuredRequest<T>): Promise<T> {
    const { label, schema, instructions, prompt, signal } = request;
    const call = (messages: { role: 'user' | 'assistant'; content: string }[], callLabel: string) =>
      this.ai.generateObject({ label: callLabel, schema, instructions, messages, ...(signal ? { abortSignal: signal } : {}) });

    try {
      return (await this.translate(call([{ role: 'user', content: prompt }], label))).object;
    } catch (error) {
      if (!(error instanceof AiOutputError)) {
        throw error;
      }
      // Log the validation failure, not the answer: it may echo the data that was sent.
      this.logger.warn('LLM answer rejected, asking once more', { label, reason: error.message });
      const repair = [
        { role: 'user' as const, content: prompt },
        { role: 'assistant' as const, content: error.text },
        {
          role: 'user' as const,
          content: `Your answer was rejected: ${error.message}\nAnswer again with one JSON object that fixes this.`,
        },
      ];
      try {
        return (await this.translate(call(repair, `${label}:repair`))).object;
      } catch (repairError) {
        if (repairError instanceof AiOutputError) {
          throw new LlmOutputInvalidError(`The model's answer to ${label} did not match the schema twice`, {
            cause: repairError,
          });
        }
        throw repairError;
      }
    }
  }

  /** Model failures become domain errors; AiOutputError stays for the repair decision above. */
  private async translate<R>(pending: Promise<R>): Promise<R> {
    try {
      return await pending;
    } catch (error) {
      if (error instanceof AiModelError || error instanceof AiBudgetExceededError) {
        throw new LlmUnavailableError('The language model is unavailable', { cause: error });
      }
      throw error;
    }
  }
}
