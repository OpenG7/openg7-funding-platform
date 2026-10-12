import type { PoolClient } from 'pg';
import type {
  PublicationReliability,
  PublicationReliabilityIncident
} from '@openg7/funding-core';

import { reliabilityFactsSql } from './reliability-facts.js';
import {
  reliabilityIncidentLinksSql,
  reliabilityIncidentJsonSql
} from './reliability-incidents.js';
import { assert } from './policy.js';

type Db = Pick<PoolClient, 'query'>;
export const RELIABILITY_CORRELATION_LIMIT = 50;

/** Complete persisted scope. No response page or preparation scan bounds these facts. */
const nonNegativeCount = (value: unknown): number => {
  assert(
    typeof value === 'string' && /^\d+$/.test(value),
    'RELIABILITY_UNAVAILABLE',
    503
  );
  const parsed = Number(value);
  assert(Number.isSafeInteger(parsed), 'RELIABILITY_UNAVAILABLE', 503);
  return parsed;
};
const date = (value: unknown): string | null => {
  if (value === null) return null;
  assert(
    typeof value === 'string' && Number.isFinite(Date.parse(value)),
    'RELIABILITY_UNAVAILABLE',
    503
  );
  return new Date(value).toISOString();
};

/** Read-only projection; the caller's transaction provides the consistent database snapshot. */
export async function publicationReliability(
  db: Db
): Promise<PublicationReliability> {
  const {
    rows: [row]
  } = await db.query(`${reliabilityFactsSql}${reliabilityIncidentLinksSql}
    SELECT transaction_timestamp() AS evaluated_at,
      (SELECT count(*)::text FROM obligation_facts WHERE state IN ('pending','blocked')) AS open,
      (SELECT count(*)::text FROM obligation_facts WHERE state IN ('pending','blocked') AND channel<>'website' AND NOT dated) AS undated,
      (SELECT min(created_at)::text FROM obligation_facts WHERE state IN ('pending','blocked')) AS oldest_open,
      (SELECT min(created_at)::text FROM obligation_facts WHERE state IN ('pending','blocked') AND channel<>'website' AND NOT dated) AS oldest_undated,
      (SELECT count(*)::text FROM obligation_facts WHERE state='fulfilled' AND evidence_matches) AS fulfilled,
      (SELECT count(*)::text FROM obligation_facts WHERE state='adjusted') AS waived,
      (SELECT count(*)::text FROM sponsorship_commitments WHERE state='needs_confirmation') AS unqualified,
      (SELECT count(*)::text FROM obligation_facts WHERE state IN ('pending','blocked') AND due_at<transaction_timestamp()) AS overdue_obligations,
      (SELECT count(*)::text FROM obligation_facts WHERE state IN ('pending','blocked') AND deadline_days IS NOT NULL AND deadline_origin IS NULL) AS missing_deadline_origin,
      (SELECT count(*)::text FROM obligation_facts WHERE state IN ('pending','blocked') AND duration_days IS NOT NULL AND channel='website' AND target='openg7') AS awaiting_duration,
      (SELECT count(*)::text FROM batch_occupancy WHERE used>=capacity) AS saturated_batches,
      (SELECT count(*)::text FROM slot_occupancy WHERE used>=capacity) AS saturated_slots,
      (SELECT count(*)::text FROM account_conflicts) AS account_conflicts,
      (SELECT count(*)::text FROM publication_deliveries WHERE status='publishing') AS publishing,
      (SELECT count(*)::text FROM publication_deliveries WHERE status='uncertain') AS uncertain,
      (SELECT count(*)::text FROM publication_account_leases WHERE uncertain) AS uncertain_accounts,
      (SELECT min(updated_at)::text FROM publication_account_leases WHERE uncertain) AS oldest_uncertain,
      (SELECT count(*)::text FROM publication_deliveries WHERE status='approved' AND scheduled_at<transaction_timestamp()) AS overdue,
      (SELECT count(*)::text FROM incidents WHERE code='FULFILMENT_EVIDENCE_MISMATCH') AS proof_mismatches,
      (SELECT count(*)::text FROM incidents WHERE code='ORPHAN_FULFILMENT_EVIDENCE') AS orphan_proofs,
      (SELECT count(*)::text FROM obligation_drift) AS obligation_mismatches,
      (SELECT count(*)::text FROM account_drift) AS account_mismatches,
      (SELECT count(*)::text FROM lease_drift) AS lease_mismatches,
      (SELECT count(*)::text FROM incidents WHERE code='BATCH_CAPACITY_EXCEEDED') AS batch_mismatches,
      (SELECT count(*)::text FROM incidents WHERE code='SLOT_CAPACITY_EXCEEDED') AS slot_mismatches,
      (SELECT count(*)::text FROM incidents) AS incident_total,
      COALESCE((SELECT jsonb_agg(${reliabilityIncidentJsonSql} ORDER BY code,subject_type,subject_id)
        FROM (SELECT * FROM incident_links ORDER BY code,subject_type,subject_id LIMIT ${RELIABILITY_CORRELATION_LIMIT}) correlated),'[]'::jsonb) AS correlations`);
  assert(row, 'RELIABILITY_UNAVAILABLE', 503);
  return {
    scope: 'global',
    evaluatedAt: row.evaluated_at.toISOString(),
    obligations: {
      open: nonNegativeCount(row.open),
      undatedSocial: nonNegativeCount(row.undated),
      oldestOpenAt: date(row.oldest_open),
      oldestUndatedAt: date(row.oldest_undated),
      fulfilledWithEvidence: nonNegativeCount(row.fulfilled),
      waived: nonNegativeCount(row.waived),
      unqualifiedDossiers: nonNegativeCount(row.unqualified),
      ...(row.overdue_obligations !== undefined
        ? { overdue: nonNegativeCount(row.overdue_obligations) }
        : {}),
      ...(row.missing_deadline_origin !== undefined
        ? {
            missingDeadlineOrigin: nonNegativeCount(row.missing_deadline_origin)
          }
        : {}),
      ...(row.awaiting_duration !== undefined
        ? { awaitingDuration: nonNegativeCount(row.awaiting_duration) }
        : {})
    },
    capacity: {
      saturatedBatches: nonNegativeCount(row.saturated_batches),
      saturatedSlots: nonNegativeCount(row.saturated_slots),
      accountConflicts: nonNegativeCount(row.account_conflicts)
    },
    deliveries: {
      publishing: nonNegativeCount(row.publishing),
      uncertain: nonNegativeCount(row.uncertain),
      uncertainAccounts: nonNegativeCount(row.uncertain_accounts),
      oldestUncertainAccountAt: date(row.oldest_uncertain),
      overdueApproved: nonNegativeCount(row.overdue)
    },
    discrepancies: {
      proof: nonNegativeCount(row.proof_mismatches),
      orphanProof: nonNegativeCount(row.orphan_proofs),
      obligationReservation: nonNegativeCount(row.obligation_mismatches),
      accountReservation: nonNegativeCount(row.account_mismatches),
      accountLease: nonNegativeCount(row.lease_mismatches),
      batchCapacity: nonNegativeCount(row.batch_mismatches),
      slotCapacity: nonNegativeCount(row.slot_mismatches)
    },
    incidents: row.correlations as PublicationReliabilityIncident[],
    incidentTotal: nonNegativeCount(row.incident_total),
    correlationLimit: RELIABILITY_CORRELATION_LIMIT
  };
}

/** Existing alert episodes consume the same complete detector, never the 50 visible correlations. */
export async function detectPublicationReliabilityIncidents(
  db: Db
): Promise<{ key: string; type: string }[]> {
  const { rows } = await db.query<{
    code: string;
    subject_type: string;
    subject_id: string;
  }>(
    `${reliabilityFactsSql} SELECT code,subject_type,subject_id::text FROM incidents ORDER BY code,subject_type,subject_id`
  );
  return rows.map((row) => ({
    key: `publication:${row.code}:${row.subject_id}`,
    type: `publication_${row.code.toLowerCase()}`
  }));
}
