import { audit, type DeliveryRow } from './context.js';
import { assert, PublicationAutomationError } from './policy.js';
import type { Db } from './sources.js';

/** Technical spacing, not a provider quota or a promised publication cadence. */
export const LIVE_ACCOUNT_INTERVAL_MS = 60_000;
const intervalMs = (mode: DeliveryRow['mode']) =>
  mode === 'live' ? LIVE_ACCOUNT_INTERVAL_MS : 0;

export const canonicalPublicationAccount = (
  row: Pick<DeliveryRow, 'feed_id' | 'account_id' | 'mode'>
) => {
  const provider = row.feed_id.split(':')[1] as 'facebook' | 'linkedin';
  const accountId = row.account_id.trim();
  return {
    provider,
    accountId:
      provider === 'linkedin'
        ? accountId.replace(/^urn:li:organization:/, '')
        : accountId,
    mode: row.mode
  };
};

/** The alias is an internal SQL identifier, never request input. */
export const canonicalAccountSql = (
  alias: 'd' | 'other' | 'publication_deliveries'
) =>
  `(CASE WHEN split_part(${alias}.feed_id,':',2)='linkedin' THEN regexp_replace(btrim(${alias}.account_id),'^urn:li:organization:','') ELSE btrim(${alias}.account_id) END)`;

async function lockAccount(db: Db, row: DeliveryRow): Promise<void> {
  const account = canonicalPublicationAccount(row);
  assert(account.accountId.length > 0, 'CONNECTION_REQUIRED');
  await db.query(
    `INSERT INTO publication_account_leases(provider,account_id,mode) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
    [account.provider, account.accountId, account.mode]
  );
  await db.query(
    `SELECT 1 FROM publication_account_leases WHERE provider=$1 AND account_id=$2 AND mode=$3 FOR UPDATE`,
    [account.provider, account.accountId, account.mode]
  );
}

/** Delivery -> account lock ordering is shared by approvals and worker outcomes. */
export async function reserveAccountSchedule(
  db: Db,
  row: DeliveryRow,
  { legacy = false } = {}
): Promise<void> {
  await lockAccount(db, row);
  const account = canonicalPublicationAccount(row);
  const state = (
    await db.query<{ delivery_id: string | null; uncertain: boolean }>(
      `SELECT delivery_id,uncertain FROM publication_account_leases WHERE provider=$1 AND account_id=$2 AND mode=$3`,
      [account.provider, account.accountId, account.mode]
    )
  ).rows[0];
  assert(!state.uncertain, 'ACCOUNT_RECONCILIATION_REQUIRED');
  const legacyUnresolved = (
    await db.query(
      `SELECT 1 FROM publication_deliveries other WHERE other.id<>$4 AND split_part(other.feed_id,':',2)=$1
       AND ${canonicalAccountSql('other')}=$2 AND other.mode=$3
       AND (other.status='uncertain' OR (other.status='publishing' AND NOT EXISTS(SELECT 1 FROM publication_account_leases a WHERE a.delivery_id=other.id))) LIMIT 1`,
      [account.provider, account.accountId, account.mode, row.id]
    )
  ).rowCount;
  assert(!legacyUnresolved, 'ACCOUNT_RECONCILIATION_REQUIRED');
  // The database clock is read after locks: transaction-start NOW() is stale
  // when another reviewer held this account past the requested time.
  const future = (
    await db.query<{ future: boolean }>(
      'SELECT $1::timestamptz > clock_timestamp() AS future',
      [row.scheduled_at]
    )
  ).rows[0].future;
  assert(legacy || future, 'APPROVAL_UNAVAILABLE');
  await db.query(
    `UPDATE publication_account_reservations r SET status='released',updated_at=NOW()
     WHERE r.provider=$1 AND r.account_id=$2 AND r.mode=$3 AND r.status='reserved'
       AND NOT EXISTS(SELECT 1 FROM publication_deliveries d WHERE d.id=r.delivery_id AND d.status IN ('approved','publishing','uncertain'))
       AND NOT EXISTS(SELECT 1 FROM publication_account_leases a WHERE a.delivery_id=r.delivery_id)`,
    [account.provider, account.accountId, account.mode]
  );
  const overlap = (
    await db.query(
      `SELECT delivery_id FROM publication_account_reservations
       WHERE provider=$1 AND account_id=$2 AND mode=$3 AND delivery_id<>$4
         AND status IN ('reserved','publishing','uncertain')
         AND abs(extract(epoch FROM scheduled_at-$5::timestamptz))*1000<$6 LIMIT 1`,
      [
        account.provider,
        account.accountId,
        account.mode,
        row.id,
        row.scheduled_at,
        intervalMs(row.mode)
      ]
    )
  ).rows[0];
  assert(!overlap, 'ACCOUNT_SLOT_RESERVED');
  const legacyOverlap = (
    await db.query(
      `SELECT 1 FROM publication_deliveries other WHERE other.id<>$4 AND split_part(other.feed_id,':',2)=$1
       AND ${canonicalAccountSql('other')}=$2 AND other.mode=$3 AND other.status='approved'
       AND NOT EXISTS(SELECT 1 FROM publication_account_reservations r WHERE r.delivery_id=other.id)
       AND abs(extract(epoch FROM other.scheduled_at-$5::timestamptz))*1000<$6 LIMIT 1`,
      [
        account.provider,
        account.accountId,
        account.mode,
        row.id,
        row.scheduled_at,
        intervalMs(row.mode)
      ]
    )
  ).rowCount;
  assert(!legacyOverlap, 'ACCOUNT_SLOT_RESERVED');
  const old = (
    await db.query<{ status: string }>(
      'SELECT status FROM publication_account_reservations WHERE delivery_id=$1',
      [row.id]
    )
  ).rows[0];
  assert(
    !old || ['released', 'reserved'].includes(old.status),
    'ACCOUNT_RECONCILIATION_REQUIRED'
  );
  await db.query(
    `INSERT INTO publication_account_reservations(delivery_id,provider,account_id,mode,scheduled_at,approval_version,status)
     VALUES($1,$2,$3,$4,$5,$6,'reserved')
     ON CONFLICT(delivery_id) DO UPDATE SET provider=EXCLUDED.provider,account_id=EXCLUDED.account_id,mode=EXCLUDED.mode,
       scheduled_at=EXCLUDED.scheduled_at,approval_version=EXCLUDED.approval_version,status='reserved',claim_version=NULL,claim_fence=NULL,updated_at=NOW()`,
    [
      row.id,
      account.provider,
      account.accountId,
      account.mode,
      row.scheduled_at,
      row.version + (legacy ? 0 : 1)
    ]
  );
}

/** Editing cannot free an in-flight or uncertain provider operation. */
export async function releaseAccountReservation(
  db: Db,
  row: DeliveryRow,
  confirmedAbsent = false
): Promise<void> {
  await lockAccount(db, row);
  const account = canonicalPublicationAccount(row);
  if (confirmedAbsent) {
    await db.query(
      `UPDATE publication_account_leases SET delivery_id=NULL,delivery_version=NULL,lease_until=NULL,uncertain=FALSE,updated_at=NOW()
       WHERE provider=$1 AND account_id=$2 AND mode=$3 AND delivery_id=$4`,
      [account.provider, account.accountId, account.mode, row.id]
    );
  }
  await db.query(
    `UPDATE publication_account_reservations SET status='released',updated_at=NOW()
     WHERE delivery_id=$1 AND NOT EXISTS(SELECT 1 FROM publication_account_leases WHERE delivery_id=$1)`,
    [row.id]
  );
}

/** An expired account lease is quarantined, never automatically reassigned. */
export async function claimAccountReservation(
  db: Db,
  row: DeliveryRow,
  claimVersion: number
): Promise<number | null> {
  const account = canonicalPublicationAccount(row);
  const reservation = (
    await db.query<{ approval_version: number }>(
      `SELECT approval_version FROM publication_account_reservations WHERE delivery_id=$1 AND status='reserved'
       AND provider=$2 AND account_id=$3 AND mode=$4 AND scheduled_at=$5`,
      [
        row.id,
        account.provider,
        account.accountId,
        account.mode,
        row.scheduled_at
      ]
    )
  ).rows[0];
  if (!reservation) {
    try {
      await reserveAccountSchedule(db, row, { legacy: true });
    } catch (error) {
      if (
        error instanceof PublicationAutomationError &&
        error.code === 'ACCOUNT_SLOT_RESERVED'
      ) {
        await db.query(
          `UPDATE publication_deliveries SET status='blocked',approved_at=NULL,approved_by=NULL,error_code=$2,version=version+1,updated_at=NOW()
           WHERE id=$1 AND status='approved' AND version=$3`,
          [row.id, error.code, row.version]
        );
        await audit(db, 'publication-worker', 'blocked', row.id, {
          code: error.code,
          qualification: 'legacy_account_reservation'
        });
        return null;
      }
      if (
        error instanceof PublicationAutomationError &&
        error.code === 'ACCOUNT_RECONCILIATION_REQUIRED'
      )
        return null;
      throw error;
    }
  }
  const available = (
    await db.query(
      `SELECT 1 FROM publication_account_leases WHERE provider=$1 AND account_id=$2 AND mode=$3 FOR UPDATE SKIP LOCKED`,
      [account.provider, account.accountId, account.mode]
    )
  ).rowCount;
  if (!available) return null;
  const acquired = (
    await db.query<{ fence: number }>(
      `UPDATE publication_account_leases SET delivery_id=$4,delivery_version=$5,fence=fence+1,dispatched_at=NULL,
       lease_until=clock_timestamp()+INTERVAL '5 minutes',updated_at=NOW()
       WHERE provider=$1 AND account_id=$2 AND mode=$3 AND delivery_id IS NULL AND NOT uncertain
         AND next_dispatch_at<=clock_timestamp() RETURNING fence`,
      [account.provider, account.accountId, account.mode, row.id, claimVersion]
    )
  ).rows[0];
  if (!acquired) return null;
  await db.query(
    `UPDATE publication_account_reservations SET status='publishing',claim_version=$2,claim_fence=$3,updated_at=NOW() WHERE delivery_id=$1`,
    [row.id, claimVersion, acquired.fence]
  );
  return acquired.fence;
}

export async function validAccountClaim(
  db: Db,
  row: DeliveryRow
): Promise<boolean> {
  return Boolean(
    (
      await db.query(
        `SELECT 1 FROM publication_account_leases a JOIN publication_account_reservations r ON r.delivery_id=a.delivery_id
         WHERE a.delivery_id=$1 AND a.delivery_version=$2 AND a.lease_until>clock_timestamp() AND NOT a.uncertain
           AND r.claim_version=a.delivery_version AND r.claim_fence=a.fence
           AND ($3::integer IS NULL OR a.fence=$3)`,
        [row.id, row.version, row.accountClaimVersion ?? null]
      )
    ).rowCount
  );
}

/** First provider request starts the real-clock spacing; repeated upload/POST guards preserve it. */
export async function markAccountDispatch(
  db: Db,
  row: DeliveryRow
): Promise<boolean> {
  return Boolean(
    (
      await db.query(
        `UPDATE publication_account_leases SET dispatched_at=COALESCE(dispatched_at,clock_timestamp()),updated_at=NOW()
     WHERE delivery_id=$1 AND delivery_version=$2 AND lease_until>clock_timestamp() AND NOT uncertain
       AND ($3::integer IS NULL OR fence=$3) RETURNING fence`,
        [row.id, row.version, row.accountClaimVersion ?? null]
      )
    ).rowCount
  );
}

export type AccountClaimOutcome =
  'published' | 'retry' | 'blocked' | 'deferred' | 'uncertain';

/** Called inside the delivery outcome transaction with the original claim version. */
export async function finishAccountClaim(
  db: Db,
  row: DeliveryRow,
  outcome: AccountClaimOutcome,
  options: { dispatched?: boolean } = {}
): Promise<void> {
  const account = canonicalPublicationAccount(row);
  await lockAccount(db, row);
  const held = (
    await db.query<{
      delivery_version: number | null;
      dispatched_at: Date | null;
    }>(
      `SELECT delivery_version,dispatched_at FROM publication_account_leases WHERE provider=$1 AND account_id=$2 AND mode=$3 AND delivery_id=$4`,
      [account.provider, account.accountId, account.mode, row.id]
    )
  ).rows[0];
  // Reconciliation owns a locked uncertain delivery rather than the old worker
  // version; every worker outcome must still match its original claim.
  if (
    !held ||
    (outcome !== 'published' && held.delivery_version !== row.version)
  )
    return;
  if (
    outcome === 'published' &&
    row.status !== 'uncertain' &&
    held.delivery_version !== row.version
  )
    return;
  const uncertain = outcome === 'uncertain';
  // Fenced workers stamp the first actual provider call after every guard.
  // Entering sendDelivery alone cannot impose spacing when assertActive fails.
  // Older claims and a verified historical publication keep a conservative fallback.
  const dispatched =
    held.dispatched_at !== null ||
    (options.dispatched === true && row.accountClaimVersion === undefined) ||
    outcome === 'published';
  await db.query(
    `UPDATE publication_account_leases SET delivery_id=CASE WHEN $4 THEN delivery_id ELSE NULL END,
     delivery_version=CASE WHEN $4 THEN delivery_version ELSE NULL END,lease_until=CASE WHEN $4 THEN lease_until ELSE NULL END,
     uncertain=$4,next_dispatch_at=CASE WHEN $6 THEN GREATEST(next_dispatch_at,COALESCE(dispatched_at,clock_timestamp())+($5 * INTERVAL '1 millisecond')) ELSE next_dispatch_at END,updated_at=NOW()
     WHERE provider=$1 AND account_id=$2 AND mode=$3`,
    [
      account.provider,
      account.accountId,
      account.mode,
      uncertain,
      intervalMs(row.mode),
      dispatched
    ]
  );
  await db.query(
    `UPDATE publication_account_reservations SET status=$2,updated_at=NOW() WHERE delivery_id=$1`,
    [
      row.id,
      uncertain
        ? 'uncertain'
        : outcome === 'published'
          ? 'published'
          : ['retry', 'deferred'].includes(outcome)
            ? 'reserved'
            : 'released'
    ]
  );
}
