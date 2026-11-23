import { z } from 'zod';

// What `sources.options` (jsonb) holds: settings an adapter needs to read a source, worked out once
// when the source is added. The column is typed with this shape, and every reader parses it with
// `sourceOptionsSchema` first: stored JSON can drift from the current code.

/** A sheet column: its 0-based index and the header text it had when the mapping was confirmed. */
export const sheetColumnSchema = z.object({
  index: z.number().int().min(0),
  header: z.string(),
});

/** Order of day, month and year in the date cells: 18.09.2026 is DMY. */
export const DATE_ORDERS = ['DMY', 'MDY', 'YMD'] as const;

/**
 * Which column holds what in a schedule sheet, and how to read its cells. A dated row with an
 * empty time cell always becomes an all-day event (deadlines, notes for the day). Mappings stored
 * before that rule may still carry a `rowsWithoutTime` key: parsing drops it.
 */
export const sheetMappingSchema = z.object({
  /** 0-based index of the header row; data rows follow it. */
  headerRow: z.number().int().min(0),
  columns: z.object({
    date: sheetColumnSchema,
    /** "15:00 - 16:30", "18:30-20:00", "15:30 - ?", "11:00"; null when the sheet has no times. */
    time: sheetColumnSchema.nullable(),
    title: sheetColumnSchema,
    /** Event type; it becomes a "[Type] " prefix of the title. */
    type: sheetColumnSchema.nullable(),
    /** Meeting link; the URL becomes the location, other text the description. */
    link: sheetColumnSchema.nullable(),
  }),
  dateOrder: z.enum(DATE_ORDERS),
  /** Length of events without an end ("15:30 - ?", or a lone start time). */
  defaultDurationMinutes: z
    .number()
    .int()
    .min(5)
    .max(24 * 60),
});

export const sourceOptionsSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('gsheet'), version: z.literal(1), mapping: sheetMappingSchema }),
]);

export type SheetColumn = z.infer<typeof sheetColumnSchema>;
export type SheetMapping = z.infer<typeof sheetMappingSchema>;
export type DateOrder = (typeof DATE_ORDERS)[number];
export type SourceOptions = z.infer<typeof sourceOptionsSchema>;
export type GoogleSheetOptions = Extract<SourceOptions, { type: 'gsheet' }>;
