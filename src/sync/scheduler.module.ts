import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SyncDispatcherJob } from './sync-dispatcher.job.js';
import { SyncModule } from './sync.module.js';

/** Scheduled jobs. Loaded only when SYNC_SCHEDULER_ENABLED is not "false" (see AppModule). */
@Module({
  imports: [ScheduleModule.forRoot(), SyncModule],
  providers: [SyncDispatcherJob],
})
export class SchedulerModule {}
