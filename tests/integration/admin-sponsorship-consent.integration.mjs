import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';

import { AdminSponsorshipConsentService } from '../../dist/apps/funding-api/src/admin-sponsorship-consent.service.js';
import { SPONSOR_WEBSITE_VISIBLE_SQL } from '../../dist/apps/funding-api/src/sponsorship-website-eligibility.js';
import { assertProductionDatabasePrivileges } from '../../dist/apps/funding-api/src/database-runtime-security.js';
import { assertSponsorshipConsentReadiness } from '../../dist/apps/funding-api/src/admin-sponsorship-consent-readiness.js';
import { upsertCheckoutSessionFromWebhook } from '../../dist/apps/funding-api/src/contributions-write.repository.js';
import {
  buildMigrationSql,
  readMigrations
} from '../../scripts/lib/database-migrations.mjs';
import { buildRuntimeRoleSql } from '../../scripts/lib/database-runtime-role.mjs';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { approveFixtureSubject } from './support/moderation-fixture.mjs';

const actor = 'synthetic-consent-operator';

test(
  'documented public-profile consent upgrades old facts without restoring visibility or sending authority',
  { timeout: 180000 },
  async (t) => {
    // This helper creates its own local container and never reads .env or DATABASE_URL.
    const { pool, stop } = await startDisposablePostgres({ migrate: false });
    let runtime;
    t.after(async () => {
      await runtime?.end();
      await stop();
    });
    const database = (await pool.query('SELECT current_database() AS name'))
      .rows[0].name;
    const migrations = readMigrations('apps/funding-api/migrations');
    await pool.query(
      buildMigrationSql(
        migrations.filter((m) => m.version <= 66),
        { database }
      )
    );
    const service = new AdminSponsorshipConsentService(pool);

    async function dossier(consent = false) {
      const id = (
        await pool.query(
          `INSERT INTO fund_contributions
        (contribution_type,amount_cents,currency,status,paid_at,sponsor_company_name,
         sponsor_public_summary,public_display_consent,sponsor_review_status,sponsor_site_visibility_held)
        VALUES('sponsorship_interest',50000,'CAD','paid','2026-01-01T12:00:00Z',
          'Synthetic consent organization','Synthetic public profile', $1,'approved',FALSE) RETURNING id`,
          [consent]
        )
      ).rows[0].id;
      const asset = (
        await pool.query(
          `INSERT INTO sponsor_media_assets
        (contribution_id,kind,review_status,original_filename,original_mime_type,
         original_size_bytes,original_storage_key,processed_size_bytes,processed_storage_key,
         checksum_sha256,width,height,alt_text,public_storage_key,public_url)
        VALUES($1,'supporting_image','approved','synthetic.webp','image/webp',42,$2,42,$3,
          repeat('a',64),32,24,'Synthetic photograph',$4,'https://synthetic.invalid/photo.webp') RETURNING id`,
          [id, randomUUID(), randomUUID(), randomUUID()]
        )
      ).rows[0].id;
      await approveFixtureSubject(pool, { type: 'media', id: asset });
      await approveFixtureSubject(pool, { type: 'sponsorship', id });
      return { id, asset };
    }

    async function delivery(owner, status = 'approved', kind = 'batch') {
      let batch = null;
      let draft = null;
      if (kind === 'batch') {
        batch = (
          await pool.query(
            "INSERT INTO sponsor_publication_batches(channel,capacity) VALUES('facebook',5) RETURNING id"
          )
        ).rows[0].id;
        draft = (
          await pool.query(
            `INSERT INTO sponsor_publication_drafts
          (contribution_id,feed_target,channel,title,body,disclosure_text,batch_id)
          VALUES($1,'openg7','facebook','Synthetic title','Synthetic body','Synthetic disclosure',$2) RETURNING id`,
            [owner.id, batch]
          )
        ).rows[0].id;
      }
      const id = (
        await pool.query(
          `INSERT INTO publication_deliveries
        (feed_id,kind,batch_id,message,scheduled_at,account_id,mode,status,approved_at,approved_by,
         media_id,media_snapshot,auto_managed)
        VALUES('openg7:facebook',$1,$2,'Synthetic publication',NOW()+interval '1 day','synthetic-account','mock',$3,
          CASE WHEN $3='approved' THEN NOW() ELSE NULL END,'synthetic-previous-approver',$4,$5::jsonb,TRUE) RETURNING id`,
          [
            batch ? 'sponsorship' : 'news',
            batch,
            status,
            kind === 'direct' ? owner.asset : null,
            kind === 'direct' ? JSON.stringify({ synthetic: true }) : null
          ]
        )
      ).rows[0].id;
      if (kind === 'photos')
        await pool.query(
          `INSERT INTO publication_delivery_photos
        (delivery_id,contribution_id,asset_id,asset_version) VALUES($1,$2,$3,'synthetic-asset-version')`,
          [id, owner.id, owner.asset]
        );
      if (draft)
        await approveFixtureSubject(pool, {
          type: 'publication_draft',
          id: draft
        });
      await approveFixtureSubject(pool, { type: 'publication_delivery', id });
      return { id, batch, draft };
    }

    const subject = await dossier(false);
    const other = await dossier(true);
    const batch = await delivery(subject);
    const direct = await delivery(subject, 'approved', 'direct');
    const photos = await delivery(subject, 'approved', 'photos');
    const published = await delivery(subject, 'published', 'direct');
    const snapshot = async (id) =>
      (
        await pool.query(
          "SELECT moderation_snapshot('sponsorship',$1) AS snapshot",
          [id]
        )
      ).rows[0].snapshot;
    const subjectBefore = await snapshot(subject.id);
    const otherBefore = await snapshot(other.id);
    const financial = async () =>
      (
        await pool.query(
          'SELECT amount_cents,currency,status,paid_at,stripe_session_id,sponsor_review_status,sponsor_details_submitted_at FROM fund_contributions WHERE id=$1',
          [subject.id]
        )
      ).rows[0];
    const moneyBefore = await financial();
    const publicVisible = async (id) =>
      (
        await pool.query(
          `SELECT (${SPONSOR_WEBSITE_VISIBLE_SQL}) AS visible FROM fund_contributions WHERE id=$1`,
          [id]
        )
      ).rows[0].visible;
    assert.equal(await publicVisible(other.id), true);

    await t.test(
      'upgrade preserves existing editorial fingerprints, grants no consent and replays no migration',
      async () => {
        await assert.rejects(service.read(subject.id, actor, true), {
          code: 'CONSENT_SCHEMA_UNAVAILABLE'
        });
        await pool.query(buildMigrationSql(migrations, { database }));
        await pool.query(buildMigrationSql(migrations, { database }));
        assert.deepEqual(await snapshot(subject.id), subjectBefore);
        assert.deepEqual(await snapshot(other.id), otherBefore);
        assert.equal(
          (await service.read(subject.id, actor, true)).effectiveConsent,
          false
        );
        assert.equal(
          (
            await pool.query(
              'SELECT count(*) FROM admin_sponsorship_consent_records'
            )
          ).rows[0].count,
          '0'
        );
        assert.equal(
          (
            await pool.query(
              'SELECT max(version) AS v FROM openg7_schema_migrations'
            )
          ).rows[0].v,
          67
        );
      }
    );

    const command = async (id, extra = {}) => ({
      contributionId: id,
      expectedVersion: (await service.read(id, actor, true)).version,
      requestId: randomUUID(),
      agreementReceived: true,
      scope: 'public_profile_name_and_presentation',
      agreedOn: '2026-01-01',
      evidenceReference: 'Synthetic signed agreement reference A-1',
      confirmed: true,
      ...extra
    });
    const request = await command(subject.id);
    let receipt;

    await t.test(
      'grant is atomic and audited, holds visibility, revokes collective/direct/photo approvals and creates no outbox',
      async () => {
        const publishedBefore = (
          await pool.query('SELECT * FROM publication_deliveries WHERE id=$1', [
            published.id
          ])
        ).rows[0];
        const moderationBefore = (
          await pool.query('SELECT count(*) FROM moderation_decisions')
        ).rows[0].count;
        receipt = await service.record(request, actor, true);
        assert.equal(receipt.actor, actor);
        assert.equal(receipt.publicVisibilityHeld, true);
        assert.equal(receipt.invalidatedDeliveryCount, 3);
        assert.notEqual(receipt.version, request.expectedVersion);
        assert.equal(
          (await service.read(subject.id, actor, true)).source,
          'documented_agreement'
        );
        const source = (
          await pool.query(
            'SELECT public_display_consent,sponsor_site_visibility_held FROM fund_contributions WHERE id=$1',
            [subject.id]
          )
        ).rows[0];
        assert.deepEqual(source, {
          public_display_consent: true,
          sponsor_site_visibility_held: true
        });
        assert.equal(await publicVisible(subject.id), false);
        assert.equal(await publicVisible(other.id), true);
        assert.deepEqual(await snapshot(other.id), otherBefore);
        assert.deepEqual(await financial(), moneyBefore);
        const changedSnapshot = await snapshot(subject.id);
        assert.equal(
          changedSnapshot.documentedConsentRecordId,
          receipt.recordId
        );
        assert.equal(
          JSON.stringify(changedSnapshot).includes(request.evidenceReference),
          false
        );
        for (const item of [batch, direct, photos]) {
          const row = (
            await pool.query(
              'SELECT status,approved_at,approved_by FROM publication_deliveries WHERE id=$1',
              [item.id]
            )
          ).rows[0];
          assert.deepEqual(row, {
            status: 'blocked',
            approved_at: null,
            approved_by: null
          });
        }
        assert.deepEqual(
          (
            await pool.query(
              'SELECT * FROM publication_deliveries WHERE id=$1',
              [published.id]
            )
          ).rows[0],
          publishedBefore
        );
        const cases = (
          await pool.query(
            `SELECT state FROM moderation_cases WHERE
        (subject_type='sponsorship' AND subject_id=$1) OR (subject_type='publication_delivery' AND subject_id=ANY($2::uuid[]))`,
            [subject.id, [batch.id, direct.id, photos.id]]
          )
        ).rows;
        assert.ok(cases.every((row) => row.state === 'unreviewed'));
        assert.equal(
          (await pool.query('SELECT count(*) FROM moderation_decisions'))
            .rows[0].count,
          moderationBefore
        );
        assert.equal(
          (await pool.query('SELECT count(*) FROM email_messages')).rows[0]
            .count,
          '0'
        );
        assert.equal(
          (await pool.query('SELECT count(*) FROM social_publication_jobs'))
            .rows[0].count,
          '0'
        );
        assert.equal(
          (await pool.query('SELECT count(*) FROM sponsor_media_cleanup_jobs'))
            .rows[0].count,
          '0'
        );
        const audit = (
          await pool.query(
            "SELECT metadata FROM admin_audit_log WHERE action='sponsorship.consent_recorded' AND entity_id=$1",
            [subject.id]
          )
        ).rows;
        assert.equal(audit.length, 1);
        assert.equal(
          JSON.stringify(audit).includes(request.evidenceReference),
          false
        );
      }
    );

    await t.test(
      'lost response reconciles the immutable receipt for its exact actor before CAS',
      async () => {
        assert.deepEqual(await service.record(request, actor, true), receipt);
        assert.deepEqual(
          await service.receipt(subject.id, request.requestId, actor, true),
          { state: 'recorded', receipt }
        );
        assert.deepEqual(
          await service.receipt(
            subject.id,
            request.requestId,
            'synthetic-other-operator',
            true
          ),
          { state: 'not_found' }
        );
        await assert.rejects(
          service.record(request, 'synthetic-other-operator', true),
          { code: 'CONSENT_REQUEST_CONFLICT' }
        );
        await assert.rejects(
          service.record(
            { ...request, evidenceReference: 'Different synthetic proof' },
            actor,
            true
          ),
          { code: 'CONSENT_REQUEST_CONFLICT' }
        );
        await assert.rejects(
          service.record({ ...request, requestId: randomUUID() }, actor, true),
          { code: 'CONSENT_VERSION_CONFLICT' }
        );
        const reader = await service.read(
          subject.id,
          'synthetic-reader',
          false
        );
        assert.equal(reader.history, undefined);
        assert.equal(reader.recordingActor, undefined);
        const operator = await service.read(subject.id, actor, true);
        assert.deepEqual(operator.recordBlockers, ['already_granted']);
        assert.equal(operator.history[0].agreedOn, '2026-01-01');
        assert.equal(
          (
            await pool.query(
              'SELECT count(*) FROM admin_sponsorship_consent_records'
            )
          ).rows[0].count,
          '1'
        );
      }
    );

    await t.test(
      'future dates, wrong version and simultaneous tabs cannot grant an unintended agreement',
      async () => {
        const candidate = await dossier();
        const before = (await service.read(candidate.id, actor, true)).version;
        await assert.rejects(
          service.record(
            await command(candidate.id, { agreedOn: '2999-01-01' }),
            actor,
            true
          ),
          { code: 'CONSENT_DATE_FUTURE' }
        );
        await assert.rejects(
          service.record(
            await command(candidate.id, { expectedVersion: 'stale-version' }),
            actor,
            true
          ),
          { code: 'CONSENT_VERSION_CONFLICT' }
        );
        assert.equal(
          (await service.read(candidate.id, actor, true)).version,
          before
        );
        const first = await command(candidate.id);
        const outcomes = await Promise.allSettled([
          service.record(first, actor, true),
          service.record(
            { ...first, requestId: randomUUID() },
            'synthetic-second-tab',
            true
          )
        ]);
        assert.equal(
          outcomes.filter((o) => o.status === 'fulfilled').length,
          1
        );
        assert.equal(
          outcomes.find((o) => o.status === 'rejected').reason.code,
          'CONSENT_VERSION_CONFLICT'
        );
      }
    );

    await t.test(
      'processing, uncertain operations and held accounts block without changing any source or command',
      async () => {
        for (const state of [
          'publishing',
          'uncertain',
          'account_uncertain',
          'reservation_publishing',
          'legacy_failed'
        ]) {
          const candidate = await dossier();
          const item = await delivery(
            candidate,
            ['publishing', 'uncertain'].includes(state) ? state : 'approved'
          );
          if (
            state === 'account_uncertain' ||
            state === 'reservation_publishing'
          ) {
            await pool.query(
              `INSERT INTO publication_account_leases(provider,account_id,mode,delivery_id,delivery_version,lease_until,uncertain)
            VALUES('facebook',$1,'mock',$2,1,NOW()+interval '1 minute',$3)`,
              [item.id, item.id, state === 'account_uncertain']
            );
            if (state === 'reservation_publishing')
              await pool.query(
                `INSERT INTO publication_account_reservations
            (delivery_id,provider,account_id,mode,scheduled_at,approval_version,status)
            VALUES($1::uuid,'facebook',$2::text,'mock',NOW(),1,'publishing')`,
                [item.id, item.id]
              );
          }
          if (state === 'legacy_failed')
            await pool.query(
              `INSERT INTO social_publication_jobs
          (batch_id,channel,provider,mode,status,idempotency_key,title,body,disclosure_text)
          VALUES($1,'facebook','facebook','mock','failed',$2,'Synthetic','Synthetic','Synthetic')`,
              [item.batch, randomUUID()]
            );
          const input = await command(candidate.id);
          const before = (
            await pool.query(
              'SELECT updated_at::text AS version,public_display_consent FROM fund_contributions WHERE id=$1',
              [candidate.id]
            )
          ).rows[0];
          const expected = [
            'uncertain',
            'account_uncertain',
            'legacy_failed'
          ].includes(state)
            ? 'CONSENT_OPERATION_UNCERTAIN'
            : 'CONSENT_OPERATION_PROCESSING';
          await assert.rejects(service.record(input, actor, true), {
            code: expected
          });
          assert.deepEqual(
            (
              await pool.query(
                'SELECT updated_at::text AS version,public_display_consent FROM fund_contributions WHERE id=$1',
                [candidate.id]
              )
            ).rows[0],
            before
          );
          assert.deepEqual(
            await service.receipt(candidate.id, input.requestId, actor, true),
            { state: 'not_found' }
          );
        }
      }
    );

    await t.test(
      'audit failure rolls back consent and all dependent approval changes',
      async () => {
        const candidate = await dossier();
        const item = await delivery(candidate);
        const input = await command(candidate.id);
        await pool.query(`CREATE FUNCTION synthetic_consent_audit_failure() RETURNS TRIGGER LANGUAGE plpgsql AS $$
        BEGIN IF NEW.action='sponsorship.consent_recorded' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER synthetic_consent_audit_failure BEFORE INSERT ON admin_audit_log FOR EACH ROW EXECUTE FUNCTION synthetic_consent_audit_failure()`);
        try {
          await assert.rejects(service.record(input, actor, true));
        } finally {
          await pool.query(
            'DROP TRIGGER synthetic_consent_audit_failure ON admin_audit_log; DROP FUNCTION synthetic_consent_audit_failure()'
          );
        }
        assert.equal(
          (await service.read(candidate.id, actor, true)).effectiveConsent,
          false
        );
        assert.equal(
          (
            await pool.query(
              'SELECT status FROM publication_deliveries WHERE id=$1',
              [item.id]
            )
          ).rows[0].status,
          'approved'
        );
        assert.deepEqual(
          await service.receipt(candidate.id, input.requestId, actor, true),
          { state: 'not_found' }
        );
      }
    );

    await t.test(
      'dedicated runtime role can insert evidence but cannot rewrite or delete its history',
      async () => {
        const role = 'synthetic_consent_runtime';
        const password = randomBytes(32).toString('hex');
        await pool.query(
          buildRuntimeRoleSql({ role, database, password }, { create: true })
        );
        runtime = new pg.Pool({ ...pool.options, user: role, password });
        await assertProductionDatabasePrivileges(runtime, true);
        await assertSponsorshipConsentReadiness(runtime, true);
        const candidate = await dossier();
        const runtimeService = new AdminSponsorshipConsentService(runtime);
        const result = await runtimeService.record(
          await command(candidate.id),
          actor,
          true
        );
        assert.equal(result.effectiveConsent, true);
        await assert.rejects(
          runtime.query(
            "UPDATE admin_sponsorship_consent_records SET actor='forged'"
          ),
          { code: '42501' }
        );
        await assert.rejects(
          runtime.query('DELETE FROM admin_sponsorship_consent_records'),
          { code: '42501' }
        );
        await assert.rejects(
          pool.query(
            "UPDATE admin_sponsorship_consent_records SET actor='forged' WHERE id=$1",
            [receipt.recordId]
          )
        );
        await assert.rejects(
          pool.query(
            'DELETE FROM admin_sponsorship_consent_records WHERE id=$1',
            [receipt.recordId]
          )
        );
      }
    );

    await t.test(
      'a delayed Checkout projection preserves local documented consent and its immutable proof',
      async () => {
        const session = 'cs_test_synthetic_consent_' + randomUUID();
        await pool.query(
          'UPDATE fund_contributions SET stripe_session_id=$2 WHERE id=$1',
          [subject.id, session]
        );
        await upsertCheckoutSessionFromWebhook(pool, {
          stripeSessionId: session,
          stripePaymentIntentId: null,
          publicReference: null,
          contributionType: 'sponsorship_interest',
          amountCents: 50000,
          currency: 'CAD',
          metadata: { publicDisplayConsent: 'false' },
          publicDisplayConsent: false,
          publicName: null,
          displayAmountConsent: false,
          nonCharityAcknowledged: true,
          sponsorshipFollowupTokenHash: null,
          status: 'paid',
          paidAtIso: '2026-01-01T12:00:00Z',
          emailPrivate: null,
          notifyAdmin: false,
          trustedPaymentFacts: { amountCents: 50000, currency: 'CAD' }
        });
        assert.equal(
          (await service.read(subject.id, actor, true)).effectiveConsent,
          true
        );
        assert.deepEqual(
          await service.receipt(subject.id, request.requestId, actor, true),
          { state: 'recorded', receipt }
        );
        assert.equal(
          (
            await pool.query(
              "SELECT metadata->>'publicDisplayConsent' AS consent FROM stripe_checkout_sessions WHERE stripe_session_id=$1",
              [session]
            )
          ).rows[0].consent,
          'false'
        );
      }
    );
  }
);
