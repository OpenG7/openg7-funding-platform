import {
  isPublicAllocationProofUrl,
  isPublicAllocationStatus,
  type FundTransparencyPublicResponse,
  type PublicFundAllocation
} from '@openg7/funding-core';

import { isTransparencyReport } from './funding-transparency.utils.js';

const nullableText = (value: unknown): boolean =>
  value === null || typeof value === 'string';

const nullableDate = (value: unknown): boolean =>
  value === null ||
  (typeof value === 'string' && Number.isFinite(Date.parse(value)));

function isPublicProgressAllocation(
  value: unknown
): value is PublicFundAllocation {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row['project_name'] === 'string' &&
    row['project_name'].trim().length > 0 &&
    typeof row['public_description'] === 'string' &&
    typeof row['expected_outcome'] === 'string' &&
    typeof row['status'] === 'string' &&
    isPublicAllocationStatus(row['status']) &&
    typeof row['progress_status'] === 'string' &&
    ['planned', 'in_progress', 'delivered'].includes(row['progress_status']) &&
    typeof row['amount_allocated'] === 'number' &&
    Number.isFinite(row['amount_allocated']) &&
    row['amount_allocated'] >= 0 &&
    typeof row['currency'] === 'string' &&
    /^[A-Z]{3}$/.test(row['currency']) &&
    nullableText(row['proof_url']) &&
    nullableText(row['proof_source']) &&
    nullableDate(row['proof_published_at']) &&
    nullableDate(row['published_at'])
  );
}

/** A malformed published allocation makes the report unavailable, never a partial success. */
export function isPublicProgressReport(
  value: unknown
): value is FundTransparencyPublicResponse {
  return (
    isTransparencyReport(value) &&
    value.latest_public_allocations.every(isPublicProgressAllocation)
  );
}

/** A reference is publishable only with an admissible link; its metadata proves no delivery. */
export function publicAllocationReference(
  allocation: Pick<
    PublicFundAllocation,
    'proof_url' | 'proof_source' | 'proof_published_at'
  >
): Pick<
  PublicFundAllocation,
  'proof_url' | 'proof_source' | 'proof_published_at'
> {
  const candidate =
    typeof allocation.proof_url === 'string' ? allocation.proof_url.trim() : '';
  if (!candidate || !isPublicAllocationProofUrl(candidate))
    return { proof_url: null, proof_source: null, proof_published_at: null };

  return {
    proof_url: candidate,
    proof_source:
      typeof allocation.proof_source === 'string'
        ? allocation.proof_source.trim() || null
        : null,
    proof_published_at:
      typeof allocation.proof_published_at === 'string' &&
      Number.isFinite(Date.parse(allocation.proof_published_at))
        ? allocation.proof_published_at
        : null
  };
}

/** Preserve the server's public selection and declared progress without inferring delivery evidence. */
export function publicProgressAllocations(
  report: FundTransparencyPublicResponse
): readonly PublicFundAllocation[] {
  if (report.data_source !== 'database') return [];
  return report.latest_public_allocations.map((allocation) => ({
    project_name: allocation.project_name,
    public_description: allocation.public_description,
    expected_outcome: allocation.expected_outcome,
    progress_status: allocation.progress_status,
    ...publicAllocationReference(allocation),
    amount_allocated: allocation.amount_allocated,
    currency: allocation.currency,
    status: allocation.status,
    published_at: allocation.published_at
  }));
}
