import { DomainError } from '../../common/errors/domain-error.js';

/** The model answered twice (once more after being told what was wrong) with an invalid object. */
export class LlmOutputInvalidError extends DomainError {
  readonly code = 'LLM_OUTPUT_INVALID';
  readonly kind = 'unavailable';
}

/** DeepSeek could not be reached or kept failing after the module's retries. */
export class LlmUnavailableError extends DomainError {
  readonly code = 'LLM_UNAVAILABLE';
  readonly kind = 'unavailable';
}
