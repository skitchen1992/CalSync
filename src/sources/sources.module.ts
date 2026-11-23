import { Module } from '@nestjs/common';
import { HttpClientModule } from '@nestjs/http-client';
import { AuthModule } from '../auth/auth.module.js';
import { GoogleModule } from '../integrations/google/google.module.js';
import { YANDEX_CALENDAR_HTTP, YandexEmbedAdapter } from './adapters/yandex-embed/yandex-embed.adapter.js';
import { SOURCE_ADAPTERS, SourceAdapterRegistry } from './source-adapter.registry.js';
import type { SourceAdapter } from './source.types.js';
import { SourcesRepository } from './sources.repository.js';
import { SourcesService } from './sources.service.js';

@Module({
  imports: [
    AuthModule,
    GoogleModule,
    HttpClientModule.register({
      name: YANDEX_CALENDAR_HTTP,
      baseUrl: 'https://calendar.yandex.ru',
      timeout: '15s',
      // The events call is a read sent as POST, so retrying it is safe.
      retry: { attempts: 3, methods: ['POST'], backoff: { delay: '500ms', factor: 2, maxDelay: '5s', jitter: 'full' } },
    }),
  ],
  providers: [
    SourcesService,
    SourcesRepository,
    SourceAdapterRegistry,
    YandexEmbedAdapter,
    {
      provide: SOURCE_ADAPTERS,
      useFactory: (...adapters: SourceAdapter[]) => adapters,
      inject: [YandexEmbedAdapter],
    },
  ],
  exports: [SourcesService],
})
export class SourcesModule {}
