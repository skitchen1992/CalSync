// What the sync tells the user outside of a bot command (Russian, see AGENTS.md).
import { plural } from '../common/utils/plural.js';
import type { SkippedEntry } from '../sources/source.types.js';

const MAX_LISTED_ENTRIES = 10;

export const SYNC_MESSAGES = {
  /** Sheet rows the sync could not read and left out of the calendar. */
  unreadableRows: (sourceName: string, entries: readonly SkippedEntry[]): string => {
    const count = entries.length;
    const listed = entries.slice(0, MAX_LISTED_ENTRIES).map((entry) => `• строка ${entry.row}: ${entry.text}`);
    if (count > MAX_LISTED_ENTRIES) {
      listed.push(`…и ещё ${count - MAX_LISTED_ENTRIES}`);
    }
    return [
      `⚠️ «${sourceName}»: не смог разобрать ${count} ${plural(count, 'строку', 'строки', 'строк')} — ${
        count === 1 ? 'её' : 'их'
      } нет в календаре.`,
      ...listed,
      'Исправь дату или время в таблице — при следующей синхронизации события появятся.',
    ].join('\n');
  },
} as const;
