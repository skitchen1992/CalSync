import type { SheetMapping } from '../../src/db/source-options.js';
import { loadTextFixture } from './fixtures.js';

// The team schedule sheet: test/fixtures/gsheet/schedule.csv is its real CSV export (sheet
// "Расписание" of "Расписание команды", captured 2026-11-23), scrubbed: meeting and registration
// links point to example.com, people's names are fictional, the "Ответственный" and "Комментарий"
// cells hold placeholders. The spreadsheet id is made up; never commit the real one.

export const TEAM_SHEET_ID = '1TeamScheduleFixture-0000000000000000000000';
export const TEAM_SHEET_URL = `https://docs.google.com/spreadsheets/d/${TEAM_SHEET_ID}/edit?gid=0#gid=0`;
export const TEAM_SHEET_TITLE = 'Расписание команды';
/** How Google names the export: "<spreadsheet> - <sheet>.csv". */
export const TEAM_SHEET_EXPORT_FILENAME = 'Расписание команды - Расписание.csv';

export const teamSheetCsv = () => loadTextFixture('gsheet/schedule.csv');

/** The mapping a person would confirm for the team sheet. */
export const TEAM_SHEET_MAPPING: SheetMapping = {
  headerRow: 0,
  columns: {
    date: { index: 0, header: 'Дата' },
    time: { index: 1, header: 'Время' },
    type: { index: 2, header: 'Тип события' },
    title: { index: 3, header: 'Название события' },
    link: { index: 4, header: 'Ссылка' },
  },
  dateOrder: 'DMY',
  defaultDurationMinutes: 60,
};

/** What the language model is expected to answer for the team sheet (see gsheet-mapping.prompts.ts). */
export const TEAM_SHEET_LLM_ANSWER = {
  headerRow: 0,
  columns: { date: 0, time: 1, type: 2, title: 3, link: 4 },
  dateOrder: 'DMY',
  defaultDurationMinutes: 60,
  timeZone: 'Europe/Moscow',
};
