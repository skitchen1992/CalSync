import { TEAM_SHEET_EXPORT_FILENAME, teamSheetCsv } from '../support/gsheet.js';

/**
 * Stands in for Google Sheets behind the real GoogleSheetAdapter: answers the CSV export the way
 * Google does (docs.google.com hands over to a signed *.googleusercontent.com URL) with the team
 * sheet fixture. Any other request fails the test.
 */
export class FakeGoogleSheets {
  csv = teamSheetCsv();
  fileName = TEAM_SHEET_EXPORT_FILENAME;
  /** When set, the export answers with this status instead (404: the sheet is not shared). */
  status: number | undefined;
  readonly requests: string[] = [];

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(new Request(input, init).url);
    this.requests.push(url.href);
    if (url.hostname === 'docs.google.com' && url.pathname.endsWith('/export')) {
      if (this.status !== undefined) {
        return new Response('<html></html>', { status: this.status, headers: { 'content-type': 'text/html' } });
      }
      const location = `https://doc-0s-10-sheets.googleusercontent.com/export/signed${url.pathname}${url.search}`;
      return new Response(null, { status: 307, headers: { location } });
    }
    if (url.hostname.endsWith('.googleusercontent.com')) {
      return new Response(this.csv, {
        status: 200,
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="-.csv"; filename*=UTF-8''${encodeURIComponent(this.fileName)}`,
        },
      });
    }
    throw new Error(`Unexpected request to ${url.origin}`);
  };

  /** Export requests made so far (each fetch of the sheet makes one). */
  get exportCount(): number {
    return this.requests.filter((url) => url.startsWith('https://docs.google.com/')).length;
  }
}
