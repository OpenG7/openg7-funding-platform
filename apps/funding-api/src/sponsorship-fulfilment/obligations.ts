import { isDeepStrictEqual } from 'node:util';

import type { PoolClient } from 'pg';
import type {
  PublicationObligationSnapshot,
  SponsorshipPublicationFormat
} from '@openg7/funding-core';

import { loadSponsorshipCommitment } from '../sponsorship-commitments.repository.js';
import { lockModerationDependencies } from '../moderation/repository.js';
import { assert } from '../publication-automation/policy.js';
import type { Source } from '../publication-automation/sources.js';

type Db = Pick<PoolClient, 'query'>;
interface ObligationDelivery {
  readonly id: string;
  readonly batch_id: string | null;
  readonly feed_id: string;
  readonly source_snapshot: readonly Source[];
  readonly obligation_snapshot?: readonly PublicationObligationSnapshot[];
  readonly publication_format?: SponsorshipPublicationFormat;
}

async function currentObligations(db: Db, row: ObligationDelivery) {
  if (!row.batch_id) return [];
  const [target, channel] = row.feed_id.split(':');
  const ids = [
    ...new Set(row.source_snapshot.map((s) => s.contribution_id))
  ].sort();
  assert(ids.length > 0, 'EMPTY_BATCH');
  const selected: PublicationObligationSnapshot[] = [];
  for (const contributionId of ids) {
    const commitment = await loadSponsorshipCommitment(db, contributionId);
    assert(commitment?.state === 'active', 'SPONSORSHIP_COMMITMENT_REQUIRED');
    const reservations = await db.query<{
      obligation_id: string;
      delivery_id: string;
    }>(
      `SELECT r.obligation_id,r.delivery_id FROM sponsorship_obligation_reservations r
       JOIN sponsorship_obligations o ON o.id=r.obligation_id WHERE o.contribution_id=$1::uuid AND r.released_at IS NULL`,
      [contributionId]
    );
    const owned = row.obligation_snapshot?.find(
      (o) => o.contributionId === contributionId
    );
    const bound = row.source_snapshot.find(
      (source) => source.contribution_id === contributionId
    )?.obligation_id;
    assert(!owned || !bound || owned.id === bound, 'SOURCE_COMMITMENT_CHANGED');
    const candidates = commitment.obligations.filter(
      (o) =>
        o.channel === channel && o.target === target && o.state === 'pending'
    );
    const obligation =
      owned || bound
        ? candidates.find((o) => o.id === (owned?.id ?? bound))
        : candidates.find(
            (o) =>
              !reservations.rows.some(
                (r) => r.obligation_id === o.id && r.delivery_id !== row.id
              )
          );
    assert(obligation, 'SPONSORSHIP_OBLIGATION_UNAVAILABLE');
    assert(
      (obligation.format ?? 'collective_text') ===
        (row.publication_format ?? 'collective_text'),
      'FORMAT_COMMITMENT_MISMATCH'
    );
    assert(
      row.publication_format !== 'individual_portrait' || ids.length === 1,
      'PORTRAIT_REQUIRES_ONE_SPONSOR'
    );
    selected.push({
      id: obligation.id,
      contributionId,
      version: obligation.version,
      channel: obligation.channel,
      target: obligation.target,
      ordinal: obligation.ordinal,
      ...(obligation.format ? { format: obligation.format } : {})
    });
  }
  return selected;
}

/** Approval reserves one exact passage per participant; concurrent approvals cannot sell it twice. */
export async function capturePublicationObligations(
  db: Db,
  row: ObligationDelivery
) {
  const selected = await currentObligations(db, row);
  for (const obligation of [...selected].sort((a, b) =>
    a.id.localeCompare(b.id)
  )) {
    const result = await db.query<{
      delivery_id: string;
      obligation_version: number;
    }>(
      `INSERT INTO sponsorship_obligation_reservations(obligation_id,delivery_id,obligation_version)
       VALUES($1::uuid,$2::uuid,$3) ON CONFLICT(obligation_id) DO UPDATE SET
         delivery_id=CASE WHEN sponsorship_obligation_reservations.released_at IS NOT NULL THEN EXCLUDED.delivery_id ELSE sponsorship_obligation_reservations.delivery_id END,
         obligation_version=CASE WHEN sponsorship_obligation_reservations.released_at IS NOT NULL THEN EXCLUDED.obligation_version ELSE sponsorship_obligation_reservations.obligation_version END,
         released_at=CASE WHEN sponsorship_obligation_reservations.released_at IS NOT NULL THEN NULL ELSE sponsorship_obligation_reservations.released_at END
       RETURNING delivery_id,obligation_version`,
      [obligation.id, row.id, obligation.version]
    );
    assert(
      result.rows[0]?.delivery_id === row.id &&
        result.rows[0]?.obligation_version === obligation.version,
      'SPONSORSHIP_OBLIGATION_RESERVED'
    );
  }
  return selected;
}

/** Revalidate commercial terms, version and reservation before each provider request and completion. */
export async function assertPublicationObligations(
  db: Db,
  row: ObligationDelivery
): Promise<void> {
  if (!row.batch_id) return;
  const selected = await currentObligations(db, row);
  assert(
    isDeepStrictEqual(selected, row.obligation_snapshot ?? []),
    'SOURCE_COMMITMENT_CHANGED'
  );
  const reservations = await db.query<{
    obligation_id: string;
    obligation_version: number;
  }>(
    'SELECT obligation_id,obligation_version FROM sponsorship_obligation_reservations WHERE delivery_id=$1::uuid AND released_at IS NULL',
    [row.id]
  );
  assert(
    reservations.rows.length === selected.length &&
      selected.every((o) =>
        reservations.rows.some(
          (r) => r.obligation_id === o.id && r.obligation_version === o.version
        )
      ),
    'SOURCE_COMMITMENT_CHANGED'
  );
}

export async function releasePublicationObligations(
  db: Db,
  deliveryId: string
): Promise<void> {
  await db.query(
    'UPDATE sponsorship_obligation_reservations SET released_at=clock_timestamp() WHERE delivery_id=$1::uuid AND released_at IS NULL',
    [deliveryId]
  );
}

/** This precedes the contribution lock, like moderation revocation. */
export async function lockCommitmentDeliveries(
  db: Db,
  contributionId: string
): Promise<void> {
  await lockModerationDependencies(db, {
    type: 'sponsorship',
    id: contributionId
  });
}

/** A term adjustment revokes publication authority; an uncertain remote effect remains held for investigation. */
export async function revokeCommitmentDeliveries(
  db: Db,
  contributionId: string
): Promise<void> {
  const deliveries = await db.query<{
    id: string;
    status: string;
    account_held: boolean;
  }>(
    `SELECT p.id,p.status,EXISTS(SELECT 1 FROM publication_account_leases account WHERE account.delivery_id=p.id AND account.uncertain) AS account_held FROM publication_deliveries p WHERE p.batch_id IN
      (SELECT batch_id FROM sponsor_publication_drafts WHERE contribution_id=$1::uuid)
      AND p.status IN ('draft','approved','publishing','blocked','uncertain') ORDER BY p.id`,
    [contributionId]
  );
  for (const delivery of deliveries.rows) {
    const uncertain =
      ['publishing', 'uncertain'].includes(delivery.status) ||
      delivery.account_held;
    await db.query(
      `UPDATE publication_deliveries SET status=$2,approved_at=NULL,approved_by=NULL,
      error_code=CASE WHEN error_code LIKE 'MODERATION_%' THEN error_code ELSE 'SOURCE_COMMITMENT_CHANGED' END,lease_until=NULL,version=version+1,updated_at=NOW() WHERE id=$1::uuid`,
      [
        delivery.id,
        uncertain && delivery.status !== 'blocked' ? 'uncertain' : 'blocked'
      ]
    );
    if (uncertain)
      await db.query(
        'UPDATE publication_account_leases SET uncertain=TRUE,updated_at=NOW() WHERE delivery_id=$1::uuid',
        [delivery.id]
      );
    if (!uncertain) {
      await db.query(
        "UPDATE publication_account_reservations SET status='released',updated_at=NOW() WHERE delivery_id=$1::uuid AND status='reserved'",
        [delivery.id]
      );
      await releasePublicationObligations(db, delivery.id);
    }
  }
}
