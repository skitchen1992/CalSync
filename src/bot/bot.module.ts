import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SourcesModule } from '../sources/sources.module.js';
import { SyncModule } from '../sync/sync.module.js';
import { BotRunner } from './bot.runner.js';
import { BotUpdates } from './bot.updates.js';

@Module({
  imports: [AuthModule, SourcesModule, SyncModule],
  providers: [BotUpdates, BotRunner],
})
export class BotModule {}
