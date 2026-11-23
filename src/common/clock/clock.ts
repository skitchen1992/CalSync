import { Injectable } from '@nestjs/common';

/**
 * Source of the current time. Services inject `Clock` instead of calling `new Date()`, so tests
 * can pin "now" (sync windows, due sources, backoff).
 */
export abstract class Clock {
  abstract now(): Date;
}

@Injectable()
export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}
