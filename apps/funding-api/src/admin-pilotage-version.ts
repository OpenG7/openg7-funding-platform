import { createHash } from 'node:crypto';

/** Keep the version fingerprint identical for read models and command checks. */
export const pilotageVersion = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
