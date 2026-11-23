import { inspect } from 'node:util';

/** Narrows a caught value to an Error so that its stack and cause can be logged. */
export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(inspect(value));
}
