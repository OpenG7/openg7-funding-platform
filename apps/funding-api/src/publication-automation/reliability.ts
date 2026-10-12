import type { PoolClient } from 'pg';
import type {
  PublicationReliability,
  PublicationReliabilityIncident
} from '@openg7/funding-core';

import {
  canonicalAccountSql,
  LIVE_ACCOUNT_INTERVAL_MS
} from './account-reservations.js';
import { assert } from './policy.js';

type Db = Pick<PoolClient, 'query'>;
export const RELIABILITY_CORRELATION_LIMIT = 50;

/** Complete persisted scope. No response page or preparation scan bounds these facts. */
const reliabilityFactsSql = `WITH
obligation_facts AS (
  SELECT o.*, (e.id IS NOT NULL AND e.obligation_id=o.id AND e.contribution_id=o.contribution_id
    AND e.channel=o.channel AND e.target=o.target AND e.obligation_version+1=o.version) AS evidence_matches,
    EXISTS(SELECT 1 FROM sponsorship_obligation_reservations r JOIN publication_deliveries d ON d.id=r.delivery_id
      WHERE r.obligation_id=o.id AND r.obligation_version=o.version AND r.released_at IS NULL
        AND d.mode='live' AND d.status IN ('approved','publishing') AND d.approved_at IS NOT NULL
        AND d.obligation_snapshot @> jsonb_build_array(jsonb_build_object('id',o.id::text,'version',o.version))) AS dated
  FROM sponsorship_obligations o LEFT JOIN sponsorship_fulfilment_evidence e ON e.id=o.fulfilment_evidence_id
),
batch_occupancy AS (
  SELECT b.id,CASE WHEN b.publication_format='individual_portrait' THEN 1 ELSE b.capacity END AS capacity,
    b.publication_format,count(d.id) AS used FROM sponsor_publication_batches b
  LEFT JOIN sponsor_publication_drafts d ON d.batch_id=b.id
  WHERE b.status IN ('open','scheduled') GROUP BY b.id
),
slot_occupancy AS (
  SELECT s.id,s.capacity,count(DISTINCT d.id) AS used FROM publication_slots s
  LEFT JOIN sponsor_publication_batches b ON b.slot_id=s.id
  LEFT JOIN sponsor_publication_drafts d ON d.slot_id=s.id OR d.batch_id=b.id
  WHERE s.status IN ('open','scheduled') GROUP BY s.id
),
obligation_drift AS (
  SELECT r.obligation_id AS id FROM sponsorship_obligation_reservations r
  JOIN sponsorship_obligations o ON o.id=r.obligation_id JOIN publication_deliveries d ON d.id=r.delivery_id
  WHERE r.released_at IS NULL AND (
    r.obligation_version<>o.version OR o.state NOT IN ('pending','blocked')
    OR d.status NOT IN ('approved','publishing','uncertain') AND NOT EXISTS(
      SELECT 1 FROM publication_account_leases a WHERE a.delivery_id=d.id AND a.uncertain)
    OR o.channel<>split_part(d.feed_id,':',2) OR o.target<>split_part(d.feed_id,':',1)
    OR COALESCE(o.publication_format,'collective_text')<>d.publication_format
    OR NOT(d.obligation_snapshot @> jsonb_build_array(jsonb_build_object('id',o.id::text,'version',r.obligation_version))))
),
account_drift AS (
  SELECT d.id FROM publication_account_reservations r JOIN publication_deliveries d ON d.id=r.delivery_id
  WHERE r.status IN ('reserved','publishing','uncertain') AND (
    r.provider<>split_part(d.feed_id,':',2) OR r.account_id<>${canonicalAccountSql('d')} OR r.mode<>d.mode
    OR r.scheduled_at<>d.scheduled_at OR d.status NOT IN ('approved','publishing','uncertain') AND NOT EXISTS(
      SELECT 1 FROM publication_account_leases a WHERE a.delivery_id=d.id AND a.uncertain))
  UNION SELECT d.id FROM publication_deliveries d WHERE d.status IN ('approved','publishing','uncertain')
    AND NOT EXISTS(SELECT 1 FROM publication_account_reservations r WHERE r.delivery_id=d.id AND r.status IN ('reserved','publishing','uncertain'))
),
lease_drift AS (
  SELECT d.id FROM publication_account_leases a JOIN publication_deliveries d ON d.id=a.delivery_id
  WHERE a.provider<>split_part(d.feed_id,':',2) OR a.account_id<>${canonicalAccountSql('d')} OR a.mode<>d.mode
    OR (NOT a.uncertain AND (d.status<>'publishing' OR a.delivery_version<>d.version OR a.lease_until<=transaction_timestamp()))
  UNION SELECT d.id FROM publication_deliveries d WHERE d.status IN ('publishing','uncertain')
    AND NOT EXISTS(SELECT 1 FROM publication_account_leases a WHERE a.delivery_id=d.id)
),
account_conflicts AS (
  SELECT a.delivery_id AS first_id,b.delivery_id AS second_id FROM publication_account_reservations a
  JOIN publication_account_reservations b ON a.provider=b.provider AND a.account_id=b.account_id AND a.mode=b.mode
    AND a.delivery_id<b.delivery_id AND a.mode='live' AND a.status IN ('reserved','publishing','uncertain')
    AND b.status IN ('reserved','publishing','uncertain')
    AND abs(extract(epoch FROM a.scheduled_at-b.scheduled_at))*1000<${LIVE_ACCOUNT_INTERVAL_MS}
),
incident_candidates AS (
  SELECT 'FULFILMENT_EVIDENCE_MISMATCH' AS code,'obligation' AS subject_type,id AS subject_id
    FROM obligation_facts WHERE state='fulfilled' AND NOT evidence_matches
  UNION ALL SELECT 'ORPHAN_FULFILMENT_EVIDENCE','obligation',e.obligation_id FROM sponsorship_fulfilment_evidence e
    JOIN sponsorship_obligations o ON o.id=e.obligation_id WHERE o.state<>'fulfilled' OR o.fulfilment_evidence_id IS DISTINCT FROM e.id
  UNION ALL SELECT 'OBLIGATION_RESERVATION_MISMATCH','obligation',id FROM obligation_drift
  UNION ALL SELECT 'ACCOUNT_RESERVATION_MISMATCH','delivery',id FROM account_drift
  UNION ALL SELECT 'ACCOUNT_LEASE_MISMATCH','delivery',id FROM lease_drift
  UNION ALL SELECT 'ACCOUNT_RESULT_UNCERTAIN','delivery',delivery_id FROM publication_account_leases WHERE uncertain
  UNION ALL SELECT 'ACCOUNT_RESULT_UNCERTAIN','delivery',d.id FROM publication_deliveries d
    WHERE d.status='uncertain' AND NOT EXISTS(SELECT 1 FROM publication_account_leases a WHERE a.delivery_id=d.id AND a.uncertain)
  UNION ALL SELECT 'ACCOUNT_SCHEDULE_CONFLICT','delivery',id FROM (
    SELECT first_id AS id FROM account_conflicts UNION SELECT second_id FROM account_conflicts) conflicting
  UNION ALL SELECT 'BATCH_CAPACITY_EXCEEDED','batch',id FROM batch_occupancy
    WHERE used>capacity OR publication_format='individual_portrait' AND used>1
  UNION ALL SELECT 'SLOT_CAPACITY_EXCEEDED','slot',id FROM slot_occupancy WHERE used>capacity
), incidents AS (SELECT DISTINCT code,subject_type,subject_id FROM incident_candidates)`;

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
  } = await db.query(`${reliabilityFactsSql}
    SELECT transaction_timestamp() AS evaluated_at,
      (SELECT count(*)::text FROM obligation_facts WHERE state IN ('pending','blocked')) AS open,
      (SELECT count(*)::text FROM obligation_facts WHERE state IN ('pending','blocked') AND channel<>'website' AND NOT dated) AS undated,
      (SELECT min(created_at)::text FROM obligation_facts WHERE state IN ('pending','blocked')) AS oldest_open,
      (SELECT min(created_at)::text FROM obligation_facts WHERE state IN ('pending','blocked') AND channel<>'website' AND NOT dated) AS oldest_undated,
      (SELECT count(*)::text FROM obligation_facts WHERE state='fulfilled' AND evidence_matches) AS fulfilled,
      (SELECT count(*)::text FROM obligation_facts WHERE state='adjusted') AS waived,
      (SELECT count(*)::text FROM sponsorship_commitments WHERE state='needs_confirmation') AS unqualified,
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
      COALESCE((SELECT jsonb_agg(jsonb_build_object('code',code,'subjectType',subject_type,'subjectId',subject_id) ORDER BY code,subject_type,subject_id)
        FROM (SELECT * FROM incidents ORDER BY code,subject_type,subject_id LIMIT ${RELIABILITY_CORRELATION_LIMIT}) correlated),'[]'::jsonb) AS correlations`);
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
      unqualifiedDossiers: nonNegativeCount(row.unqualified)
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
