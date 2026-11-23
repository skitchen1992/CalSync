import { Injectable, Logger } from '@nestjs/common';
import { HttpClient, HttpClientError, type HttpResponse, InjectHttpClient } from '@nestjs/http-client';
import { type GoogleSheetOptions, sourceOptionsSchema } from '../../../db/source-options.js';
import type {
  NormalizedEvent,
  RecognizedSource,
  SourceAdapter,
  SourceInspection,
  SourceTarget,
  SyncWindow,
} from '../../source.types.js';
import {
  SheetNotAccessibleError,
  SourceOptionsInvalidError,
  SourceResponseInvalidError,
  SourceUnavailableError,
  UnsupportedSourceUrlError,
} from '../../sources.errors.js';
import { parseCsv } from './gsheet-csv.js';
import { SheetMappingService } from './gsheet-mapping.service.js';
import { readSheet } from './gsheet-rows.js';
import { type GoogleSheetRef, parseGoogleSheetUrl } from './gsheet.url.js';

export const GOOGLE_SHEETS_HTTP = 'google-sheets';

const SHEETS_ORIGIN = 'https://docs.google.com';
/** docs.google.com hands the export over to a signed URL on this host. */
const EXPORT_CONTENT_HOST = /^[a-z0-9-]+\.googleusercontent\.com$/;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
/** Statuses that mean "not shared by link" or "no such sheet" rather than an outage. */
const NOT_ACCESSIBLE = new Set([400, 401, 403, 404]);
const UNTITLED = 'Google Таблица';
const DEFAULT_TIME_ZONE = 'Europe/Moscow';

interface DownloadedSheet {
  table: string[][];
  /** Spreadsheet title, from the export's file name ("<spreadsheet> - <sheet>.csv"). */
  title: string | undefined;
}

/** "Расписание команды - Расписание.csv" → "Расписание команды" (the sheet name comes last). */
export function spreadsheetTitle(contentDisposition: string | null): string | undefined {
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition ?? '')?.[1];
  if (!encoded) {
    return undefined;
  }
  let fileName: string;
  try {
    fileName = decodeURIComponent(encoded.trim()).replace(/\.csv$/i, '');
  } catch {
    return undefined; // malformed percent-encoding: no title rather than a failed sync
  }
  const separator = fileName.lastIndexOf(' - ');
  const title = (separator > 0 ? fileName.slice(0, separator) : fileName).trim();
  return title === '' ? undefined : title;
}

/**
 * Public Google Sheets (shared "anyone with the link"), read without authorization through the
 * CSV export of one sheet. The export is always requested from docs.google.com by spreadsheet id;
 * the only redirect followed is Google's hand-over to a signed *.googleusercontent.com URL.
 */
@Injectable()
export class GoogleSheetAdapter implements SourceAdapter {
  readonly type = 'gsheet';
  private readonly logger = new Logger(GoogleSheetAdapter.name);

  constructor(
    @InjectHttpClient(GOOGLE_SHEETS_HTTP) private readonly http: HttpClient,
    private readonly mappings: SheetMappingService,
  ) {}

  recognize(url: URL): RecognizedSource | undefined {
    return parseGoogleSheetUrl(url) && { type: this.type, name: UNTITLED, timeZone: DEFAULT_TIME_ZONE };
  }

  /** Downloads the sheet and asks the language model for its column mapping (once per added sheet). */
  async inspect(url: string, signal?: AbortSignal): Promise<SourceInspection> {
    const sheet = await this.download(this.sheetRef(url), signal);
    const { mapping, timeZone } = await this.mappings.propose(sheet.table, signal);
    return {
      name: sheet.title ?? UNTITLED,
      timeZone,
      options: { type: 'gsheet', version: 1, mapping },
      unparsedRows: readSheet(sheet.table, mapping, timeZone).unparsedRows,
    };
  }

  async fetch(source: SourceTarget, window: SyncWindow, signal?: AbortSignal): Promise<NormalizedEvent[]> {
    const { mapping } = this.parseOptions(source.options);
    const sheet = await this.download(this.sheetRef(source.url), signal);
    const { events, unparsedRows } = readSheet(sheet.table, mapping, source.timeZone);
    if (unparsedRows.length > 0) {
      this.logger.debug('Sheet rows left out', { count: unparsedRows.length });
    }
    return events
      .filter((event) => event.startsAt >= window.start && event.startsAt < window.end)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  }

  private sheetRef(url: string): GoogleSheetRef {
    const ref = parseGoogleSheetUrl(new URL(url));
    if (!ref) {
      throw new UnsupportedSourceUrlError('Not a Google Sheets link');
    }
    return ref;
  }

  private parseOptions(options: SourceTarget['options']): GoogleSheetOptions {
    const parsed = sourceOptionsSchema.safeParse(options);
    if (!parsed.success || parsed.data.type !== 'gsheet') {
      throw new SourceOptionsInvalidError(
        'The stored sheet mapping is missing or invalid',
        parsed.success ? undefined : { cause: parsed.error },
      );
    }
    return parsed.data;
  }

  private async download(ref: GoogleSheetRef, signal?: AbortSignal): Promise<DownloadedSheet> {
    const exportUrl = new URL(`/spreadsheets/d/${ref.spreadsheetId}/export`, SHEETS_ORIGIN);
    exportUrl.searchParams.set('format', 'csv');
    if (ref.gid) {
      exportUrl.searchParams.set('gid', ref.gid);
    }

    let response = await this.get(exportUrl, 'manual', signal);
    if (REDIRECTS.has(response.status)) {
      const location = response.headers.get('location');
      const next = location ? new URL(location, exportUrl) : undefined;
      if (!next || next.protocol !== 'https:' || !EXPORT_CONTENT_HOST.test(next.hostname)) {
        // A private sheet sends anonymous readers to the sign-in page.
        throw new SheetNotAccessibleError('Google redirected the export away from the content host');
      }
      response = await this.get(next, 'error', signal);
    }
    if (NOT_ACCESSIBLE.has(response.status)) {
      throw new SheetNotAccessibleError(`Google Sheets answered ${response.status} to the export`);
    }
    if (!response.ok) {
      throw new SourceUnavailableError(`Google Sheets answered ${response.status} to the export`);
    }
    if (!(response.headers.get('content-type') ?? '').startsWith('text/csv')) {
      throw new SourceResponseInvalidError('Google Sheets did not answer with CSV');
    }
    return { table: parseCsv(response.data), title: spreadsheetTitle(response.headers.get('content-disposition')) };
  }

  private async get(url: URL, redirect: 'manual' | 'error', signal?: AbortSignal): Promise<HttpResponse<string>> {
    try {
      return await this.http.get<string>(url.href, {
        redirect,
        responseType: 'text',
        throwOnHttpError: false,
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (error instanceof HttpClientError) {
        throw new SourceUnavailableError('Google Sheets is unavailable', { cause: error });
      }
      throw error;
    }
  }
}
