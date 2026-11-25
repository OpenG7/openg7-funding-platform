import type { Pool, PoolClient } from 'pg';
import type {
  PilotCommand,
  SponsorMediaApproveAllPlan,
  SponsorMediaApproveAllReceipt
} from '@openg7/funding-core';

import { lockWorkspace } from '../sponsor-media-workspace/policy.js';

import type { PilotExecutionPorts } from './contracts.js';
import { requireValue } from './errors.js';

/** Native per-media receipts survive interruption; the dossier is approved only after all succeed. */
export async function approvePilotageMedia(
  pool: Pool,
  ports: PilotExecutionPorts,
  command: PilotCommand,
  actor: string
): Promise<Pick<SponsorMediaApproveAllReceipt, 'items'> | null> {
  const planId = command.payload?.approveMediaPlanId;
  if (!planId) return null;
  requireValue(ports.media, 'MEDIA_REVIEW_UNAVAILABLE', 503);
  const plan = (
    await pool.query(
      `SELECT actor,plan,expires_at FROM sponsor_media_batch_plans WHERE id=$1`,
      [planId]
    )
  ).rows[0];
  requireValue(
    plan?.actor === actor &&
      plan.plan?.kind === 'approve_all' &&
      plan.plan.response?.contributionId?.toLowerCase() ===
        command.targetId.toLowerCase(),
    'MEDIA_PLAN_SCOPE_MISMATCH',
    409
  );
  const prepared = plan.plan.response as SponsorMediaApproveAllPlan;
  requireValue(
    !prepared.summary.blocked && !prepared.summary.notProcessable,
    'MEDIA_APPROVAL_INCOMPLETE'
  );
  const dossier = (
    await pool.query(
      `SELECT status,sponsor_review_status,updated_at::text AS version FROM fund_contributions WHERE id=$1`,
      [command.targetId]
    )
  ).rows[0];
  requireValue(dossier?.status === 'paid', 'PAYMENT_REQUIRED');
  requireValue(
    dossier?.sponsor_review_status === 'pending_review' &&
      dossier.version === command.version,
    'VERSION_CONFLICT'
  );
  if (prepared.summary.alreadyApproved === prepared.summary.total) {
    requireValue(
      Date.parse(prepared.expiresAt) > Date.now() &&
        new Date(plan.expires_at).getTime() > Date.now(),
      'MEDIA_PLAN_EXPIRED'
    );
    return {
      items: prepared.candidates.map((candidate) => ({
        id: candidate.asset.id,
        originalFilename: candidate.asset.originalFilename,
        version: candidate.asset.version,
        result: 'already_approved',
        reasons: []
      }))
    };
  }
  const receipt = await ports.media.executeApproveAll(
    {
      requestId: command.requestId,
      planId,
      confirmation: planId,
      humanReviewed: true
    },
    actor
  );
  requireValue(receipt.status === 'completed', 'MEDIA_APPROVAL_INCOMPLETE');
  return receipt;
}

/** Locks also serialize uploads/removals. A changed or additional image requires a fresh confirmation. */
export async function verifyPilotageMedia(
  db: PoolClient,
  contributionId: string,
  receipt: Pick<SponsorMediaApproveAllReceipt, 'items'>
): Promise<void> {
  await lockWorkspace(db, contributionId);
  const assets = (
    await db.query(
      `SELECT id,review_status,updated_at::text AS version FROM sponsor_media_assets
     WHERE contribution_id=$1 AND deleted_at IS NULL ORDER BY id`,
      [contributionId]
    )
  ).rows;
  requireValue(
    assets.length === receipt.items.length &&
      assets.every(
        (asset) =>
          asset.review_status === 'approved' &&
          receipt.items.some(
            (item) =>
              item.id === asset.id &&
              item.version === asset.version &&
              ['approved', 'already_approved'].includes(item.result)
          )
      ),
    'MEDIA_APPROVAL_CHANGED'
  );
}
