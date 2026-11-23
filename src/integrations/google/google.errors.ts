import { CircuitOpenError } from '@nestjs/resilience';
import { DomainError } from '../../common/errors/domain-error.js';

/** The user revoked access, or the refresh token expired: they must connect Google again. */
export class GoogleAuthRevokedError extends DomainError {
  readonly code = 'GOOGLE_AUTH_REVOKED';
  readonly kind = 'forbidden';
}

/** The OAuth exchange did not return what CalSync needs (refresh token, calendar scope). */
export class GoogleAuthorizationIncompleteError extends DomainError {
  readonly code = 'GOOGLE_AUTHORIZATION_INCOMPLETE';
  readonly kind = 'invalid';
}

/** Google answered with an error CalSync cannot handle, or could not be reached. */
export class GoogleApiError extends DomainError {
  readonly code = 'GOOGLE_API_ERROR';
  readonly kind = 'unavailable';
}

const RATE_LIMIT_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded']);

interface GaxiosLikeError {
  status?: number;
  response?: { status?: number; data?: unknown };
}

const asGaxios = (error: unknown): GaxiosLikeError | undefined =>
  typeof error === 'object' && error !== null ? (error as GaxiosLikeError) : undefined;

/** HTTP status of a Google API error, if it has one. */
export function googleErrorStatus(error: unknown): number | undefined {
  const gaxios = asGaxios(error);
  return gaxios?.status ?? gaxios?.response?.status;
}

/** `invalid_grant` from the token endpoint: the refresh token no longer works. */
function isInvalidGrant(error: unknown): boolean {
  const data = asGaxios(error)?.response?.data;
  return typeof data === 'object' && data !== null && (data as { error?: unknown }).error === 'invalid_grant';
}

function rateLimitReason(error: unknown): boolean {
  const data = asGaxios(error)?.response?.data as { error?: { errors?: { reason?: string }[] } } | undefined;
  return data?.error?.errors?.some((item) => item.reason !== undefined && RATE_LIMIT_REASONS.has(item.reason)) ?? false;
}

/**
 * Retry condition for the `google` resilience preset: rate limits (429, or 403 with a rate-limit
 * reason), server errors and network failures. Other client errors are final.
 */
export function isRetryableGoogleError(error: unknown): boolean {
  if (isInvalidGrant(error)) {
    return false;
  }
  const status = googleErrorStatus(error);
  if (status === undefined) {
    return true; // network failure, timeout
  }
  return status === 429 || status >= 500 || (status === 403 && rateLimitReason(error));
}

/**
 * Translates a failed Google call into a domain error, keeping the original as `cause`.
 * An open circuit stays a CircuitOpenError: the sync stops the whole run on it (see 105).
 */
export function translateGoogleError(error: unknown, operation: string): Error {
  if (error instanceof DomainError || error instanceof CircuitOpenError) {
    return error;
  }
  if (isInvalidGrant(error) || googleErrorStatus(error) === 401) {
    return new GoogleAuthRevokedError('Google access was revoked or expired', { cause: error });
  }
  const status = googleErrorStatus(error);
  return new GoogleApiError(`Google ${operation} failed${status ? ` with ${status}` : ''}`, { cause: error });
}
