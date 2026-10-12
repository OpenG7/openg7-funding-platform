import {
  canonicalAccountSql,
  LIVE_ACCOUNT_INTERVAL_MS
} from './account-reservations.js';

export const reliabilityFactsSql = `WITH
obligation_facts AS (
  SELECT o.*,t.deadline_days,t.duration_days,t.origin_at AS deadline_origin,t.due_at,
    (e.id IS NOT NULL AND e.obligation_id=o.id AND e.contribution_id=o.contribution_id
    AND e.channel=o.channel AND e.target=o.target AND e.obligation_version+1=o.version) AS evidence_matches,
    EXISTS(SELECT 1 FROM sponsorship_obligation_reservations r JOIN publication_deliveries d ON d.id=r.delivery_id
      WHERE r.obligation_id=o.id AND r.obligation_version=o.version AND r.released_at IS NULL
        AND d.mode='live' AND d.status IN ('approved','publishing') AND d.approved_at IS NOT NULL
        AND d.obligation_snapshot @> jsonb_build_array(jsonb_build_object('id',o.id::text,'version',o.version))) AS dated
  FROM sponsorship_obligations o LEFT JOIN sponsorship_fulfilment_evidence e ON e.id=o.fulfilment_evidence_id
  LEFT JOIN sponsorship_obligation_timing t ON t.obligation_id=o.id
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
    AND b.scheduled_at>a.scheduled_at-${LIVE_ACCOUNT_INTERVAL_MS}*INTERVAL '1 millisecond'
    AND b.scheduled_at<a.scheduled_at+${LIVE_ACCOUNT_INTERVAL_MS}*INTERVAL '1 millisecond'
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
  UNION ALL SELECT 'SPONSORSHIP_DEADLINE_EXCEEDED','obligation',id FROM obligation_facts
    WHERE state IN ('pending','blocked') AND due_at<transaction_timestamp()
  UNION ALL SELECT 'SPONSORSHIP_DEADLINE_ORIGIN_UNKNOWN','obligation',id FROM obligation_facts
    WHERE state IN ('pending','blocked') AND deadline_days IS NOT NULL AND deadline_origin IS NULL
), incidents AS (SELECT DISTINCT code,subject_type,subject_id FROM incident_candidates)`;
