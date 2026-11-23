const YANDEX_HOSTS = new Set(['calendar.yandex.ru', 'calendar.yandex.com']);
const DEFAULT_TIME_ZONE = 'Europe/Moscow';
const DEFAULT_NAME = 'Яндекс Календарь';

export interface YandexEmbedParams {
  layerIds: string[];
  layerName: string;
  timeZone: string;
}

/**
 * Reads an embed link (https://calendar.yandex.ru/embed/week?layer_ids=…&tz_id=…&layer_names=…).
 * Only the layer ids, name and zone are used: requests always go to the fixed Yandex host,
 * never to the URL the user sent.
 */
export function parseYandexEmbedUrl(url: URL): YandexEmbedParams | undefined {
  if (url.protocol !== 'https:' || !YANDEX_HOSTS.has(url.hostname) || !url.pathname.startsWith('/embed/')) {
    return undefined;
  }
  const layerIds = (url.searchParams.get('layer_ids') ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => /^\d+$/.test(id));
  if (layerIds.length === 0) {
    return undefined;
  }
  const layerName = url.searchParams.get('layer_names')?.trim();
  return {
    layerIds,
    layerName: layerName ? layerName : DEFAULT_NAME,
    timeZone: url.searchParams.get('tz_id') ?? DEFAULT_TIME_ZONE,
  };
}
