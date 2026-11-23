import { Clock } from '../../src/common/clock/clock.js';

/** A clock that always answers the same instant. */
export class FixedClock extends Clock {
  constructor(private readonly instant: Date) {
    super();
  }

  now(): Date {
    return new Date(this.instant);
  }
}
