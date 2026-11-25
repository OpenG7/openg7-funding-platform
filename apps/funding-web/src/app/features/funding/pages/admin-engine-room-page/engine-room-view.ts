import type { PublicationFeed } from '@openg7/funding-core';

/** Independent dimensions: account verification never implies a running worker. */
export function engineFeedHealth(feed: PublicationFeed): string {
  if (feed.mode === 'disabled') return 'disabled';
  if (!feed.configured) return 'unconfigured';
  if (feed.connection !== 'ready') return feed.connection;
  return feed.paused ? 'paused' : 'ready';
}

export function heartbeatState(
  lastSeen: string | null,
  now: number
): 'recent' | 'stale' | 'unknown' {
  const timestamp = lastSeen ? Date.parse(lastSeen) : NaN;
  if (!Number.isFinite(timestamp) || timestamp > now) return 'unknown';
  return now - timestamp <= 45_000 ? 'recent' : 'stale';
}
