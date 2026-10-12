import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { recordFixtureSponsorshipAgreement } from './support/sponsorship-agreement-fixture.mjs';
import { approveFixtureSubject } from './support/moderation-fixture.mjs';
import { PublicationAutomationService } from '../../dist/apps/funding-api/src/publication-automation/service.js';
import { withPostgresTransaction } from '../../dist/apps/funding-api/src/postgres-transaction.js';
import {
  capturePublicationObligations,
  recordSocialFulfilment,
  revokeCommitmentDeliveries
} from '../../dist/apps/funding-api/src/sponsorship-fulfilment.repository.js';
import { loadSponsorshipCommitment } from '../../dist/apps/funding-api/src/sponsorship-commitments.repository.js';
import { adjustSponsorshipObligation } from '../../dist/apps/funding-api/src/sponsorship-commitments/changes.js';
import {
  assignDraftToPublicationBatch,
  createAdminPublicationDraft
} from '../../dist/apps/funding-api/src/fund-admin.repository.js';

test(
  'draft passages preserve history and the recorded format on disposable PostgreSQL',
  { timeout: 240000 },
  async (t) => {
    const database = await startDisposablePostgres();
    t.after(database.stop);
    const { pool } = database;
    const service = new PublicationAutomationService(
      pool,
      {},
      { SOCIAL_PUBLICATION_MODE: 'mock' }
    );
    const now = new Date();
    const future = new Date(now.getTime() + 3600000);
    async function reset() {
      await pool.query(
        'TRUNCATE fund_contributions,publication_deliveries,publication_recurrences,social_publication_jobs,sponsor_publication_drafts,sponsor_publication_batches,publication_slots,admin_audit_log CASCADE'
      );
      await pool.query(
        "UPDATE publication_feeds SET timezone='UTC',weekdays='{0,1,2,3,4,5,6}',local_time=$1,horizon_days=6,capacity=10",
        [future.toISOString().slice(11, 16)]
      );
    }
    async function sponsor({
      quantity = 1,
      format = 'collective_text',
      declaredPublished = false
    } = {}) {
      const id = (
        await pool.query(
          `INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,
      public_display_consent,sponsor_review_status,sponsor_company_name,sponsor_public_summary,sponsor_feed_status)
      VALUES('sponsorship_interest',50000,'CAD','paid',TRUE,'approved','Synthetic recorded sponsor','Full sponsor presentation',$1) RETURNING id`,
          [declaredPublished ? 'published' : 'not_planned']
        )
      ).rows[0].id;
      await recordFixtureSponsorshipAgreement(pool, id, {
        benefits: [{ channel: 'facebook', target: 'openg7', quantity, format }]
      });
      await approveFixtureSubject(pool, { type: 'sponsorship', id });
      return id;
    }
    const drafts = async (id) =>
      (
        await pool.query(
          'SELECT * FROM sponsor_publication_drafts WHERE contribution_id=$1 ORDER BY created_at,id',
          [id]
        )
      ).rows;
    const adjustment = (obligation, change) => ({
      requestId: randomUUID(),
      obligationId: obligation.id,
      expectedVersion: obligation.version,
      confirmation: obligation.id,
      reason: 'Explicit synthetic amendment to the recorded agreement',
      ...change
    });
    const adjust = (request) =>
      withPostgresTransaction(pool, (db) =>
        adjustSponsorshipObligation(db, request, 'synthetic-owner')
      );
    const retirementAudit = async (id) =>
      (
        await pool.query(
          `SELECT actor,entity_id,metadata FROM admin_audit_log
           WHERE action='sponsorship_commitment.retire_publication_draft' AND entity_id=$1`,
          [id]
        )
      ).rows;
    await t.test(
      'a historical published declaration neither closes an obligation nor suppresses preparation',
      async () => {
        await reset();
        const id = await sponsor({ quantity: 2, declaredPublished: true });
        const batch = (
          await pool.query(
            "INSERT INTO sponsor_publication_batches(channel,capacity,status) VALUES('facebook',1,'published') RETURNING id"
          )
        ).rows[0].id;
        const original = (
          await pool.query(
            `INSERT INTO sponsor_publication_drafts(contribution_id,feed_target,channel,title,body,disclosure_text,status,batch_id,public_url)
      VALUES($1,'openg7','facebook','Historical title','Historical full body','Paid sponsorship.','published',$2,'https://example.invalid/historical') RETURNING *`,
            [id, batch]
          )
        ).rows[0];
        await service.prepare('openg7:facebook', 'synthetic-planner', now);
        const rows = await drafts(id);
        assert.equal(rows.length, 2);
        assert.deepEqual(
          rows.find((row) => row.id === original.id),
          original
        );
        const prepared = rows.find((row) => row.id !== original.id);
        const commitment = await loadSponsorshipCommitment(pool, id);
        assert.equal(
          prepared.obligation_id,
          commitment.obligations.find((o) => o.ordinal === 1).id
        );
        assert.equal(
          commitment.obligations.every((o) => o.state !== 'fulfilled'),
          true
        );
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int n FROM sponsorship_fulfilment_evidence'
            )
          ).rows[0].n,
          0
        );
      }
    );
    await t.test(
      'a qualified first passage permits a distinct second draft without moving the published source',
      async () => {
        await reset();
        const id = await sponsor({ quantity: 2 });
        await service.prepare('openg7:facebook', 'synthetic-planner', now);
        const first = (await drafts(id))[0];
        const delivery = (
          await pool.query(
            'SELECT * FROM publication_deliveries WHERE batch_id=$1',
            [first.batch_id]
          )
        ).rows[0];
        delivery.mode = 'live';
        delivery.account_id = 'synthetic-observed-page';
        await withPostgresTransaction(pool, async (db) => {
          delivery.obligation_snapshot = await capturePublicationObligations(
            db,
            delivery
          );
          await recordSocialFulfilment(
            db,
            delivery,
            'synthetic-observed-first',
            'https://example.invalid/observed-first',
            'synthetic-observer',
            'provider_acknowledged'
          );
          await db.query(
            "UPDATE publication_deliveries SET status='published',mode='live',published_at=NOW() WHERE id=$1",
            [delivery.id]
          );
          await db.query(
            "UPDATE sponsor_publication_drafts SET status='published',published_at=NOW(),public_url='https://example.invalid/observed-first' WHERE id=$1",
            [first.id]
          );
          await db.query(
            "UPDATE sponsor_publication_batches SET status='published',published_at=NOW() WHERE id=$1",
            [first.batch_id]
          );
        });
        const preserved = (await drafts(id))[0];
        await service.prepare('openg7:facebook', 'synthetic-planner', now);
        const rows = await drafts(id);
        assert.equal(rows.length, 2);
        assert.deepEqual(
          rows.find((row) => row.id === first.id),
          preserved
        );
        const next = rows.find((row) => row.id !== first.id);
        const commitment = await loadSponsorshipCommitment(pool, id);
        assert.equal(
          next.obligation_id,
          commitment.obligations.find((o) => o.ordinal === 2).id
        );
        assert.notEqual(next.batch_id, first.batch_id);
        assert.equal(
          commitment.obligations.filter((o) => o.state === 'fulfilled').length,
          1
        );
        await service.prepare('openg7:facebook', 'synthetic-planner', now);
        assert.equal(
          (await drafts(id)).length,
          2,
          'repeat preparation must retain the existing second passage'
        );
      }
    );
    await t.test(
      'destination adjustment retires the obsolete open source and permits automatic and manual creation at the new destination',
      async () => {
        for (const automatic of [true, false]) {
          await reset();
          const id = await sponsor();
          await service.prepare('openg7:facebook', 'synthetic-planner', now);
          const original = (await drafts(id))[0];
          const delivery = (
            await pool.query(
              'SELECT * FROM publication_deliveries WHERE batch_id=$1',
              [original.batch_id]
            )
          ).rows[0];
          const obligation = (await loadSponsorshipCommitment(pool, id))
            .obligations[0];
          const request = adjustment(obligation, {
            kind: 'destination',
            target: 'openg20'
          });
          await adjust(request);
          await adjust(request);
          const retired = (await drafts(id)).find(
            (row) => row.id === original.id
          );
          assert.equal(retired.status, 'cancelled');
          const {
            status: originalStatus,
            updated_at: originalUpdated,
            ...originalContent
          } = original;
          const {
            status: retiredStatus,
            updated_at: retiredUpdated,
            ...retainedContent
          } = retired;
          assert.equal(originalStatus, 'draft');
          assert.equal(retiredStatus, 'cancelled');
          assert.ok(retiredUpdated >= originalUpdated);
          assert.deepEqual(
            retainedContent,
            originalContent,
            'retirement must preserve the human source and historical associations'
          );
          assert.deepEqual(await retirementAudit(original.id), [
            {
              actor: 'synthetic-owner',
              entity_id: original.id,
              metadata: {
                requestId: request.requestId,
                obligationId: obligation.id
              }
            }
          ]);
          const blocked = (
            await pool.query(
              'SELECT * FROM publication_deliveries WHERE id=$1',
              [delivery.id]
            )
          ).rows[0];
          assert.equal(blocked.status, 'blocked');
          assert.equal(blocked.approved_at, null);
          assert.deepEqual(blocked.source_snapshot, delivery.source_snapshot);
          if (automatic)
            await service.prepare('openg20:facebook', 'synthetic-planner', now);
          const manual = await createAdminPublicationDraft(pool, {
            contributionId: id,
            feedTarget: 'openg20',
            channel: 'facebook'
          });
          assert.equal(manual.updated, true);
          assert.notEqual(manual.draft.id, original.id);
          assert.equal(manual.draft.feed_target, 'openg20');
          assert.equal(manual.draft.approved_at, null);
          assert.equal((await drafts(id)).length, 2);
          assert.equal(
            (await drafts(id)).find((row) => row.id === manual.draft.id)
              .obligation_id,
            obligation.id
          );
          await service.prepare('openg20:facebook', 'synthetic-planner', now);
          assert.equal(
            (await drafts(id)).length,
            2,
            'repeat creation must retain the current open passage'
          );
          assert.equal(
            (await loadSponsorshipCommitment(pool, id)).obligations[0].state,
            'pending'
          );
          assert.equal(
            (
              await pool.query(
                'SELECT count(*)::int n FROM sponsorship_fulfilment_evidence'
              )
            ).rows[0].n,
            0
          );
        }
      }
    );
    await t.test(
      'waiving the first prepared passage allows the next remaining ordinal and preserves the old proposal',
      async () => {
        await reset();
        const id = await sponsor({ quantity: 2 });
        await service.prepare('openg7:facebook', 'synthetic-planner', now);
        const first = (await drafts(id))[0];
        const before = await loadSponsorshipCommitment(pool, id);
        const firstObligation = before.obligations.find((o) => o.ordinal === 1);
        const secondObligation = before.obligations.find(
          (o) => o.ordinal === 2
        );
        await adjust(adjustment(firstObligation, { kind: 'waiver' }));
        await service.prepare('openg7:facebook', 'synthetic-planner', now);
        const rows = await drafts(id);
        assert.equal(rows.length, 2);
        assert.equal(
          rows.find((row) => row.id === first.id).status,
          'cancelled'
        );
        const next = rows.find((row) => row.id !== first.id);
        assert.equal(next.obligation_id, secondObligation.id);
        assert.notEqual(next.batch_id, first.batch_id);
        assert.equal(next.approved_at, null);
        const manual = await createAdminPublicationDraft(pool, {
          contributionId: id,
          feedTarget: 'openg7',
          channel: 'facebook'
        });
        assert.equal(manual.draft.id, next.id);
        const current = await loadSponsorshipCommitment(pool, id);
        assert.equal(
          current.obligations.find((o) => o.id === firstObligation.id).state,
          'adjusted'
        );
        assert.equal(
          current.obligations.find((o) => o.id === secondObligation.id).state,
          'pending'
        );
        assert.equal((await retirementAudit(first.id)).length, 1);
      }
    );
    await t.test(
      'a format amendment creates a fresh private workspace without rewriting published history or inheriting approval',
      async () => {
        await reset();
        const id = await sponsor();
        const historical = (
          await pool.query(
            `INSERT INTO sponsor_publication_drafts(contribution_id,feed_target,channel,title,body,disclosure_text,status,public_url)
            VALUES($1,'openg7','facebook','Historical title','Historical full body','Paid sponsorship.','published','https://example.invalid/history') RETURNING *`,
            [id]
          )
        ).rows[0];
        await service.prepare('openg7:facebook', 'synthetic-planner', now);
        const first = (await drafts(id)).find(
          (row) => row.id !== historical.id
        );
        const obligation = (await loadSponsorshipCommitment(pool, id))
          .obligations[0];
        await adjust(
          adjustment(obligation, {
            kind: 'format',
            format: 'individual_portrait'
          })
        );
        await service.prepare('openg7:facebook', 'synthetic-planner', now);
        const rows = await drafts(id);
        assert.equal(rows.length, 3);
        assert.deepEqual(
          rows.find((row) => row.id === historical.id),
          historical
        );
        assert.equal(
          rows.find((row) => row.id === first.id).status,
          'cancelled'
        );
        const next = rows.find(
          (row) => ![historical.id, first.id].includes(row.id)
        );
        const delivery = (
          await pool.query(
            'SELECT * FROM publication_deliveries WHERE batch_id=$1',
            [next.batch_id]
          )
        ).rows[0];
        assert.equal(delivery.publication_format, 'individual_portrait');
        assert.equal(delivery.status, 'draft');
        assert.equal(delivery.media_snapshot, null);
        assert.equal(delivery.approved_at, null);
      }
    );
    await t.test(
      'uncertain or in-flight sources retain their drafts and holds, blocking competing automatic and manual passages after amendments',
      async () => {
        for (const status of ['publishing', 'uncertain', 'blocked']) {
          for (const kind of ['destination', 'waiver']) {
            await reset();
            const id = await sponsor({ quantity: 2 });
            await service.prepare('openg7:facebook', 'synthetic-planner', now);
            const first = (await drafts(id))[0];
            const delivery = (
              await pool.query(
                'SELECT * FROM publication_deliveries WHERE batch_id=$1',
                [first.batch_id]
              )
            ).rows[0];
            await withPostgresTransaction(pool, async (db) => {
              const snapshot = await capturePublicationObligations(
                db,
                delivery
              );
              await db.query(
                `UPDATE publication_deliveries SET status=$2,obligation_snapshot=$3::jsonb WHERE id=$1`,
                [delivery.id, status, JSON.stringify(snapshot)]
              );
              await db.query(
                `INSERT INTO publication_account_leases(provider,account_id,mode,delivery_id,delivery_version,lease_until,uncertain)
                VALUES('facebook','synthetic-held-account','mock',$1,$2,clock_timestamp()+INTERVAL '5 minutes',TRUE)`,
                [delivery.id, delivery.version]
              );
              await db.query(
                `INSERT INTO publication_account_reservations(delivery_id,provider,account_id,mode,scheduled_at,approval_version,status)
                VALUES($1,'facebook','synthetic-held-account','mock',$2,$3,'uncertain')`,
                [delivery.id, delivery.scheduled_at, delivery.version]
              );
            });
            const reservation = (
              await pool.query(
                'SELECT * FROM sponsorship_obligation_reservations WHERE delivery_id=$1',
                [delivery.id]
              )
            ).rows[0];
            const obligation = (
              await loadSponsorshipCommitment(pool, id)
            ).obligations.find((o) => o.ordinal === 1);
            await adjust(
              adjustment(
                obligation,
                kind === 'destination' ? { kind, target: 'openg20' } : { kind }
              )
            );
            const heldVersion = (
              await pool.query(
                'SELECT version FROM publication_deliveries WHERE id=$1',
                [delivery.id]
              )
            ).rows[0].version;
            assert.deepEqual((await drafts(id))[0], first);
            const target = kind === 'destination' ? 'openg20' : 'openg7';
            await service.prepare(
              `${target}:facebook`,
              'synthetic-planner',
              now
            );
            assert.deepEqual(
              await createAdminPublicationDraft(pool, {
                contributionId: id,
                feedTarget: target,
                channel: 'facebook'
              }),
              { updated: false, draft: null }
            );
            assert.deepEqual(await drafts(id), [first]);
            assert.equal(
              (
                await pool.query(
                  'SELECT version FROM publication_deliveries WHERE id=$1',
                  [delivery.id]
                )
              ).rows[0].version,
              heldVersion,
              'preparation and manual creation must not invalidate the investigation version again'
            );
            assert.deepEqual(
              (
                await pool.query(
                  'SELECT * FROM sponsorship_obligation_reservations WHERE delivery_id=$1',
                  [delivery.id]
                )
              ).rows[0],
              reservation
            );
            assert.equal(
              (
                await pool.query(
                  'SELECT uncertain FROM publication_account_leases WHERE delivery_id=$1',
                  [delivery.id]
                )
              ).rows[0].uncertain,
              true
            );
            assert.equal(
              (
                await pool.query(
                  'SELECT status FROM publication_account_reservations WHERE delivery_id=$1',
                  [delivery.id]
                )
              ).rows[0].status,
              'uncertain'
            );
            assert.deepEqual(await retirementAudit(first.id), []);
            assert.equal(
              (await loadSponsorshipCommitment(pool, id)).obligations.some(
                (o) => o.state === 'fulfilled'
              ),
              false
            );
          }
        }
      }
    );
    await t.test(
      'preparation and manual creation repair obsolete bindings left by an earlier API using the actual recorded amendment',
      async () => {
        for (const automatic of [true, false]) {
          for (const kind of ['destination', 'waiver']) {
            await reset();
            const id = await sponsor({ quantity: 2 });
            await service.prepare('openg7:facebook', 'synthetic-planner', now);
            const first = (await drafts(id))[0];
            const commitment = await loadSponsorshipCommitment(pool, id);
            const obligation = commitment.obligations.find(
              (o) => o.ordinal === 1
            );
            const requestId = randomUUID();
            // Synthetic persisted state from before this correction: terms were
            // amended and authority revoked, but the old source remained open.
            await withPostgresTransaction(pool, async (db) => {
              const after = {
                state: kind === 'waiver' ? 'adjusted' : 'pending',
                target: kind === 'destination' ? 'openg20' : 'openg7',
                format: obligation.format,
                version: obligation.version + 1
              };
              await db.query(
                `INSERT INTO sponsorship_commitment_changes(request_id,request_fingerprint,commitment_id,obligation_id,kind,actor,reason,previous_value,resulting_value)
                VALUES($1,$2,$3,$4,$5,'synthetic-owner','Explicit synthetic prior amendment',$6::jsonb,$7::jsonb)`,
                [
                  requestId,
                  'c'.repeat(64),
                  commitment.id,
                  obligation.id,
                  kind,
                  JSON.stringify({
                    state: obligation.state,
                    target: obligation.target,
                    format: obligation.format,
                    version: obligation.version
                  }),
                  JSON.stringify(after)
                ]
              );
              await db.query(
                'UPDATE sponsorship_obligations SET state=$2,target=$3,version=version+1 WHERE id=$1',
                [obligation.id, after.state, after.target]
              );
              await db.query(
                'UPDATE sponsorship_commitments SET version=version+1 WHERE id=$1',
                [commitment.id]
              );
              await revokeCommitmentDeliveries(db, id);
            });
            assert.equal((await drafts(id))[0].status, 'draft');
            const target = kind === 'destination' ? 'openg20' : 'openg7';
            const actor = automatic ? 'synthetic-planner' : 'synthetic-admin';
            if (automatic)
              await service.prepare(`${target}:facebook`, actor, now);
            const manual = await createAdminPublicationDraft(
              pool,
              { contributionId: id, feedTarget: target, channel: 'facebook' },
              actor
            );
            assert.equal(manual.updated, true);
            assert.notEqual(manual.draft.id, first.id);
            assert.equal(manual.draft.feed_target, target);
            assert.equal(manual.draft.approved_at, null);
            const rows = await drafts(id);
            assert.equal(rows.length, 2);
            const retired = rows.find((row) => row.id === first.id);
            assert.equal(retired.status, 'cancelled');
            assert.equal(retired.body, first.body);
            assert.equal(retired.batch_id, first.batch_id);
            assert.equal(
              rows.find((row) => row.id === manual.draft.id).obligation_id,
              kind === 'destination'
                ? obligation.id
                : commitment.obligations.find((o) => o.ordinal === 2).id
            );
            assert.deepEqual(await retirementAudit(first.id), [
              {
                actor,
                entity_id: first.id,
                metadata: { requestId, obligationId: obligation.id }
              }
            ]);
            assert.equal(
              (
                await pool.query(
                  'SELECT count(*)::int n FROM sponsorship_commitment_changes WHERE request_id=$1',
                  [requestId]
                )
              ).rows[0].n,
              1
            );
          }
        }
      }
    );
    await t.test(
      'manual creation waits for a concurrent destination amendment and cannot recreate the obsolete destination',
      async () => {
        await reset();
        const id = await sponsor();
        await service.prepare('openg7:facebook', 'synthetic-planner', now);
        const first = (await drafts(id))[0];
        const obligation = (await loadSponsorshipCommitment(pool, id))
          .obligations[0];
        const blocker = await pool.connect();
        let sourceLockReached;
        const sourceLock = new Promise((resolve) => {
          sourceLockReached = resolve;
        });
        const observedPool = {
          async connect() {
            const client = await pool.connect();
            return {
              async query(sql, values) {
                if (
                  sql ===
                  'SELECT id FROM fund_contributions WHERE id=$1::uuid FOR UPDATE'
                )
                  sourceLockReached();
                return client.query(sql, values);
              },
              release() {
                client.release();
              }
            };
          }
        };
        let amendment;
        let creation;
        try {
          await blocker.query('BEGIN');
          await blocker.query(
            'SELECT id FROM fund_contributions WHERE id=$1 FOR UPDATE',
            [id]
          );
          amendment = withPostgresTransaction(observedPool, (db) =>
            adjustSponsorshipObligation(
              db,
              adjustment(obligation, {
                kind: 'destination',
                target: 'openg20'
              }),
              'synthetic-owner'
            )
          );
          await sourceLock;
          creation = createAdminPublicationDraft(
            pool,
            { contributionId: id, feedTarget: 'openg7', channel: 'facebook' },
            'synthetic-admin'
          );
          await blocker.query('COMMIT');
          await amendment;
          assert.deepEqual(await creation, { updated: false, draft: null });
          assert.deepEqual(
            (await drafts(id)).map((row) => [row.id, row.status]),
            [[first.id, 'cancelled']]
          );
          const current = await createAdminPublicationDraft(
            pool,
            { contributionId: id, feedTarget: 'openg20', channel: 'facebook' },
            'synthetic-admin'
          );
          assert.equal(current.updated, true);
          assert.equal(current.draft.feed_target, 'openg20');
          assert.notEqual(current.draft.id, first.id);
        } finally {
          await blocker.query('ROLLBACK');
          blocker.release();
          await Promise.allSettled([amendment, creation].filter(Boolean));
        }
      }
    );
    await t.test(
      'retirement audit failure rolls back the amendment, draft lifecycle, delivery revocation and immutable change record',
      async () => {
        await reset();
        const id = await sponsor();
        await service.prepare('openg7:facebook', 'synthetic-planner', now);
        const before = await drafts(id);
        const commitment = await loadSponsorshipCommitment(pool, id);
        const delivery = (
          await pool.query('SELECT * FROM publication_deliveries')
        ).rows[0];
        const request = adjustment(commitment.obligations[0], {
          kind: 'destination',
          target: 'openg20'
        });
        await pool.query(`CREATE FUNCTION synthetic_fail_retirement_audit() RETURNS TRIGGER LANGUAGE plpgsql AS $$
          BEGIN IF NEW.action='sponsorship_commitment.retire_publication_draft' THEN
            RAISE EXCEPTION 'Synthetic audit failure' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
          CREATE TRIGGER synthetic_fail_retirement_audit BEFORE INSERT ON admin_audit_log
            FOR EACH ROW EXECUTE FUNCTION synthetic_fail_retirement_audit()`);
        try {
          await assert.rejects(adjust(request), { code: '23514' });
          assert.deepEqual(await drafts(id), before);
          assert.deepEqual(
            await loadSponsorshipCommitment(pool, id),
            commitment
          );
          assert.deepEqual(
            (
              await pool.query(
                'SELECT * FROM publication_deliveries WHERE id=$1',
                [delivery.id]
              )
            ).rows[0],
            delivery
          );
          assert.equal(
            (
              await pool.query(
                'SELECT count(*)::int n FROM sponsorship_commitment_changes WHERE request_id=$1',
                [request.requestId]
              )
            ).rows[0].n,
            0
          );
        } finally {
          await pool.query(
            'DROP TRIGGER synthetic_fail_retirement_audit ON admin_audit_log; DROP FUNCTION synthetic_fail_retirement_audit()'
          );
        }
      }
    );
    await t.test(
      'automatic and manual membership keep portraits individual and never flatten recorded composite formats',
      async () => {
        await reset();
        const ids = [];
        for (const format of [
          'individual_portrait',
          'individual_portrait',
          'collective_composite',
          'collective_composite',
          'collective_text'
        ])
          ids.push(await sponsor({ format }));
        await service.prepare('openg7:facebook', 'synthetic-planner', now);
        const groups = (
          await pool.query(`SELECT b.id,b.publication_format,array_agg(d.id::text ORDER BY d.id) draft_ids,
      array_agg(o.publication_format) obligation_formats FROM sponsor_publication_batches b
      JOIN sponsor_publication_drafts d ON d.batch_id=b.id JOIN sponsorship_obligations o ON o.id=d.obligation_id
      GROUP BY b.id ORDER BY b.scheduled_at`)
        ).rows;
        assert.deepEqual(
          groups.map((g) => [g.publication_format, g.draft_ids.length]),
          [
            ['individual_portrait', 1],
            ['individual_portrait', 1],
            ['collective_composite', 2],
            ['collective_text', 1]
          ]
        );
        for (const group of groups)
          assert.equal(
            group.obligation_formats.every(
              (f) => f === group.publication_format
            ),
            true
          );
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int n FROM publication_deliveries WHERE approved_at IS NOT NULL'
            )
          ).rows[0].n,
          0
        );
        const unrelated = (await drafts(ids[4]))[0];
        const attempt = await assignDraftToPublicationBatch(pool, {
          batchId: groups[0].id,
          draftId: unrelated.id
        });
        assert.equal(attempt.updated, false);
        assert.equal((await drafts(ids[4]))[0].batch_id, unrelated.batch_id);
        const privateVisuals = (
          await pool.query(
            "SELECT status,media_snapshot,approved_at,photo_selections FROM publication_deliveries WHERE publication_format<>'collective_text'"
          )
        ).rows;
        assert.equal(
          privateVisuals.length,
          3,
          'each image batch has a scoped private workspace for human selection'
        );
        for (const delivery of privateVisuals) {
          assert.equal(delivery.status, 'draft');
          assert.equal(delivery.media_snapshot, null);
          assert.equal(delivery.approved_at, null);
          assert.deepEqual(delivery.photo_selections, []);
        }
      }
    );
    await t.test(
      'eight individual commitments prepare eight distinct portrait workspaces with no silent substitution or approval',
      async () => {
        await reset();
        await pool.query(
          "UPDATE publication_feeds SET horizon_days=10 WHERE id='openg7:facebook'"
        );
        const ids = [];
        for (let index = 0; index < 8; index++)
          ids.push(await sponsor({ format: 'individual_portrait' }));
        await service.prepare('openg7:facebook', 'synthetic-planner', now);
        const workspaces = (
          await pool.query(`SELECT p.id,p.publication_format,p.status,p.media_snapshot,p.approved_at,
      p.source_snapshot,p.photo_selections,p.scheduled_at,b.capacity,count(d.id)::int members
      FROM publication_deliveries p JOIN sponsor_publication_batches b ON b.id=p.batch_id
      JOIN sponsor_publication_drafts d ON d.batch_id=b.id GROUP BY p.id,b.id ORDER BY p.scheduled_at`)
        ).rows;
        assert.equal(workspaces.length, 8);
        assert.equal(
          new Set(workspaces.map((p) => p.scheduled_at.toISOString())).size,
          8
        );
        assert.deepEqual(
          workspaces.map((p) => p.source_snapshot[0].contribution_id),
          ids,
          'first eligible entries retain their order'
        );
        for (const workspace of workspaces) {
          assert.equal(workspace.publication_format, 'individual_portrait');
          assert.equal(workspace.members, 1);
          assert.equal(workspace.source_snapshot.length, 1);
          assert.equal(workspace.status, 'draft');
          assert.equal(workspace.media_snapshot, null);
          assert.equal(workspace.approved_at, null);
          assert.deepEqual(workspace.photo_selections, []);
        }
        await service.prepare('openg7:facebook', 'synthetic-planner', now);
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int n FROM publication_deliveries'
            )
          ).rows[0].n,
          8
        );
      }
    );
    await t.test(
      'an automatic passage never recreates a human-rejected draft',
      async () => {
        await reset();
        const id = await sponsor();
        const obligation = (await loadSponsorshipCommitment(pool, id))
          .obligations[0];
        const rejected = (
          await pool.query(
            `INSERT INTO sponsor_publication_drafts(contribution_id,feed_target,channel,title,body,disclosure_text,status,obligation_id)
        VALUES($1,'openg7','facebook','Rejected title','Human rejected content','Paid sponsorship.','rejected',$2) RETURNING *`,
            [id, obligation.id]
          )
        ).rows[0];
        await service.prepare('openg7:facebook', 'synthetic-planner', now);
        await service.prepare('openg7:facebook', 'synthetic-planner', now);
        assert.deepEqual(await drafts(id), [rejected]);
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int n FROM publication_deliveries'
            )
          ).rows[0].n,
          0
        );
        assert.equal(
          (await loadSponsorshipCommitment(pool, id)).obligations[0].state,
          'pending',
          'a refusal preserves the obligation without inventing delivery or waiver'
        );
      }
    );
    await t.test(
      'repair cannot exceed its shared slot and restores every source on rollback',
      async () => {
        await reset();
        const excluded = await sponsor();
        const retained = await sponsor();
        await service.prepare('openg7:facebook', 'synthetic-planner', now);
        const delivery = (
          await pool.query('SELECT * FROM publication_deliveries')
        ).rows[0];
        const slotId = (
          await pool.query(
            `INSERT INTO publication_slots(feed_target,channel,starts_at,timezone,capacity,status)
         VALUES('openg7','facebook',$1,'UTC',2,'open') RETURNING id`,
            [future]
          )
        ).rows[0].id;
        await pool.query(
          'UPDATE sponsor_publication_batches SET capacity=3,slot_id=$2 WHERE id=$1',
          [delivery.batch_id, slotId]
        );
        for (let index = 0; index < 2; index++) {
          const candidate = await sponsor();
          const obligation = (await loadSponsorshipCommitment(pool, candidate))
            .obligations[0];
          await pool.query(
            `INSERT INTO sponsor_publication_drafts(contribution_id,feed_target,channel,title,body,disclosure_text,status,obligation_id)
           VALUES($1,'openg7','facebook','Full candidate title','Full candidate body','Paid sponsorship.','draft',$2)`,
            [candidate, obligation.id]
          );
        }
        await pool.query(
          'UPDATE fund_contributions SET public_display_consent=FALSE WHERE id=$1',
          [excluded]
        );
        await approveFixtureSubject(pool, {
          type: 'publication_delivery',
          id: delivery.id
        });
        const before = (
          await pool.query(
            'SELECT * FROM sponsor_publication_drafts ORDER BY id'
          )
        ).rows;
        const beforeDelivery = (
          await pool.query('SELECT * FROM publication_deliveries WHERE id=$1', [
            delivery.id
          ])
        ).rows[0];
        const proposal = await service.repairPreview(delivery.id);
        assert.ok(proposal);
        assert.equal(proposal.sponsors.length, 3);
        assert.ok(proposal.sponsors.some((sponsor) => sponsor.id === retained));
        await assert.rejects(
          service.repair(delivery.id, proposal.version, 'synthetic-reviewer'),
          { code: 'SLOT_CAPACITY_EXCEEDED' }
        );
        assert.deepEqual(
          (
            await pool.query(
              'SELECT * FROM sponsor_publication_drafts ORDER BY id'
            )
          ).rows,
          before
        );
        assert.deepEqual(
          (
            await pool.query(
              'SELECT * FROM publication_deliveries WHERE id=$1',
              [delivery.id]
            )
          ).rows[0],
          beforeDelivery
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int n FROM admin_audit_log WHERE action='publication_automation.repair_proposed'"
            )
          ).rows[0].n,
          0
        );
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int n FROM sponsorship_fulfilment_evidence'
            )
          ).rows[0].n,
          0
        );
      }
    );
  }
);
