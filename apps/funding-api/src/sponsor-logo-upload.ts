import { randomBytes } from 'node:crypto';

import type { MultipartPart } from './http-multipart.js';

export interface SponsorLogoFile {
  readonly data: Buffer;
  readonly extension: 'jpg' | 'png' | 'webp';
  readonly filename: string;
  readonly mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly sizeBytes: number;
}

export const SPONSOR_LOGO_FILENAME_PATTERN =
  /^sponsor-logo-[0-9a-f-]{36}-[0-9]{13}-[a-f0-9]{16}\.(?:jpg|png|webp)$/;
const sponsorLogoContentTypes = new Map<string, string>([
  ['jpg', 'image/jpeg'],
  ['png', 'image/png'],
  ['webp', 'image/webp']
]);
const detectSponsorLogoFileType = (
  data: Buffer
): Pick<SponsorLogoFile, 'extension' | 'mimeType'> | null => {
  if (
    data.length >= 8 &&
    data
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { extension: 'png', mimeType: 'image/png' };
  }

  if (
    data.length >= 3 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[2] === 0xff
  ) {
    return { extension: 'jpg', mimeType: 'image/jpeg' };
  }

  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString('ascii') === 'RIFF' &&
    data.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { extension: 'webp', mimeType: 'image/webp' };
  }

  return null;
};

const createSponsorLogoFilename = (
  contributionId: string,
  extension: SponsorLogoFile['extension']
): string =>
  `sponsor-logo-${contributionId.toLowerCase()}-${Date.now()}-${randomBytes(8).toString('hex')}.${extension}`;

export const parseSponsorLogoUpload = (
  parts: readonly MultipartPart[],
  contributionId: string,
  maxBytes: number
): SponsorLogoFile | null => {
  const filePart = parts.find((part) => part.name === 'logo');
  if (!filePart?.filename || filePart.data.byteLength === 0) {
    return null;
  }

  if (filePart.data.byteLength > maxBytes) {
    return null;
  }

  const detected = detectSponsorLogoFileType(filePart.data);
  if (!detected || filePart.contentType !== detected.mimeType) {
    return null;
  }

  return {
    data: filePart.data,
    extension: detected.extension,
    filename: createSponsorLogoFilename(contributionId, detected.extension),
    mimeType: detected.mimeType,
    sizeBytes: filePart.data.byteLength
  };
};

export const contentTypeForSponsorLogoFilename = (
  filename: string
): string | null =>
  sponsorLogoContentTypes.get(filename.split('.').at(-1) ?? '') ?? null;
