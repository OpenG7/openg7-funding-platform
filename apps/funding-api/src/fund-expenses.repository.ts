import type {
  AdminExpenseCreateRequest,
  AdminExpenseMutationResult,
  AdminExpenseRecord,
  AdminExpensesResponse,
  AdminExpensesSummary,
  AdminExpenseStatus,
  AdminExpenseUpdateRequest
} from '@openg7/funding-core';
import type { Pool, PoolClient } from 'pg';

import {
  allocationAmountMinor,
  allocationRequiresConfirmation,
  isPublicAllocationStatus,
  isPublicAllocationProofUrl,
  PUBLIC_ALLOCATION_CREATE_CONFIRMATION
} from '../../../packages/funding-core/src/index.js';

import { insertAdminAuditLog } from './fund-admin-audit.repository.js';
import { getAdminBackofficePresence } from './fund-admin.persistence.js';

export const allowedAdminExpenseStatuses = new Set<AdminExpenseStatus>([
  'draft',
  'published',
  'active',
  'private',
  'archived'
]);

interface AdminExpenseRow {
  readonly id: string;
  readonly project_name: string;
  readonly public_description: string;
  readonly expected_outcome: string;
  readonly progress_status: 'planned' | 'in_progress' | 'delivered';
  readonly proof_url: string | null;
  readonly proof_source: string | null;
  readonly proof_published_at: string | null;
  readonly amount_allocated: string;
  readonly currency: string;
  readonly status: AdminExpenseStatus;
  readonly published_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface AdminExpensesSummaryRow {
  readonly total_count: string;
  readonly published_count: string;
  readonly draft_count: string;
  readonly private_count: string;
  readonly archived_count: string;
  readonly total_allocated: string;
  readonly published_allocated: string;
  readonly currency: string;
  readonly last_updated_at: string;
}

export interface AdminExpenseAuditInput {
  readonly actor: string;
  readonly action: string;
}

const centsToAmount = (value: number): number =>
  Number((value / 100).toFixed(2));

export class AdminExpenseValidationError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

const validateExpenseFields = (
  input: AdminExpenseCreateRequest | AdminExpenseUpdateRequest
): void => {
  if (
    input.amountAllocated !== undefined &&
    allocationAmountMinor(input.amountAllocated) === null
  ) {
    throw new AdminExpenseValidationError(
      'invalid_amount',
      'Allocation amount must contain exact positive minor units.'
    );
  }
  if (!isPublicAllocationProofUrl(input.proofUrl)) {
    throw new AdminExpenseValidationError(
      'invalid_proof',
      'Allocation proof must be an HTTPS URL without credentials.'
    );
  }
};

const requireExpenseConfirmation = (
  actual: string | undefined,
  expected: string
): void => {
  if (actual !== expected) {
    throw new AdminExpenseValidationError(
      'confirmation_required',
      'Confirm the allocation content and visibility before proceeding.'
    );
  }
};

const parseDbInt = (value: string): number => Number.parseInt(value, 10);

const normalizeAdminExpenseStatus = (
  value: AdminExpenseStatus
): AdminExpenseStatus =>
  allowedAdminExpenseStatuses.has(value) ? value : 'draft';

const mapAdminExpenseRow = (row: AdminExpenseRow): AdminExpenseRecord => ({
  id: row.id,
  project_name: row.project_name,
  public_description: row.public_description,
  expected_outcome: row.expected_outcome,
  progress_status: row.progress_status,
  proof_url: row.proof_url,
  proof_source: row.proof_source,
  proof_published_at: row.proof_published_at,
  amount_allocated: centsToAmount(parseDbInt(row.amount_allocated)),
  currency: row.currency.toUpperCase(),
  status: normalizeAdminExpenseStatus(row.status),
  published_at: row.published_at,
  created_at: row.created_at,
  updated_at: row.updated_at
});

const emptyAdminExpensesSummary = (): AdminExpensesSummary => ({
  total_count: 0,
  published_count: 0,
  draft_count: 0,
  private_count: 0,
  archived_count: 0,
  total_allocated: 0,
  published_allocated: 0,
  currency: 'CAD'
});

const getAdminExpensesSummary = async (
  pool: Pool | null
): Promise<{
  readonly summary: AdminExpensesSummary;
  readonly lastUpdatedAt: string;
}> => {
  const now = new Date().toISOString();
  if (!pool) {
    return {
      summary: emptyAdminExpensesSummary(),
      lastUpdatedAt: now
    };
  }

  const presence = await getAdminBackofficePresence(pool);
  if (!presence.has_fund_allocations) {
    return {
      summary: emptyAdminExpensesSummary(),
      lastUpdatedAt: now
    };
  }

  const query = await pool.query<AdminExpensesSummaryRow>(`
    SELECT
      COUNT(*)::text AS total_count,
      COALESCE(SUM(CASE WHEN status IN ('published', 'active') THEN 1 ELSE 0 END), 0)::text AS published_count,
      COALESCE(SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END), 0)::text AS draft_count,
      COALESCE(SUM(CASE WHEN status = 'private' THEN 1 ELSE 0 END), 0)::text AS private_count,
      COALESCE(SUM(CASE WHEN status = 'archived' THEN 1 ELSE 0 END), 0)::text AS archived_count,
      COALESCE(SUM(CASE WHEN status <> 'archived' THEN amount_allocated ELSE 0 END), 0)::text AS total_allocated,
      COALESCE(SUM(CASE WHEN status IN ('published', 'active') THEN amount_allocated ELSE 0 END), 0)::text AS published_allocated,
      COALESCE(MAX(currency), 'cad') AS currency,
      COALESCE(MAX(updated_at), NOW())::text AS last_updated_at
    FROM fund_allocations
  `);

  const row = query.rows[0];
  if (!row) {
    return {
      summary: emptyAdminExpensesSummary(),
      lastUpdatedAt: now
    };
  }

  return {
    summary: {
      total_count: parseDbInt(row.total_count),
      published_count: parseDbInt(row.published_count),
      draft_count: parseDbInt(row.draft_count),
      private_count: parseDbInt(row.private_count),
      archived_count: parseDbInt(row.archived_count),
      total_allocated: centsToAmount(parseDbInt(row.total_allocated)),
      published_allocated: centsToAmount(parseDbInt(row.published_allocated)),
      currency: row.currency.toUpperCase()
    },
    lastUpdatedAt: row.last_updated_at
  };
};

const getAdminExpenseById = async (
  pool: Pool | PoolClient,
  expenseId: string
): Promise<AdminExpenseRecord | null> => {
  const query = await pool.query<AdminExpenseRow>(
    `
      SELECT
        id::text AS id,
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
        published_at::text AS published_at,
        created_at::text AS created_at,
        updated_at::text AS updated_at
      FROM fund_allocations
      WHERE id = $1::bigint
      LIMIT 1
    `,
    [expenseId]
  );

  const row = query.rows[0];
  return row ? mapAdminExpenseRow(row) : null;
};

export const listAdminExpenses = async (
  pool: Pool | null,
  expenseId?: string
): Promise<AdminExpensesResponse> => {
  const now = new Date().toISOString();
  const { summary, lastUpdatedAt } = await getAdminExpensesSummary(pool);

  if (!pool) {
    return {
      data_source: 'database',
      summary,
      expenses: [],
      last_updated_at: lastUpdatedAt
    };
  }

  const presence = await getAdminBackofficePresence(pool);
  if (!presence.has_fund_allocations) {
    return {
      data_source: 'database',
      summary,
      expenses: [],
      last_updated_at: lastUpdatedAt
    };
  }

  const query = await pool.query<AdminExpenseRow>(
    `
    SELECT
      id::text AS id,
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
      published_at::text AS published_at,
      created_at::text AS created_at,
      updated_at::text AS updated_at
    FROM fund_allocations
    WHERE ($1::bigint IS NULL OR id = $1::bigint)
    ORDER BY
      CASE status
        WHEN 'draft' THEN 0
        WHEN 'published' THEN 1
        WHEN 'active' THEN 1
        WHEN 'private' THEN 2
        ELSE 3
      END,
      COALESCE(published_at, updated_at, created_at) DESC
    LIMIT 250
  `,
    [expenseId ?? null]
  );

  return {
    data_source: 'database',
    summary,
    expenses: query.rows.map(mapAdminExpenseRow),
    last_updated_at: query.rows[0]?.updated_at ?? lastUpdatedAt ?? now
  };
};

export const createAdminExpense = async (
  pool: Pool | null,
  input: AdminExpenseCreateRequest,
  audit: AdminExpenseAuditInput
): Promise<AdminExpenseMutationResult> => {
  validateExpenseFields(input);
  if (isPublicAllocationStatus(input.status)) {
    requireExpenseConfirmation(
      input.confirmation,
      PUBLIC_ALLOCATION_CREATE_CONFIRMATION
    );
  }
  if (!pool) {
    return { updated: false, expense: null };
  }

  const presence = await getAdminBackofficePresence(pool);
  if (!presence.has_fund_allocations) {
    return { updated: false, expense: null };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<{ readonly id: string }>(
      `
      INSERT INTO fund_allocations (
        project_name,
        public_description,
        expected_outcome,
        progress_status,
        proof_url,
        proof_source,
        proof_published_at,
        amount_allocated,
        currency,
        status,
        published_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz
      )
      RETURNING id::text AS id
    `,
      [
        input.projectName.trim(),
        input.publicDescription.trim(),
        input.expectedOutcome.trim(),
        input.progressStatus,
        input.proofUrl?.trim() || null,
        input.proofSource?.trim() || null,
        input.proofPublishedAt ?? null,
        allocationAmountMinor(input.amountAllocated),
        input.currency.toLowerCase(),
        input.status,
        input.publishedAt ??
          (input.status === 'published' || input.status === 'active'
            ? new Date().toISOString()
            : null)
      ]
    );

    const id = result.rows[0]?.id;
    const expense = id ? await getAdminExpenseById(client, id) : null;
    if (!expense) {
      await client.query('ROLLBACK');
      return { updated: false, expense: null };
    }

    const audited = await insertAdminAuditLog(client, {
      actor: audit.actor,
      action: audit.action,
      entityType: 'expense',
      entityId: expense.id,
      summary: `Expense created for ${expense.project_name}.`,
      metadata: {
        amountAllocated: expense.amount_allocated,
        status: expense.status,
        expectedOutcome: expense.expected_outcome,
        progressStatus: expense.progress_status,
        proofUrl: expense.proof_url,
        proofSource: expense.proof_source,
        proofPublishedAt: expense.proof_published_at
      }
    });
    if (!audited) {
      throw new Error('Achievement audit could not be recorded.');
    }
    await client.query('COMMIT');
    return { updated: true, expense };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const updateAdminExpense = async (
  pool: Pool | null,
  input: AdminExpenseUpdateRequest,
  audit: AdminExpenseAuditInput
): Promise<AdminExpenseMutationResult> => {
  validateExpenseFields(input);
  if (!pool) {
    return { updated: false, expense: null };
  }

  const presence = await getAdminBackofficePresence(pool);
  if (!presence.has_fund_allocations) {
    return { updated: false, expense: null };
  }

  const assignments: string[] = [];
  const values: unknown[] = [input.expenseId];

  const addAssignment = (sql: string, value: unknown): void => {
    values.push(value);
    assignments.push(sql.replace('?', `$${values.length}`));
  };

  if (input.projectName !== undefined) {
    addAssignment('project_name = ?', input.projectName.trim());
  }

  if (input.publicDescription !== undefined) {
    addAssignment('public_description = ?', input.publicDescription.trim());
  }

  if (input.expectedOutcome !== undefined) {
    addAssignment('expected_outcome = ?', input.expectedOutcome.trim());
  }

  if (input.progressStatus !== undefined) {
    addAssignment('progress_status = ?', input.progressStatus);
  }

  if (input.proofUrl !== undefined) {
    addAssignment('proof_url = ?', input.proofUrl?.trim() || null);
  }

  if (input.proofSource !== undefined) {
    addAssignment('proof_source = ?', input.proofSource?.trim() || null);
  }

  if (input.proofPublishedAt !== undefined) {
    addAssignment(
      'proof_published_at = ?::timestamptz',
      input.proofPublishedAt
    );
  }

  if (input.amountAllocated !== undefined) {
    addAssignment(
      'amount_allocated = ?',
      allocationAmountMinor(input.amountAllocated)
    );
  }

  if (input.currency !== undefined) {
    addAssignment('currency = ?', input.currency.toLowerCase());
  }

  if (input.status !== undefined) {
    addAssignment('status = ?', input.status);
  }

  if (assignments.length === 0 && input.publishedAt === undefined) {
    return {
      updated: false,
      expense: await getAdminExpenseById(pool, input.expenseId)
    };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query<{ status: AdminExpenseStatus }>(
      'SELECT status FROM fund_allocations WHERE id=$1::bigint AND updated_at=$2::timestamptz FOR UPDATE',
      [input.expenseId, input.expectedVersion]
    );
    const status = current.rows[0]?.status;
    if (!status) {
      await client.query('ROLLBACK');
      return { updated: false, expense: null };
    }
    if (allocationRequiresConfirmation(status, input.status)) {
      requireExpenseConfirmation(input.confirmation, input.expenseId);
    }
    if (isPublicAllocationStatus(input.status ?? status)) {
      if (input.publishedAt)
        addAssignment('published_at = ?::timestamptz', input.publishedAt);
      else assignments.push('published_at = COALESCE(published_at, NOW())');
    } else if (input.publishedAt !== undefined) {
      addAssignment('published_at = ?::timestamptz', input.publishedAt);
    }
    values.push(input.expectedVersion);
    assignments.push('updated_at = NOW()');
    const result = await client.query(
      `
      UPDATE fund_allocations
      SET ${assignments.join(', ')}
      WHERE id = $1::bigint
        AND updated_at = $${values.length}::timestamptz
    `,
      values
    );

    if ((result.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK');
      return { updated: false, expense: null };
    }

    const expense = await getAdminExpenseById(client, input.expenseId);
    if (!expense) {
      throw new Error('Updated achievement could not be loaded.');
    }
    const audited = await insertAdminAuditLog(client, {
      actor: audit.actor,
      action: audit.action,
      entityType: 'expense',
      entityId: expense.id,
      summary: `Expense updated for ${expense.project_name}.`,
      metadata: {
        amountAllocated: expense.amount_allocated,
        status: expense.status,
        expectedOutcome: expense.expected_outcome,
        progressStatus: expense.progress_status,
        proofUrl: expense.proof_url,
        proofSource: expense.proof_source,
        proofPublishedAt: expense.proof_published_at
      }
    });
    if (!audited) {
      throw new Error('Achievement audit could not be recorded.');
    }
    await client.query('COMMIT');
    return { updated: true, expense };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
