// Everything the bot says (Russian, see AGENTS.md) and the pure formatters around it.
import { CircuitOpenError } from '@nestjs/resilience';
import { DomainError } from '../common/errors/domain-error.js';
import type { Source } from '../db/schema.js';
import type { DateOrder, SheetColumn, SheetMapping } from '../db/source-options.js';
import type { NormalizedEvent } from '../sources/source.types.js';
import type { SourcePreview } from '../sources/sources.service.js';
import type { SyncOutcome } from '../sync/sync.service.js';

export const BOT_COMMANDS = [
  { command: 'connect', description: 'Подключить Google Календарь' },
  { command: 'list', description: 'Мои источники' },
  { command: 'sync', description: 'Синхронизировать сейчас' },
  { command: 'remove', description: 'Удалить источник' },
  { command: 'status', description: 'Состояние' },
  { command: 'help', description: 'Как пользоваться' },
];

const YANDEX_LINK_EXAMPLE = 'https://calendar.yandex.ru/embed/week?layer_ids=…';
const SHEET_LINK_EXAMPLE = 'https://docs.google.com/spreadsheets/d/…';

export const TEXTS = {
  help: (intervalMinutes: number) =>
    [
      'Привет! Я CalSync — переношу события из других календарей и таблиц с расписанием в Google Календарь.',
      '',
      '1. /connect — подключи Google Календарь.',
      `2. Пришли ссылку. Поддерживаются:\n• встроенные календари Яндекса: ${YANDEX_LINK_EXAMPLE}\n• Google Таблицы с доступом по ссылке: ${SHEET_LINK_EXAMPLE}`,
      `3. Проверь превью и подтверди — я создам отдельный календарь в Google и буду обновлять его каждые ${intervalMinutes} мин.`,
      '',
      '/list — источники · /sync — синхронизировать сейчас · /remove — удалить · /status — состояние',
    ].join('\n'),
  connect: 'Нажми кнопку и разреши CalSync создавать календари в твоём Google Календаре. Ссылка действует 10 минут.',
  connectLocalhostHint:
    '⚠️ CalSync сейчас запущен локально: открой ссылку на том же компьютере, где он работает. После входа Google вернёт браузер на localhost — на телефоне эта страница не откроется.',
  connectButton: 'Подключить Google',
  notALink: 'Пришли ссылку на календарь или Google Таблицу — или открой /help.',
  checking: 'Проверяю ссылку…',
  addButton: '✅ Добавить',
  cancelButton: 'Отмена',
  cancelled: 'Не добавляю.',
  syncing: 'Синхронизирую…',
  noSources: 'Пока нет источников. Пришли ссылку на календарь или Google Таблицу.',
  chooseToRemove: 'Какой источник удалить?',
  removeButton: '🗑 Удалить',
  removed: 'Источник и его календарь в Google удалены.',
  removedCalendarKept: 'Источник удалён. Календарь в Google остался: Google не подключён, удали его вручную.',
  removeCancelled: 'Ничего не удаляю.',
  needGoogleFirst: 'Чтобы добавить в Google Календарь, сначала подключи Google: /connect',
} as const;

const plural = (count: number, one: string, few: string, many: string) => {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
};

const eventsWord = (count: number) => `${count} ${plural(count, 'событие', 'события', 'событий')}`;

const formatInstant = (instant: Date, timeZone: string) =>
  new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone }).format(
    instant,
  );

const formatDate = (date: string) =>
  new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));

/** "23 нояб., 20:30", or "1 нояб., весь день" for an all-day event. */
const eventWhen = (event: NormalizedEvent, timeZone: string) =>
  'date' in event.start ? `${formatDate(event.start.date)}, весь день` : formatInstant(event.startsAt, timeZone);

/** Russian message for an error that reached the user. */
export function errorMessage(error: unknown): string {
  if (error instanceof CircuitOpenError) {
    return 'Google Календарь сейчас недоступен. Попробую позже.';
  }
  const code = error instanceof DomainError ? error.code : undefined;
  return messageForCode(code);
}

function messageForCode(code: string | undefined): string {
  switch (code) {
    case 'UNSUPPORTED_SOURCE_URL':
      return `Не узнаю эту ссылку. Поддерживаются встроенные календари Яндекса (${YANDEX_LINK_EXAMPLE}) и Google Таблицы с доступом по ссылке (${SHEET_LINK_EXAMPLE}).`;
    case 'SHEET_NOT_ACCESSIBLE':
      return 'Не могу открыть таблицу. Проверь, что доступ открыт «всем, у кого есть ссылка», и что лист из ссылки существует.';
    case 'SHEET_EMPTY':
      return 'Таблица пустая: нужна строка с заголовками колонок и строки с событиями.';
    case 'SHEET_LAYOUT_CHANGED':
      return 'Колонки в таблице переименованы или удалены. Удали источник (/remove) и добавь таблицу заново.';
    case 'SOURCE_OPTIONS_INVALID':
      return 'Сохранённая разметка таблицы не читается. Удали источник (/remove) и добавь таблицу заново.';
    case 'LLM_UNAVAILABLE':
      return 'Не получилось разобрать таблицу: сервис распознавания сейчас недоступен. Попробуй ещё раз позже.';
    case 'LLM_OUTPUT_INVALID':
      return 'Не смог понять, где в таблице дата, время и название. Проверь, что у колонок есть заголовки, и попробуй ещё раз.';
    case 'SOURCE_UNAVAILABLE':
      return 'Не получилось загрузить календарь: источник недоступен. Попробую позже.';
    case 'SOURCE_RESPONSE_INVALID':
      return 'Источник ответил в неожиданном формате — похоже, его API изменился.';
    case 'SOURCE_NOT_FOUND':
      return 'Источник не найден — он уже удалён или предложение устарело.';
    case 'GOOGLE_NOT_CONNECTED':
      return 'Google не подключён: /connect';
    case 'GOOGLE_AUTH_REVOKED':
      return 'Доступ к Google отозван или истёк: /connect';
    case 'GOOGLE_API_ERROR':
      return 'Google Календарь ответил ошибкой. Попробую позже.';
    case 'SUSPICIOUS_EMPTY_SNAPSHOT':
      return 'Источник вернул пустой календарь — на всякий случай ничего не удаляю.';
    default:
      return 'Что-то пошло не так. Попробую позже.';
  }
}

const DATE_FORMATS: Record<DateOrder, string> = { DMY: 'ДД.ММ.ГГГГ', MDY: 'ММ/ДД/ГГГГ', YMD: 'ГГГГ-ММ-ДД' };
const MAX_LISTED_ROWS = 10;

const durationText = (minutes: number) => {
  const [hours, rest] = [Math.floor(minutes / 60), minutes % 60];
  return [hours > 0 ? `${hours} ч` : '', rest > 0 ? `${rest} мин` : ''].filter(Boolean).join(' ');
};

const columnText = (column: SheetColumn | null) => (column ? `«${column.header || `колонка ${column.index + 1}`}»` : 'нет');

/** How the sheet will be read: the recognized columns and rules, for the user to check. */
export function sheetMappingText(mapping: SheetMapping, timeZone: string, unparsedRows: readonly number[]): string[] {
  const { date, time, title, type, link } = mapping.columns;
  const lines = [
    'Как читаю таблицу:',
    `• дата — ${columnText(date)}, формат ${DATE_FORMATS[mapping.dateOrder]}`,
    time
      ? `• время — ${columnText(time)}; без конца («15:30 - ?») — ${durationText(mapping.defaultDurationMinutes)}`
      : '• время — нет, все события на весь день',
    `• название — ${columnText(title)}`,
    `• тип — ${columnText(type)}${type ? ' → в начале названия: [Тип] Название' : ''}`,
    `• ссылка — ${columnText(link)}${link ? ' → место встречи' : ''}`,
    'Пустые строки и строки без даты пропускаю, строки без времени ставлю на весь день.',
    `Часовой пояс: ${timeZone}.`,
  ];
  if (unparsedRows.length > 0) {
    const listed = unparsedRows.slice(0, MAX_LISTED_ROWS).join(', ');
    const more = unparsedRows.length > MAX_LISTED_ROWS ? ` и ещё ${unparsedRows.length - MAX_LISTED_ROWS}` : '';
    lines.push(`⚠️ Не разобрал строки ${listed}${more} — их не будет в календаре.`);
  }
  return lines;
}

export function previewText(preview: SourcePreview, googleConnected: boolean): string {
  const { source, eventCount, sample, unparsedRows } = preview;
  const isSheet = source.options?.type === 'gsheet';
  const lines = [`Нашёл ${isSheet ? 'таблицу' : 'календарь'} «${source.name}»: ${eventsWord(eventCount)} в окне синхронизации.`];
  if (source.options?.type === 'gsheet') {
    lines.push('', ...sheetMappingText(source.options.mapping, source.timeZone, unparsedRows));
  }
  if (sample.length > 0) {
    lines.push('', 'Ближайшие:', ...sample.map((event) => `• ${eventWhen(event, source.timeZone)} — ${event.title}`));
  }
  lines.push('', googleConnected ? `Добавить ${isSheet ? 'её' : 'его'} в Google Календарь?` : TEXTS.needGoogleFirst);
  return lines.join('\n');
}

function outcomeLine(outcome: SyncOutcome): string {
  const name = `«${outcome.sourceName}»`;
  switch (outcome.status) {
    case 'synced': {
      const changes = [
        outcome.created > 0 ? `+${outcome.created} новых` : undefined,
        outcome.updated > 0 ? `${outcome.updated} изменено` : undefined,
        outcome.deleted > 0 ? `${outcome.deleted} удалено` : undefined,
      ].filter(Boolean);
      return `✅ ${name}: ${changes.length > 0 ? changes.join(', ') : 'без изменений'}`;
    }
    case 'skipped':
      return outcome.reason === 'running' ? `⏳ ${name}: уже синхронизируется` : `⏸ ${name}: пропущен`;
    case 'failed':
      return `⚠️ ${name}: ${errorMessage(outcome.error)}`;
  }
}

export function syncSummaryText(outcomes: SyncOutcome[]): string {
  return outcomes.length === 0 ? TEXTS.noSources : outcomes.map(outcomeLine).join('\n');
}

export function sourceListText(sources: { source: Source; eventCount: number }[]): string {
  if (sources.length === 0) {
    return TEXTS.noSources;
  }
  const lines = sources.map(({ source, eventCount }, index) => {
    const head = `${index + 1}. «${source.name}» — ${eventsWord(eventCount)}`;
    if (!source.lastSyncedAt && !source.lastSyncStatus) {
      return `${head}\n   ещё не синхронизирован`;
    }
    const last = source.lastSyncedAt ? `синхронизирован ${formatInstant(source.lastSyncedAt, source.timeZone)}` : '';
    const failure =
      source.lastSyncStatus === 'failed' ? `\n   ⚠️ ${messageForCode(source.lastSyncError?.split(':')[0])}` : '';
    return `${head}\n   ${last}${failure}`;
  });
  return ['Источники:', '', ...lines].join('\n');
}

export const removeConfirmText = (source: Source) =>
  `Удалить «${source.name}»? Его календарь в Google тоже будет удалён.`;

export const statusText = (googleConnected: boolean, sourceCount: number) =>
  [`Google: ${googleConnected ? 'подключён ✅' : 'не подключён — /connect'}`, `Источников: ${sourceCount}`].join('\n');
