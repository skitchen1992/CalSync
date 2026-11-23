import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Bot } from 'grammy';
import { toError } from '../common/errors/to-error.js';
import { telegramConfig } from '../config/telegram.config.js';
import { TELEGRAM_BOT } from '../integrations/telegram/telegram.constants.js';
import { BOT_COMMANDS } from './bot.texts.js';

/**
 * Receives updates by long polling (no public URL needed). Starts after every handler is
 * registered and stops on shutdown. Disabled with TELEGRAM_POLLING_ENABLED=false (tests).
 */
@Injectable()
export class BotRunner implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(BotRunner.name);

  constructor(
    @Inject(TELEGRAM_BOT) private readonly bot: Bot,
    @Inject(telegramConfig.KEY) private readonly config: ConfigType<typeof telegramConfig>,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.pollingEnabled) {
      return;
    }
    // bot.start() resolves only when polling stops, so it is not awaited here.
    void this.bot
      .start({
        drop_pending_updates: true,
        allowed_updates: ['message', 'callback_query'],
        onStart: (info) => {
          this.logger.log('Telegram bot started', { username: info.username });
          void this.bot.api
            .setMyCommands(BOT_COMMANDS)
            .catch((error: unknown) => this.logger.warn('Could not set bot commands', { reason: toError(error).message }));
        },
      })
      .catch((error: unknown) => this.logger.error('Telegram polling stopped', toError(error).stack));
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.bot.isRunning()) {
      await this.bot.stop();
    }
  }
}
