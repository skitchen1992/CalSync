import { HttpClient } from '@nestjs/http-client';
import { loadFixture } from '../../../../test/support/fixtures.js';
import { SourceResponseInvalidError, SourceUnavailableError } from '../../sources.errors.js';
import { requestRanges, YandexEmbedAdapter } from './yandex-embed.adapter.js';
import { toNormalizedEvent } from './yandex-embed.mapper.js';
import { yandexEventSchema } from './yandex-embed.schemas.js';
import { parseYandexEmbedUrl } from './yandex-embed.url.js';

// The link the user shared (layer of the "[П2025]Разработка ИТ-продукта" course).
const EMBED_URL =
  'https://calendar.yandex.ru/embed/week?clckid=053ec2b4&layer_ids=38194026&layer_names=%5B%D0%9F2025%5D%D0%A0%D0%B0%D0%B7%D1%80%D0%B0%D0%B1%D0%BE%D1%82%D0%BA%D0%B0%20%D0%98%D0%A2-%D0%BF%D1%80%D0%BE%D0%B4%D1%83%D0%BA%D1%82%D0%B0&tz_id=Europe%2FMoscow&uid=1130000069942883';
const LAYER_NAME = '[П2025]Разработка ИТ-продукта';

// First event of the captured response.
const FIRST_UID = '0f94eea2-6508-444a-9eac-986873d65f4b@events-38194026';
const FIRST_TITLE = 'Промежуточные презентации НИР';

const WINDOW = { start: new Date('2026-11-16T00:00:00Z'), end: new Date('2026-11-18T00:00:00Z') };
const SOURCE = { url: EMBED_URL, timeZone: 'Europe/Moscow', options: null };

type EventsResponse = { models: [{ data: { events: Record<string, unknown>[] } }] };
const realEvent = () => loadFixture<EventsResponse>('yandex-embed/get-events.json').models[0].data.events[0]!;

function adapterAnswering(...bodies: unknown[]) {
  const requests: { url: string; body: unknown; headers: Headers }[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push({ url: request.url, body: await request.json(), headers: request.headers });
    const body = bodies.length > 1 ? bodies.shift() : bodies[0];
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const http = new HttpClient({ baseUrl: 'https://calendar.yandex.ru', fetch, retry: false });
  return { adapter: new YandexEmbedAdapter(http), requests };
}

describe('parseYandexEmbedUrl', () => {
  it('reads layer ids, name and zone from an embed link', () => {
    expect(parseYandexEmbedUrl(new URL(EMBED_URL))).toEqual({
      layerIds: ['38194026'],
      layerName: LAYER_NAME,
      timeZone: 'Europe/Moscow',
    });
  });

  it.each([
    ['another host', 'https://calendar.example.com/embed/week?layer_ids=1'],
    ['a non-embed page', 'https://calendar.yandex.ru/week?layer_ids=1'],
    ['plain http', 'http://calendar.yandex.ru/embed/week?layer_ids=1'],
    ['no layer ids', 'https://calendar.yandex.ru/embed/week?tz_id=Europe%2FMoscow'],
  ])('rejects %s', (_, url) => {
    expect(parseYandexEmbedUrl(new URL(url))).toBeUndefined();
  });
});

describe('requestRanges', () => {
  it('splits a 67-day window into ranges Yandex accepts', () => {
    const ranges = requestRanges({ start: new Date('2026-11-16T10:00:00Z'), end: new Date('2027-01-22T10:00:00Z') });

    expect(ranges).toEqual([
      { from: '2026-11-15', to: '2026-12-15' },
      { from: '2026-12-16', to: '2027-01-15' },
      { from: '2027-01-16', to: '2027-01-23' },
    ]);
  });
});

describe('toNormalizedEvent', () => {
  it('maps a timed event to local times in its zone and a UTC start instant', () => {
    const event = toNormalizedEvent(yandexEventSchema.parse(realEvent()));

    expect(event).toMatchObject({
      uid: FIRST_UID,
      title: FIRST_TITLE,
      start: { dateTime: '2026-11-16T09:30:00', timeZone: 'Europe/Moscow' },
      end: { dateTime: '2026-11-16T13:00:00', timeZone: 'Europe/Moscow' },
      startsAt: new Date('2026-11-16T06:30:00Z'),
    });
    expect(event.location).toMatch(/^https:\/\/meet\.example\.com\//);
  });

  it('maps an all-day event to dates with an exclusive end', () => {
    const allDay = { ...realEvent(), isAllDay: true, startTs: '2026-11-20T00:00:00', endTs: '2026-11-21T00:00:00' };

    expect(toNormalizedEvent(yandexEventSchema.parse(allDay))).toMatchObject({
      start: { date: '2026-11-20' },
      end: { date: '2026-11-21' },
    });
  });

  it('gives each instance of a recurring series its own uid', () => {
    const instance = { ...realEvent(), isRecurrence: true };

    expect(toNormalizedEvent(yandexEventSchema.parse(instance)).uid).toBe(`${FIRST_UID}#2026-11-16T06:30:00`);
  });

  it('adds the conference link to the description once', () => {
    const withConference = { ...realEvent(), description: 'Agenda', conferenceUrl: 'https://telemost.example.com/j/1' };

    expect(toNormalizedEvent(yandexEventSchema.parse(withConference)).description).toBe(
      'Agenda\n\nhttps://telemost.example.com/j/1',
    );
  });
});

describe('YandexEmbedAdapter', () => {
  it('recognizes the embed link with its layer name and zone', () => {
    const { adapter } = adapterAnswering({});

    expect(adapter.recognize(new URL(EMBED_URL))).toEqual({
      type: 'yandex-embed',
      name: LAYER_NAME,
      timeZone: 'Europe/Moscow',
    });
  });

  it('asks the fixed Yandex host for the layer and keeps the events inside the window', async () => {
    const { adapter, requests } = adapterAnswering(loadFixture('yandex-embed/get-events.json'));

    const events = await adapter.fetch(SOURCE, WINDOW);

    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe('https://calendar.yandex.ru/embed/models?_models=get-events');
    expect(requests[0]!.headers.get('x-yandex-maya-timezone')).toBe('Europe/Moscow');
    expect(requests[0]!.body).toMatchObject({
      models: [{ name: 'get-events', params: { layerId: ['38194026'], from: '2026-11-15', to: '2026-11-19' } }],
    });
    expect(events.map((event) => event.startsAt.toISOString())).toEqual([
      '2026-11-16T06:30:00.000Z',
      '2026-11-16T09:00:00.000Z',
      '2026-11-16T16:00:00.000Z',
      '2026-11-17T06:30:00.000Z',
    ]);
  });

  it('turns an error answer into SourceUnavailableError', async () => {
    const { adapter } = adapterAnswering(loadFixture('yandex-embed/get-events-too-long-period.json'));

    await expect(adapter.fetch(SOURCE, WINDOW)).rejects.toBeInstanceOf(SourceUnavailableError);
  });

  it('turns an unexpected shape into SourceResponseInvalidError', async () => {
    const { adapter } = adapterAnswering({ models: [{ name: 'get-events', status: 'ok', data: { items: [] } }] });

    await expect(adapter.fetch(SOURCE, WINDOW)).rejects.toBeInstanceOf(SourceResponseInvalidError);
  });
});
