import { createHash } from 'node:crypto';

import type {
  AdminExpenseCreateReceipt,
  AdminExpenseCreateRequest,
  AdminExpenseRecord
} from '@openg7/funding-core';
import type { Pool, PoolClient } from 'pg';

import { allocationAmountMinor } from '../../../packages/funding-core/src/index.js';

/** Bind the UUID to the accepted fields, including the explicit visibility confirmation. */
export const expenseCreationFingerprint = (
  input: AdminExpenseCreateRequest
): string =>
  createHash('sha256')
    .update(
      JSON.stringify([
        input.projectName.trim(),
        input.publicDescription.trim(),
        input.expectedOutcome.trim(),
        input.progressStatus,
        input.proofUrl?.trim() || null,
        input.proofSource?.trim() || null,
        input.proofPublishedAt ?? null,
        allocationAmountMinor(input.amountAllocated),
        input.currency,
        input.status,
        input.publishedAt ?? null,
        input.confirmation ?? null
      ])
    )
    .digest('hex');

export interface ExpenseCreationCommand {
  readonly actor: string;
  readonly requestHash: string;
  readonly expense: AdminExpenseRecord;
}

/** Called only on the allocation transaction's client, after the UUID advisory lock. */
export async function findExpenseCreationCommand(
  client: PoolClient,
  requestId: string
): Promise<ExpenseCreationCommand | null> {
  const result = await client.query<ExpenseCreationCommand>(
    `SELECT actor, request_hash AS "requestHash", expense_snapshot AS expense
     FROM expense_creation_receipts WHERE request_id = $1::uuid`,
    [requestId]
  );
  return result.rows[0] ?? null;
}

/** Pure private read; missing and foreign-actor commands have the same response. */
export async function readAdminExpenseCreateReceipt(
  pool: Pool,
  requestId: string,
  actor: string
): Promise<AdminExpenseCreateReceipt> {
  const normalized = requestId.toLowerCase();
  const result = await pool.query<{
    expenseId: string;
    acceptedAt: Date | string;
  }>(
    `SELECT expense_id::text AS "expenseId", accepted_at AS "acceptedAt"
     FROM expense_creation_receipts WHERE request_id = $1::uuid AND actor = $2`,
    [normalized, actor]
  );
  const row = result.rows[0];
  return row
    ? {
        requestId: normalized,
        found: true,
        expenseId: row.expenseId,
        acceptedAt: new Date(row.acceptedAt).toISOString()
      }
    : { requestId: normalized, found: false };
}
