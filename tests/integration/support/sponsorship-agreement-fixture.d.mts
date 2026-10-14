import type { Pool } from 'pg';

export function recordFixtureSponsorshipAgreement(
  pool: Pool,
  contributionId: string,
  options: {
    channel?: string;
    channels?: string[];
    target?: string;
    quantity?: number;
  }
): Promise<unknown>;
