import { isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';

export function loadTrustedProxyHops(value: string | undefined): number {
  const hops = value === undefined ? 0 : Number(value);
  if (!Number.isSafeInteger(hops) || hops < 0 || hops > 8)
    throw new Error(
      'FUNDING_TRUSTED_PROXY_HOPS must be an integer between 0 and 8.'
    );
  return hops;
}

/** Enable only when the API is reachable exclusively through that many proxies. */
export function requestClientIp(
  request: IncomingMessage,
  trustedHops: number
): string {
  const peer = request.socket.remoteAddress ?? 'unknown';
  const forwarded = request.headers['x-forwarded-for'];
  if (!trustedHops || typeof forwarded !== 'string') return peer;
  const chain = forwarded.split(',').map((value) => value.trim());
  // Work from the trusted end; a client-provided prefix must not choose the bucket.
  const candidate = chain[chain.length - trustedHops];
  return candidate && isIP(candidate) ? candidate : peer;
}
