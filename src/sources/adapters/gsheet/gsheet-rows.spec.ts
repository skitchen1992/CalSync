import { TEAM_SHEET_MAPPING, teamSheetCsv } from '../../../../test/support/gsheet.js';
import { SheetLayoutChangedError } from '../../sources.errors.js';
import { parseCsv } from './gsheet-csv.js';
import {
  composeTitle,
  parseSheetDate,
  parseTimeRange,
  readSheet,
  sheetEventUid,
} from './gsheet-rows.js';

const ZONE = 'Europe/Moscow';
/** sheetEventUid('2026-09-18', '15:00', '[ВОЕНМЕХ АКСЕЛЬ] Лекция: …') */
const FIRST_EVENT_UID = '2026-09-18T15:00#JnZ_OkSPHwJNHfGs';
/** Data rows of the fixture: 190 rows below the header, 17 of them empty week separators. */
const FIXTURE_EVENT_COUNT = 173;

const table = () => parseCsv(teamSheetCsv());
const read = (rows = table(), mapping = TEAM_SHEET_MAPPING) => readSheet(rows, mapping, ZONE);
const eventOn = (date: string, titlePart: string) => {
  const event = read().events.find((candidate) => {
    const start = 'date' in candidate.start ? candidate.start.date : candidate.start.dateTime;
    return start.startsWith(date) && candidate.title.includes(titlePart);
  });
  expect(event, `${date} ${titlePart}`).toBeDefined();
  return event!;
};

describe('parseCsv', () => {
  it('reads the export: CRLF rows, quoted multiline cells, doubled quotes', () => {
    const rows = table();

    expect(rows).toHaveLength(191);
    expect(rows[0]).toEqual([
      'Дата',
      'Время',
      'Тип события',
      'Название события',
      'Ссылка',
      'Ответственный',
      'Комментарий',
      '',
      '',
      '',
      '',
      'ID синхронизации',
    ]);
    expect(rows.every((row) => row.length === 12)).toBe(true);
    expect(rows[106]![3]).toMatch(/^"Интеллектуальная собственность/);
    expect(rows[55]![3]).toContain('\n14:05 - 14:25');
  });

  it('handles LF line ends, a byte order mark and a trailing line break', () => {
    expect(parseCsv('﻿a,"b\nc"\nd,e\n')).toEqual([
      ['a', 'b\nc'],
      ['d', 'e'],
    ]);
  });
});

describe('parseSheetDate', () => {
  it.each([
    ['18.09.2026 ПТ', 'DMY', '2026-09-18'],
    ['03.10.2026', 'DMY', '2026-10-03'],
    ['21/11/2026 СБ', 'DMY', '2026-11-21'],
    ['18.09.26', 'DMY', '2026-09-18'],
    ['09/18/2026', 'MDY', '2026-09-18'],
    ['2026-09-18', 'YMD', '2026-09-18'],
  ] as const)('reads %s as %s', (cell, order, date) => {
    expect(parseSheetDate(cell, order)).toBe(date);
  });

  it.each(['31.02.2026', '18.09', 'ПТ', '', '123.09.2026'])('rejects %j', (cell) => {
    expect(parseSheetDate(cell, 'DMY')).toBeUndefined();
  });
});

describe('parseTimeRange', () => {
  it.each([
    ['15:00 - 16:30', { start: '15:00', end: '16:30' }],
    ['18:30-20:00', { start: '18:30', end: '20:00' }],
    ['20:30 - 21:30 ', { start: '20:30', end: '21:30' }],
    ['9:00 - 9:40', { start: '09:00', end: '09:40' }],
    ['15:00 – 16:30', { start: '15:00', end: '16:30' }],
    ['15.00-16.30', { start: '15:00', end: '16:30' }],
    ['15:30 - ?', { start: '15:30' }],
    ['11:00', { start: '11:00' }],
  ])('reads %j', (cell, range) => {
    expect(parseTimeRange(cell)).toEqual(range);
  });

  it.each(['25:00', '15:00 - 16', 'вечером', '15:00 - 16:30 - 17:00'])('rejects %j', (cell) => {
    expect(parseTimeRange(cell)).toBeUndefined();
  });
});

describe('composeTitle', () => {
  it('puts the type in front of the title', () => {
    expect(composeTitle('МГУ АКСЕЛЬ', 'Fail Conf')).toBe('[МГУ АКСЕЛЬ] Fail Conf');
  });

  it('titles a row that has only a type by the type', () => {
    expect(composeTitle('Созвон командный ', '')).toBe('Созвон командный');
  });

  it('adds no prefix when the title already names the type', () => {
    expect(composeTitle('МГТУ им.Баумана Венчурные игры', 'МГТУ им.Баумана Венчурные игры')).toBe(
      'МГТУ им.Баумана Венчурные игры',
    );
  });

  it('joins a multiline title into one line', () => {
    expect(composeTitle('', 'В 13:00 - Семинар:\nВ 14:00 - Практикум:\n')).toBe('В 13:00 - Семинар: В 14:00 - Практикум:');
  });

  it('gives nothing for an empty row', () => {
    expect(composeTitle(' ', '')).toBeUndefined();
  });
});

describe('sheetEventUid', () => {
  const title = '[ВОЕНМЕХ АКСЕЛЬ] Лекция: технологическое предпринимательство: введение в стартап-среду';

  it('is derived from date, start and title', () => {
    expect(sheetEventUid('2026-09-18', '15:00', title)).toBe(FIRST_EVENT_UID);
  });

  it('ignores case and spacing of the title', () => {
    expect(sheetEventUid('2026-09-18', '15:00', `  ${title.toUpperCase().replace(/ /g, '  ')}`)).toBe(FIRST_EVENT_UID);
  });

  it('changes with the start time', () => {
    expect(sheetEventUid('2026-09-18', '15:30', title)).not.toBe(FIRST_EVENT_UID);
  });
});

describe('readSheet', () => {
  it('reads every dated row of the team sheet and skips the week separators', () => {
    const { events, skipped } = read();

    expect(events).toHaveLength(FIXTURE_EVENT_COUNT);
    expect(skipped).toEqual([]);
    expect(new Set(events.map((event) => event.uid)).size).toBe(FIXTURE_EVENT_COUNT);
  });

  it('maps a regular row: type prefix, Moscow times, the link as location', () => {
    expect(read().events[0]).toEqual({
      uid: FIRST_EVENT_UID,
      title: '[ВОЕНМЕХ АКСЕЛЬ] Лекция: технологическое предпринимательство: введение в стартап-среду',
      location: 'https://meet.example.com/d0d92b6044',
      start: { dateTime: '2026-09-18T15:00:00', timeZone: ZONE },
      end: { dateTime: '2026-09-18T16:30:00', timeZone: ZONE },
      startsAt: new Date('2026-09-18T12:00:00Z'),
    });
  });

  it('gives an open end ("15:30 - ?") the default duration and keeps non-link text as description', () => {
    expect(eventOn('2026-09-28T15:30', 'Венчурные игры')).toMatchObject({
      title: 'МГТУ им.Баумана Венчурные игры',
      end: { dateTime: '2026-09-28T16:30:00' },
      description: 'ОЧНО',
    });
  });

  it('reads a range without spaces and a lone start time', () => {
    expect(eventOn('2026-10-01T18:30', 'Методология').end).toEqual({ dateTime: '2026-10-01T20:00:00', timeZone: ZONE });
    expect(eventOn('2026-10-03T11:00', 'Анализ рынка').end).toEqual({ dateTime: '2026-10-03T12:00:00', timeZone: ZONE });
  });

  it('reads a slash-separated date', () => {
    expect(eventOn('2026-11-21T16:45', 'Финальная питч сессия')).toBeDefined();
  });

  it('makes a dated row without time an all-day event', () => {
    expect(eventOn('2026-11-01', 'ДДЛ подачи заявки')).toMatchObject({
      title: 'ДДЛ подачи заявки на научного консультанта',
      start: { date: '2026-11-01' },
      end: { date: '2026-11-02' },
      startsAt: new Date('2026-10-31T21:00:00Z'),
    });
  });

  it('joins a multiline title and keeps its lines in the description', () => {
    const event = eventOn('2026-10-10T12:00', 'Экспертная сессия');

    expect(event.title).toBe(
      '[МГУ АКСЕЛЬ] Экспертная сессия: 12:20 - 12:40 Кузнецов Кузьма 14:05 - 14:25 Павлов Павел 14:25 - 14:45 Юрист 14:45 - 15:02 Фёдорова Фаина',
    );
    expect(event.description?.split('\n')).toHaveLength(4);
  });

  it('makes every dated row without time an all-day event', () => {
    const allDay = read().events.filter((event) => 'date' in event.start);

    expect(allDay.map((event) => [event.start, event.title])).toEqual([
      [{ date: '2026-09-26' }, 'МГУ АКСЕЛЬ'],
      [{ date: '2026-11-01' }, 'ДДЛ подачи заявки на научного консультанта'],
      [{ date: '2026-11-02' }, 'Открывается запись в экспертную трубу'],
      [{ date: '2026-12-31' }, 'МЫ ВЫЖИЛИ! УРА! (дай бог, дай бог) :D счастья, здоровья, удачи'],
    ]);
  });

  it('keeps uids when rows move', () => {
    const rows = table();
    const withoutSeparators = rows.filter((row) => row.some((cell) => cell.trim() !== ''));

    expect(read(withoutSeparators).events.map((event) => event.uid)).toEqual(read(rows).events.map((event) => event.uid));
  });

  it('reports rows whose date or time cannot be read, with the text the user wrote', () => {
    const rows = table();
    rows.push(['32.13.2026', '10:00', 'Тип', 'Плохая дата', ''], ['01.12.2026', 'утром', 'Тип', 'Плохое\nвремя', '']);

    expect(read(rows).skipped).toEqual([
      { key: expect.any(String), row: 192, text: '32.13.2026 · 10:00 · Тип · Плохая дата' },
      { key: expect.any(String), row: 193, text: '01.12.2026 · утром · Тип · Плохое время' },
    ]);
  });

  it('keeps the key of a broken row when rows above it change, and changes it when the row is edited', () => {
    const broken = ['32.13.2026', '10:00', 'Тип', 'Плохая дата', ''];
    const keyOf = (rows: string[][]) => read(rows).skipped[0]!.key;
    const original = [...table(), broken];

    expect(keyOf([...table().slice(0, 50), ...table().slice(60), broken])).toBe(keyOf(original));
    expect(keyOf([...table(), ['32.13.2026', '11:00', 'Тип', 'Плохая дата', '']])).not.toBe(keyOf(original));
  });

  it('follows a column that moved', () => {
    const shifted = table().map((row, index) => [index === 0 ? 'Новая колонка' : 'x', ...row]);

    expect(read(shifted).events[0]!.title).toBe(read().events[0]!.title);
  });

  it('fails when a mapped column is gone instead of reading the wrong one', () => {
    const renamed = table();
    renamed[0]![1] = 'Когда';

    expect(() => read(renamed)).toThrow(SheetLayoutChangedError);
  });
});
