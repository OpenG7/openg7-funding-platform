import type { FundTransparencyPublicResponse } from '@openg7/funding-core';

/** One cache per configured reader/account/project, with shared concurrent reads. */
export function createPublicTransparencyCache(
  read: () => Promise<FundTransparencyPublicResponse>,
  {
    ttlMs = 60_000,
    now = Date.now
  }: { ttlMs?: number; now?: () => number } = {}
): () => Promise<FundTransparencyPublicResponse> {
  let cached: FundTransparencyPublicResponse | null = null;
  let expiresAt = 0;
  let pending: Promise<FundTransparencyPublicResponse> | null = null;
  return () => {
    if (cached && now() < expiresAt) return Promise.resolve(cached);
    if (pending) return pending;
    const startedAt = now();
    // Starting expiry before the read also bounds the age of a slow projection.
    pending = Promise.resolve()
      .then(read)
      .then((report) => {
        cached = report;
        expiresAt = startedAt + ttlMs;
        return report;
      })
      .finally(() => {
        pending = null;
      });
    // Expired results are never served as a successful fallback after failure.
    return pending;
  };
}
