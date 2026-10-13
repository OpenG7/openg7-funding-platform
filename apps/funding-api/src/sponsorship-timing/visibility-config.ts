export interface SponsorshipVisibilityConfig {
  readonly enabled: boolean;
  readonly origin: string | null;
  readonly intervalMs: number;
  readonly batchSize: number;
}

/** Server-owned HTTPS origin only; never accept a dossier's URL or a request parameter. */
export function loadSponsorshipVisibilityConfig(
  env: NodeJS.ProcessEnv = process.env
): SponsorshipVisibilityConfig {
  const enabled = env.FUNDING_SPONSORSHIP_VISIBILITY_ENABLED ?? 'false';
  if (!['true', 'false'].includes(enabled))
    throw new Error(
      'FUNDING_SPONSORSHIP_VISIBILITY_ENABLED must be true or false.'
    );
  const integer = (key: string, fallback: number, min: number, max: number) => {
    const raw = env[key] ?? String(fallback);
    const value = Number(raw);
    if (
      !/^\d+$/.test(raw) ||
      !Number.isSafeInteger(value) ||
      value < min ||
      value > max
    )
      throw new Error(`${key} is outside its supported integer range.`);
    return value;
  };
  const rawOrigin = env.FUNDING_SPONSORSHIP_VISIBILITY_ORIGIN?.trim();
  let origin: string | null = null;
  if (rawOrigin) {
    let url: URL;
    try {
      url = new URL(rawOrigin);
    } catch {
      throw new Error(
        'FUNDING_SPONSORSHIP_VISIBILITY_ORIGIN must be an HTTPS origin.'
      );
    }
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/' ||
      (url.port && url.port !== '443')
    )
      throw new Error(
        'FUNDING_SPONSORSHIP_VISIBILITY_ORIGIN must be an HTTPS origin.'
      );
    origin = url.origin;
  }
  if (enabled === 'true' && !origin)
    throw new Error(
      'FUNDING_SPONSORSHIP_VISIBILITY_ORIGIN is required when enabled.'
    );
  return {
    enabled: enabled === 'true',
    origin,
    intervalMs:
      integer(
        'FUNDING_SPONSORSHIP_VISIBILITY_INTERVAL_SECONDS',
        900,
        60,
        86400
      ) * 1000,
    batchSize: integer('FUNDING_SPONSORSHIP_VISIBILITY_BATCH_SIZE', 5, 1, 20)
  };
}
