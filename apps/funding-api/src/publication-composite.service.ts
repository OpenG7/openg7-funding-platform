import { createHash } from 'node:crypto';

import sharp, { type OverlayOptions } from 'sharp';

import { PublicationAutomationError } from './publication-automation/policy.js';

export const PUBLICATION_COMPOSITE_TRANSFORM =
  'equal-cells-contained-jpeg90-v1';
export interface PublicationCompositeSource {
  readonly contributionId: string;
  readonly name: string;
  readonly credit: string | null;
  readonly bytes: Buffer;
}
const escapeMarkup = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

/** Equal cells and contained images; no participant, name or credit is silently omitted. */
export async function preparePublicationComposite(
  sources: readonly PublicationCompositeSource[]
) {
  if (
    !sources.length ||
    sources.length > 10 ||
    new Set(sources.map((s) => s.contributionId)).size !== sources.length
  )
    throw new PublicationAutomationError('COMPOSITE_PARTICIPANTS_INVALID', 400);
  const columns =
    sources.length <= 2 ? sources.length : sources.length <= 4 ? 2 : 3;
  const rows = Math.ceil(sources.length / columns);
  const width = 1200,
    margin = 24,
    cellWidth = Math.floor((width - margin * (columns + 1)) / columns),
    photoHeight = 240,
    cellHeight = 360;
  const height = margin + rows * (cellHeight + margin) + 64;
  const overlays: OverlayOptions[] = [];
  for (let index = 0; index < sources.length; index++) {
    const source = sources[index]!;
    if (
      !source.name.trim() ||
      /[\u0000-\u001f\u007f]/.test(source.name) ||
      source.name.length > 300 ||
      (source.credit?.length ?? 0) > 200
    )
      throw new PublicationAutomationError('COMPOSITE_LABEL_TOO_LONG', 400);
    const left = margin + (index % columns) * (cellWidth + margin),
      top = margin + Math.floor(index / columns) * (cellHeight + margin);
    const photo = await sharp(source.bytes, {
      failOn: 'warning',
      limitInputPixels: 40_000_000
    })
      .rotate()
      .resize(cellWidth, photoHeight, { fit: 'contain', background: '#ffffff' })
      .flatten({ background: '#ffffff' })
      .toColourspace('srgb')
      .png()
      .toBuffer();
    const label = await sharp({
      text: {
        text: escapeMarkup(
          [source.name, source.credit].filter(Boolean).join('\n')
        ),
        font: 'sans 26',
        width: cellWidth,
        wrap: 'word-char',
        align: 'centre',
        rgba: true,
        dpi: 72
      }
    })
      .png()
      .toBuffer({ resolveWithObject: true });
    if (label.info.height > cellHeight - photoHeight - 16)
      throw new PublicationAutomationError('COMPOSITE_LABEL_TOO_LONG', 400);
    overlays.push(
      { input: photo, left, top },
      {
        input: label.data,
        left: left + Math.floor((cellWidth - label.info.width) / 2),
        top: top + photoHeight + 16
      }
    );
  }
  const disclosure = await sharp({
    text: {
      text: 'Commandite rémunérée · Paid sponsorship',
      font: 'sans 18',
      width: width - 2 * margin,
      align: 'centre',
      rgba: true,
      dpi: 72
    }
  })
    .png()
    .toBuffer({ resolveWithObject: true });
  overlays.push({
    input: disclosure.data,
    left: Math.floor((width - disclosure.info.width) / 2),
    top: height - 48
  });
  const bytes = await sharp({
    create: { width, height, channels: 3, background: '#ffffff' }
  })
    .composite(overlays)
    .toColourspace('srgb')
    .jpeg({ quality: 90 })
    .toBuffer();
  return {
    bytes,
    mimeType: 'image/jpeg' as const,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    width,
    height,
    transform: PUBLICATION_COMPOSITE_TRANSFORM,
    contributionIds: sources.map((s) => s.contributionId)
  };
}
