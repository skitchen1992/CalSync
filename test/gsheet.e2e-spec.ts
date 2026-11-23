import { SourcesService } from '../src/sources/sources.service.js';
import { createTestApp, type TestApp } from './support/create-test-app.js';
import { TEAM_SHEET_LLM_ANSWER, TEAM_SHEET_MAPPING, TEAM_SHEET_TITLE, TEAM_SHEET_URL } from './support/gsheet.js';
import { connectGoogle, USER_ID } from './support/scenario.js';
import { attachBot, type BotHarness, callbackUpdate, textUpdate } from './support/telegram.js';

/** The fixture's dates are fixed, so the clock is too: the sync window is 16.11.2026–22.01.2027. */
const NOW = new Date('2026-11-23T09:00:00Z');
/** Fixture events inside that window: 13 in the past week, 12 ahead, and the all-day one on 31.12. */
const EVENTS_IN_WINDOW = 26;

const PREVIEW = [
  `Нашёл таблицу «${TEAM_SHEET_TITLE}»: ${EVENTS_IN_WINDOW} событий в окне синхронизации.`,
  '',
  'Как читаю таблицу:',
  '• дата — «Дата», формат ДД.ММ.ГГГГ',
  '• время — «Время»; без конца («15:30 - ?») — 1 ч',
  '• название — «Название события»',
  '• тип — «Тип события» → в начале названия: [Тип] Название',
  '• ссылка — «Ссылка» → место встречи',
  'Пустые строки и строки без даты пропускаю, строки без времени ставлю на весь день.',
  'Часовой пояс: Europe/Moscow.',
  '',
  'Ближайшие:',
  '• 23 нояб., 20:30 — [Созвон командный с Ксенией] ДокПоток созвон с Ксенией',
  '• 24 нояб., 15:00 — ВОЕНМЕХ АКСЕЛЬ',
  '• 25 нояб., 19:00 — [ФИЗТЕХИДЕЯ АКСЕЛЬ] Каналы поиска и привлечения инвестиций в стартап',
  '',
  'Добавить её в Google Календарь?',
].join('\n');

describe('Google Sheets through the bot', () => {
  let testApp: TestApp;
  let harness: BotHarness;

  beforeEach(async () => {
    testApp = await createTestApp({ now: NOW });
    harness = await attachBot(testApp);
  });

  afterEach(async () => {
    await testApp.close();
  });

  const send = (text: string) => harness.bot.handleUpdate(textUpdate(USER_ID, text));
  const press = (data: string) => harness.bot.handleUpdate(callbackUpdate(USER_ID, data));
  const addButton = () => harness.buttons().find((button) => button.callback_data?.startsWith('src:ok:'));

  it('previews a sheet with the recognized columns and three upcoming events', async () => {
    await connectGoogle(testApp);
    testApp.llm.reply({ object: TEAM_SHEET_LLM_ANSWER });

    await send(TEAM_SHEET_URL);

    expect(harness.replies()).toEqual(['Проверяю ссылку…', PREVIEW]);
    expect(harness.buttons().map((button) => button.text)).toEqual(['✅ Добавить', 'Отмена']);
    expect(testApp.llm.calls).toHaveLength(1);
    expect(testApp.llm.lastCall?.lastUserMessage).not.toMatch(/https?:\/\//);
  });

  it('adds the sheet as its own calendar and syncs it later without asking the model again', async () => {
    await connectGoogle(testApp);
    testApp.llm.reply({ object: TEAM_SHEET_LLM_ANSWER });
    await send(TEAM_SHEET_URL);

    await press(addButton()!.callback_data!);

    expect(harness.replies().slice(-2)).toEqual([
      `✅ Календарь «${TEAM_SHEET_TITLE}» добавлен. Синхронизирую…`,
      `✅ «${TEAM_SHEET_TITLE}»: +${EVENTS_IN_WINDOW} новых`,
    ]);
    const [calendar] = [...testApp.googleCalendar.calendars.values()];
    expect(calendar).toMatchObject({ summary: TEAM_SHEET_TITLE, timeZone: 'Europe/Moscow' });
    expect(calendar!.events.size).toBe(EVENTS_IN_WINDOW);
    expect([...calendar!.events.values()].find((event) => event.title.startsWith('[ФИЗТЕХИДЕЯ АКСЕЛЬ] Каналы'))).toMatchObject({
      start: { dateTime: '2026-11-25T19:00:00', timeZone: 'Europe/Moscow' },
      end: { dateTime: '2026-11-25T20:30:00', timeZone: 'Europe/Moscow' },
      location: expect.stringMatching(/^https:\/\/events\.example\.com\//),
    });
    const [source] = await testApp.app.get(SourcesService).listActive(USER_ID);
    expect(source!.options).toEqual({ type: 'gsheet', version: 1, mapping: TEAM_SHEET_MAPPING });

    await send('/sync');

    expect(harness.replies().at(-1)).toBe(`✅ «${TEAM_SHEET_TITLE}»: без изменений`);
    expect(testApp.llm.calls).toHaveLength(1);
  });

  it('asks to share a sheet that Google does not export, without asking the model', async () => {
    await connectGoogle(testApp);
    testApp.sheets.status = 404;

    await send(TEAM_SHEET_URL);

    expect(harness.replies().at(-1)).toContain('доступ открыт «всем, у кого есть ссылка»');
    expect(testApp.llm.calls).toHaveLength(0);
  });

  it('gives up after one repair when the model keeps answering with an invalid mapping', async () => {
    await connectGoogle(testApp);
    const invalid = { object: { ...TEAM_SHEET_LLM_ANSWER, columns: { ...TEAM_SHEET_LLM_ANSWER.columns, date: 42 } } };
    testApp.llm.reply(invalid, invalid);

    await send(TEAM_SHEET_URL);

    expect(harness.replies().at(-1)).toBe(
      'Не смог понять, где в таблице дата, время и название. Проверь, что у колонок есть заголовки, и попробуй ещё раз.',
    );
    expect(testApp.llm.calls).toHaveLength(2);
    expect(addButton()).toBeUndefined();
  });
});
