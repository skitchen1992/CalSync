import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Bot } from 'grammy';
import { toError } from '../../common/errors/to-error.js';
import { Notifier } from '../../common/notifier/notifier.js';
import { TELEGRAM_BOT } from './telegram.constants.js';

@Injectable()
export class TelegramNotifier extends Notifier {
  private readonly logger = new Logger(TelegramNotifier.name);

  constructor(@Inject(TELEGRAM_BOT) private readonly bot: Bot) {
    super();
  }

  async notify(telegramUserId: number, text: string): Promise<void> {
    try {
      await this.bot.api.sendMessage(telegramUserId, text, { link_preview_options: { is_disabled: true } });
    } catch (error) {
      this.logger.warn('Telegram notification failed', { telegramUserId, reason: toError(error).message });
    }
  }
}
