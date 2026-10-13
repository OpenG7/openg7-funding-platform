import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';

import type { SponsorshipPublicObservationReason } from '@openg7/funding-core';

export class PublicObservationHttpError extends Error {
  constructor(readonly reason: SponsorshipPublicObservationReason) {
    super(reason);
  }
}

export interface PublicObservationResponse {
  readonly status: number;
  readonly contentType: string;
  readonly body: Buffer;
}

export type PublicObservationGet = (
  path: string,
  maxBytes: number,
  timeoutMs: number
) => Promise<PublicObservationResponse>;

/** Conservative deny rules, including mapped IPv4 and transition/documentation networks. */
export function isPublicObservationAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number) as [
      number,
      number,
      number
    ];
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (isIP(address) !== 6) return false;
  const [head = '', tail = ''] = address.toLowerCase().split('::');
  const first = Number.parseInt(head.split(':')[0] || '0', 16);
  const firstTwo = head
    .split(':')
    .filter(Boolean)
    .map((part) => Number.parseInt(part, 16));
  // A omitted second word is zero. Expanded and padded spellings use the same numeric rules.
  const second =
    firstTwo[1] ??
    (address.includes('::')
      ? 0
      : Number.parseInt(tail.split(':')[0] || '0', 16));
  return (
    first >= 0x2000 &&
    first <= 0x3fff &&
    first !== 0x2002 &&
    first !== 0x3fff &&
    !(first === 0x2001 && (second <= 0x1ff || second === 0xdb8))
  );
}

/** DNS is checked in full then pinned for this request; redirects and compressed bodies are refused. */
export function createPublicObservationGet(
  origin: string,
  ports: {
    readonly resolve?: (
      hostname: string
    ) => Promise<readonly { address: string; family: number }[]>;
    readonly request?: typeof request;
  } = {}
): PublicObservationGet {
  const base = new URL(origin);
  if (
    base.protocol !== 'https:' ||
    base.username ||
    base.password ||
    base.pathname !== '/' ||
    base.search ||
    base.hash ||
    (base.port && base.port !== '443')
  )
    throw new PublicObservationHttpError('DNS_UNSAFE');
  return async (path, maxBytes, timeoutMs) => {
    if (
      !/^\/api\/public\/(?:sponsorships\?page=\d+&pageSize=50|sponsor-media\/[0-9a-f-]{36})$/i.test(
        path
      )
    )
      throw new PublicObservationHttpError('DNS_UNSAFE');
    const deadline = Date.now() + timeoutMs;
    let dnsTimer: ReturnType<typeof setTimeout> | undefined;
    const addresses = await Promise.race([
      (
        ports.resolve ??
        ((hostname: string) => lookup(hostname, { all: true, verbatim: true }))
      )(base.hostname),
      new Promise<never>((_, reject) => {
        dnsTimer = setTimeout(
          () => reject(new PublicObservationHttpError('HTTP_TIMEOUT')),
          timeoutMs
        );
      })
    ]).finally(() => clearTimeout(dnsTimer));
    if (
      !addresses.length ||
      addresses.some((record) => !isPublicObservationAddress(record.address))
    )
      throw new PublicObservationHttpError('DNS_UNSAFE');
    const pinned = addresses[0]!;
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new PublicObservationHttpError('HTTP_TIMEOUT');
    return new Promise<PublicObservationResponse>((resolve, reject) => {
      const abort = AbortSignal.timeout(remaining);
      const req = (ports.request ?? request)(
        new URL(path, base),
        {
          method: 'GET',
          agent: false,
          signal: abort,
          family: pinned.family,
          lookup: (_hostname, _options, callback) =>
            callback(null, pinned.address, pinned.family),
          headers: {
            Accept: 'application/json,image/webp',
            'Accept-Encoding': 'identity'
          }
        },
        (res) => {
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400) {
            res.destroy();
            reject(new PublicObservationHttpError('HTTP_REDIRECT'));
            return;
          }
          if ((res.headers['content-encoding'] ?? 'identity') !== 'identity') {
            res.destroy();
            reject(new PublicObservationHttpError('HTTP_INVALID'));
            return;
          }
          const length = Number(res.headers['content-length'] ?? 0);
          if (length > maxBytes) {
            res.destroy();
            reject(new PublicObservationHttpError('HTTP_TOO_LARGE'));
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > maxBytes) {
              res.destroy();
              reject(new PublicObservationHttpError('HTTP_TOO_LARGE'));
            } else chunks.push(chunk);
          });
          res.on('end', () =>
            resolve({
              status,
              contentType: String(res.headers['content-type'] ?? ''),
              body: Buffer.concat(chunks)
            })
          );
          res.on('error', () =>
            reject(
              new PublicObservationHttpError(
                abort.aborted ? 'HTTP_TIMEOUT' : 'HTTP_ERROR'
              )
            )
          );
        }
      );
      req.on('error', () =>
        reject(
          new PublicObservationHttpError(
            abort.aborted ? 'HTTP_TIMEOUT' : 'HTTP_ERROR'
          )
        )
      );
      req.end();
    });
  };
}
