import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import type { ImportedPreflightPreparation } from './result-import.js';
import { PreflightContractError, type PreflightMission } from './contracts.js';
import {
  preparationInput,
  producerSettingsFromEnv,
  snapshotHash,
  type FundingSourceSnapshot,
  type ProducerSettings
} from './source.js';

type Queryable = Pick<PoolClient, 'query'>;
export async function assertPreflightSchema(db: Queryable): Promise<void> {
  const tables = [
    'preflight_sources',
    'preflight_missions',
    'preflight_outbox',
    'preflight_preparations',
    'preflight_worker_heartbeats'
  ];
  try {
    const { rows } = await db.query<{ ok: boolean }>(
      'SELECT bool_and(has_table_privilege(relation,permission)) AS ok FROM unnest($1::text[]) relation CROSS JOIN unnest($2::text[]) permission',
      [tables, ['SELECT', 'INSERT', 'UPDATE']]
    );
    if (rows[0]?.ok !== true) throw new Error('PREFLIGHT_SCHEMA_REQUIRED');
    await db.query(
      'SELECT source_hash,source_version FROM preflight_sources LIMIT 0'
    );
    await db.query(
      'SELECT claim_token,lease_until FROM preflight_outbox LIMIT 0'
    );
  } catch {
    throw new Error('PREFLIGHT_SCHEMA_REQUIRED');
  }
}
export interface SourceRow {
  tenant_id: string;
  commitment_id: string;
  contribution_id: string;
  source_version: number;
  source_hash: string;
  eligible: boolean;
  snapshot: FundingSourceSnapshot;
}
export interface TrackedMission {
  mission_id: string;
  tenant_id: string;
  commitment_id: string;
  contribution_id: string;
  source_version: number;
  source_hash: string;
  remote_status: string;
  current: boolean;
  poll_attempts: number;
}
export async function preflightTransaction<T>(
  pool: Pick<Pool, 'connect'>,
  action: (db: PoolClient) => Promise<T>
): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const result = await action(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}

interface SnapshotRow {
  commitmentId: string;
  contributionId: string;
  commitmentVersion: number;
  offerFingerprint: string;
  commitmentState: string;
  paymentStatus: string;
  refundStatus: string;
  consent: boolean;
  reviewStatus: string;
  companyName: string | null;
  publicReference: string;
  benefits: Array<{
    id: string;
    channel: string;
    target: string;
    quantity: number;
  }>;
}
export async function readFundingSource(
  db: Queryable,
  commitmentId: string
): Promise<FundingSourceSnapshot | null> {
  // Financial activation locks contribution before commitment; use the same order.
  const relation = (
    await db.query<{ contribution_id: string }>(
      'SELECT contribution_id FROM sponsorship_commitments WHERE id=$1::uuid',
      [commitmentId]
    )
  ).rows[0];
  if (!relation) return null;
  await db.query(
    'SELECT id FROM fund_contributions WHERE id=$1::uuid FOR UPDATE',
    [relation.contribution_id]
  );
  const row = (
    await db.query<SnapshotRow>(
      `SELECT m.id AS "commitmentId",m.contribution_id AS "contributionId",m.version AS "commitmentVersion",
    m.state AS "commitmentState",o.fingerprint AS "offerFingerprint",o.snapshot->'benefits' AS benefits,
    c.status AS "paymentStatus",c.sponsorship_refund_status AS "refundStatus",c.public_display_consent AS consent,
    c.sponsor_review_status AS "reviewStatus",CASE WHEN c.public_display_consent THEN c.sponsor_company_name ELSE NULL END AS "companyName",
    c.public_reference AS "publicReference"
    FROM sponsorship_commitments m JOIN fund_contributions c ON c.id=m.contribution_id
    JOIN sponsorship_offers o ON o.id=m.offer_id WHERE m.id=$1::uuid FOR UPDATE OF m`,
      [commitmentId]
    )
  ).rows[0];
  if (!row) return null;
  const obligations = (
    await db.query<{ id: string; version: number; state: string }>(
      'SELECT id,version,state FROM sponsorship_obligations WHERE commitment_id=$1::uuid ORDER BY id',
      [commitmentId]
    )
  ).rows;
  const benefits = Array.isArray(row.benefits)
    ? row.benefits.map(
        (item) =>
          `${item.id}: ${item.quantity} × ${item.channel}/${item.target}`
      )
    : [];
  const title =
    row.companyName?.trim().slice(0, 180) ||
    `Engagement ${row.publicReference || row.commitmentId}`;
  return {
    commitmentId: row.commitmentId,
    contributionId: row.contributionId,
    commitmentVersion: row.commitmentVersion,
    offerFingerprint: row.offerFingerprint,
    eligible:
      row.commitmentState === 'active' &&
      row.paymentStatus === 'paid' &&
      row.refundStatus === 'not_requested' &&
      row.reviewStatus !== 'refused',
    paymentStatus: row.paymentStatus,
    refundStatus: row.refundStatus,
    consent: row.consent,
    reviewStatus: row.reviewStatus,
    title,
    description:
      'Préparer un brouillon privé de présentation Web à partir des prestations connues. Les droits, consentements, approbations et publication restent sous l’autorité de Funding Platform.',
    benefits,
    obligations
  };
}

/** Caller owns the Funding transaction; no HTTP/model call may happen here. */
export async function enqueueActivatedPreflightMission(
  db: Queryable,
  commitmentId: string,
  settings: ProducerSettings = producerSettingsFromEnv()
): Promise<string | null> {
  if (!settings.enabled) return null;
  const snapshot = await readFundingSource(db, commitmentId);
  if (!snapshot) return null;
  const digest = snapshotHash(snapshot);
  const previous = (
    await db.query<SourceRow>(
      'SELECT * FROM preflight_sources WHERE tenant_id=$1 AND commitment_id=$2::uuid FOR UPDATE',
      [settings.tenantId, commitmentId]
    )
  ).rows[0];
  if (previous?.source_hash === digest) {
    await db.query(
      'UPDATE preflight_sources SET checked_at=NOW() WHERE tenant_id=$1 AND commitment_id=$2::uuid',
      [settings.tenantId, commitmentId]
    );
    return null;
  }
  if (!previous && !snapshot.eligible) return null;
  const version = (previous?.source_version ?? 0) + 1;
  await db.query(
    `INSERT INTO preflight_sources(tenant_id,commitment_id,contribution_id,source_version,source_hash,eligible,snapshot)
    VALUES($1,$2::uuid,$3::uuid,$4,$5,$6,$7) ON CONFLICT(tenant_id,commitment_id) DO UPDATE SET
    source_version=EXCLUDED.source_version,source_hash=EXCLUDED.source_hash,eligible=EXCLUDED.eligible,snapshot=EXCLUDED.snapshot,checked_at=NOW()`,
    [
      settings.tenantId,
      commitmentId,
      snapshot.contributionId,
      version,
      digest,
      snapshot.eligible,
      snapshot
    ]
  );
  if (previous) {
    await db.query(
      'UPDATE preflight_missions SET current=FALSE,updated_at=NOW() WHERE tenant_id=$1 AND commitment_id=$2::uuid',
      [settings.tenantId, commitmentId]
    );
    await db.query(
      'UPDATE preflight_preparations SET obsolete=TRUE WHERE tenant_id=$1 AND commitment_id=$2::uuid',
      [settings.tenantId, commitmentId]
    );
    await db.query(
      "UPDATE preflight_outbox SET status='superseded',claim_token=NULL,lease_until=NULL WHERE tenant_id=$1 AND commitment_id=$2::uuid AND event_type='mission.submitted' AND status='pending'",
      [settings.tenantId, commitmentId]
    );
    const eventId = randomUUID();
    await db.query(
      `INSERT INTO preflight_outbox(id,tenant_id,commitment_id,source_version,event_type,payload) VALUES($1,$2,$3::uuid,$4,'source.updated',$5)`,
      [
        eventId,
        settings.tenantId,
        commitmentId,
        version,
        {
          schemaVersion: '1.0',
          type: 'source.updated',
          eventId,
          tenantId: settings.tenantId,
          source: {
            application: 'funding-platform',
            subjectType: 'sponsorship-commitment',
            subjectId: commitmentId,
            version
          }
        }
      ]
    );
  }
  if (!snapshot.eligible) return null;
  const missionId = randomUUID(),
    eventId = randomUUID();
  const mission: PreflightMission = {
    schemaVersion: '1.0',
    missionId,
    eventId,
    tenantId: settings.tenantId,
    source: {
      application: 'funding-platform',
      subjectType: 'sponsorship-commitment',
      subjectId: commitmentId,
      version
    },
    workflow: { type: 'sponsorship-preparation-v1', version: '1.0' },
    priority: 'normal',
    constraints: {
      humanApprovalRequired: true,
      maxCostUsd: settings.maxCostUsd,
      timeoutMs: 30000,
      maxAttempts: 3
    },
    input: preparationInput(snapshot, digest)
  };
  await db.query(
    'INSERT INTO preflight_missions(mission_id,tenant_id,commitment_id,contribution_id,source_version,source_hash) VALUES($1,$2,$3::uuid,$4::uuid,$5,$6)',
    [
      missionId,
      settings.tenantId,
      commitmentId,
      snapshot.contributionId,
      version,
      digest
    ]
  );
  await db.query(
    `INSERT INTO preflight_outbox(id,tenant_id,commitment_id,source_version,mission_id,event_type,payload) VALUES($1,$2,$3::uuid,$4,$5,'mission.submitted',$6)`,
    [eventId, settings.tenantId, commitmentId, version, missionId, mission]
  );
  return missionId;
}

/** Reconcile only sources explicitly observed after opt-in, never historical backfill. */
export async function reconcileTrackedSources(
  pool: Pool,
  settings: ProducerSettings,
  limit = 20
): Promise<number> {
  if (!settings.enabled) return 0;
  const ids = (
    await pool.query<{ commitment_id: string }>(
      'SELECT commitment_id FROM preflight_sources WHERE tenant_id=$1 ORDER BY checked_at,commitment_id LIMIT $2',
      [settings.tenantId, limit]
    )
  ).rows;
  for (const row of ids)
    await preflightTransaction(pool, (db) =>
      enqueueActivatedPreflightMission(db, row.commitment_id, settings)
    );
  return ids.length;
}

export async function listPreparations(
  db: Queryable,
  contributionId: string,
  tenantId: string
): Promise<{
  items: Array<
    ImportedPreflightPreparation & { obsolete: boolean; importedAt: string }
  >;
}> {
  const rows = (
    await db.query<{
      preparation: ImportedPreflightPreparation;
      obsolete: boolean;
      imported_at: Date;
    }>(
      `SELECT preparation,obsolete,imported_at FROM preflight_preparations
    WHERE tenant_id=$1 AND contribution_id=$2::uuid ORDER BY imported_at DESC,mission_id LIMIT 50`,
      [tenantId, contributionId]
    )
  ).rows;
  return {
    items: rows.map((row) => ({
      ...row.preparation,
      obsolete: row.obsolete,
      importedAt: row.imported_at.toISOString()
    }))
  };
}

export async function connectorStatus(db: Queryable, tenantId: string) {
  const outbox = (
    await db.query<{ pending: string; quarantined: string }>(
      `SELECT count(*) FILTER(WHERE status IN ('pending','running')) AS pending,
    count(*) FILTER(WHERE status='quarantined') AS quarantined FROM preflight_outbox WHERE tenant_id=$1`,
      [tenantId]
    )
  ).rows[0]!;
  const tracked = (
    await db.query<{ count: string; import_quarantined: string }>(
      "SELECT count(*),count(*) FILTER(WHERE current AND error_code IS NOT NULL AND poll_after='infinity'::timestamptz) AS import_quarantined FROM preflight_missions WHERE tenant_id=$1",
      [tenantId]
    )
  ).rows[0]!;
  const heartbeat = (
    await db.query<{ seen_at: Date | null }>(
      'SELECT max(seen_at) AS seen_at FROM preflight_worker_heartbeats WHERE tenant_id=$1',
      [tenantId]
    )
  ).rows[0];
  return {
    pending: Number(outbox.pending),
    quarantined: Number(outbox.quarantined),
    trackedMissions: Number(tracked.count),
    quarantinedImports: Number(tracked.import_quarantined),
    lastWorkerSeenAt: heartbeat?.seen_at?.toISOString() ?? null
  };
}

export async function persistPreflightPreparation(
  pool: Pool,
  preparation: ImportedPreflightPreparation,
  expected: {
    tenantId: string;
    commitmentId: string;
    sourceVersion: number;
    sourceHash: string;
  }
): Promise<boolean> {
  if (
    preparation.status !== 'proposed' ||
    preparation.businessDecisionExecuted !== false ||
    preparation.tenantId !== expected.tenantId ||
    preparation.commitmentId !== expected.commitmentId ||
    preparation.sourceVersion !== expected.sourceVersion ||
    preparation.sourceHash !== expected.sourceHash
  )
    throw new PreflightContractError('preflight_import_source_mismatch');
  return preflightTransaction(pool, async (db) => {
    const current = await readFundingSource(db, expected.commitmentId);
    const source = (
      await db.query<SourceRow>(
        'SELECT * FROM preflight_sources WHERE tenant_id=$1 AND commitment_id=$2::uuid FOR UPDATE',
        [expected.tenantId, expected.commitmentId]
      )
    ).rows[0];
    if (
      !source ||
      !source.eligible ||
      source.source_version !== expected.sourceVersion ||
      source.source_hash !== expected.sourceHash
    )
      return false;
    if (!current || snapshotHash(current) !== expected.sourceHash) return false;
    const tracked = (
      await db.query(
        `SELECT mission_id FROM preflight_missions
      WHERE mission_id=$1 AND tenant_id=$2 AND commitment_id=$3::uuid AND source_version=$4 AND source_hash=$5 AND current FOR UPDATE`,
        [
          preparation.missionId,
          expected.tenantId,
          expected.commitmentId,
          expected.sourceVersion,
          expected.sourceHash
        ]
      )
    ).rows[0];
    if (!tracked) return false;
    const existing = (
      await db.query<{ preparation: ImportedPreflightPreparation }>(
        'SELECT preparation FROM preflight_preparations WHERE mission_id=$1 AND tenant_id=$2',
        [preparation.missionId, expected.tenantId]
      )
    ).rows[0];
    if (existing) {
      if (snapshotHash(existing.preparation) !== snapshotHash(preparation))
        throw new Error('PREFLIGHT_IMPORT_CONFLICT');
      return true;
    }
    await db.query(
      `INSERT INTO preflight_preparations(mission_id,tenant_id,commitment_id,contribution_id,source_version,source_hash,preparation)
      VALUES($1,$2,$3::uuid,$4::uuid,$5,$6,$7)`,
      [
        preparation.missionId,
        expected.tenantId,
        expected.commitmentId,
        source.contribution_id,
        expected.sourceVersion,
        expected.sourceHash,
        preparation
      ]
    );
    await db.query(
      "UPDATE preflight_missions SET remote_status='review_ready',poll_after='infinity',error_code=NULL,updated_at=NOW() WHERE mission_id=$1 AND tenant_id=$2 AND current",
      [preparation.missionId, expected.tenantId]
    );
    return true;
  });
}
