import type {
  AdminFlowMeasurement,
  EngineRoomScope,
  SponsorshipCommitmentRecord,
  AdminFlowCohort
} from '@openg7/funding-core';
import type { Pool, PoolClient } from 'pg';

import { sponsorshipCommitmentProjectionSql } from './sponsorship-commitments.repository.js';
import {
  loadSponsorshipEvidenceFacts,
  qualifiedSponsorshipEvidenceIds
} from './sponsorship-progress-evidence.js';
import { loadSponsorshipProgressPublications } from './sponsorship-progress.repository.js';
import { withPostgresTransaction } from './postgres-transaction.js';
import { isValidUuid } from './business-helpers/request-validation.js';
import {
  projectFlowMeasurement,
  unavailableFlowMeasurement,
  type FlowObligationFact
} from './admin-flow-measurement.js';

/** Fixed SQL relation, never a client-provided expression. Includes all exact participants. */
const deliveryPassages = `SELECT d.obligation_id FROM sponsor_publication_drafts d
  JOIN publication_deliveries j ON j.batch_id=d.batch_id AND j.feed_id=d.feed_target || ':' || d.channel
  WHERE j.id=$2::uuid AND d.obligation_id IS NOT NULL`;

export async function loadFlowMeasurementOnClient(
  db: PoolClient,
  scope: EngineRoomScope,
  now: Date
): Promise<AdminFlowMeasurement> {
  const args = [scope.sponsorshipId ?? null, scope.deliveryId ?? null];
  const records = await db.query<{
    id: string;
    commitment: SponsorshipCommitmentRecord | null;
  }>(
    `SELECT c.id,${sponsorshipCommitmentProjectionSql('c.id')} AS commitment FROM fund_contributions c
     WHERE c.contribution_type='sponsorship_interest' AND ($1::uuid IS NULL OR c.id=$1::uuid)
     AND ($2::uuid IS NULL OR EXISTS(SELECT 1 FROM sponsorship_obligations ob
       WHERE ob.contribution_id=c.id AND ob.id IN (${deliveryPassages})))`,
    args
  );
  const dates = await db.query<{ id: string; createdAt: string }>(
    `SELECT ob.id,ob.created_at::text AS "createdAt" FROM sponsorship_obligations ob
     WHERE ($1::uuid IS NULL OR ob.contribution_id=$1::uuid)
     AND ($2::uuid IS NULL OR ob.id IN (${deliveryPassages}))`,
    args
  );
  const created = new Map(dates.rows.map((row) => [row.id, row.createdAt]));
  const ids = records.rows.map((row) => row.id);
  const evidence = await loadSponsorshipEvidenceFacts(
    db,
    ids,
    now.toISOString()
  );
  const publications = await loadSponsorshipProgressPublications(db, ids);
  const facts: FlowObligationFact[] = [];
  let excluded = 0;
  for (const record of records.rows) {
    const commitment = record.commitment;
    if (!commitment || commitment.state !== 'active' || !commitment.offer) {
      excluded++;
      continue;
    }
    const qualified = new Set(
      qualifiedSponsorshipEvidenceIds(
        commitment,
        evidence.filter((e) => e.contributionId === record.id)
      )
    );
    for (const obligation of commitment.obligations) {
      if (!created.has(obligation.id)) continue;
      const modes = new Set(
        publications
          .filter((p) => p.obligationId === obligation.id)
          .map((p) => p.deliveryMode)
          .filter((m) => m !== null)
      );
      const proof = evidence.find(
        (e) => e.id === obligation.fulfilmentEvidenceId && qualified.has(e.id)
      );
      const mode: AdminFlowCohort['mode'] = proof
        ? 'live'
        : modes.size > 1
          ? 'mixed'
          : ([...modes][0] ?? 'unknown');
      facts.push({
        obligation,
        createdAt: created.get(obligation.id) ?? null,
        qualifiedDeliveredAt: proof?.deliveredAt ?? null,
        mode
      });
    }
  }
  return projectFlowMeasurement(facts, excluded, scope, now);
}

export async function readFlowMeasurement(
  pool: Pool | null,
  scope: EngineRoomScope,
  now = new Date()
): Promise<AdminFlowMeasurement> {
  if (
    !pool ||
    [scope.sponsorshipId, scope.deliveryId].some(
      (id) => id !== undefined && !isValidUuid(id)
    )
  )
    return unavailableFlowMeasurement(scope, now);
  try {
    return await withPostgresTransaction(
      pool,
      (db) => loadFlowMeasurementOnClient(db, scope, now),
      { readOnlySnapshot: true }
    );
  } catch {
    return unavailableFlowMeasurement(scope, now);
  }
}
