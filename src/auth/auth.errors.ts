import { DomainError } from '../common/errors/domain-error.js';

/** The OAuth callback carried a state that is unknown, expired or already used. */
export class InvalidOAuthStateError extends DomainError {
  readonly code = 'INVALID_OAUTH_STATE';
  readonly kind = 'invalid';
}

/** An action needs Google access, but the user has not connected it (or it was revoked). */
export class GoogleNotConnectedError extends DomainError {
  readonly code = 'GOOGLE_NOT_CONNECTED';
  readonly kind = 'forbidden';
}
