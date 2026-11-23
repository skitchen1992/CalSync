import { createHash } from 'node:crypto';
import { addMinutesToLocal, nextDate, zonedTimeToInstant } from '../../../common/utils/zoned-time.js';
import type { DateOrder, SheetColumn, SheetMapping } from '../../../db/source-options.js';
import type { NormalizedEvent } from '../../source.types.js';
import { SheetLayoutChangedError } from '../../sources.errors.js';

// Deterministic reading of schedule rows with a confirmed mapping. No LLM here: a regular sync
// runs only this code.

/** Day, month and year, then anything (a weekday: "18.09.2026 ПТ"); separators . / - */
const DATE = /^(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})(?!\d)/;
const TIME = String.raw`(\d{1,2})[:.](\d{2})`;
/** "15:00 - 16:30", "18:30-20:00", "15:30 - ?", "15:30 -", "11:00" */
const TIME_RANGE = new RegExp(String.raw`^${TIME}(?:\s*-\s*(?:${TIME}|\?)?)?$`);
const DASHES = /[‒-―−]/g;
const URL_PATTERN = /https?:\/\/\S+/;

export interface TimeRange {
  /** HH:MM */
  start: string;
  /** HH:MM; absent for an open end ("15:30 - ?") or a lone start time. */
  end?: string;
}

/** Column indexes of one sheet, resolved against its current header row. */
export interface SheetColumns {
  date: number;
  time?: number;
  title: number;
  type?: number;
  link?: number;
}

export interface SheetReadResult {
  events: NormalizedEvent[];
  /** 1-based sheet rows that have a date but could not be read; they are left out. */
  unparsedRows: number[];
}

const pad = (value: number) => String(value).padStart(2, '0');

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** `18.09.2026 ПТ` → `2026-09-18` (DMY); undefined when the cell holds no valid date. */
export function parseSheetDate(cell: string, order: DateOrder): string | undefined {
  const match = DATE.exec(cell.trim());
  if (!match) {
    return undefined;
  }
  const [first, second, third] = [match[1]!, match[2]!, match[3]!];
  const [dayText, monthText, yearText] =
    order === 'DMY' ? [first, second, third] : order === 'MDY' ? [second, first, third] : [third, second, first];
  if (dayText.length > 2 || (yearText.length !== 2 && yearText.length !== 4)) {
    return undefined;
  }
  const year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return undefined;
  }
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** `15:00 - 16:30` → start and end; `15:30 - ?` and `11:00` → start only; undefined if unreadable. */
export function parseTimeRange(cell: string): TimeRange | undefined {
  const match = TIME_RANGE.exec(cell.trim().replace(DASHES, '-').replace(/\s+/g, ' '));
  if (!match) {
    return undefined;
  }
  const time = (hours?: string, minutes?: string) => {
    if (hours === undefined || minutes === undefined) return undefined;
    const [h, m] = [Number(hours), Number(minutes)];
    return h <= 23 && m <= 59 ? `${pad(h)}:${pad(m)}` : null;
  };
  const start = time(match[1], match[2]);
  const end = time(match[3], match[4]);
  if (!start || end === null) {
    return undefined;
  }
  return end ? { start, end } : { start };
}

/** Joins the lines of a cell into one: titles in the sheet are often split over several lines. */
export const singleLine = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ');

const comparable = (text: string) => singleLine(text).toLocaleLowerCase('ru');

/**
 * The event title: the type becomes a "[Type] " prefix, so the calendar shows which program an
 * event belongs to. A row with only a type is titled by it; a title that already names the type
 * keeps no prefix. Undefined when both are empty.
 */
export function composeTitle(typeCell: string, titleCell: string): string | undefined {
  const type = singleLine(typeCell);
  const title = singleLine(titleCell);
  if (!title) {
    return type || undefined;
  }
  if (!type || comparable(title).includes(comparable(type))) {
    return title;
  }
  return `[${type}] ${title}`;
}

/**
 * Sheet rows have no id, so the uid comes from what identifies the event: date, start time and
 * title (case and spacing ignored). Moving a row keeps it; editing one of these makes a new event.
 */
export function sheetEventUid(date: string, start: string | undefined, title: string): string {
  const hash = createHash('sha256')
    .update(JSON.stringify([date, start ?? null, comparable(title)]))
    .digest('base64url')
    .slice(0, 16);
  return `${date}${start ? `T${start}` : ''}#${hash}`;
}

/**
 * Finds the mapped columns in the current header row: where the header still is, by its text
 * when columns moved. Fails when a header is gone, rather than reading the wrong column.
 */
export function resolveColumns(table: readonly string[][], mapping: SheetMapping): SheetColumns {
  const header = (table[mapping.headerRow] ?? []).map(comparable);
  const find = (column: SheetColumn): number => {
    const expected = comparable(column.header);
    if (expected === '' || header[column.index] === expected) {
      return column.index;
    }
    const moved = header.indexOf(expected);
    if (moved === -1 || header.lastIndexOf(expected) !== moved) {
      throw new SheetLayoutChangedError(`Column "${column.header}" is no longer in the header row`);
    }
    return moved;
  };
  const optional = (column: SheetColumn | null) => (column ? find(column) : undefined);
  const { date, time, title, type, link } = mapping.columns;
  const columns: SheetColumns = { date: find(date), title: find(title) };
  const [timeIndex, typeIndex, linkIndex] = [optional(time), optional(type), optional(link)];
  return {
    ...columns,
    ...(timeIndex !== undefined ? { time: timeIndex } : {}),
    ...(typeIndex !== undefined ? { type: typeIndex } : {}),
    ...(linkIndex !== undefined ? { link: linkIndex } : {}),
  };
}

/** Location from the link cell's URL; its other text and a multiline title go to the description. */
function details(titleCell: string, linkCell: string): Pick<NormalizedEvent, 'description' | 'location'> {
  const url = URL_PATTERN.exec(linkCell)?.[0];
  const linkText = (url ? linkCell.replace(url, '') : linkCell)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
  const titleLines = titleCell
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const description = [titleLines.length > 1 ? titleLines.join('\n') : '', linkText].filter(Boolean).join('\n\n');
  return { ...(description ? { description } : {}), ...(url ? { location: url } : {}) };
}

type RowOutcome = { kind: 'event'; event: NormalizedEvent } | { kind: 'skipped' } | { kind: 'unparsed' };

function readRow(
  row: readonly string[],
  columns: SheetColumns,
  mapping: SheetMapping,
  timeZone: string,
): RowOutcome {
  const cell = (index: number | undefined) => (index === undefined ? '' : (row[index] ?? ''));
  const dateCell = cell(columns.date).trim();
  if (dateCell === '') {
    return { kind: 'skipped' }; // separator rows between weeks, notes
  }
  const date = parseSheetDate(dateCell, mapping.dateOrder);
  if (!date) {
    return { kind: 'unparsed' };
  }
  const titleCell = cell(columns.title);
  const title = composeTitle(cell(columns.type), titleCell);
  if (!title) {
    return { kind: 'skipped' };
  }
  const common = { title, ...details(titleCell, cell(columns.link)) };

  const timeCell = cell(columns.time).trim();
  if (timeCell === '') {
    // A dated row without a time is a deadline or a note for the day: an all-day event.
    return {
      kind: 'event',
      event: {
        ...common,
        uid: sheetEventUid(date, undefined, title),
        start: { date },
        end: { date: nextDate(date) },
        startsAt: zonedTimeToInstant(`${date}T00:00:00`, timeZone),
      },
    };
  }

  const time = parseTimeRange(timeCell);
  if (!time) {
    return { kind: 'unparsed' };
  }
  const start = `${date}T${time.start}:00`;
  let end = time.end ? `${date}T${time.end}:00` : addMinutesToLocal(start, mapping.defaultDurationMinutes);
  if (end === start) {
    end = addMinutesToLocal(start, mapping.defaultDurationMinutes);
  } else if (end < start) {
    end = `${nextDate(date)}T${time.end}:00`; // "23:00 - 01:00" ends the next day
  }
  return {
    kind: 'event',
    event: {
      ...common,
      uid: sheetEventUid(date, time.start, title),
      start: { dateTime: start, timeZone },
      end: { dateTime: end, timeZone },
      startsAt: zonedTimeToInstant(start, timeZone),
    },
  };
}

/** Reads every data row (those below the header row) into events, in sheet order. */
export function readSheet(table: readonly string[][], mapping: SheetMapping, timeZone: string): SheetReadResult {
  const columns = resolveColumns(table, mapping);
  const result: SheetReadResult = { events: [], unparsedRows: [] };
  table.forEach((row, index) => {
    if (index <= mapping.headerRow) {
      return;
    }
    const outcome = readRow(row, columns, mapping, timeZone);
    if (outcome.kind === 'event') {
      result.events.push(outcome.event);
    } else if (outcome.kind === 'unparsed') {
      result.unparsedRows.push(index + 1);
    }
  });
  return result;
}
