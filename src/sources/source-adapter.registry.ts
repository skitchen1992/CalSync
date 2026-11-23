import { Inject, Injectable } from '@nestjs/common';
import type { SourceType } from '../db/schema.js';
import type { RecognizedSource, SourceAdapter } from './source.types.js';
import { UnsupportedSourceUrlError } from './sources.errors.js';

export const SOURCE_ADAPTERS = Symbol('SOURCE_ADAPTERS');

/** Picks the adapter for a URL or a stored source type. */
@Injectable()
export class SourceAdapterRegistry {
  constructor(@Inject(SOURCE_ADAPTERS) private readonly adapters: SourceAdapter[]) {}

  recognize(rawUrl: string): RecognizedSource {
    let url: URL;
    try {
      url = new URL(rawUrl.trim());
    } catch {
      throw new UnsupportedSourceUrlError('Not a valid URL');
    }
    for (const adapter of this.adapters) {
      const recognized = adapter.recognize(url);
      if (recognized) {
        return recognized;
      }
    }
    throw new UnsupportedSourceUrlError('No adapter supports this URL');
  }

  get(type: SourceType): SourceAdapter {
    const adapter = this.adapters.find((candidate) => candidate.type === type);
    if (!adapter) {
      throw new Error(`No adapter registered for source type ${type}`);
    }
    return adapter;
  }
}
