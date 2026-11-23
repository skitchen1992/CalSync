import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { type Bot, type Context, InlineKeyboard } from 'grammy';
import { GoogleAuthService } from '../auth/google-auth.service.js';
import { DomainError } from '../common/errors/domain-error.js';
import { toError } from '../common/errors/to-error.js';
import { googleConfig } from '../config/google.config.js';
import { syncConfig } from '../config/sync.config.js';
import { telegramConfig } from '../config/telegram.config.js';
import { TELEGRAM_BOT } from '../integrations/telegram/telegram.constants.js';
import { SourcesService } from '../sources/sources.service.js';
import { SyncService } from '../sync/sync.service.js';
import {
  errorMessage,
  previewText,
  removeConfirmText,
  sourceListText,
  statusText,
  syncSummaryText,
  TEXTS,
} from './bot.texts.js';

const URL_PATTERN = /https?:\/\/\S+/;

/** Callback data; a source id is a UUID, so every payload stays under Telegram's 64 bytes. */
const CALLBACK = {
  confirmAdd: (id: string) => `src:ok:${id}`,
  cancelAdd: (id: string) => `src:no:${id}`,
  askRemove: (id: string) => `rm:ask:${id}`,
  confirmRemove: (id: string) => `rm:yes:${id}`,
  cancelRemove: 'rm:no',
} as const;

/**
 * Telegram entry point. Handlers are thin: they parse the update, call one service and format the
 * answer. Each handler runs inside an error boundary that answers domain errors in Russian.
 */
@Injectable()
export class BotUpdates implements OnModuleInit {
  private readonly logger = new Logger(BotUpdates.name);
  private readonly allowedUserIds: ReadonlySet<number>;
  /** While running locally, the OAuth redirect only works in a browser on the same machine. */
  private readonly googleRedirectsToLocalhost: boolean;

  constructor(
    @Inject(TELEGRAM_BOT) private readonly bot: Bot,
    @Inject(telegramConfig.KEY) telegram: ConfigType<typeof telegramConfig>,
    @Inject(syncConfig.KEY) private readonly sync: ConfigType<typeof syncConfig>,
    @Inject(googleConfig.KEY) google: ConfigType<typeof googleConfig>,
    private readonly sources: SourcesService,
    private readonly syncService: SyncService,
    private readonly googleAuth: GoogleAuthService,
  ) {
    this.allowedUserIds = new Set(telegram.allowedUserIds);
    this.googleRedirectsToLocalhost = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(google.redirectUrl).hostname);
  }

  onModuleInit(): void {
    const bot = this.bot;

    // Single-tenant: updates from anyone outside the allowlist are dropped without an answer.
    bot.use(async (ctx, next) => {
      const userId = ctx.from?.id;
      if (userId === undefined || !this.allowedUserIds.has(userId)) {
        this.logger.debug('Update from a user outside the allowlist dropped', { userId });
        return;
      }
      await next();
    });

    bot.command(['start', 'help'], (ctx) => this.guard(ctx, () => ctx.reply(TEXTS.help(this.sync.intervalMinutes))));
    bot.command('connect', (ctx) => this.guard(ctx, () => this.connect(ctx)));
    bot.command('add', (ctx) => this.guard(ctx, () => this.addSource(ctx, ctx.match)));
    bot.command('list', (ctx) => this.guard(ctx, () => this.list(ctx)));
    bot.command('sync', (ctx) => this.guard(ctx, () => this.syncAll(ctx)));
    bot.command('remove', (ctx) => this.guard(ctx, () => this.chooseToRemove(ctx)));
    bot.command('status', (ctx) => this.guard(ctx, () => this.status(ctx)));

    bot.callbackQuery(/^src:ok:([\w-]+)$/, (ctx) => this.guard(ctx, () => this.confirmAdd(ctx, ctx.match[1]!)));
    bot.callbackQuery(/^src:no:([\w-]+)$/, (ctx) => this.guard(ctx, () => this.cancelAdd(ctx, ctx.match[1]!)));
    bot.callbackQuery(/^rm:ask:([\w-]+)$/, (ctx) => this.guard(ctx, () => this.askRemove(ctx, ctx.match[1]!)));
    bot.callbackQuery(/^rm:yes:([\w-]+)$/, (ctx) => this.guard(ctx, () => this.remove(ctx, ctx.match[1]!)));
    bot.callbackQuery(CALLBACK.cancelRemove, (ctx) =>
      this.guard(ctx, async () => {
        await ctx.answerCallbackQuery();
        await ctx.editMessageText(TEXTS.removeCancelled);
      }),
    );

    bot.on('message:text', (ctx) =>
      this.guard(ctx, () => {
        const url = URL_PATTERN.exec(ctx.message.text)?.[0];
        return url ? this.addSource(ctx, url) : ctx.reply(TEXTS.notALink);
      }),
    );
    // Answer stale or unknown buttons so the client stops its loading animation.
    bot.on('callback_query:data', (ctx) => this.guard(ctx, () => ctx.answerCallbackQuery()));

    bot.catch((error) => {
      this.logger.error('Unhandled bot error', toError(error.error).stack, { updateId: error.ctx.update.update_id });
    });
  }

  private async connect(ctx: Context): Promise<void> {
    const url = await this.googleAuth.startAuthorization(ctx.from!.id);
    const text = this.googleRedirectsToLocalhost ? `${TEXTS.connect}\n\n${TEXTS.connectLocalhostHint}` : TEXTS.connect;
    await ctx.reply(text, { reply_markup: new InlineKeyboard().url(TEXTS.connectButton, url) });
  }

  private async addSource(ctx: Context, text: string): Promise<void> {
    const url = URL_PATTERN.exec(text)?.[0];
    if (!url) {
      await ctx.reply(TEXTS.notALink);
      return;
    }
    const userId = ctx.from!.id;
    await ctx.reply(TEXTS.checking);
    const preview = await this.sources.preview(userId, url);
    const connected = await this.googleAuth.isConnected(userId);
    const keyboard = new InlineKeyboard();
    if (connected) {
      keyboard.text(TEXTS.addButton, CALLBACK.confirmAdd(preview.source.id));
    }
    keyboard.text(TEXTS.cancelButton, CALLBACK.cancelAdd(preview.source.id));
    await ctx.reply(previewText(preview, connected), {
      reply_markup: keyboard,
      link_preview_options: { is_disabled: true },
    });
  }

  private async confirmAdd(ctx: Context, sourceId: string): Promise<void> {
    await ctx.answerCallbackQuery();
    const source = await this.sources.confirm(ctx.from!.id, sourceId);
    await ctx.editMessageText(`✅ Календарь «${source.name}» добавлен. ${TEXTS.syncing}`);
    const outcome = await this.syncService.syncSource(source);
    await ctx.reply(syncSummaryText([outcome]));
  }

  private async cancelAdd(ctx: Context, sourceId: string): Promise<void> {
    await ctx.answerCallbackQuery();
    await this.sources.cancel(ctx.from!.id, sourceId);
    await ctx.editMessageText(TEXTS.cancelled);
  }

  private async list(ctx: Context): Promise<void> {
    const sources = await this.sources.listActive(ctx.from!.id);
    const withCounts = await Promise.all(
      sources.map(async (source) => ({ source, eventCount: await this.syncService.mirroredEventCount(source.id) })),
    );
    await ctx.reply(sourceListText(withCounts));
  }

  private async syncAll(ctx: Context): Promise<void> {
    await ctx.reply(TEXTS.syncing);
    await ctx.reply(syncSummaryText(await this.syncService.syncAllForUser(ctx.from!.id)));
  }

  private async chooseToRemove(ctx: Context): Promise<void> {
    const sources = await this.sources.listActive(ctx.from!.id);
    if (sources.length === 0) {
      await ctx.reply(TEXTS.noSources);
      return;
    }
    const keyboard = new InlineKeyboard();
    for (const source of sources) {
      keyboard.text(source.name, CALLBACK.askRemove(source.id)).row();
    }
    await ctx.reply(TEXTS.chooseToRemove, { reply_markup: keyboard });
  }

  private async askRemove(ctx: Context, sourceId: string): Promise<void> {
    await ctx.answerCallbackQuery();
    const source = await this.sources.findForUser(ctx.from!.id, sourceId);
    await ctx.editMessageText(removeConfirmText(source), {
      reply_markup: new InlineKeyboard()
        .text(TEXTS.removeButton, CALLBACK.confirmRemove(source.id))
        .text(TEXTS.cancelButton, CALLBACK.cancelRemove),
    });
  }

  private async remove(ctx: Context, sourceId: string): Promise<void> {
    await ctx.answerCallbackQuery();
    const { calendarKept } = await this.sources.remove(ctx.from!.id, sourceId);
    await ctx.editMessageText(calendarKept ? TEXTS.removedCalendarKept : TEXTS.removed);
  }

  private async status(ctx: Context): Promise<void> {
    const userId = ctx.from!.id;
    const [connected, sources] = await Promise.all([this.googleAuth.isConnected(userId), this.sources.listActive(userId)]);
    await ctx.reply(statusText(connected, sources.length));
  }

  /** Error boundary of one update: domain errors become a Russian answer, the rest is logged. */
  private async guard(ctx: Context, handler: () => Promise<unknown>): Promise<void> {
    try {
      await handler();
    } catch (caught) {
      const error = toError(caught);
      if (error instanceof DomainError) {
        this.logger.warn('Bot request failed', { code: error.code, reason: error.message });
      } else {
        this.logger.error('Bot handler failed', error.stack, { updateId: ctx.update.update_id });
      }
      if (ctx.callbackQuery) {
        await ctx.answerCallbackQuery().catch(() => undefined);
      }
      await ctx.reply(errorMessage(error)).catch(() => undefined);
    }
  }
}
