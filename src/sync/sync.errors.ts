import { DomainError } from '../common/errors/domain-error.js';

/** The source returned nothing where many events were mirrored: likely a broken fetch, not a wipe. */
export class SuspiciousSnapshotError extends DomainError {
  readonly code = 'SUSPICIOUS_EMPTY_SNAPSHOT';
  readonly kind = 'unavailable';
}
