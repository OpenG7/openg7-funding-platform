import type {
  FundTransparencyPublicResponse,
  PublicFundAllocation
} from './public-funding.js';

/** Public allocation policy shared by the API and its confirmation UI. */
export const PUBLIC_ALLOCATION_CREATE_CONFIRMATION = 'CREATE_PUBLIC_ALLOCATION';

export const isPublicAllocationStatus = (status: string | undefined): boolean =>
  status === 'published' || status === 'active';

export const allocationRequiresConfirmation = (
  current: string | undefined,
  next: string | undefined
): boolean =>
  isPublicAllocationStatus(current) ||
  isPublicAllocationStatus(next) ||
  (next !== undefined &&
    next !== current &&
    ['private', 'archived'].includes(next));

/** Preserve the decimal API contract while rejecting rounding and unsafe integers. */
export function allocationAmountMinor(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const minor = Math.round(value * 100);
  return minor > 0 && Number.isSafeInteger(minor) && minor / 100 === value
    ? minor
    : null;
}

export function isPublicAllocationProofUrl(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

export type AdminExpenseStatus =
  'draft' | 'published' | 'active' | 'private' | 'archived';

export interface AdminExpenseRecord extends PublicFundAllocation {
  readonly id: string;
  readonly status: AdminExpenseStatus;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface AdminExpensesSummary {
  readonly total_count: number;
  readonly published_count: number;
  readonly draft_count: number;
  readonly private_count: number;
  readonly archived_count: number;
  readonly total_allocated: number;
  readonly published_allocated: number;
  readonly currency: string;
}

export interface AdminExpensesResponse {
  readonly data_source: 'database';
  readonly summary: AdminExpensesSummary;
  readonly expenses: readonly AdminExpenseRecord[];
  readonly last_updated_at: string;
}

export interface AdminExpenseCreateRequest {
  readonly confirmation?: string;
  readonly projectName: string;
  readonly publicDescription: string;
  readonly expectedOutcome: string;
  readonly progressStatus: 'planned' | 'in_progress' | 'delivered';
  readonly proofUrl?: string | null;
  readonly proofSource?: string | null;
  readonly proofPublishedAt?: string | null;
  readonly amountAllocated: number;
  readonly currency: 'CAD';
  readonly status: AdminExpenseStatus;
  readonly publishedAt?: string | null;
}

export interface AdminExpenseUpdateRequest extends Partial<AdminExpenseCreateRequest> {
  readonly expenseId: string;
  readonly expectedVersion: string;
}

export interface AdminExpenseMutationResult {
  readonly updated: boolean;
  readonly expense: AdminExpenseRecord | null;
}

export interface AdminTransparencyResponse {
  readonly data_source: 'database';
  readonly public_summary: FundTransparencyPublicResponse;
  readonly expenses_summary: AdminExpensesSummary;
  readonly expenses: readonly AdminExpenseRecord[];
  readonly last_updated_at: string;
}
