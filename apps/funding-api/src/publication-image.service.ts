import { createHash } from 'node:crypto';

import sharp from 'sharp';
import type { SponsorMediaUsageRights } from '@openg7/funding-core';

import {
  normalizeSponsorMediaUsage,
  sponsorMediaUsageIssue
} from '../../../packages/funding-core/src/index.js';

import { PublicationAutomationError } from './publication-automation/policy.js';

export const PUBLICATION_IMAGE_TRANSFORM = 'jpeg90-srgb-white-v1';

/** The same deterministic preparation supplies private previews and provider dispatch. */
export async function preparePublicationImage(source: Buffer): Promise<{
  readonly bytes: Buffer;
  readonly mimeType: 'image/jpeg';
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly transform: string;
}> {
  const prepared = await sharp(source, {
    failOn: 'warning',
    limitInputPixels: 40_000_000
  })
    .rotate()
    .flatten({ background: '#ffffff' })
    .toColourspace('srgb')
    .jpeg({ quality: 90 })
    .toBuffer({ resolveWithObject: true });
  return {
    bytes: prepared.data,
    mimeType: 'image/jpeg',
    sha256: createHash('sha256').update(prepared.data).digest('hex'),
    width: prepared.info.width,
    height: prepared.info.height,
    transform: PUBLICATION_IMAGE_TRANSFORM
  };
}

export const PUBLICATION_PORTRAIT_TRANSFORM = 'contained-portrait-jpeg90-v1';
export interface PublicationPortraitInput {
  readonly contributionId: string;
  readonly name: string;
  readonly credit: string | null;
  readonly bytes: Buffer;
  readonly channel: 'facebook' | 'linkedin';
  readonly target: 'openg7' | 'openg20';
  readonly media: {
    readonly contributionId: string;
    readonly kind: string;
    readonly moderationApproved: boolean;
    readonly usage: SponsorMediaUsageRights;
    readonly restrictionsReviewed: boolean;
  };
}

/** Contains the owner's approved photograph and renders every supplied name/credit in full. */
export async function preparePortraitImage(input: PublicationPortraitInput) {
  if (
    !input.contributionId ||
    input.media.contributionId !== input.contributionId ||
    input.media.kind !== 'supporting_image'
  )
    throw new PublicationAutomationError('PORTRAIT_PHOTO_OWNER_REQUIRED', 409);
  if (input.media.moderationApproved !== true)
    throw new PublicationAutomationError('MEDIA_NOT_APPROVED', 409);
  const usage = normalizeSponsorMediaUsage(input.media.usage);
  if (input.credit !== usage.credit)
    throw new PublicationAutomationError('MEDIA_CREDIT_REQUIRED', 409);
  const issue = sponsorMediaUsageIssue(usage, {
    channel: input.channel,
    target: input.target,
    transformations: ['technical', 'portrait'],
    restrictionsReviewed: input.media.restrictionsReviewed,
    renderedCredit: input.credit
  });
  if (issue) throw new PublicationAutomationError(issue, 409);
  if (
    !input.name.trim() ||
    input.name.length > 300 ||
    /[\u0000-\u001f\u007f]/.test(input.name)
  )
    throw new PublicationAutomationError('PORTRAIT_LABEL_TOO_LONG', 400);
  const width = 1200,
    margin = 32,
    photoHeight = 720,
    height = 1024;
  const escapeMarkup = (value: string) =>
    value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&apos;');
  const photo = await sharp(input.bytes, {
    failOn: 'warning',
    limitInputPixels: 40_000_000
  })
    .rotate()
    .resize(width - margin * 2, photoHeight, {
      fit: 'contain',
      background: '#ffffff'
    })
    .flatten({ background: '#ffffff' })
    .toColourspace('srgb')
    .png()
    .toBuffer();
  const label = await sharp({
    text: {
      text: escapeMarkup([input.name, input.credit].filter(Boolean).join('\n')),
      font: 'sans 32',
      width: width - margin * 2,
      wrap: 'word-char',
      align: 'centre',
      rgba: true,
      dpi: 72
    }
  })
    .png()
    .toBuffer({ resolveWithObject: true });
  if (label.info.height > 176)
    throw new PublicationAutomationError('PORTRAIT_LABEL_TOO_LONG', 400);
  const disclosure = await sharp({
    text: {
      text: 'Commandite rémunérée · Paid sponsorship',
      font: 'sans 20',
      width: width - margin * 2,
      align: 'centre',
      rgba: true,
      dpi: 72
    }
  })
    .png()
    .toBuffer({ resolveWithObject: true });
  const bytes = await sharp({
    create: { width, height, channels: 3, background: '#ffffff' }
  })
    .composite([
      { input: photo, left: margin, top: margin },
      {
        input: label.data,
        left: Math.floor((width - label.info.width) / 2),
        top: margin + photoHeight + 24
      },
      {
        input: disclosure.data,
        left: Math.floor((width - disclosure.info.width) / 2),
        top: height - 44
      }
    ])
    .toColourspace('srgb')
    .jpeg({ quality: 90 })
    .toBuffer();
  return {
    bytes,
    mimeType: 'image/jpeg' as const,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    width,
    height,
    transform: PUBLICATION_PORTRAIT_TRANSFORM
  };
}
