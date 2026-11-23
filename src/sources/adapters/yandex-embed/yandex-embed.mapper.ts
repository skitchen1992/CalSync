import type { NormalizedEvent } from '../../source.types.js';
import type { YandexEvent } from './yandex-embed.schemas.js';

const UNTITLED = '(без названия)';

const datePart = (localDateTime: string) => localDateTime.slice(0, 10);

const nextDay = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** Instances of a recurring series share `externalId`; their start tells them apart. */
export const yandexEventUid = (event: YandexEvent) =>
  event.isRecurrence ? `${event.externalId}#${event.instanceStartTs}` : event.externalId;

function describe(event: YandexEvent): string | undefined {
  const parts = [event.description?.trim(), event.conferenceUrl?.trim()].filter((part): part is string => !!part);
  const unique = parts.filter((part, index) => !parts.slice(0, index).some((earlier) => earlier.includes(part)));
  const text = unique.join('\n\n');
  return text === '' ? undefined : text;
}

export function toNormalizedEvent(event: YandexEvent): NormalizedEvent {
  const location = event.location?.trim();
  const description = describe(event);
  const common = {
    uid: yandexEventUid(event),
    title: event.name.trim() || UNTITLED,
    ...(description ? { description } : {}),
    ...(location ? { location } : {}),
    startsAt: new Date(`${event.instanceStartTs}Z`),
  };

  if (event.isAllDay) {
    const start = datePart(event.startTs);
    const end = datePart(event.endTs);
    return { ...common, start: { date: start }, end: { date: end > start ? end : nextDay(start) } };
  }
  return {
    ...common,
    start: { dateTime: event.startTs, timeZone: event.timezone },
    end: { dateTime: event.endTs, timeZone: event.timezone },
  };
}
