import { Module } from '@nestjs/common';
import { HttpClientModule } from '@nestjs/http-client';
import { AuthModule } from '../auth/auth.module.js';
import { DeepseekModule } from '../integrations/deepseek/deepseek.module.js';
import { GoogleModule } from '../integrations/google/google.module.js';
import { GOOGLE_SHEETS_HTTP, GoogleSheetAdapter } from './adapters/gsheet/gsheet.adapter.js';
import { SheetMappingService } from './adapters/gsheet/gsheet-mapping.service.js';
import { YANDEX_CALENDAR_HTTP, YandexEmbedAdapter } from './adapters/yandex-embed/yandex-embed.adapter.js';
import { SOURCE_ADAPTERS, SourceAdapterRegistry } from './source-adapter.registry.js';
import type { SourceAdapter } from './source.types.js';
import { SourcesRepository } from './sources.repository.js';
import { SourcesService } from './sources.service.js';

@Module({
  imports: [
    AuthModule,
    GoogleModule,
    DeepseekModule,
    HttpClientModule.register({
      name: YANDEX_CALENDAR_HTTP,
      baseUrl: 'https://calendar.yandex.ru',
      timeout: '15s',
      // The events call is a read sent as POST, so retrying it is safe.
      retry: { attempts: 3, methods: ['POST'], backoff: { delay: '500ms', factor: 2, maxDelay: '5s', jitter: 'full' } },
    }),
    // No baseUrl: the export starts on docs.google.com and continues on a signed
    // *.googleusercontent.com URL, which the adapter checks before following it. Redirects are
    // never followed implicitly.
    HttpClientModule.register({
      name: GOOGLE_SHEETS_HTTP,
      timeout: '20s',
      redirect: 'error',
      retry: { attempts: 3, backoff: { delay: '500ms', factor: 2, maxDelay: '5s', jitter: 'full' } },
    }),
  ],
  providers: [
    SourcesService,
    SourcesRepository,
    SourceAdapterRegistry,
    YandexEmbedAdapter,
    GoogleSheetAdapter,
    SheetMappingService,
    {
      provide: SOURCE_ADAPTERS,
      useFactory: (...adapters: SourceAdapter[]) => adapters,
      inject: [YandexEmbedAdapter, GoogleSheetAdapter],
    },
  ],
  exports: [SourcesService],
})
export class SourcesModule {}
