import { createHash } from 'node:crypto';
import path from 'node:path';

import type { SponsorMediaKind } from '@openg7/funding-core';
import sharp from 'sharp';

export type SupportedSponsorImageMimeType =
  'image/jpeg' | 'image/png' | 'image/webp';

export interface ProcessSponsorImageInput {
  readonly data: Buffer;
  readonly kind: SponsorMediaKind;
  readonly originalFilename: string;
}

export interface ProcessedSponsorImage {
  readonly originalData: Buffer;
  readonly originalFilename: string;
  readonly originalExtension: 'jpg' | 'png' | 'webp';
  readonly originalMimeType: SupportedSponsorImageMimeType;
  readonly originalSizeBytes: number;
  readonly processedData: Buffer;
  readonly processedMimeType: 'image/webp';
  readonly processedSizeBytes: number;
  readonly checksumSha256: string;
  readonly width: number;
  readonly height: number;
}

const imageFormat = {
  jpeg: { extension: 'jpg', mimeType: 'image/jpeg' },
  png: { extension: 'png', mimeType: 'image/png' },
  webp: { extension: 'webp', mimeType: 'image/webp' }
} as const;

const sanitizeOriginalFilename = (filename: string): string => {
  const basename = path
    .basename(filename)
    .replace(/[\u0000-\u001f\u007f]/g, '');
  return (basename || 'image').slice(0, 200);
};

export const processSponsorImage = async (
  input: ProcessSponsorImageInput
): Promise<ProcessedSponsorImage> => {
  const decoder = sharp(input.data, {
    failOn: 'warning',
    limitInputPixels: 40_000_000,
    sequentialRead: true
  });
  const metadata = await decoder.metadata().catch(() => {
    throw new Error('Sponsor media must be a valid JPEG, PNG, or WebP image.');
  });
  const detected = metadata.format
    ? imageFormat[metadata.format as keyof typeof imageFormat]
    : undefined;

  if (!detected || !metadata.width || !metadata.height) {
    throw new Error('Sponsor media must be a valid JPEG, PNG, or WebP image.');
  }

  const maxDimension = input.kind === 'logo' ? 1200 : 2000;
  const quality = input.kind === 'logo' ? 90 : 82;
  const processed = await decoder
    .rotate()
    .resize({
      width: maxDimension,
      height: maxDimension,
      fit: 'inside',
      withoutEnlargement: true
    })
    .webp({ quality, alphaQuality: 100, effort: 4 })
    .toBuffer({ resolveWithObject: true });

  return {
    originalData: input.data,
    originalFilename: sanitizeOriginalFilename(input.originalFilename),
    originalExtension: detected.extension,
    originalMimeType: detected.mimeType,
    originalSizeBytes: input.data.byteLength,
    processedData: processed.data,
    processedMimeType: 'image/webp',
    processedSizeBytes: processed.data.byteLength,
    checksumSha256: createHash('sha256').update(processed.data).digest('hex'),
    width: processed.info.width,
    height: processed.info.height
  };
};
