const SHEETS_HOST = 'docs.google.com';
/** /spreadsheets/d/<id>/edit, also with an account prefix: /spreadsheets/u/1/d/<id>/… */
const SHEET_PATH = /^\/spreadsheets(?:\/u\/\d+)?\/d\/([\w-]{20,})(?:\/|$)/;
const GID = /^\d+$/;

export interface GoogleSheetRef {
  spreadsheetId: string;
  /** The sheet (tab) id; without it Google exports the first sheet. */
  gid?: string;
}

/**
 * Reads a Google Sheets link (https://docs.google.com/spreadsheets/d/<id>/edit?gid=0#gid=0).
 * Only the ids are used: the export is always requested from the fixed docs.google.com host,
 * never from the URL the user sent.
 */
export function parseGoogleSheetUrl(url: URL): GoogleSheetRef | undefined {
  if (url.protocol !== 'https:' || url.hostname !== SHEETS_HOST) {
    return undefined;
  }
  const spreadsheetId = SHEET_PATH.exec(url.pathname)?.[1];
  if (!spreadsheetId) {
    return undefined;
  }
  const gid = url.searchParams.get('gid') ?? new URLSearchParams(url.hash.slice(1)).get('gid');
  return gid && GID.test(gid) ? { spreadsheetId, gid } : { spreadsheetId };
}
