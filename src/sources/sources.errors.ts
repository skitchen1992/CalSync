import { DomainError } from '../common/errors/domain-error.js';

export class UnsupportedSourceUrlError extends DomainError {
  readonly code = 'UNSUPPORTED_SOURCE_URL';
  readonly kind = 'invalid';
}

export class SourceNotFoundError extends DomainError {
  readonly code = 'SOURCE_NOT_FOUND';
  readonly kind = 'not_found';
}

/** The source could not be fetched (network, timeout, an error answer). */
export class SourceUnavailableError extends DomainError {
  readonly code = 'SOURCE_UNAVAILABLE';
  readonly kind = 'unavailable';
}

/** The source answered, but not in the shape the adapter expects (an unofficial API changed). */
export class SourceResponseInvalidError extends DomainError {
  readonly code = 'SOURCE_RESPONSE_INVALID';
  readonly kind = 'unavailable';
}

/** The stored `sources.options` do not match what the adapter expects (see sourceOptionsSchema). */
export class SourceOptionsInvalidError extends DomainError {
  readonly code = 'SOURCE_OPTIONS_INVALID';
  readonly kind = 'invalid';
}

/** Google answered that the spreadsheet or its sheet cannot be read without signing in. */
export class SheetNotAccessibleError extends DomainError {
  readonly code = 'SHEET_NOT_ACCESSIBLE';
  readonly kind = 'forbidden';
}

/** A column of the confirmed mapping is no longer in the sheet's header row. */
export class SheetLayoutChangedError extends DomainError {
  readonly code = 'SHEET_LAYOUT_CHANGED';
  readonly kind = 'conflict';
}

/** The sheet has no header and data rows to read. */
export class SheetEmptyError extends DomainError {
  readonly code = 'SHEET_EMPTY';
  readonly kind = 'invalid';
}
