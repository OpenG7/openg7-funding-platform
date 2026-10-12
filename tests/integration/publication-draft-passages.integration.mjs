import assert from 'node:assert/strict';
import test from 'node:test';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { recordFixtureSponsorshipAgreement } from './support/sponsorship-agreement-fixture.mjs';
import { approveFixtureSubject } from './support/moderation-fixture.mjs';
import { PublicationAutomationService } from '../../dist/apps/funding-api/src/publication-automation/service.js';
import { withPostgresTransaction } from '../../dist/apps/funding-api/src/postgres-transaction.js';
import {
  capturePublicationObligations,
  recordSocialFulfilment
} from '../../dist/apps/funding-api/src/sponsorship-fulfilment.repository.js';
import { loadSponsorshipCommitment } from '../../dist/apps/funding-api/src/sponsorship-commitments.repository.js';
import { assignDraftToPublicationBatch } from '../../dist/apps/funding-api/src/fund-admin.repository.js';

test(
  'draft passages preserve history and the recorded format on disposable PostgreSQL',
  { timeout: 90000 },
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
