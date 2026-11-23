import type { Bot } from 'grammy';
import type { Update } from 'grammy/types';
import { TELEGRAM_BOT } from '../../src/integrations/telegram/telegram.constants.js';
import type { TestApp } from './create-test-app.js';
import { USER_ID } from './scenario.js';

const BOT_INFO = {
  id: 7000,
  is_bot: true as const,
  first_name: 'CalSync',
  username: 'calsync_test_bot',
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
};

export interface ApiCall {
  method: string;
  payload: Record<string, unknown>;
}

export interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}

let updateId = 1;
const user = (id: number) => ({ id, is_bot: false, first_name: 'Test' });
const chat = (id: number) => ({ id, type: 'private' as const, first_name: 'Test' });

export function textUpdate(fromId: number, text: string): Update {
  const command = text.startsWith('/') ? text.split(' ')[0]! : undefined;
  return {
    update_id: updateId++,
    message: {
      message_id: updateId,
      date: Math.floor(Date.now() / 1000),
      chat: chat(fromId),
      from: user(fromId),
      text,
      ...(command ? { entities: [{ type: 'bot_command', offset: 0, length: command.length }] } : {}),
    },
  } as Update;
}

export function callbackUpdate(fromId: number, data: string): Update {
  return {
    update_id: updateId++,
    callback_query: {
      id: String(updateId),
      from: user(fromId),
      chat_instance: '1',
      data,
      message: { message_id: 1, date: Math.floor(Date.now() / 1000), chat: chat(fromId), text: 'previous' },
    },
  } as Update;
}

/** The app's real grammY bot, with every Bot API call recorded instead of sent to Telegram. */
export interface BotHarness {
  bot: Bot;
  calls: ApiCall[];
  /** Texts the bot sent or edited, in order. */
  replies: () => string[];
  /** Inline buttons of every message the bot sent or edited. */
  buttons: () => InlineButton[];
}

export async function attachBot(testApp: TestApp): Promise<BotHarness> {
  const bot: Bot = testApp.app.get(TELEGRAM_BOT);
  const calls: ApiCall[] = [];
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    const result =
      method === 'getMe'
        ? BOT_INFO
        : method === 'sendMessage' || method === 'editMessageText'
          ? { message_id: 1, date: 0, chat: chat(USER_ID), text: '' }
          : true;
    // grammY's transformer types are per-method; the fake answers every method generically.
    return { ok: true, result } as never;
  });
  await bot.init();
  return {
    bot,
    calls,
    replies: () =>
      calls
        .filter((call) => call.method === 'sendMessage' || call.method === 'editMessageText')
        .map((call) => String(call.payload['text'])),
    buttons: () =>
      calls.flatMap((call) => {
        const markup = call.payload['reply_markup'] as { inline_keyboard?: InlineButton[][] } | undefined;
        return markup?.inline_keyboard?.flat() ?? [];
      }),
  };
}
