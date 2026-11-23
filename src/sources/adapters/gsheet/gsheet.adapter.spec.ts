import { HttpClient } from '@nestjs/http-client';
import {
  TEAM_SHEET_EXPORT_FILENAME,
  TEAM_SHEET_ID,
  TEAM_SHEET_MAPPING,
  TEAM_SHEET_TITLE,
  TEAM_SHEET_URL,
  teamSheetCsv,
} from '../../../../test/support/gsheet.js';
import type { SourceOptions } from '../../../db/source-options.js';
import {
  SheetNotAccessibleError,
  SourceOptionsInvalidError,
  SourceResponseInvalidError,
} from '../../sources.errors.js';
import { GoogleSheetAdapter, spreadsheetTitle } from './gsheet.adapter.js';
import type { SheetMappingService } from './gsheet-mapping.service.js';
import { parseGoogleSheetUrl } from './gsheet.url.js';

const ZONE = 'Europe/Moscow';
const EXPORT_URL = `https://docs.google.com/spreadsheets/d/${TEAM_SHEET_ID}/export?format=csv&gid=0`;
const CONTENT_URL = `https://doc-0s-10-sheets.googleusercontent.com/export/signed/${TEAM_SHEET_ID}?format=csv&gid=0`;
const OPTIONS: SourceOptions = { type: 'gsheet', version: 1, mapping: TEAM_SHEET_MAPPING };
const SOURCE = { url: TEAM_SHEET_URL, timeZone: ZONE, options: OPTIONS };
const WINDOW = { start: new Date('2026-11-16T00:00:00Z'), end: new Date('2026-11-24T00:00:00Z') };

const csvResponse = (body = teamSheetCsv()) =>
  new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="-.csv"; filename*=UTF-8''${encodeURIComponent(TEAM_SHEET_EXPORT_FILENAME)}`,
    },
  });

/** Answers like Google: the export on docs.google.com hands over to a signed content URL with `csv`. */
const googleAnswering =
  (csv = teamSheetCsv()) =>
  (url: string) =>
    url.startsWith('https://docs.google.com/')
      ? new Response(null, { status: 307, headers: { location: CONTENT_URL } })
      : csvResponse(csv);

function adapterWith(answer: (url: string) => Response = googleAnswering()) {
  const requests: string[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new Request(input).url;
    requests.push(url);
    return answer(url);
  });
  // The same options as GOOGLE_SHEETS_HTTP in SourcesModule, minus retries.
  const http = new HttpClient({ fetch, retry: false, redirect: 'error' });
  const mappings = { propose: vi.fn(async () => ({ mapping: TEAM_SHEET_MAPPING, timeZone: ZONE })) };
  return { adapter: new GoogleSheetAdapter(http, mappings as unknown as SheetMappingService), requests, mappings };
}

describe('parseGoogleSheetUrl', () => {
  it.each([
    [TEAM_SHEET_URL, { spreadsheetId: TEAM_SHEET_ID, gid: '0' }],
    [`https://docs.google.com/spreadsheets/d/${TEAM_SHEET_ID}/edit#gid=1785`, { spreadsheetId: TEAM_SHEET_ID, gid: '1785' }],
    [`https://docs.google.com/spreadsheets/u/1/d/${TEAM_SHEET_ID}/edit`, { spreadsheetId: TEAM_SHEET_ID }],
    [`https://docs.google.com/spreadsheets/d/${TEAM_SHEET_ID}`, { spreadsheetId: TEAM_SHEET_ID }],
  ])('reads %s', (url, ref) => {
    expect(parseGoogleSheetUrl(new URL(url))).toEqual(ref);
  });

  it.each([
    ['a document', `https://docs.google.com/document/d/${TEAM_SHEET_ID}/edit`],
    ['another host', `https://docs.example.com/spreadsheets/d/${TEAM_SHEET_ID}/edit`],
    ['plain http', `http://docs.google.com/spreadsheets/d/${TEAM_SHEET_ID}/edit`],
    ['a published copy', 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ/pubhtml'],
  ])('rejects %s', (_, url) => {
    expect(parseGoogleSheetUrl(new URL(url))).toBeUndefined();
  });
});

describe('spreadsheetTitle', () => {
  it('takes the spreadsheet title from the export file name', () => {
    const header = `attachment; filename="-.csv"; filename*=UTF-8''${encodeURIComponent(TEAM_SHEET_EXPORT_FILENAME)}`;

    expect(spreadsheetTitle(header)).toBe(TEAM_SHEET_TITLE);
  });

  it('gives nothing for a missing or broken header', () => {
    expect(spreadsheetTitle(null)).toBeUndefined();
    expect(spreadsheetTitle("attachment; filename*=UTF-8''%E0%A4%A.csv")).toBeUndefined();
  });
});

describe('GoogleSheetAdapter', () => {
  it('recognizes a sheet link', () => {
    expect(adapterWith().adapter.recognize(new URL(TEAM_SHEET_URL))).toMatchObject({ type: 'gsheet' });
  });

  it('exports the sheet from docs.google.com by id and gid and follows the hand-over to the content host', async () => {
    const { adapter, requests, mappings } = adapterWith();

    const { events, skipped } = await adapter.fetch(SOURCE, WINDOW);

    expect(requests).toEqual([EXPORT_URL, CONTENT_URL]);
    expect(skipped).toEqual([]);
    expect(mappings.propose).not.toHaveBeenCalled();
    expect(events.map((event) => `${event.startsAt.toISOString()} ${event.title}`)).toEqual([
      '2026-11-16T17:30:00.000Z [Созвон командный с Ксенией] ДокПоток созвон с Ксенией',
      '2026-11-17T12:00:00.000Z [ВОЕНМЕХ АКСЕЛЬ] Капитализация бренда стартапа. Роль контент-маркетинга в PR-стратегии',
      '2026-11-17T16:00:00.000Z [МГУ АКСЕЛЬ] Построение воронки продаж (B2B, B2C, B2G)',
      '2026-11-17T18:00:00.000Z [ФИЗТЕХИДЕЯ АКСЕЛЬ] Встреча с трекером Пётр Петров',
      '2026-11-18T16:00:00.000Z [МГУ АКСЕЛЬ] Как презентовать себя инвесторам, корпорациям, партнерам. Публичные выступления: как держать себя на сцене. Особенности содержания и формы инвестиционной презентации. Тренинг по публичным выступлениям с инвестиционной презентацией',
      '2026-11-19T10:30:00.000Z ВОЕНМЕХ АКСЕЛЬ',
      '2026-11-19T14:20:00.000Z [МГУ АКСЕЛЬ] Встреча с трекером Иван Иванов',
      '2026-11-19T16:00:00.000Z [МГУ АКСЕЛЬ] PR в стартапе. Как использовать контент для своего продвижения. Формирование бренда стартапа. От стратегии к тактике',
      '2026-11-20T10:00:00.000Z [СТАРТАП-ПОЛИГОН ТУСУР Томск] Встреча с трекером Сидор Сидоров',
      '2026-11-20T12:00:00.000Z [ВОЕНМЕХ АКСЕЛЬ] Финансовая модель стартапа и зачем инвестору «кэш-берны»',
      '2026-11-21T13:45:00.000Z [ФИЗТЕХИДЕЯ АКСЕЛЬ] Финальная питч сессия',
      '2026-11-22T16:00:00.000Z Созвон командный',
      '2026-11-23T17:30:00.000Z [Созвон командный с Ксенией] ДокПоток созвон с Ксенией',
    ]);
  });

  it('inspects a new sheet: its title, the proposed mapping and zone', async () => {
    const { adapter, mappings } = adapterWith();

    const inspection = await adapter.inspect(TEAM_SHEET_URL);

    expect(inspection).toEqual({ name: TEAM_SHEET_TITLE, timeZone: ZONE, options: OPTIONS });
    expect(mappings.propose).toHaveBeenCalledTimes(1);
  });

  it('reads a mapping stored with the old rowsWithoutTime rule and still adds all-day rows', async () => {
    const { adapter } = adapterWith();
    const stored = { ...OPTIONS, mapping: { ...TEAM_SHEET_MAPPING, rowsWithoutTime: 'skip' } } as SourceOptions;
    const december = { start: new Date('2026-12-01T00:00:00Z'), end: new Date('2027-01-01T00:00:00Z') };

    const { events } = await adapter.fetch({ ...SOURCE, options: stored }, december);

    expect(events.at(-1)).toMatchObject({ start: { date: '2026-12-31' }, end: { date: '2027-01-01' } });
  });

  it('reports unreadable rows even when they are outside the window', async () => {
    const { adapter } = adapterWith(googleAnswering(`${teamSheetCsv()}\r\n01.09.2026,когда-нибудь,МГУ АКСЕЛЬ,Старая встреча,`));

    const { skipped } = await adapter.fetch(SOURCE, WINDOW);

    expect(skipped).toEqual([{ key: expect.any(String), row: 192, text: '01.09.2026 · когда-нибудь · МГУ АКСЕЛЬ · Старая встреча' }]);
  });

  it('treats a hand-over to the sign-in page as a sheet that is not shared', async () => {
    const { adapter, requests } = adapterWith(
      () => new Response(null, { status: 302, headers: { location: 'https://accounts.google.com/ServiceLogin?continue=x' } }),
    );

    await expect(adapter.fetch(SOURCE, WINDOW)).rejects.toBeInstanceOf(SheetNotAccessibleError);
    expect(requests).toEqual([EXPORT_URL]);
  });

  it('treats 404 as a sheet that is not shared', async () => {
    const { adapter } = adapterWith(() => new Response('<html></html>', { status: 404, headers: { 'content-type': 'text/html' } }));

    await expect(adapter.fetch(SOURCE, WINDOW)).rejects.toBeInstanceOf(SheetNotAccessibleError);
  });

  it('rejects an answer that is not CSV', async () => {
    const { adapter } = adapterWith(() => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }));

    await expect(adapter.fetch(SOURCE, WINDOW)).rejects.toBeInstanceOf(SourceResponseInvalidError);
  });

  it('refuses to sync without a valid stored mapping, before any request', async () => {
    const { adapter, requests } = adapterWith();
    const broken = { type: 'gsheet', version: 1, mapping: { headerRow: 0 } } as unknown as SourceOptions;

    await expect(adapter.fetch({ ...SOURCE, options: null }, WINDOW)).rejects.toBeInstanceOf(SourceOptionsInvalidError);
    await expect(adapter.fetch({ ...SOURCE, options: broken }, WINDOW)).rejects.toBeInstanceOf(SourceOptionsInvalidError);
    expect(requests).toEqual([]);
  });
});
