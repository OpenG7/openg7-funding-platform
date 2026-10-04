import type { PublicFundAllocation } from '@openg7/funding-core';
import type { Pool } from 'pg';

import { isPublicAllocationProofUrl } from '../../../packages/funding-core/src/index.js';

import { centsToAmount, parseDbInt } from './fund-transparency-projection.js';

interface AllocationRow {
  readonly project_name: string;
  readonly public_description: string;
  readonly expected_outcome: string;
  readonly progress_status: 'planned' | 'in_progress' | 'delivered';
  readonly proof_url: string | null;
  readonly proof_source: string | null;
  readonly proof_published_at: string | null;
  readonly amount_allocated: string;
  readonly currency: string;
  readonly status: string;
  readonly published_at: string | null;
}

export const getLatestPublicAllocations = async (
  pool: Pool,
  hasFundAllocations: boolean
): Promise<readonly PublicFundAllocation[]> => {
  if (!hasFundAllocations) {
    return [];
  }

  const allocationQuery = await pool.query<AllocationRow>(`
    SELECT
      project_name,
      public_description,
      expected_outcome,
      progress_status,
      proof_url,
      proof_source,
      proof_published_at::text AS proof_published_at,
      amount_allocated::text AS amount_allocated,
      currency,
      status,
      published_at::text AS published_at
    FROM fund_allocations
    WHERE status IN ('published', 'active')
    ORDER BY COALESCE(published_at, created_at) DESC
    LIMIT 8
  `);

  return allocationQuery.rows.map((row) => ({
    project_name: row.project_name,
    public_description: row.public_description,
    expected_outcome: row.expected_outcome,
    progress_status: row.progress_status,
    proof_url: isPublicAllocationProofUrl(row.proof_url) ? row.proof_url : null,
    proof_source: row.proof_source,
    proof_published_at: row.proof_published_at,
    amount_allocated: centsToAmount(parseDbInt(row.amount_allocated)),
    currency: row.currency.toUpperCase(),
    status: row.status,
    published_at: row.published_at
  }));
};
