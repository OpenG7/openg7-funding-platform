import { createHash, randomUUID } from 'node:crypto';

import type {
  AdminSponsorshipConsent,
  AdminSponsorshipConsentRecordReceipt,
  AdminSponsorshipConsentReceiptResponse,
  SponsorshipConsentRecordBlocker
} from '@openg7/funding-core';
import type { Pool, PoolClient } from 'pg';

import { SPONSORSHIP_PUBLIC_CONSENT_SCOPE } from '../../../packages/funding-core/src/admin-sponsorship-consent.js';

import {
  consentActor,
  consentCheck,
  consentUuid,
  parseSponsorshipConsent
} from './admin-sponsorship-consent-policy.js';
import { assertSponsorshipConsentReadiness } from './admin-sponsorship-consent-readiness.js';
import { withPostgresTransaction } from './postgres-transaction.js';
import { revokeCommitmentDeliveries } from './sponsorship-fulfilment.repository.js';

/** Include direct media deliveries as well as collective sponsorship batches. */
const deliveryScope = `(p.batch_id IN (
  SELECT batch_id FROM sponsor_publication_drafts WHERE contribution_id=$1::uuid)
  OR p.media_id IN (SELECT id FROM sponsor_media_assets WHERE contribution_id=$1::uuid)
  OR EXISTS(SELECT 1 FROM publication_delivery_photos photo JOIN sponsor_media_assets asset
    ON asset.id=photo.asset_id WHERE photo.delivery_id=p.id AND photo.active AND asset.contribution_id=$1::uuid))`;

interface ConsentSource {
  version: string;
  effective: boolean;
  today: string;
}

interface ConsentHistoryRow {
  id: string;
  agreed_on: string;
  evidence_reference: string;
  recorded_at: Date;
  actor: string;
}

interface ConsentCommandRow {
  actor: string;
  request_hash: string;
  contribution_id: string;
  receipt: AdminSponsorshipConsentRecordReceipt;
}

async function source(db: PoolClient, id: string, lock = false) {
  const row = (
    await db.query<ConsentSource>(
      `SELECT updated_at::text AS version,public_display_consent AS effective,
        (clock_timestamp() AT TIME ZONE 'America/Toronto')::date::text AS today
       FROM fund_contributions WHERE id=$1::uuid AND contribution_type='sponsorship_interest'
       ${lock ? 'FOR UPDATE' : ''}`,
      [id]
    )
  ).rows[0];
  consentCheck(row, 'CONSENT_NOT_FOUND', 404);
  return row;
}

async function operationBlockers(db: PoolClient, id: string) {
  const row = (
    await db.query<{ processing: boolean; uncertain: boolean }>(
      `WITH related AS (SELECT p.id,p.status FROM publication_deliveries p WHERE ${deliveryScope}),
       legacy AS (SELECT status FROM social_publication_jobs WHERE batch_id IN
         (SELECT batch_id FROM sponsor_publication_drafts WHERE contribution_id=$1::uuid))
       SELECT EXISTS(SELECT 1 FROM related WHERE status='publishing')
         OR EXISTS(SELECT 1 FROM publication_account_leases a JOIN related p ON p.id=a.delivery_id WHERE NOT a.uncertain)
         OR EXISTS(SELECT 1 FROM publication_account_reservations a JOIN related p ON p.id=a.delivery_id WHERE a.status='publishing')
         OR EXISTS(SELECT 1 FROM legacy WHERE status IN ('pending','publishing')) AS processing,
         EXISTS(SELECT 1 FROM related WHERE status='uncertain')
         OR EXISTS(SELECT 1 FROM publication_account_leases a JOIN related p ON p.id=a.delivery_id WHERE a.uncertain)
         OR EXISTS(SELECT 1 FROM publication_account_reservations a JOIN related p ON p.id=a.delivery_id WHERE a.status='uncertain')
         OR EXISTS(SELECT 1 FROM legacy WHERE status='failed') AS uncertain`,
      [id]
    )
  ).rows[0]!;
  return [
    ...(row.processing ? ['operation_processing' as const] : []),
    ...(row.uncertain ? ['operation_uncertain' as const] : [])
  ];
}

/** No provider, email, media write or publication port exists in this service. */
export class AdminSponsorshipConsentService {
  constructor(private readonly pool: Pool) {}

  async read(
    contributionId: string,
    actor: string,
    mayRecord: boolean
  ): Promise<AdminSponsorshipConsent> {
    consentCheck(consentUuid(contributionId), 'CONSENT_INVALID_REQUEST', 400);
    consentActor(actor);
    await assertSponsorshipConsentReadiness(this.pool);
    return withPostgresTransaction(
      this.pool,
      async (db) => {
        const current = await source(db, contributionId);
        const history = (
          await db.query<ConsentHistoryRow>(
            `SELECT id,agreed_on::text,evidence_reference,recorded_at,actor
             FROM admin_sponsorship_consent_records WHERE contribution_id=$1::uuid
             ORDER BY recorded_at DESC,id DESC LIMIT 50`,
            [contributionId]
          )
        ).rows;
        const recordBlockers: SponsorshipConsentRecordBlocker[] = [
          ...(current.effective ? ['already_granted' as const] : []),
          ...(!mayRecord ? ['permission_required' as const] : []),
          ...(mayRecord ? await operationBlockers(db, contributionId) : [])
        ];
        return {
          contributionId: contributionId.toLowerCase(),
          version: current.version,
          effectiveConsent: current.effective,
          source: current.effective
            ? history.length
              ? 'documented_agreement'
              : 'checkout'
            : 'none',
          scope: SPONSORSHIP_PUBLIC_CONSENT_SCOPE,
          canRecord: recordBlockers.length === 0,
          recordBlockers,
          ...(mayRecord
            ? {
                recordingActor: actor,
                history: history.map((row) => ({
                  id: row.id,
                  agreedOn: row.agreed_on,
                  evidenceReference: row.evidence_reference,
                  recordedAt: row.recorded_at.toISOString(),
                  actor: row.actor
                }))
              }
            : {})
        };
      },
      { readOnlySnapshot: true }
    );
  }

  async receipt(
    contributionId: string,
    requestId: string,
    actor: string,
    mayRecord: boolean
  ): Promise<AdminSponsorshipConsentReceiptResponse> {
    consentCheck(mayRecord, 'CONSENT_PERMISSION_REQUIRED', 403);
    consentActor(actor);
    consentCheck(
      consentUuid(contributionId) && consentUuid(requestId),
      'CONSENT_INVALID_REQUEST',
      400
    );
    await assertSponsorshipConsentReadiness(this.pool);
    const row = (
      await this.pool.query<ConsentCommandRow>(
        `SELECT actor,request_hash,contribution_id,receipt FROM admin_sponsorship_consent_records
         WHERE request_id=$1::uuid AND contribution_id=$2::uuid AND actor=$3`,
        [requestId, contributionId, actor]
      )
    ).rows[0];
    return row
      ? { state: 'recorded', receipt: row.receipt }
      : { state: 'not_found' };
  }

  async record(
    raw: unknown,
    actor: string,
    mayRecord: boolean
  ): Promise<AdminSponsorshipConsentRecordReceipt> {
    consentCheck(mayRecord, 'CONSENT_PERMISSION_REQUIRED', 403);
    consentActor(actor);
    const input = parseSponsorshipConsent(raw);
    await assertSponsorshipConsentReadiness(this.pool, true);
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ ...input, actor }))
      .digest('hex');
    return withPostgresTransaction(this.pool, async (db) => {
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        'sponsorship-consent:' + input.requestId
      ]);
      const prior = (
        await db.query<ConsentCommandRow>(
          'SELECT actor,request_hash,contribution_id,receipt FROM admin_sponsorship_consent_records WHERE request_id=$1::uuid',
          [input.requestId]
        )
      ).rows[0];
      if (prior) {
        consentCheck(
          prior.actor === actor && prior.request_hash === requestHash,
          'CONSENT_REQUEST_CONFLICT'
        );
        return prior.receipt;
      }
      // Match native delivery-before-source locking, including directly used photos.
      const deliveries = (
        await db.query<{ id: string; status: string }>(
          `SELECT p.id,p.status FROM publication_deliveries p WHERE ${deliveryScope} ORDER BY p.id FOR UPDATE OF p`,
          [input.contributionId]
        )
      ).rows;
      const current = await source(db, input.contributionId, true);
      consentCheck(
        current.version === input.expectedVersion,
        'CONSENT_VERSION_CONFLICT'
      );
      consentCheck(!current.effective, 'CONSENT_ALREADY_GRANTED');
      consentCheck(input.agreedOn <= current.today, 'CONSENT_DATE_FUTURE', 400);
      const blockers = await operationBlockers(db, input.contributionId);
      consentCheck(
        !blockers.includes('operation_uncertain'),
        'CONSENT_OPERATION_UNCERTAIN'
      );
      consentCheck(
        !blockers.includes('operation_processing'),
        'CONSENT_OPERATION_PROCESSING'
      );
      await revokeCommitmentDeliveries(
        db,
        input.contributionId,
        deliveries.map((delivery) => delivery.id)
      );
      const updated = (
        await db.query<{ version: string }>(
          `UPDATE fund_contributions SET public_display_consent=TRUE,sponsor_site_visibility_held=TRUE,
           updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 microsecond')
           WHERE id=$1::uuid RETURNING updated_at::text AS version`,
          [input.contributionId]
        )
      ).rows[0]!;
      const recordId = randomUUID();
      const recordedAt = (
        await db.query<{ now: Date }>('SELECT clock_timestamp() AS now')
      ).rows[0]!.now.toISOString();
      const receipt: AdminSponsorshipConsentRecordReceipt = {
        requestId: input.requestId,
        contributionId: input.contributionId,
        recordId,
        outcome: 'recorded',
        version: updated.version,
        effectiveConsent: true,
        publicVisibilityHeld: true,
        invalidatedDeliveryCount: deliveries.filter((delivery) =>
          ['draft', 'approved', 'blocked'].includes(delivery.status)
        ).length,
        recordedAt,
        actor
      };
      const audit = (
        await db.query<{ id: string }>(
          `INSERT INTO admin_audit_log(actor,action,entity_type,entity_id,summary,metadata)
           VALUES($1,'sponsorship.consent_recorded','sponsorship',$2,
             'Explicit public-profile agreement documented; visibility held and delivery authority revoked.',$3::jsonb) RETURNING id`,
          [
            actor,
            input.contributionId,
            JSON.stringify({
              requestId: input.requestId,
              recordId,
              scope: input.scope,
              previousConsent: current.effective,
              invalidatedDeliveryCount: receipt.invalidatedDeliveryCount
            })
          ]
        )
      ).rows[0];
      consentCheck(audit, 'CONSENT_AUDIT_UNAVAILABLE', 503);
      await db.query(
        `INSERT INTO admin_sponsorship_consent_records
          (id,contribution_id,request_id,request_hash,expected_version,scope,agreement_received,
           agreed_on,evidence_reference,previous_consent,actor,audit_reference,receipt,recorded_at)
         VALUES($1,$2,$3,$4,$5,$6,TRUE,$7::date,$8,$9,$10,$11,$12::jsonb,$13::timestamptz)`,
        [
          recordId,
          input.contributionId,
          input.requestId,
          requestHash,
          input.expectedVersion,
          input.scope,
          input.agreedOn,
          input.evidenceReference,
          current.effective,
          actor,
          audit.id,
          JSON.stringify(receipt),
          recordedAt
        ]
      );
      return receipt;
    });
  }
}
