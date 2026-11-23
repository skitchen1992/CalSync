import { z } from 'zod';

/** Local wall-clock time without an offset, as Yandex sends it: 2026-11-23T09:30:00. */
const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);

/** The fields CalSync reads from an event of the embed `get-events` model; the rest is ignored. */
export const yandexEventSchema = z.object({
  externalId: z.string().min(1),
  name: z.string(),
  description: z.string().nullish(),
  location: z.string().nullish(),
  conferenceUrl: z.string().nullish(),
  timezone: z.string().min(1),
  startTs: localDateTime,
  endTs: localDateTime,
  /** The instance start in UTC (no offset in the string). */
  instanceStartTs: localDateTime,
  isAllDay: z.boolean(),
  isRecurrence: z.boolean(),
});

export type YandexEvent = z.infer<typeof yandexEventSchema>;

const okModel = z.object({
  name: z.literal('get-events'),
  status: z.literal('ok'),
  data: z.object({ events: z.array(yandexEventSchema) }),
});

const errorModel = z.object({
  name: z.literal('get-events'),
  status: z.literal('error'),
  error: z.object({ code: z.string().nullish(), errorCollection: z.unknown() }),
});

export const yandexGetEventsResponseSchema = z.object({
  models: z.array(z.discriminatedUnion('status', [okModel, errorModel])).length(1),
});
