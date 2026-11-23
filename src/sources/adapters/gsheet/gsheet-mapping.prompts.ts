import { z } from 'zod';
import { isValidTimeZone } from '../../../common/utils/zoned-time.js';
import { DATE_ORDERS } from '../../../db/source-options.js';

// The one LLM task of Google Sheet sources: proposing a column mapping when a sheet is added.
// Bump SHEET_MAPPING_PROMPT_VERSION with every change of the instructions or the schema.

export const SHEET_MAPPING_PROMPT_VERSION = 2;
export const SHEET_MAPPING_LABEL = 'sheet-mapping';

/** Rows the model sees: the header and the first data rows after it. */
const SAMPLE_ROWS = 16;
const MAX_CELL_LENGTH = 120;
const URL_PATTERN = /https?:\/\/[^\s/]+\S*/g;

export const SHEET_MAPPING_INSTRUCTIONS = `You read the first rows of a schedule kept in Google Sheets and work out how to turn its rows into calendar events.
People maintain the sheet by hand, so expect quirks: a weekday after the date ("18.09.2026 ПТ"), time ranges with or without spaces ("15:00 - 16:30", "18:30-20:00"), an open end ("15:30 - ?"), a lone start time, empty rows between weeks, titles split over several lines, and columns that are not about the event (people responsible, comments, technical ids).

Each row is given as {column index: cell text}; empty cells are left out and links are shown as <link host>.

Answer with one JSON object:
- headerRow: the index of the row with the column names.
- columns: the column index for each role, or null when the sheet has no such column. Use a column for one role at most, and never pick columns of people, comments or ids.
  - date: the date of the event.
  - time: the start time or the time range.
  - title: the name of the event.
  - type: the kind of event or the program it belongs to, when a separate column has it.
  - link: the meeting link or the place.
- dateOrder: the order of day, month and year in the date cells.
- defaultDurationMinutes: how long an event without an end lasts; take the usual length of the events that have both a start and an end, rounded to 15 minutes.
- timeZone: the IANA time zone the times are written in. Infer it from the language, places and organizations; for a Russian-language sheet without other hints, use Europe/Moscow.`;

/** What the model answers. Column indexes are bounded by the sheet, so out-of-range answers fail validation. */
export function sheetMappingProposalSchema(columnCount: number, rowIndexes: readonly number[]) {
  const column = z
    .number()
    .int()
    .min(0)
    .max(Math.max(columnCount - 1, 0));
  return z
    .object({
      headerRow: z.number().int().min(0).describe('Index of the row with the column names. Example: 0'),
      columns: z.object({
        date: column.describe('Column with the event date ("18.09.2026 ПТ"). Example: 0'),
        time: column.nullable().describe('Column with the start time or time range ("15:00 - 16:30"), or null. Example: 1'),
        title: column.describe('Column with the event name. Example: 3'),
        type: column.nullable().describe('Column with the kind of event or its program ("МГУ АКСЕЛЬ"), or null. Example: 2'),
        link: column.nullable().describe('Column with the meeting link or place, or null. Example: 4'),
      }),
      dateOrder: z
        .enum(DATE_ORDERS)
        .describe('Order of day, month and year in the date cells: DMY for 18.09.2026, MDY for 09/18/2026, YMD for 2026-09-18. Example: "DMY"'),
      defaultDurationMinutes: z
        .number()
        .int()
        .min(5)
        .max(12 * 60)
        .describe('Length of an event without an end ("15:30 - ?" or "11:00"), in minutes. Example: 60'),
      timeZone: z
        .string()
        .refine(isValidTimeZone, 'must be an IANA time zone name')
        .describe('IANA time zone of the times in the sheet. Example: "Europe/Moscow"'),
    })
    .superRefine((proposal, ctx) => {
      if (!rowIndexes.includes(proposal.headerRow)) {
        ctx.addIssue({ code: 'custom', path: ['headerRow'], message: `must be one of the rows shown: ${rowIndexes.join(', ')}` });
      }
      const used = Object.values(proposal.columns).filter((index): index is number => index !== null);
      if (new Set(used).size !== used.length) {
        ctx.addIssue({ code: 'custom', path: ['columns'], message: 'each column can have one role only' });
      }
    });
}

export type SheetMappingProposal = z.infer<ReturnType<typeof sheetMappingProposalSchema>>;

export interface SheetMappingPrompt {
  prompt: string;
  /** Sheet row indexes shown to the model; the header row must be one of them. */
  rowIndexes: number[];
  columnCount: number;
}

/** A cell as the model sees it: links reduced to their host (they may carry tokens), long text cut. */
function sampleCell(cell: string): string {
  const masked = cell.trim().replace(URL_PATTERN, (url) => `<link ${new URL(url).hostname}>`);
  return masked.length > MAX_CELL_LENGTH ? `${masked.slice(0, MAX_CELL_LENGTH)}…` : masked;
}

/** The user message: the first non-empty rows of the sheet, header included. */
export function sheetMappingPrompt(table: readonly string[][]): SheetMappingPrompt {
  const sample = table
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.some((cell) => cell.trim() !== ''))
    .slice(0, SAMPLE_ROWS);
  const columnCount = Math.max(0, ...sample.map(({ row }) => row.length));
  const lines = sample.map(({ row, index }) => {
    const cells = Object.fromEntries(
      row.flatMap((cell, column) => (cell.trim() === '' ? [] : [[String(column), sampleCell(cell)]])),
    );
    return `row ${index}: ${JSON.stringify(cells)}`;
  });
  return {
    prompt: [`The sheet has ${columnCount} columns (indexes 0 to ${columnCount - 1}). Its first non-empty rows:`, ...lines].join(
      '\n',
    ),
    rowIndexes: sample.map(({ index }) => index),
    columnCount,
  };
}
