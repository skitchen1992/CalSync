import { Global, Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Bot } from 'grammy';
import { Notifier } from '../../common/notifier/notifier.js';
import { telegramConfig } from '../../config/telegram.config.js';
import { TELEGRAM_BOT } from './telegram.constants.js';
import { TelegramNotifier } from './telegram.notifier.js';

/**
 * The Telegram Bot API client and the Notifier built on it. Global infrastructure: features
 * notify users through the Notifier abstraction without importing the bot.
 */
@Global()
@Module({
  providers: [
    {
      provide: TELEGRAM_BOT,
      inject: [telegramConfig.KEY],
      useFactory: (config: ConfigType<typeof telegramConfig>) => new Bot(config.botToken),
    },
    { provide: Notifier, useClass: TelegramNotifier },
  ],
  exports: [TELEGRAM_BOT, Notifier],
})
export class TelegramModule {}
