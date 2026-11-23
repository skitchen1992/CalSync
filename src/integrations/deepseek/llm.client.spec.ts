import { AiModule } from '@nestjs/ai';
import { type FakeAnswer, FakeModel, providerError } from '@nestjs/ai/testing';
import { Test } from '@nestjs/testing';
import { z } from 'zod';
import { LlmOutputInvalidError, LlmUnavailableError } from './deepseek.errors.js';
import { LlmClient } from './llm.client.js';

const schema = z.object({ column: z.number().int().min(0).max(4).describe('Index of the date column. Example: 0') });
const request = { label: 'test', schema, instructions: 'Find the date column.', prompt: '{"0":"Дата"}' };

async function clientAnswering(...answers: FakeAnswer[]) {
  const model = new FakeModel(answers);
  const moduleRef = await Test.createTestingModule({
    imports: [AiModule.forRoot({ models: { default: model }, defaults: { retry: false } })],
    providers: [LlmClient],
  }).compile();
  return { client: moduleRef.get(LlmClient), model };
}

describe('LlmClient.generateObject', () => {
  it('returns the validated object', async () => {
    const { client, model } = await clientAnswering({ object: { column: 0 } });

    await expect(client.generateObject(request)).resolves.toEqual({ column: 0 });
    expect(model.calls).toHaveLength(1);
    expect(model.lastCall?.instructions).toBe('Find the date column.');
  });

  it('asks once more with the validation error when the answer does not match the schema', async () => {
    const { client, model } = await clientAnswering({ object: { column: 9 } }, { object: { column: 1 } });

    await expect(client.generateObject(request)).resolves.toEqual({ column: 1 });
    expect(model.calls).toHaveLength(2);
    expect(model.lastCall?.lastUserMessage).toMatch(/^Your answer was rejected: .*column/s);
  });

  it('gives up with LlmOutputInvalidError after the repair call fails too', async () => {
    const { client, model } = await clientAnswering({ object: { column: 9 } }, 'not json at all');

    await expect(client.generateObject(request)).rejects.toBeInstanceOf(LlmOutputInvalidError);
    expect(model.calls).toHaveLength(2);
  });

  it('turns a provider failure into LlmUnavailableError without a repair call', async () => {
    const { client, model } = await clientAnswering(providerError(503));

    await expect(client.generateObject(request)).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(model.calls).toHaveLength(1);
  });
});
