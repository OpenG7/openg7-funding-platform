import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import sharp from 'sharp';

import { loadResponsibilityBalance } from '../../dist/apps/funding-api/src/admin-responsibility-balance.service.js';
import { getSponsorshipProgress } from '../../dist/apps/funding-api/src/sponsorship-progress.service.js';
import { getAdminAssistantContext } from '../../dist/apps/funding-api/src/admin-assistant/context.service.js';
import { projectPreparation } from '../../dist/apps/funding-api/src/admin-preparation.projection.js';
import { adjustSponsorshipObligation } from '../../dist/apps/funding-api/src/sponsorship-commitments/changes.js';
import { withPostgresTransaction } from '../../dist/apps/funding-api/src/postgres-transaction.js';
import { setSponsorshipWebsiteVisibility } from '../../dist/apps/funding-api/src/sponsorship-website.service.js';
import { fulfil } from '../../dist/apps/funding-api/src/sponsorship-fulfilment/evidence-write.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { approveFixtureSubject } from './support/moderation-fixture.mjs';
import { recordFixtureSponsorshipAgreement } from './support/sponsorship-agreement-fixture.mjs';

const actor = 'admin:00000000-0000-4000-8000-000000000004';

test(
  'responsibility balance reads qualified persisted facts without sending or inventing fulfilment',
  { timeout: 90000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);

    await t.test(
      'personal CAD and USD payments are read independently, without a global mixed-currency aggregate',
      async () => {
        for (const currency of ['cad', 'usd']) {
          const id = (
            await pool.query(
              `INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at)
        VALUES('personal_support',2500,$1,'paid',NOW()) RETURNING id`,
              [currency]
            )
          ).rows[0].id;
          const balance = await loadResponsibilityBalance(pool, id);
          assert.equal(balance.status, 'balanced');
          assert.equal(balance.amountMinor, 2500);
          assert.equal(balance.currency, currency.toUpperCase());
          assert.equal(balance.expected, 0);
        }
      }
    );

    await t.test(
      'a confirmed refunded personal payment balances until a real communication incident remains',
      async () => {
        const id = (
          await pool.query(
            `INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at)
        VALUES('personal_support',2500,'cad','refunded',NOW()) RETURNING id`
          )
        ).rows[0].id;
        const settled = await loadResponsibilityBalance(pool, id);
        assert.equal(settled.status, 'balanced');
        assert.equal(settled.expected, 0);
        assert.ok(settled.reasons.includes('payment_refunded'));
        await pool.query(
          `INSERT INTO email_messages(template_key,recipient_email,from_email,subject,text_body,html_body,status,metadata)
        VALUES('refund_fixture','synthetic@example.invalid','fixture@example.invalid','Synthetic refund','Synthetic body','Synthetic body','failed',$1::jsonb)`,
          [JSON.stringify({ contributionId: id })]
        );
        const incident = await loadResponsibilityBalance(pool, id);
        assert.notEqual(incident.status, 'balanced');
        assert.ok(incident.reasons.includes('email_failed'));
        assert.equal(incident.paymentStatus, 'refunded');
      }
    );

    await t.test(
      'all reads share a read-only repeatable snapshot during a concurrent payment change',
      async () => {
        const id = (
          await pool.query(
            `INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at)
      VALUES('personal_support',3000,'cad','paid',NOW()) RETURNING id`
          )
        ).rows[0].id;
        const events = [];
        let changed = false;
        const observedPool = {
          query: () =>
            assert.fail('the balance must use only its snapshot client'),
          async connect() {
            const client = await pool.connect();
            let open = false;
            return {
              async query(sql, values) {
                if (sql.startsWith('BEGIN')) {
                  assert.equal(
                    sql,
                    'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'
                  );
                  open = true;
                  events.push('begin');
                } else assert.equal(open, true);
                const result = await client.query(sql, values);
                if (!changed && sql.includes('c.paid_at::text AS "paidAt"')) {
                  changed = true;
                  await pool.query(
                    "UPDATE fund_contributions SET status='disputed',updated_at=NOW() WHERE id=$1",
                    [id]
                  );
                }
                if (['COMMIT', 'ROLLBACK'].includes(sql)) {
                  open = false;
                  events.push(sql.toLowerCase());
                }
                return result;
              },
              release() {
                assert.equal(open, false);
                events.push('release');
                client.release();
              }
            };
          }
        };
        const stable = await loadResponsibilityBalance(observedPool, id);
        assert.equal(changed, true);
        assert.equal(stable.paymentStatus, 'paid');
        assert.equal(stable.status, 'balanced');
        assert.deepEqual(events, ['begin', 'commit', 'release']);
        const current = await loadResponsibilityBalance(pool, id);
        assert.equal(current.paymentStatus, 'disputed');
        assert.equal(current.status, 'blocked');
        assert.notEqual(current.version, stable.version);
      }
    );

    const contributionId = (
      await pool.query(
        `INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at,
      sponsor_company_name,sponsor_contact_email,email_private,sponsor_details_submitted_at,
      sponsor_public_summary,public_display_consent,sponsor_review_status,sponsor_site_visibility_held)
    VALUES('sponsorship_interest',50000,'cad','paid',NOW(),'Synthetic balance company',
      'balance@example.invalid','balance@example.invalid',NOW(),'Synthetic public presentation',TRUE,'approved',TRUE) RETURNING id`
      )
    ).rows[0].id;

    await t.test(
      'paid sponsorship without a recorded agreement remains unknown',
      async () => {
        const balance = await loadResponsibilityBalance(pool, contributionId);
        assert.equal(balance.status, 'unknown');
        assert.equal(balance.fulfilled, 0);
        assert.ok(balance.reasons.includes('commitment_needs_confirmation'));
      }
    );

    await recordFixtureSponsorshipAgreement(pool, contributionId, {
      channel: 'website'
    });
    const image = await sharp({
      create: { width: 100, height: 100, channels: 3, background: '#345678' }
    })
      .webp()
      .toBuffer();
    const hash = createHash('sha256').update(image).digest('hex');
    const mediaId = (
      await pool.query(
        `INSERT INTO sponsor_media_assets(contribution_id,kind,review_status,original_filename,
      original_mime_type,original_size_bytes,original_storage_key,processed_size_bytes,processed_storage_key,
      public_storage_key,public_url,checksum_sha256,width,height,usage_rights)
    VALUES($1,'supporting_image','approved','synthetic.png','image/png',100,'private-original',
      $2,'private-processed','public-synthetic','https://example.invalid/synthetic.webp',$3,100,100,$4::jsonb) RETURNING id`,
        [
          contributionId,
          image.length,
          hash,
          JSON.stringify({
            state: 'confirmed',
            channels: ['website'],
            targets: ['openg7'],
            transformations: ['technical'],
            credit: null,
            restrictions: null
          })
        ]
      )
    ).rows[0].id;
    await approveFixtureSubject(pool, { type: 'media', id: mediaId });
    await approveFixtureSubject(pool, {
      type: 'sponsorship',
      id: contributionId
    });

    await t.test(
      'an explicitly approved website placement creates one exact proof and waits for its queued communication',
      async () => {
        const before = await loadResponsibilityBalance(pool, contributionId);
        assert.equal(before.expected, 1);
        assert.equal(before.fulfilled, 0);
        assert.equal(before.outstanding, 1);
        assert.notEqual(before.status, 'balanced');
        const version = (
          await pool.query(
            'SELECT updated_at::text AS version FROM fund_contributions WHERE id=$1',
            [contributionId]
          )
        ).rows[0].version;
        assert.equal(
          await setSponsorshipWebsiteVisibility(
            pool,
            {
              contributionId,
              expectedVersion: version,
              visible: true,
              confirmed: true
            },
            actor,
            {
              readPrivateObject: async (key) => {
                assert.equal(key, 'private-processed');
                return image;
              }
            }
          ),
          'updated'
        );
        const waiting = await loadResponsibilityBalance(pool, contributionId);
        assert.equal(waiting.fulfilled, 1);
        assert.equal(waiting.waived, 0);
        assert.equal(waiting.outstanding, 0);
        assert.equal(waiting.status, 'waiting');
        assert.equal(
          waiting.obligations[0].evidence.contributionId,
          contributionId
        );
        assert.equal(
          waiting.obligations[0].evidence.provenance,
          'website_verified'
        );
        const persisted = (
          await pool.query(
            'SELECT id,mode,obligation_version FROM sponsorship_fulfilment_evidence WHERE contribution_id=$1',
            [contributionId]
          )
        ).rows;
        assert.equal(persisted.length, 1);
        assert.equal(persisted[0].mode, 'live');
        assert.equal(persisted[0].id, waiting.obligations[0].evidence.id);
        assert.equal(
          persisted[0].obligation_version + 1,
          waiting.obligations[0].version
        );
        // Synthetic acknowledgement in this disposable queue; no SMTP/provider is contacted.
        await pool.query(
          "UPDATE email_messages SET status='sent' WHERE metadata->>'contributionId'=$1",
          [contributionId]
        );
        const complete = await loadResponsibilityBalance(pool, contributionId);
        assert.equal(complete.status, 'balanced');
        assert.equal(complete.fulfilled, 1);
        assert.notEqual(complete.version, waiting.version);
        const json = JSON.stringify(complete);
        for (const privateValue of [
          'balance@example.invalid',
          'private-original',
          'private-processed',
          hash
        ])
          assert.equal(json.includes(privateValue), false);
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS count FROM sponsorship_fulfilment_evidence WHERE contribution_id=$1',
              [contributionId]
            )
          ).rows[0].count,
          1
        );
      }
    );

    await t.test(
      'a confirmed waiver is auditable and never counted as delivery',
      async () => {
        const id = (
          await pool.query(
            `INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at)
      VALUES('sponsorship_interest',50000,'cad','paid',NOW()) RETURNING id`
          )
        ).rows[0].id;
        await recordFixtureSponsorshipAgreement(pool, id, {
          channel: 'facebook'
        });
        const obligation = (
          await pool.query(
            'SELECT id,version FROM sponsorship_obligations WHERE contribution_id=$1',
            [id]
          )
        ).rows[0];
        await withPostgresTransaction(pool, (db) =>
          adjustSponsorshipObligation(
            db,
            {
              requestId: randomUUID(),
              obligationId: obligation.id,
              expectedVersion: obligation.version,
              confirmation: obligation.id,
              reason: 'Synthetic explicit owner waiver for the balance test',
              kind: 'waiver'
            },
            actor
          )
        );
        const balance = await loadResponsibilityBalance(pool, id);
        assert.equal(balance.expected, 1);
        assert.equal(balance.fulfilled, 0);
        assert.equal(balance.waived, 1);
        assert.equal(balance.outstanding, 0);
        assert.equal(balance.unknown, 0);
        assert.equal(balance.obligations[0].evidence, undefined);
        assert.notEqual(
          balance.status,
          'balanced',
          'missing dossier prerequisites are still reported'
        );
      }
    );
    await t.test(
      'an immutable historical proof with incomplete source snapshots stays unknown',
      async () => {
        const id = (
          await pool.query(
            `INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at)
        VALUES('sponsorship_interest',50000,'cad','paid',NOW()) RETURNING id`
          )
        ).rows[0].id;
        await recordFixtureSponsorshipAgreement(pool, id, {
          channel: 'website'
        });
        const obligation = (
          await pool.query(
            'SELECT id,version FROM sponsorship_obligations WHERE contribution_id=$1',
            [id]
          )
        ).rows[0];
        // Seed an incomplete old immutable record; this never asserts an actual public placement.
        await withPostgresTransaction(pool, (db) =>
          fulfil(db, {
            obligationId: obligation.id,
            contributionId: id,
            obligationVersion: obligation.version,
            channel: 'website',
            target: 'openg7',
            deliveryId: null,
            deliveryVersion: null,
            accountId: 'openg7:website',
            provenance: 'website_verified',
            externalPostId: null,
            externalPostUrl: null,
            message: 'Synthetic incomplete historical snapshot',
            sources: [{ id }],
            media: [],
            actor
          })
        );
        const balance = await loadResponsibilityBalance(pool, id);
        assert.equal(balance.status, 'unknown');
        assert.equal(balance.fulfilled, 0);
        assert.equal(balance.outstanding, 1);
        assert.ok(balance.reasons.includes('fulfilment_snapshot_unqualified'));
        assert.equal(balance.obligations[0].evidence, undefined);
        const dossier = (await getSponsorshipProgress(pool, id)).dossier;
        assert.deepEqual(dossier.qualifiedFulfilmentEvidenceIds, []);
        assert.equal(dossier.publicationCompletion.done, 0);
        assert.equal(
          dossier.publicationWorkflow.reason,
          'fulfilment_unverified'
        );
        assert.notEqual(dossier.publicationWorkflow.state, 'complete');
        assert.equal(
          dossier.milestones.find((item) => item.id === 'publication').reason,
          'fulfilment_unverified'
        );
        const context = (await getAdminAssistantContext(pool, id)).context;
        assert.equal(
          context.publicationWorkflow.reason,
          'fulfilment_unverified'
        );
        assert.notEqual(context.nextStep, 'complete');
        const preparation = await projectPreparation(pool, {
          contribution_id: id,
          reference: 'SYNTHETIC-UNQUALIFIED-PROOF',
          amount_minor: '50000',
          currency: 'CAD'
        });
        assert.equal(
          preparation.checks.find((item) => item.code === 'accepted_offer')
            .state,
          'complete'
        );
        assert.ok(
          preparation.blockers.some(
            (item) => item.code === 'fulfilment_unverified'
          )
        );
        assert.equal(preparation.canApprove, false);
      }
    );
  }
);
