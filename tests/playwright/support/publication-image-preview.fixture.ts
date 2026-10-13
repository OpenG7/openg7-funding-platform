import { createHash } from 'node:crypto';

import type { Page } from '@playwright/test';
import type {
  PublicationAutomationCommand,
  PublicationDelivery,
  PublicationMediaOption
} from '@openg7/funding-core';
import sharp from 'sharp';

import { syntheticHighResolutionPhoto } from '../../integration/support/publication-visual-load-images.mjs';
import { processSponsorImage } from '../../../apps/funding-api/src/sponsor-image.service.js';
import { preparePublicationImage } from '../../../apps/funding-api/src/publication-image.service.js';

import { expect } from './test.js';

export interface PublicationImagePreviewContext {
  setup(
    page: Page,
    job: Partial<PublicationDelivery>,
    media: Record<string, PublicationMediaOption[]>,
    privateBatchCompose?: boolean
  ): Promise<PublicationAutomationCommand[]>;
}
export async function syntheticPublicationJpeg() {
  const bytes = await sharp({
    create: { width: 12, height: 20, channels: 3, background: '#dd7700' }
  })
    .jpeg({ quality: 90 })
    .toBuffer();
  return { bytes, hash: createHash('sha256').update(bytes).digest('hex') };
}
interface NormalizedPublicationJpeg {
  readonly bytes: Buffer;
  readonly hash: string;
}
let normalizedCollectionImages:
  Promise<readonly NormalizedPublicationJpeg[]> | undefined;

/** Lazily share immutable synthetic bytes; normalisation runs once per test worker. */
export function normalizedPublicationCollection() {
  return (normalizedCollectionImages ??= (async () => {
    const images: NormalizedPublicationJpeg[] = [];
    for (let index = 0; index < 10; index++) {
      const original = await syntheticHighResolutionPhoto(index);
      const source = await processSponsorImage({
        data: original.bytes,
        kind: 'supporting_image',
        originalFilename: `synthetic-large-${index + 1}.jpg`
      });
      expect([source.width, source.height]).toEqual([2000, 1333]);
      const image = await preparePublicationImage(source.processedData);
      expect([image.width, image.height]).toEqual([2000, 1333]);
      expect(image.mimeType).toBe('image/jpeg');
      images.push({ bytes: image.bytes, hash: image.sha256 });
    }
    expect(new Set(images.map((image) => image.hash)).size).toBe(10);
    return images;
  })());
}
