import type { Bot } from 'grammy';
import type { Update } from 'grammy/types';
import { TELEGRAM_BOT } from '../src/integrations/telegram/telegram.constants.js';
import { createTestApp, type TestApp } from './support/create-test-app.js';
import { connectGoogle, STRANGER_ID, upcomingEvent, USER_ID, YANDEX_EMBED_URL, YANDEX_LAYER_NAME } from './support/scenario.js';

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

interface ApiCall {
  method: string;
  payload: Record<string, unknown>;
}

let updateId = 1;
const user = (id: number) => ({ id, is_bot: false, first_name: 'Test' });
const chat = (id: number) => ({ id, type: 'private' as const, first_name: 'Test' });

function textUpdate(fromId: number, text: string): Update {
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

function callbackUpdate(fromId: number, data: string): Update {
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

describe('Telegram bot', () => {
  let testApp: TestApp;
  let bot: Bot;
  let calls: ApiCall[];

  beforeEach(async () => {
    testApp = await createTestApp();
    bot = testApp.app.get(TELEGRAM_BOT);
    calls = [];
    // Intercept every Bot API call: nothing reaches Telegram.
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
  });

  afterEach(async () => {
    await testApp.close();
  });

  const replies = () =>
    calls.filter((call) => call.method === 'sendMessage' || call.method === 'editMessageText').map((call) => String(call.payload['text']));

  const buttons = () =>
    calls.flatMap((call) => {
      const markup = call.payload['reply_markup'] as { inline_keyboard?: { text: string; callback_data?: string; url?: string }[][] } | undefined;
      return markup?.inline_keyboard?.flat() ?? [];
    });

  it('answers /start with the help text', async () => {
    await bot.handleUpdate(textUpdate(USER_ID, '/start'));

    expect(replies()).toEqual([expect.stringContaining('CalSync')]);
  });

  it('ignores users outside the allowlist', async () => {
    await bot.handleUpdate(textUpdate(STRANGER_ID, '/start'));
    await bot.handleUpdate(textUpdate(STRANGER_ID, YANDEX_EMBED_URL));

    expect(calls.filter((call) => call.method !== 'getMe')).toEqual([]);
  });

  it('sends a Google consent link on /connect', async () => {
    await bot.handleUpdate(textUpdate(USER_ID, '/connect'));

    expect(buttons()).toEqual([expect.objectContaining({ url: expect.stringMatching(/^https:\/\/accounts\.example\.com\//) })]);
  });

  it('previews a Yandex link, adds it on confirmation and syncs it', async () => {
    await connectGoogle(testApp);
    testApp.source.events = [upcomingEvent('a', 24), upcomingEvent('b', 48)];

    await bot.handleUpdate(textUpdate(USER_ID, `Вот календарь: ${YANDEX_EMBED_URL}`));

    expect(replies().at(-1)).toContain(`Нашёл календарь «${YANDEX_LAYER_NAME}»: 2 события`);
    const add = buttons().find((button) => button.callback_data?.startsWith('src:ok:'));
    expect(add).toBeDefined();

    await bot.handleUpdate(callbackUpdate(USER_ID, add!.callback_data!));

    expect(replies().slice(-2)).toEqual([
      `✅ Календарь «${YANDEX_LAYER_NAME}» добавлен. Синхронизирую…`,
      `✅ «${YANDEX_LAYER_NAME}»: +2 новых`,
    ]);
    expect([...testApp.googleCalendar.calendars.values()][0]!.events.size).toBe(2);
  });

  it('offers no add button until Google is connected', async () => {
    testApp.source.events = [upcomingEvent('a', 24)];

    await bot.handleUpdate(textUpdate(USER_ID, YANDEX_EMBED_URL));

    expect(replies().at(-1)).toContain('/connect');
    expect(buttons().some((button) => button.callback_data?.startsWith('src:ok:'))).toBe(false);
  });

  it('explains which links it understands', async () => {
    await bot.handleUpdate(textUpdate(USER_ID, 'https://example.com/calendar.ics'));

    expect(replies().at(-1)).toContain('calendar.yandex.ru/embed');
  });

  it('answers a failure with a Russian message instead of silence', async () => {
    await connectGoogle(testApp);
    testApp.source.failure = new Error('connection reset');

    await bot.handleUpdate(textUpdate(USER_ID, YANDEX_EMBED_URL));

    expect(replies().at(-1)).toBe('Что-то пошло не так. Попробую позже.');
  });
});
