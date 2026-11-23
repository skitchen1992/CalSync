import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { GoogleModule } from '../integrations/google/google.module.js';
import { SourcesModule } from '../sources/sources.module.js';
import { EventLinksRepository } from './event-links.repository.js';
import { SyncService } from './sync.service.js';

@Module({
  imports: [SourcesModule, AuthModule, GoogleModule],
  providers: [SyncService, EventLinksRepository],
  exports: [SyncService],
})
export class SyncModule {}
