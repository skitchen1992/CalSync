import { ConsoleLogger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { appConfig } from './config/app.config.js';

async function bootstrap() {
  // ConfigModule loads and validates .env while the app is created, so the configured logger can
  // only be built afterwards; bootstrap logs are buffered until then.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get<ConfigType<typeof appConfig>>(appConfig.KEY);
  app.useLogger(new ConsoleLogger({ json: config.logFormat === 'json', logLevels: config.logLevels }));
  app.use(helmet());
  app.enableShutdownHooks();
  await app.listen(config.port);
}
await bootstrap();
