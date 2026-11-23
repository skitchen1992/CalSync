import { Injectable, Logger } from '@nestjs/common';
import { type SheetMapping, sheetMappingSchema } from '../../../db/source-options.js';
import { LlmClient } from '../../../integrations/deepseek/llm.client.js';
import { SheetEmptyError } from '../../sources.errors.js';
import {
  SHEET_MAPPING_INSTRUCTIONS,
  SHEET_MAPPING_LABEL,
  SHEET_MAPPING_PROMPT_VERSION,
  type SheetMappingProposal,
  sheetMappingPrompt,
  sheetMappingProposalSchema,
} from './gsheet-mapping.prompts.js';

export interface ProposedSheetMapping {
  mapping: SheetMapping;
  timeZone: string;
}

/**
 * Asks the language model which column holds what, once, when a sheet is added. The result is
 * shown to the user and stored on the source after confirmation; syncs never call the model.
 */
@Injectable()
export class SheetMappingService {
  private readonly logger = new Logger(SheetMappingService.name);

  constructor(private readonly llm: LlmClient) {}

  async propose(table: readonly string[][], signal?: AbortSignal): Promise<ProposedSheetMapping> {
    const { prompt, rowIndexes, columnCount } = sheetMappingPrompt(table);
    if (rowIndexes.length < 2) {
      throw new SheetEmptyError('The sheet has no rows to read');
    }
    const proposal = await this.llm.generateObject({
      label: SHEET_MAPPING_LABEL,
      schema: sheetMappingProposalSchema(columnCount, rowIndexes),
      instructions: SHEET_MAPPING_INSTRUCTIONS,
      prompt,
      ...(signal ? { signal } : {}),
    });
    this.logger.log('Sheet mapping proposed', { promptVersion: SHEET_MAPPING_PROMPT_VERSION, columnCount });
    return { mapping: toMapping(table, proposal), timeZone: proposal.timeZone };
  }
}

/** Keeps the header text next to each index, so a later sync notices moved or renamed columns. */
function toMapping(table: readonly string[][], proposal: SheetMappingProposal): SheetMapping {
  const header = table[proposal.headerRow] ?? [];
  const column = (index: number) => ({ index, header: (header[index] ?? '').trim() });
  const optional = (index: number | null) => (index === null ? null : column(index));
  const { date, time, title, type, link } = proposal.columns;
  return sheetMappingSchema.parse({
    headerRow: proposal.headerRow,
    columns: { date: column(date), time: optional(time), title: column(title), type: optional(type), link: optional(link) },
    dateOrder: proposal.dateOrder,
    defaultDurationMinutes: proposal.defaultDurationMinutes,
  });
}
