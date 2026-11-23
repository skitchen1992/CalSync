import { AiModule } from '@nestjs/ai';
import { type FakeAnswer, FakeModel } from '@nestjs/ai/testing';
import { Test } from '@nestjs/testing';
import { TEAM_SHEET_LLM_ANSWER, TEAM_SHEET_MAPPING, teamSheetCsv } from '../../../../test/support/gsheet.js';
import { LlmOutputInvalidError } from '../../../integrations/deepseek/deepseek.errors.js';
import { LlmClient } from '../../../integrations/deepseek/llm.client.js';
import { SheetEmptyError } from '../../sources.errors.js';
import { parseCsv } from './gsheet-csv.js';
import { sheetMappingPrompt } from './gsheet-mapping.prompts.js';
import { SheetMappingService } from './gsheet-mapping.service.js';

const table = () => parseCsv(teamSheetCsv());

async function serviceAnswering(...answers: FakeAnswer[]) {
  const model = new FakeModel(answers);
  const moduleRef = await Test.createTestingModule({
    imports: [AiModule.forRoot({ models: { default: model }, defaults: { retry: false } })],
    providers: [LlmClient, SheetMappingService],
  }).compile();
  return { service: moduleRef.get(SheetMappingService), model };
}

describe('sheetMappingPrompt', () => {
  it('shows the header and the first 15 non-empty rows, keyed by column', () => {
    const { prompt, rowIndexes, columnCount } = sheetMappingPrompt(table());

    expect(columnCount).toBe(12);
    // Row 5 is an empty week separator.
    expect(rowIndexes).toEqual([0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    expect(prompt).toContain('row 0: {"0":"Дата","1":"Время","2":"Тип события","3":"Название события","4":"Ссылка"');
    expect(prompt).toContain('"1":"15:00 - 16:30"');
  });

  it('never sends meeting links, only their host', () => {
    const { prompt } = sheetMappingPrompt(table());

    expect(prompt).toContain('<link meet.example.com>');
    expect(prompt).not.toMatch(/https?:\/\//);
  });
});

describe('SheetMappingService', () => {
  it('turns the answer into a mapping that keeps each column header', async () => {
    const { service, model } = await serviceAnswering({ object: TEAM_SHEET_LLM_ANSWER });

    await expect(service.propose(table())).resolves.toEqual({ mapping: TEAM_SHEET_MAPPING, timeZone: 'Europe/Moscow' });
    expect(model.calls).toHaveLength(1);
  });

  it('asks again when a column is out of range, and accepts the corrected answer', async () => {
    const { service, model } = await serviceAnswering(
      { object: { ...TEAM_SHEET_LLM_ANSWER, columns: { ...TEAM_SHEET_LLM_ANSWER.columns, link: 12 } } },
      { object: TEAM_SHEET_LLM_ANSWER },
    );

    await expect(service.propose(table())).resolves.toMatchObject({ mapping: TEAM_SHEET_MAPPING });
    expect(model.calls).toHaveLength(2);
    expect(model.lastCall?.lastUserMessage).toContain('columns.link');
  });

  it('rejects one column used for two roles and an unknown time zone', async () => {
    const { service } = await serviceAnswering(
      { object: { ...TEAM_SHEET_LLM_ANSWER, columns: { ...TEAM_SHEET_LLM_ANSWER.columns, title: 2 } } },
      { object: { ...TEAM_SHEET_LLM_ANSWER, timeZone: 'Moscow time' } },
    );

    await expect(service.propose(table())).rejects.toBeInstanceOf(LlmOutputInvalidError);
  });

  it('does not ask the model about a sheet without data rows', async () => {
    const { service, model } = await serviceAnswering();

    await expect(service.propose([['Дата', 'Время'], ['', '']])).rejects.toBeInstanceOf(SheetEmptyError);
    expect(model.calls).toHaveLength(0);
  });
});
