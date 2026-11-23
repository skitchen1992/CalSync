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
