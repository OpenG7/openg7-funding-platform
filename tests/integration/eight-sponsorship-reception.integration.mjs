import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import {
  composePublicationRecognition,
  missingPublicationRecognitionSources
} from '../../dist/packages/funding-core/src/index.js';
import { PublicationAutomationService } from '../../dist/apps/funding-api/src/publication-automation/service.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { recordFixtureSponsorshipAgreement } from './support/sponsorship-agreement-fixture.mjs';
import { approveFixtureSubject } from './support/moderation-fixture.mjs';

test(
  'eight documented sponsorships traverse preparation, approval, delivery and individual proof without loss',
  { timeout: 180000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);
    const feedId = 'openg7:facebook';
    const actor = 'admin:00000000-0000-4000-8000-000000000003';
    const provider = 'https://eight-sponsorships.example.invalid/graph';
    const service = new PublicationAutomationService(
      pool,
      {},
      {
        SOCIAL_PUBLICATION_MODE: 'live',
        SOCIAL_PUBLICATION_OPENG7_FACEBOOK_ACCOUNT_ID: '80',
        SOCIAL_PUBLICATION_OPENG7_FACEBOOK_ACCESS_TOKEN:
          'synthetic-reception-token',
        SOCIAL_PUBLICATION_FACEBOOK_GRAPH_BASE_URL: provider
      }
    );
    const posts = [];
    let loseNextResponse = false;
    t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
      const address = String(url);
      if (address === `${provider}/me?fields=id`)
        return Response.json({ id: '80' });
      if (address === `${provider}/80/feed` && init.method === 'POST') {
        const form = new URLSearchParams(init.body);
        const post = {
          id: `80_${100 + posts.length}`,
          message: form.get('message')
        };
        posts.push(post);
        if (loseNextResponse) {
          loseNextResponse = false;
          throw new Error(
            'Synthetic response lost after the exact post was accepted.'
          );
        }
        return Response.json({ id: post.id });
      }
      const post = posts.find((item) =>
        address.startsWith(`${provider}/${item.id}?`)
      );
      if (post && (init.method === undefined || init.method === 'GET'))
        return Response.json({
          ...post,
          from: { id: '80' },
          is_published: true,
          permalink_url: `https://www.facebook.com/${post.id}`
        });
      throw new Error('Unexpected synthetic provider request.');
    });
    const deliveries = async () =>
      (
        await pool.query(
          'SELECT * FROM publication_deliveries ORDER BY scheduled_at,id'
        )
      ).rows;
    const evidence = async () =>
      (
        await pool.query(
          'SELECT * FROM sponsorship_fulfilment_evidence ORDER BY obligation_id'
        )
      ).rows;

    async function fixture(body) {
      await pool.query(
        'TRUNCATE fund_contributions,publication_deliveries,publication_recurrences,social_publication_jobs,sponsor_publication_drafts,sponsor_publication_batches,publication_slots,admin_audit_log CASCADE'
      );
      posts.length = 0;
      loseNextResponse = false;
      const now = new Date();
      const next = new Date(now.getTime() + 3600000);
      const horizon = now.getUTCDate() === next.getUTCDate() ? 3 : 4;
      await pool.query(
        "UPDATE publication_feeds SET paused=TRUE,auto_prepare=FALSE,timezone='UTC',weekdays='{0,1,2,3,4,5,6}',local_time=$1,capacity=5,horizon_days=$2,connection='unchecked',account_fingerprint=NULL,last_prepared_at=NULL",
        [next.toISOString().slice(11, 16), horizon]
      );
      await pool.query(
        'UPDATE publication_worker_settings SET enabled=TRUE,version=1'
      );
      await service.command({ action: 'check', feedId }, actor);
      const people = [];
      for (let index = 0; index < 8; index++) {
        const id = randomUUID();
        const name = `Atelier de réception synthétique ${index + 1}`;
        await pool.query(
          "INSERT INTO fund_contributions(id,contribution_type,amount_cents,currency,status,paid_at,created_at,public_display_consent,sponsor_review_status,sponsor_company_name,sponsor_public_summary) VALUES($1,'sponsorship_interest',25000,'cad','paid',$2,$2,TRUE,'approved',$3,$4)",
          [id, new Date(Date.UTC(2020, 0, 1, 0, 0, index)), name, body]
        );
        const agreement = await recordFixtureSponsorshipAgreement(pool, id, {
          channel: 'facebook'
        });
        await approveFixtureSubject(pool, { type: 'sponsorship', id });
        people.push({ id, name, obligationId: agreement.obligations[0].id });
      }
      await service.prepare(feedId, actor, now);
      return { now, people };
    }

    async function approveAll() {
      for (const delivery of await deliveries()) {
        await approveFixtureSubject(pool, {
          type: 'publication_delivery',
          id: delivery.id
        });
        await service.command(
          {
            action: 'approve',
            id: delivery.id,
            version: delivery.version,
            confirmation: delivery.id
          },
          actor
        );
      }
    }

    async function resume() {
      const feed = (await service.feeds()).find((item) => item.id === feedId);
      await service.command(
        { action: 'settings', settings: { ...feed, paused: false } },
        actor
      );
    }

    // Only this disposable fixture advances a persisted cooldown after observing
    // its retention. The worker still uses the production lease/dispatch guards.
    async function advanceCooldown() {
      await pool.query(
        "UPDATE publication_account_leases SET next_dispatch_at=clock_timestamp() WHERE provider='facebook' AND account_id='80' AND NOT uncertain AND delivery_id IS NULL"
      );
    }

    async function assertEightProofs(people) {
      const proofs = await evidence();
      assert.equal(proofs.length, 8);
      assert.deepEqual(
        new Set(proofs.map((proof) => proof.obligation_id)),
        new Set(people.map((person) => person.obligationId))
      );
      assert.equal(
        new Set(proofs.map((proof) => proof.contribution_id)).size,
        8
      );
      for (const person of people) {
        const proof = proofs.find(
          (item) => item.obligation_id === person.obligationId
        );
        assert.equal(proof.contribution_id, person.id);
        assert.equal(proof.mode, 'live');
        assert.ok(
          ['provider_acknowledged', 'provider_verified'].includes(
            proof.provenance
          )
        );
        assert(proof.message.includes(person.name));
        assert(
          posts.some(
            (post) =>
              post.id === proof.external_post_id &&
              post.message === proof.message
          )
        );
      }
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int n FROM sponsorship_obligations WHERE state='fulfilled' AND fulfilment_evidence_id IS NOT NULL"
          )
        ).rows[0].n,
        8
      );
    }

    for (const [label, body, distribution] of [
      [
        'capacity-limited 5+3',
        'Un soutien documenté au projet public.',
        [5, 3]
      ],
      ['character-limited 3+3+2', 'x'.repeat(830), [3, 3, 2]]
    ])
      await t.test(label, async () => {
        const { people } = await fixture(body);
        const prepared = await deliveries();
        const sources = (
          await pool.query(
            'SELECT draft.*,contribution.sponsor_company_name AS name FROM sponsor_publication_drafts draft JOIN fund_contributions contribution ON contribution.id=draft.contribution_id ORDER BY draft.id'
          )
        ).rows;
        assert.deepEqual(
          prepared.map(
            (delivery) =>
              sources.filter((source) => source.batch_id === delivery.batch_id)
                .length
          ),
          distribution
        );
        for (const delivery of prepared) {
          const members = sources
            .filter((source) => source.batch_id === delivery.batch_id)
            .map((source) => ({
              id: source.id,
              contributionId: source.contribution_id,
              name: source.name,
              title: source.title,
              body: source.body,
              disclosureText: source.disclosure_text
            }));
          assert.equal(
            delivery.message,
            composePublicationRecognition(members)
          );
          assert.deepEqual(
            missingPublicationRecognitionSources(delivery.message, members),
            []
          );
          assert(delivery.message.length <= 2900);
          assert.equal(delivery.approved_at, null);
        }
        assert.equal(posts.length, 0);
        assert.equal((await evidence()).length, 0);
        await service.prepare(feedId, actor);
        assert.deepEqual(
          await deliveries(),
          prepared,
          'a replay preserves each exact private proposal'
        );
        await approveAll();
        await service.tick(
          new Date(prepared.at(-1).scheduled_at.getTime() + 1000)
        );
        assert.equal(
          posts.length,
          0,
          'a paused feed retains all eight authorized passages'
        );
        await resume();
        for (const delivery of prepared) {
          await advanceCooldown();
          await service.tick(new Date(delivery.scheduled_at.getTime() + 1000));
        }
        assert.equal(posts.length, distribution.length);
        await assertEightProofs(people);
        await service.tick(
          new Date(prepared.at(-1).scheduled_at.getTime() + 2000)
        );
        await assertEightProofs(people);
        assert.equal(
          posts.length,
          distribution.length,
          'the published passages are never resent'
        );
      });

    await t.test(
      'an uncertain first post retains all obligations until verified and never resends blindly',
      async () => {
        const { people } = await fixture(
          'Un soutien documenté au projet public.'
        );
        const prepared = await deliveries();
        await approveAll();
        await resume();
        loseNextResponse = true;
        const due = new Date(prepared[0].scheduled_at.getTime() + 1000);
        await service.tick(due);
        const uncertain = (await deliveries())[0];
        assert.equal(uncertain.status, 'uncertain');
        assert.equal(posts.length, 1);
        assert.equal((await evidence()).length, 0);
        await service.tick(
          new Date(prepared.at(-1).scheduled_at.getTime() + 1000)
        );
        assert.equal(posts.length, 1);
        assert.equal((await evidence()).length, 0);
        await service.command(
          {
            action: 'reconcile',
            id: uncertain.id,
            version: uncertain.version,
            confirmation: uncertain.id,
            externalPostId: posts[0].id
          },
          actor
        );
        assert.equal((await evidence()).length, 5);
        assert(
          (await evidence()).every(
            (proof) => proof.provenance === 'provider_verified'
          )
        );
        await advanceCooldown();
        await service.tick(new Date(prepared[1].scheduled_at.getTime() + 1000));
        await assertEightProofs(people);
        assert.equal(posts.length, 2);
      }
    );
  }
);
