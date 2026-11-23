import { parseYandexEmbedUrl } from '../../src/sources/adapters/yandex-embed/yandex-embed.url.js';
import type { NormalizedEvent, RecognizedSource, SourceAdapter, SourceSnapshot } from '../../src/sources/source.types.js';

/**
 * Stands in for YandexEmbedAdapter: recognizes the same links, but serves events set by the spec.
 * The real adapter is covered against captured responses in its unit spec.
 */
export class FakeSourceAdapter implements SourceAdapter {
  readonly type = 'yandex-embed';
  events: NormalizedEvent[] = [];
  /** When set, fetch() fails with it. */
  failure: Error | undefined;
  /** When set, fetch() waits for it before answering (to hold a sync in flight). */
  gate: Promise<void> | undefined;
  fetchCount = 0;

  recognize(url: URL): RecognizedSource | undefined {
    const params = parseYandexEmbedUrl(url);
    return params && { type: this.type, name: params.layerName, timeZone: params.timeZone };
  }

  async fetch(): Promise<SourceSnapshot> {
    this.fetchCount++;
    await this.gate;
    if (this.failure) throw this.failure;
    return { events: this.events.map((event) => ({ ...event })), skipped: [] };
  }
}
