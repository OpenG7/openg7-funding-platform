import type { Pool, PoolClient } from 'pg';

import { insertAdminAuditLog } from './fund-admin-audit.repository.js';
import { withPostgresTransaction } from './postgres-transaction.js';

// Keep the held batch set uncorrelated: PostgreSQL evaluates it once per query,
// rather than compiling/repeating nested delivery/account subplans per source.
const uncertainPublicationBatchesSql = `
  SELECT held_delivery.batch_id FROM publication_deliveries held_delivery
    WHERE held_delivery.batch_id IS NOT NULL AND held_delivery.status IN ('publishing','uncertain')
  UNION
  SELECT held_delivery.batch_id FROM publication_deliveries held_delivery
    JOIN publication_account_leases held_account ON held_account.delivery_id=held_delivery.id
    WHERE held_delivery.batch_id IS NOT NULL AND held_account.uncertain
  UNION
  SELECT held_delivery.batch_id FROM publication_deliveries held_delivery
    JOIN publication_account_reservations held_account ON held_account.delivery_id=held_delivery.id
    WHERE held_delivery.batch_id IS NOT NULL AND held_account.status IN ('publishing','uncertain')
  UNION
  SELECT held_legacy.batch_id FROM social_publication_jobs held_legacy
    WHERE held_legacy.status IN ('publishing','failed')`;

/** Aliases are internal identifiers, never request input. NULL means unassigned. */
export const publicationDraftUncertainSql = (draft = 'draft') =>
  `COALESCE(${draft}.batch_id IN(${uncertainPublicationBatchesSql}),FALSE)`;

/** A source with an unresolved send cannot acquire another competing passage. */
export const publicationSourceUncertainSql = (
  contributionId: string,
  channel: string
) =>
  `COALESCE((${contributionId},${channel}) IN(
    SELECT held_source.contribution_id,held_source.channel FROM sponsor_publication_drafts held_source
    WHERE ${publicationDraftUncertainSql('held_source')}),FALSE)`;

/** Caller owns the transaction and has locked/revoked the contribution's deliveries. */
export const retireAdjustedPublicationDrafts = async (
  db: PoolClient,
  obligationId: string,
  actor: string,
  requestId: string
): Promise<boolean> => {
  const retired = await db.query<{ id: string }>(
    `UPDATE sponsor_publication_drafts draft SET status='cancelled',updated_at=NOW()
     WHERE draft.obligation_id=$1::uuid AND draft.status NOT IN ('published','cancelled','rejected')
       AND NOT EXISTS(SELECT 1 FROM sponsor_publication_batches batch
         WHERE batch.id=draft.batch_id AND batch.status='published')
       AND NOT EXISTS(SELECT 1 FROM publication_slots slot
         WHERE slot.id=draft.slot_id AND slot.status='published')
       AND NOT ${publicationDraftUncertainSql()}
       AND NOT EXISTS(SELECT 1 FROM publication_deliveries delivery
         WHERE delivery.batch_id=draft.batch_id AND delivery.status IN ('approved','published'))
       AND NOT EXISTS(SELECT 1 FROM social_publication_jobs legacy
         WHERE legacy.batch_id=draft.batch_id AND legacy.status IN ('publishing','published','failed'))
       AND NOT EXISTS(SELECT 1 FROM sponsorship_obligation_reservations reservation
         WHERE reservation.obligation_id=draft.obligation_id AND reservation.released_at IS NULL)
     RETURNING draft.id`,
    [obligationId]
  );
  for (const draft of retired.rows) {
    if (
      !(await insertAdminAuditLog(db, {
        actor,
        action: 'sponsorship_commitment.retire_publication_draft',
        entityType: 'sponsor_publication_draft',
        entityId: draft.id,
        summary:
          'Obsolete publication draft retained after an explicit term adjustment.',
        metadata: { requestId, obligationId }
      }))
    )
      return false;
  }
  return true;
};

const obsoleteDraftScope = `draft.status NOT IN ('published','cancelled','rejected')
  AND draft.channel=$2 AND (draft.feed_target=$1 OR obligation.target=$1)
  AND ($3::uuid IS NULL OR draft.contribution_id=$3::uuid)
  AND (obligation.state='adjusted' OR draft.feed_target<>obligation.target)
  AND NOT ${publicationDraftUncertainSql()}
  AND NOT EXISTS(SELECT 1 FROM sponsor_publication_batches historical
    WHERE historical.id=draft.batch_id AND historical.status='published')
  AND NOT EXISTS(SELECT 1 FROM publication_slots historical
    WHERE historical.id=draft.slot_id AND historical.status='published')
  AND NOT EXISTS(SELECT 1 FROM publication_deliveries historical
    WHERE historical.batch_id=draft.batch_id AND historical.status='published')
  AND NOT EXISTS(SELECT 1 FROM social_publication_jobs historical
    WHERE historical.batch_id=draft.batch_id AND historical.status='published')`;

interface RetirementScope {
  target: string;
  channel: string;
  contributionId?: string;
}
type RevokeDeliveries = (
  db: PoolClient,
  contributionId: string
) => Promise<void>;

/** Caller holds deliveries and contributions; reread obsolete bindings before writing. */
export const retireObsoletePublicationDraftsOnConnection = async (
  db: PoolClient,
  scope: RetirementScope,
  contributionIds: readonly string[],
  actor: string,
  revokeDeliveries: RevokeDeliveries
): Promise<void> => {
  const obsolete = await db.query<{
    obligation_id: string;
    contribution_id: string;
    request_id: string;
  }>(
    `SELECT obligation.id AS obligation_id,draft.contribution_id,amendment.request_id
     FROM sponsor_publication_drafts draft
     JOIN sponsorship_obligations obligation ON obligation.id=draft.obligation_id
     JOIN LATERAL(SELECT request_id FROM sponsorship_commitment_changes change
       WHERE change.obligation_id=obligation.id AND change.kind IN ('destination','waiver')
       ORDER BY change.created_at DESC,change.id DESC LIMIT 1) amendment ON TRUE
     WHERE ${obsoleteDraftScope} AND draft.contribution_id=ANY($4::uuid[])
     ORDER BY draft.contribution_id,obligation.id`,
    [scope.target, scope.channel, scope.contributionId ?? null, contributionIds]
  );
  for (const contributionId of new Set(
    obsolete.rows.map((row) => row.contribution_id)
  ))
    await revokeDeliveries(db, contributionId);
  for (const row of obsolete.rows) {
    if (
      !(await retireAdjustedPublicationDrafts(
        db,
        row.obligation_id,
        actor,
        row.request_id
      ))
    )
      throw new Error('COMMITMENT_AUDIT_UNAVAILABLE');
  }
};

/** Repair pre-correction bindings using their real amendment, never a fabricated term change. */
export const retireObsoletePublicationDrafts = async (
  pool: Pool,
  scope: RetirementScope,
  actor: string,
  revokeDeliveries: RevokeDeliveries
): Promise<void> => {
  const parameters = [
    scope.target,
    scope.channel,
    scope.contributionId ?? null
  ];
  const candidates = await pool.query<{ contribution_id: string }>(
    `SELECT DISTINCT draft.contribution_id FROM sponsor_publication_drafts draft
     JOIN sponsorship_obligations obligation ON obligation.id=draft.obligation_id
     WHERE ${obsoleteDraftScope}
       AND EXISTS(SELECT 1 FROM sponsorship_commitment_changes amendment
         WHERE amendment.obligation_id=obligation.id AND amendment.kind IN ('destination','waiver'))
     ORDER BY draft.contribution_id LIMIT 400`,
    parameters
  );
  if (!candidates.rows.length) return;
  const contributionIds = candidates.rows.map((row) => row.contribution_id);
  await withPostgresTransaction(pool, async (db) => {
    // Match administrative revocation: all deliveries, then source contributions.
    await db.query(
      `SELECT delivery.id FROM publication_deliveries delivery
       WHERE delivery.batch_id IN(SELECT batch_id FROM sponsor_publication_drafts
         WHERE contribution_id=ANY($1::uuid[])) ORDER BY delivery.id FOR UPDATE OF delivery`,
      [contributionIds]
    );
    await db.query(
      'SELECT id FROM fund_contributions WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',
      [contributionIds]
    );
    await retireObsoletePublicationDraftsOnConnection(
      db,
      scope,
      contributionIds,
      actor,
      revokeDeliveries
    );
  });
};
