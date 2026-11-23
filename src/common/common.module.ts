import { Global, Module } from '@nestjs/common';
import { Clock, SystemClock } from './clock/clock.js';
import { CryptoService } from './crypto/crypto.service.js';

/** Feature-agnostic infrastructure that almost every module needs. */
@Global()
@Module({
  providers: [{ provide: Clock, useClass: SystemClock }, CryptoService],
  exports: [Clock, CryptoService],
})
export class CommonModule {}
