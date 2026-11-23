// Everything the bot says (Russian, see AGENTS.md) and the pure formatters around it.
import { CircuitOpenError } from '@nestjs/resilience';
import { DomainError } from '../common/errors/domain-error.js';
import type { Source } from '../db/schema.js';
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

export const TEXTS = {
  help: (intervalMinutes: number) =>
    [
      'Привет! Я CalSync — переношу события из других календарей в Google Календарь.',
      '',
      '1. /connect — подключи Google Календарь.',
      '2. Пришли ссылку на календарь. Сейчас поддерживаются встроенные календари Яндекса: ссылка вида https://calendar.yandex.ru/embed/week?layer_ids=…',
      `3. Подтверди — я создам для него отдельный календарь в Google и буду обновлять его каждые ${intervalMinutes} мин.`,
      '',
      '/list — источники · /sync — синхронизировать сейчас · /remove — удалить · /status — состояние',
    ].join('\n'),
  connect: 'Нажми кнопку и разреши CalSync создавать календари в твоём Google Календаре. Ссылка действует 10 минут.',
  connectLocalhostHint:
    '⚠️ CalSync сейчас запущен локально: открой ссылку на том же компьютере, где он работает. После входа Google вернёт браузер на localhost — на телефоне эта страница не откроется.',
  connectButton: 'Подключить Google',
  notALink: 'Пришли ссылку на календарь или открой /help.',
  checking: 'Проверяю календарь…',
  addButton: '✅ Добавить',
  cancelButton: 'Отмена',
  cancelled: 'Не добавляю.',
  syncing: 'Синхронизирую…',
  noSources: 'Пока нет источников. Пришли ссылку на календарь.',
  chooseToRemove: 'Какой источник удалить?',
  removeButton: '🗑 Удалить',
  removed: 'Источник и его календарь в Google удалены.',
  removedCalendarKept: 'Источник удалён. Календарь в Google остался: Google не подключён, удали его вручную.',
  removeCancelled: 'Ничего не удаляю.',
  needGoogleFirst: 'Чтобы добавить календарь, сначала подключи Google: /connect',
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
      return 'Не узнаю эту ссылку. Сейчас поддерживаются встроенные календари Яндекса: https://calendar.yandex.ru/embed/week?layer_ids=…';
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

export function previewText(preview: SourcePreview, googleConnected: boolean): string {
  const { source, eventCount, sample } = preview;
  const lines = [`Нашёл календарь «${source.name}»: ${eventsWord(eventCount)} в окне синхронизации.`];
  if (sample.length > 0) {
    lines.push('', 'Ближайшие:', ...sample.map((event) => `• ${formatInstant(event.startsAt, source.timeZone)} — ${event.title}`));
  }
  lines.push('', googleConnected ? 'Добавить его в Google Календарь?' : TEXTS.needGoogleFirst);
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
