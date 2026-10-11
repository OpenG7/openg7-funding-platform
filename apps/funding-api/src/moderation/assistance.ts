import { isIP } from 'node:net';

import {
  suggestTextModeration,
  type ModerationSubject
} from '../../../../packages/funding-core/src/index.js';

import { getModerationContent, type ModerationDb } from './content.js';

function reviewText(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(reviewText);
  const texts: string[] = [];
  for (const [key, item] of Object.entries(value)) {
    if (
      [
        'message',
        'title',
        'body',
        'disclosure',
        'publicSummary',
        'publicName',
        'companyName',
        'altText'
      ].includes(key) &&
      typeof item === 'string'
    )
      texts.push(item);
    else if (item && typeof item === 'object') texts.push(...reviewText(item));
  }
  return texts;
}
export async function assistModerationContent(
  db: ModerationDb,
  subject: ModerationSubject
) {
  const content = await getModerationContent(db, subject);
  const text = reviewText(content.snapshot).join('\n\n');
  return {
    ...suggestTextModeration({
      subject,
      contentVersion: content.contentVersion,
      contentFingerprint: content.fingerprint,
      text
    }),
    capabilities: {
      text: 'local_advisory',
      ocr: 'not_configured',
      externalLinks: 'not_configured'
    },
    textLength: text.length
  };
}

/** A future isolated link adapter must pin DNS and revalidate every redirect. */
export function isSafeModerationLinkDestination(
  input: string,
  resolvedAddresses: readonly string[]
): boolean {
  if (
    input.length > 2048 ||
    !resolvedAddresses.length ||
    resolvedAddresses.length > 8
  )
    return false;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return false;
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443')
  )
    return false;
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    host === 'localhost' ||
    /\.(localhost|local|internal|test|invalid)$/.test(host)
  )
    return false;
  const publicAddress = (address: string) => {
    const kind = isIP(address);
    if (kind === 4) {
      const [a, b, c] = address.split('.').map(Number);
      return !(
        a === 0 ||
        a === 10 ||
        a === 127 ||
        a >= 224 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 &&
          (b === 168 ||
            (b === 88 && c === 99) ||
            (b === 0 && (c === 0 || c === 2)))) ||
        (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
        (a === 203 && b === 0 && c === 113)
      );
    }
    if (kind === 6) {
      const normalized = address.toLowerCase();
      // Only ordinary global unicast; mapped, local, documentation and tunnel ranges abstain.
      const fields = normalized.split(':');
      const first = Number.parseInt(fields[0]!, 16);
      const second = Number.parseInt(fields[1] || '0', 16);
      return (
        first >= 0x2000 &&
        first <= 0x3fff &&
        first !== 0x2002 &&
        !(
          first === 0x2001 &&
          (second === 0 ||
            second === 0xdb8 ||
            (second >= 0x10 && second <= 0x2f))
        )
      );
    }
    return false;
  };
  if (isIP(host) && !publicAddress(host)) return false;
  return resolvedAddresses.every(publicAddress);
}
