import type { Bot } from 'grammy';
import { createTestApp, type TestApp } from './support/create-test-app.js';
import { connectGoogle, STRANGER_ID, upcomingEvent, USER_ID, YANDEX_EMBED_URL, YANDEX_LAYER_NAME } from './support/scenario.js';
import { type ApiCall, attachBot, callbackUpdate, type InlineButton, textUpdate } from './support/telegram.js';

describe('Telegram bot', () => {
  let testApp: TestApp;
  let bot: Bot;
  let calls: ApiCall[];
  let replies: () => string[];
  let buttons: () => InlineButton[];

  beforeEach(async () => {
    testApp = await createTestApp();
    ({ bot, calls, replies, buttons } = await attachBot(testApp));
  });

  afterEach(async () => {
    await testApp.close();
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
    // The e2e redirect URL is on localhost, so the bot says where the link can be opened.
    expect(replies().at(-1)).toContain('SSH-туннелем');
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
    expect(replies().at(-1)).toContain('Google Таблицы');
  });

  it('answers a failure with a Russian message instead of silence', async () => {
    await connectGoogle(testApp);
    testApp.source.failure = new Error('connection reset');

    await bot.handleUpdate(textUpdate(USER_ID, YANDEX_EMBED_URL));

    expect(replies().at(-1)).toBe('Что-то пошло не так. Попробую позже.');
  });
});
