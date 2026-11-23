import { Injectable } from '@nestjs/common';
import { HttpClient, HttpClientError, InjectHttpClient } from '@nestjs/http-client';
import type {
  NormalizedEvent,
  RecognizedSource,
  SourceAdapter,
  SourceSnapshot,
  SourceTarget,
  SyncWindow,
} from '../../source.types.js';
import { SourceResponseInvalidError, SourceUnavailableError, UnsupportedSourceUrlError } from '../../sources.errors.js';
import { toNormalizedEvent } from './yandex-embed.mapper.js';
import { yandexGetEventsResponseSchema } from './yandex-embed.schemas.js';
import { parseYandexEmbedUrl } from './yandex-embed.url.js';

export const YANDEX_CALENDAR_HTTP = 'yandex-calendar';

/** Yandex rejects long ranges ("too long period"); 31 days per request is accepted. */
const MAX_DAYS_PER_REQUEST = 31;
const DAY_MS = 86_400_000;

const toDate = (instant: Date) => instant.toISOString().slice(0, 10);

/** Inclusive [from, to] date ranges covering the window, padded by a day for zone offsets. */
export function requestRanges(window: SyncWindow): { from: string; to: string }[] {
  const ranges: { from: string; to: string }[] = [];
  const last = window.end.getTime() + DAY_MS;
  for (let from = window.start.getTime() - DAY_MS; from <= last; from += MAX_DAYS_PER_REQUEST * DAY_MS) {
    const to = Math.min(from + (MAX_DAYS_PER_REQUEST - 1) * DAY_MS, last);
    ranges.push({ from: toDate(new Date(from)), to: toDate(new Date(to)) });
  }
  return ranges;
}

/**
 * Yandex Calendar embed links. Uses the unofficial endpoint the embed page itself calls
 * (`/embed/models?_models=get-events`); it needs no session, only the layer id and a time zone.
 * The response is validated strictly, because nothing guarantees this API stays the same.
 */
@Injectable()
export class YandexEmbedAdapter implements SourceAdapter {
  readonly type = 'yandex-embed';

  constructor(@InjectHttpClient(YANDEX_CALENDAR_HTTP) private readonly http: HttpClient) {}

  recognize(url: URL): RecognizedSource | undefined {
    const params = parseYandexEmbedUrl(url);
    return params && { type: this.type, name: params.layerName, timeZone: params.timeZone };
  }

  async fetch(source: SourceTarget, window: SyncWindow, signal?: AbortSignal): Promise<SourceSnapshot> {
    const params = parseYandexEmbedUrl(new URL(source.url));
    if (!params) {
      throw new UnsupportedSourceUrlError('Not a Yandex Calendar embed link');
    }

    const byUid = new Map<string, NormalizedEvent>();
    for (const range of requestRanges(window)) {
      for (const event of await this.fetchRange(params.layerIds, params.timeZone, range, signal)) {
        if (event.startsAt >= window.start && event.startsAt < window.end) {
          byUid.set(event.uid, event); // ranges overlap by a day; the same event may come twice
        }
      }
    }
    // Yandex returns structured events: nothing is ever left unread.
    return { events: [...byUid.values()].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()), skipped: [] };
  }

  private async fetchRange(
    layerIds: string[],
    timeZone: string,
    range: { from: string; to: string },
    signal?: AbortSignal,
  ): Promise<NormalizedEvent[]> {
    let body: unknown;
    try {
      ({ data: body } = await this.http.post('/embed/models', {
        query: { _models: 'get-events' },
        headers: { accept: 'application/json', 'x-yandex-maya-timezone': timeZone },
        json: {
          models: [
            {
              name: 'get-events',
              params: { layerId: layerIds, limitAttendees: true, showDeclined: false, ...range },
            },
          ],
        },
        ...(signal ? { signal } : {}),
      }));
    } catch (error) {
      if (error instanceof HttpClientError) {
        throw new SourceUnavailableError('Yandex Calendar is unavailable', { cause: error });
      }
      throw error;
    }

    const parsed = yandexGetEventsResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new SourceResponseInvalidError('Yandex Calendar answered in an unexpected format', {
        cause: parsed.error,
      });
    }
    const [model] = parsed.data.models;
    if (model!.status === 'error') {
      throw new SourceUnavailableError(`Yandex Calendar refused the request (${model!.error.code ?? 'unknown'})`, {
        cause: model!.error.errorCollection,
      });
    }
    return model!.data.events.map(toNormalizedEvent);
  }
}
