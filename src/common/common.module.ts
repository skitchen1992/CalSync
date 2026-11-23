import { Global, Module } from '@nestjs/common';
import { Clock, SystemClock } from './clock/clock.js';

/** Feature-agnostic infrastructure that almost every module needs. */
@Global()
@Module({
  providers: [{ provide: Clock, useClass: SystemClock }],
  exports: [Clock],
})
export class CommonModule {}
