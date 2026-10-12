import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';

import {
  previewSponsorshipHistoricalAudit,
  reviewSponsorshipHistoricalEvidence
} from '../../dist/apps/funding-api/src/sponsorship-commitments/historical-audit.js';
import { withPostgresTransaction } from '../../dist/apps/funding-api/src/postgres-transaction.js';
import { assertProductionDatabasePrivileges } from '../../dist/apps/funding-api/src/database-runtime-security.js';
import { buildRuntimeRoleSql } from '../../scripts/lib/database-runtime-role.mjs';

import { startDisposablePostgres } from './support/disposable-postgres.mjs';

test(
  'historical evidence inventory is conservative, stable and non-destructive',
  { timeout: 90000 },
  async (t) => {
    const database = await startDisposablePostgres();
    const password = randomBytes(32).toString('hex');
    const role = 'og7_historical_audit_runtime';
    const databaseName = (
      await database.pool.query('SELECT current_database() AS name')
    ).rows[0].name;
    await database.pool.query(
      buildRuntimeRoleSql(
        { role, database: databaseName, password },
        { create: true }
      )
    );
    const runtimePool = new pg.Pool({
      ...database.pool.options,
      user: role,
      password
    });
    t.after(async () => {
      await runtimePool.end();
      await database.stop();
    });
    await assertProductionDatabasePrivileges(runtimePool, true);
    await assert.rejects(
      runtimePool.query('DELETE FROM sponsorship_historical_evidence_reviews'),
      { code: '42501' }
    );
    const pool = database.pool,
      actor = 'admin:00000000-0000-4000-8000-000000000042';
    const image = (kind) => ({
      id: randomUUID(),
      contributionId: null,
      kind,
      version: 'synthetic-media-v1',
      sourceHash: 'a'.repeat(64),
      derivedHash: 'a'.repeat(64),
      usage: {
        state: 'confirmed',
        channels: ['website'],
        targets: ['openg7'],
        transformations: ['technical'],
        credit: null,
        restrictions: null
      },
      restrictionsReviewed: false
    });
    const fixture = async ({
      durationDays = null,
      logo = true,
      complete = true,
      imageChanges = null,
      requiredElements = [
        'company_name',
        'approved_logo',
        'approved_presentation'
      ]
    } = {}) => {
      const contributionId = (
        await pool.query(`INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at,sponsor_company_name)
      VALUES('sponsorship_interest',5000,'cad','paid',NOW(),'Synthetic historical company') RETURNING id`)
      ).rows[0].id;
      const offer = {
        version: 'historical-synthetic-v1',
        amountMinor: 5000,
        currency: 'CAD',
        benefits: [
          {
            id: 'website_mention',
            channel: 'website',
            target: 'openg7',
            quantity: 1,
            requiredElements,
            deadlineDays: null,
            durationDays
          }
        ]
      };
      const offerId = (
        await pool.query(
          `INSERT INTO sponsorship_offers(public_reference,version,fingerprint,amount_minor,currency,snapshot,provenance)
      VALUES('SYNTHETIC-HISTORICAL-AUDIT',$1,$2,5000,'CAD',$3::jsonb,'historical_qualification') RETURNING id`,
          [offer.version, 'b'.repeat(64), JSON.stringify(offer)]
        )
      ).rows[0].id;
      const commitmentId = (
        await pool.query(
          `INSERT INTO sponsorship_commitments(contribution_id,offer_id,provenance,state,activated_at)
      VALUES($1,$2,'qualified_historical','active',NOW()) RETURNING id`,
          [contributionId, offerId]
        )
      ).rows[0].id;
      const obligationId = (
        await pool.query(
          `INSERT INTO sponsorship_obligations(commitment_id,contribution_id,benefit_id,channel,target,ordinal)
      VALUES($1,$2,'website_mention','website','openg7',1) RETURNING id`,
          [commitmentId, contributionId]
        )
      ).rows[0].id;
      let media = [
        ...(logo ? [image('logo')] : []),
        image('supporting_image')
      ].map((asset) => ({ ...asset, contributionId }));
      if (imageChanges) media = media.map(imageChanges);
      const evidenceId = (
        await pool.query(
          `INSERT INTO sponsorship_fulfilment_evidence(obligation_id,contribution_id,obligation_version,channel,target,mode,account_id,provenance,message,source_snapshot,media_snapshot,content_fingerprint,delivered_at,actor)
      VALUES($1,$2,1,'website','openg7','live','openg7:website','website_verified','Synthetic historical company',$3::jsonb,$4::jsonb,$5,NOW(),$6) RETURNING id`,
          [
            obligationId,
            contributionId,
            JSON.stringify(
              complete
                ? [
                    {
                      id: contributionId,
                      company: 'Synthetic historical company',
                      summary: 'Public synthetic description',
                      privateNote: 'MUST-NOT-LEAK'
                    }
                  ]
                : []
            ),
            JSON.stringify(complete ? media : null),
            'c'.repeat(64),
            actor
          ]
        )
      ).rows[0].id;
      await pool.query(
        "UPDATE sponsorship_obligations SET state='fulfilled',fulfilment_evidence_id=$2,version=2 WHERE id=$1",
        [obligationId, evidenceId]
      );
      return { evidenceId, contributionId, obligationId, media };
    };
    const duration = await fixture({ durationDays: 30 });
    const missing = await fixture({ logo: false });
    const incomplete = await fixture({ complete: false });
    const valid = await fixture();
    const preview = (input = {}) =>
      withPostgresTransaction(
        pool,
        (db) => previewSponsorshipHistoricalAudit(db, input),
        { readOnlySnapshot: true }
      );
    await t.test(
      'duration, actual omission and insufficient snapshots remain distinct',
      async () => {
        const page = await preview();
        assert.deepEqual(page.totals, {
          evidence: 4,
          filtered: 4,
          unreviewed: 4,
          durationUnverified: 1,
          requiredElementMissing: 1,
          snapshotIncomplete: 1,
          noIssueDetected: 1
        });
        assert.deepEqual(
          page.items.find((item) => item.evidenceId === duration.evidenceId)
            .findings,
          ['duration_unverified']
        );
        assert.deepEqual(
          page.items.find((item) => item.evidenceId === missing.evidenceId)
            .findings,
          ['required_element_missing']
        );
        assert.deepEqual(
          page.items.find((item) => item.evidenceId === incomplete.evidenceId)
            .findings,
          ['snapshot_incomplete']
        );
        assert.deepEqual(
          page.items.find((item) => item.evidenceId === valid.evidenceId)
            .findings,
          []
        );
        assert.ok(!JSON.stringify(page).includes('MUST-NOT-LEAK'));
        assert.ok(
          !JSON.stringify(page).includes('Synthetic historical company')
        );
      }
    );
    await t.test(
      'filters preserve global totals and inspect only exact recorded rights',
      async () => {
        const page = await preview({
          finding: 'required_element_missing',
          contributionId: missing.contributionId
        });
        assert.equal(page.items.length, 1);
        assert.equal(page.totals.evidence, 4);
        assert.equal(page.totals.filtered, 1);
        // No current media row exists. Historical qualification still uses the exact
        // recorded ownership/channel/target/rights and identifies this valid record.
        const old = await preview({ contributionId: valid.contributionId });
        assert.deepEqual(old.items[0].findings, []);
      }
    );
    let receipt;
    const command = {
      requestId: randomUUID(),
      evidenceId: duration.evidenceId,
      expectedVersion: 0,
      confirmation: duration.evidenceId,
      conclusion: 'follow_up_required',
      reason: 'Synthetic duration agreement needs a separate traced resolution.'
    };
    const review = (input) =>
      withPostgresTransaction(runtimePool, (db) =>
        reviewSponsorshipHistoricalEvidence(db, input, actor)
      );
    await t.test(
      'explicit review is append-only, replayable and never changes the evidence or balance',
      async () => {
        const before = (
          await pool.query(
            'SELECT row_to_json(e) AS evidence FROM sponsorship_fulfilment_evidence e WHERE id=$1',
            [duration.evidenceId]
          )
        ).rows[0].evidence;
        receipt = await review(command);
        assert.equal(receipt.reviewVersion, 1);
        assert.deepEqual(await review(command), receipt);
        await assert.rejects(review({ ...command, conclusion: 'confirmed' }), {
          code: 'HISTORICAL_AUDIT_REQUEST_CONFLICT'
        });
        await assert.rejects(review({ ...command, requestId: randomUUID() }), {
          code: 'HISTORICAL_AUDIT_VERSION_CONFLICT'
        });
        assert.deepEqual(
          (
            await pool.query(
              'SELECT row_to_json(e) AS evidence FROM sponsorship_fulfilment_evidence e WHERE id=$1',
              [duration.evidenceId]
            )
          ).rows[0].evidence,
          before
        );
        assert.equal(
          (
            await pool.query(
              'SELECT state FROM sponsorship_obligations WHERE id=$1',
              [duration.obligationId]
            )
          ).rows[0].state,
          'fulfilled'
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::integer AS count FROM admin_audit_log WHERE action='sponsorship_evidence.historical_reviewed'"
            )
          ).rows[0].count,
          1
        );
        await assert.rejects(
          pool.query(
            "UPDATE sponsorship_historical_evidence_reviews SET reason='Changed' WHERE id=$1",
            [receipt.review.id]
          ),
          { code: '23514' }
        );
        await assert.rejects(
          pool.query(
            'DELETE FROM sponsorship_historical_evidence_reviews WHERE id=$1',
            [receipt.review.id]
          ),
          { code: '23514' }
        );
        const row = (await preview({ contributionId: duration.contributionId }))
          .items[0];
        assert.equal(row.reviewVersion, 1);
        assert.deepEqual(row.latestReview, receipt.review);
        assert.ok(!JSON.stringify(row).includes(command.reason));
        assert.deepEqual(row.findings, ['duration_unverified']);
      }
    );
    await t.test(
      'concurrent versioned conclusions preserve one winner and exact UUID replay',
      async () => {
        const second = {
          ...command,
          requestId: randomUUID(),
          expectedVersion: 1,
          conclusion: 'inconclusive'
        };
        const outcomes = await Promise.allSettled([
          review(second),
          review({ ...second, requestId: randomUUID() })
        ]);
        assert.equal(
          outcomes.filter((result) => result.status === 'fulfilled').length,
          1
        );
        assert.equal(
          outcomes.find((result) => result.status === 'rejected').reason.code,
          'HISTORICAL_AUDIT_VERSION_CONFLICT'
        );
        const exact = {
          ...command,
          requestId: randomUUID(),
          expectedVersion: 2,
          conclusion: 'confirmed'
        };
        const repeats = await Promise.all([review(exact), review(exact)]);
        assert.deepEqual(repeats[0], repeats[1]);
        assert.equal(repeats[0].reviewVersion, 3);
      }
    );
    await t.test(
      'confirmation, UUID, version and bounded private reason are enforced',
      async () => {
        for (const changes of [
          { confirmation: 'wrong' },
          { requestId: 'invalid' },
          { expectedVersion: -1 },
          { reason: '' },
          { reason: 'x'.repeat(2001) },
          { conclusion: 'auto_correct' },
          { unexpected: true }
        ])
          await assert.rejects(review({ ...command, ...changes }), {
            code: 'HISTORICAL_AUDIT_INVALID'
          });
        await assert.rejects(
          review({
            ...command,
            requestId: randomUUID(),
            evidenceId: randomUUID(),
            confirmation: undefined
          }),
          { code: 'HISTORICAL_AUDIT_INVALID' }
        );
      }
    );
    await t.test(
      'stable cursor traverses more than one page and excludes evidence inserted later',
      async () => {
        for (let n = 0; n < 27; n++) await fixture();
        const first = await preview({ pageSize: 25 });
        assert.equal(first.items.length, 25);
        assert.equal(first.totals.evidence, 31);
        assert.ok(first.nextCursor);
        const later = await fixture();
        const second = await preview({
          pageSize: 25,
          cursor: first.nextCursor
        });
        assert.equal(second.items.length, 6);
        assert.equal(second.nextCursor, null);
        assert.equal(second.asOf, first.asOf);
        assert.equal(second.totals.evidence, 31);
        assert.ok(
          !second.items.some((item) => item.evidenceId === later.evidenceId)
        );
        assert.equal(
          new Set(
            [...first.items, ...second.items].map((item) => item.evidenceId)
          ).size,
          31
        );
        await assert.rejects(
          preview({ cursor: first.nextCursor, finding: 'duration_unverified' }),
          { code: 'HISTORICAL_AUDIT_INVALID' }
        );
        await assert.rejects(preview({ cursor: 'invalid-cursor' }), {
          code: 'HISTORICAL_AUDIT_INVALID'
        });
        await assert.rejects(preview({ pageSize: 1000 }), {
          code: 'HISTORICAL_AUDIT_INVALID'
        });
      }
    );
    await t.test(
      'malformed historical image metadata stays unknown instead of implying validated rights',
      async () => {
        for (const imageChanges of [
          (asset) => ({ ...asset, id: '-'.repeat(36) }),
          (asset) => ({ ...asset, version: 42 }),
          (asset) => ({ ...asset, sourceHash: 1 }),
          (asset) => ({ ...asset, derivedHash: 1 }),
          (asset) => ({
            ...asset,
            usage: { ...asset.usage, channels: { website: true } }
          }),
          (asset) => ({
            ...asset,
            usage: { ...asset.usage, targets: { openg7: true } }
          }),
          (asset) => ({
            ...asset,
            usage: { ...asset.usage, transformations: { technical: true } }
          })
        ]) {
          const malformed = await fixture({ imageChanges });
          const result = await preview({
            contributionId: malformed.contributionId
          });
          assert.deepEqual(result.items[0].findings, ['snapshot_incomplete']);
          assert.ok(
            result.items[0].requirements
              .filter(({ element }) => element !== 'company_name')
              .every(({ observation }) => observation === 'unknown')
          );
        }
      }
    );
  }
);
