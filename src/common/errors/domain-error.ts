/**
 * What went wrong, independent of transport. HTTP maps it to a status (DomainErrorFilter),
 * the bot maps it to a user message, jobs record it on the source.
 */
export type DomainErrorKind = 'invalid' | 'not_found' | 'conflict' | 'forbidden' | 'unavailable';

/**
 * Base class for errors that services and integrations throw. Subclasses declare a stable
 * `code` and a `kind`, and wrap the original failure in `cause`:
 *
 *   export class SourceUnavailableError extends DomainError {
 *     readonly code = 'SOURCE_UNAVAILABLE';
 *     readonly kind = 'unavailable';
 *   }
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly kind: DomainErrorKind;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}
