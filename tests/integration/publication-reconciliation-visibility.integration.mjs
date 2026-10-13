import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PublicationAutomationService } from '../../dist/apps/funding-api/src/publication-automation/service.js';
import { claimNextDelivery } from '../../dist/apps/funding-api/src/publication-automation/claims.js';
import { finishAccountClaim } from '../../dist/apps/funding-api/src/publication-automation/account-reservations.js';
import { digest } from '../../dist/apps/funding-api/src/publication-automation/policy.js';
import { withPostgresTransaction } from '../../dist/apps/funding-api/src/postgres-transaction.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { approveFixtureSubject } from './support/moderation-fixture.mjs';

test(
  'reconciliation and immutable visibility observations with disposable PostgreSQL',
  { timeout: 120000 },
  async (t) => {
    const database = await startDisposablePostgres();
    t.after(database.stop);
    const pool = database.pool;
    const env = {
      SOCIAL_PUBLICATION_MODE: 'live',
      SOCIAL_PUBLICATION_WORKER_ENABLED: 'true',
      SOCIAL_PUBLICATION_FACEBOOK_GRAPH_BASE_URL: 'https://reconciliation.test',
      SOCIAL_PUBLICATION_OPENG20_FACEBOOK_ACCOUNT_ID: '20',
      SOCIAL_PUBLICATION_OPENG20_FACEBOOK_ACCESS_TOKEN: 'synthetic'
    };
    const service = new PublicationAutomationService(pool, {}, env);
    const row = async (id) =>
      (
        await pool.query('SELECT * FROM publication_deliveries WHERE id=$1', [
          id
        ])
      ).rows[0];
    let lookups = 0;
    let afterLookup;
    let response;
    const unexpected = [];
    t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
      assert.equal(options.method ?? 'GET', 'GET');
      const path = String(url);
      if (path === 'https://reconciliation.test/me?fields=id')
        return Response.json({ id: '20' });
      if (
        path ===
        'https://reconciliation.test/linkedin/posts/urn%3Ali%3AugcPost%3A99'
      )
        return Response.json({
          id: 'urn:li:ugcPost:99',
          author: 'urn:li:organization:20',
          commentary: 'Qualified LinkedIn history',
          lifecycleState: 'PUBLISHED',
          visibility: 'PUBLIC'
        });
      if (
        path ===
        'https://reconciliation.test/20_99?fields=id,from,message,is_published'
      ) {
        lookups++;
        const open = (
          await pool.query(
            'SELECT count(*)::int count FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND xact_start IS NOT NULL'
          )
        ).rows[0].count;
        assert.equal(
          open,
          0,
          'no API transaction or lock survives into provider HTTP'
        );
        await afterLookup?.();
        if (response === 'timeout') throw new Error('Synthetic timeout');
        if (typeof response === 'number')
          return new Response('{}', { status: response });
        return Response.json(response);
      }
      unexpected.push(path);
      throw new Error('Unexpected synthetic provider URL');
    });
    t.after(() => assert.deepEqual(unexpected, []));
    async function reset() {
      env.SOCIAL_PUBLICATION_MODE = 'live';
      await pool.query(
        'TRUNCATE fund_contributions,sponsorship_offers,publication_deliveries,admin_audit_log CASCADE'
      );
      await pool.query('UPDATE publication_worker_settings SET enabled=TRUE');
      await service.command(
        { action: 'check', feedId: 'openg20:facebook' },
        'reconciliation-tester'
      );
      const feed = (await service.state()).feeds.find(
        (item) => item.id === 'openg20:facebook'
      );
      await service.command(
        { action: 'settings', settings: { ...feed, paused: false } },
        'reconciliation-tester'
      );
      lookups = 0;
      afterLookup = undefined;
    }
    async function uncertain() {
      const scheduledAt = new Date(Date.now() + 60000).toISOString();
      const { id } = await service.command(
        {
          action: 'compose',
          feedId: 'openg20:facebook',
          kind: 'news',
          message: 'Historical approved recognition',
          scheduledAt
        },
        'reconciliation-tester'
      );
      await approveFixtureSubject(pool, { type: 'publication_delivery', id });
      const draft = await row(id);
      await service.command(
        { action: 'approve', id, version: draft.version, confirmation: id },
        'reconciliation-tester'
      );
      const context = {
        pool,
        workerSettings: async (db = pool, lock = '') =>
          (
            await db.query(
              `SELECT enabled,version FROM publication_worker_settings WHERE id=TRUE ${lock}`
            )
          ).rows[0]
      };
      const claim = await claimNextDelivery(
        context,
        new Date(Date.parse(scheduledAt) + 1000)
      );
      await withPostgresTransaction(pool, async (db) => {
        await db.query(
          "UPDATE publication_deliveries SET status='uncertain',version=version+1,error_code='PROVIDER_TIMEOUT' WHERE id=$1",
          [id]
        );
        await finishAccountClaim(db, claim, 'uncertain', { dispatched: true });
      });
      return row(id);
    }
    const reconciliation = (record) =>
      service.command(
        {
          action: 'reconcile',
          id: record.id,
          version: record.version,
          confirmation: record.id,
          externalPostId: '20_99'
        },
        'reconciliation-tester'
      );

    await t.test(
      'verified reads release every transaction before HTTP and complete with distinct provenance',
      async () => {
        await reset();
        const initial = await uncertain();
        response = {
          id: '20_99',
          from: { id: '20' },
          message: initial.message,
          is_published: true
        };
        await reconciliation(initial);
        assert.equal((await row(initial.id)).status, 'published');
        const audits = (
          await pool.query(
            "SELECT action,metadata FROM admin_audit_log WHERE entity_id=$1 AND action IN ('publication_automation.reconciliation_result_observed','publication_automation.reconcile') ORDER BY created_at,id",
            [initial.id]
          )
        ).rows;
        assert.deepEqual(audits.map((item) => item.action).sort(), [
          'publication_automation.reconcile',
          'publication_automation.reconciliation_result_observed'
        ]);
        assert.equal(
          audits.find((item) => item.action.endsWith('.reconcile')).metadata
            .provenance,
          'provider_verified'
        );
        assert.equal(lookups, 1);
      }
    );

    await t.test(
      'a decision changed during HTTP survives; the verified historical result remains observed',
      async () => {
        await reset();
        const initial = await uncertain();
        response = {
          id: '20_99',
          from: { id: '20' },
          message: initial.message,
          is_published: true
        };
        afterLookup = () =>
          pool.query(
            "UPDATE publication_deliveries SET status='blocked',version=version+1,approved_at=NULL,approved_by=NULL,error_code='MODERATION_RESTRICTED' WHERE id=$1",
            [initial.id]
          );
        await assert.rejects(reconciliation(initial), {
          code: 'VERSION_CONFLICT'
        });
        const current = await row(initial.id);
        assert.equal(current.status, 'blocked');
        assert.equal(current.error_code, 'MODERATION_RESTRICTED');
        assert.equal(current.approved_at, null);
        assert.equal(current.external_post_id, null);
        assert.equal(
          (
            await pool.query(
              "SELECT * FROM admin_audit_log WHERE entity_id=$1 AND action='publication_automation.reconciliation_result_observed'",
              [initial.id]
            )
          ).rowCount,
          1
        );
        assert.equal(
          (
            await pool.query(
              "SELECT * FROM admin_audit_log WHERE entity_id=$1 AND action='publication_automation.reconcile'",
              [initial.id]
            )
          ).rowCount,
          0
        );
      }
    );

    await t.test(
      'unreadable remote posts preserve uncertainty and authorize no resend',
      async () => {
        for (const failure of [403, 404, 'timeout']) {
          await reset();
          const initial = await uncertain();
          response = failure;
          await assert.rejects(reconciliation(initial), {
            code: 'REMOTE_POST_UNVERIFIED'
          });
          assert.deepEqual(await row(initial.id), initial);
          assert.equal(
            (await pool.query('SELECT * FROM sponsorship_fulfilment_evidence'))
              .rowCount,
            0
          );
        }
      }
    );

    await t.test(
      'a mode changed during HTTP prevents completion while preserving the remote observation',
      async () => {
        await reset();
        const initial = await uncertain();
        response = {
          id: '20_99',
          from: { id: '20' },
          message: initial.message,
          is_published: true
        };
        afterLookup = async () => {
          env.SOCIAL_PUBLICATION_MODE = 'mock';
        };
        await assert.rejects(reconciliation(initial), { code: 'MODE_CHANGED' });
        assert.deepEqual(await row(initial.id), initial);
        assert.equal(
          (
            await pool.query(
              "SELECT * FROM admin_audit_log WHERE entity_id=$1 AND action='publication_automation.reconciliation_result_observed'",
              [initial.id]
            )
          ).rowCount,
          1
        );
        assert.equal(
          (await pool.query('SELECT * FROM sponsorship_fulfilment_evidence'))
            .rowCount,
          0
        );
      }
    );

    await t.test(
      'visibility compares immutable proof, records changes/unknown and never alters fulfilled or paid facts',
      async () => {
        await reset();
        const initial = await uncertain();
        response = {
          id: '20_99',
          from: { id: '20' },
          message: initial.message,
          is_published: true
        };
        await reconciliation(initial);
        const contribution = (
          await pool.query(
            "INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at,public_display_consent,sponsor_company_name) VALUES('sponsorship_interest',50000,'cad','paid',NOW(),TRUE,'Synthetic visibility owner') RETURNING *"
          )
        ).rows[0];
        const snapshot = {
          version: 'historical-qualification-v1',
          amountMinor: 50000,
          currency: 'CAD',
          benefits: [
            {
              id: 'facebook_batch',
              channel: 'facebook',
              target: 'openg20',
              quantity: 1
            },
            {
              id: 'linkedin_batch',
              channel: 'linkedin',
              target: 'openg20',
              quantity: 1
            }
          ]
        };
        const offer = (
          await pool.query(
            "INSERT INTO sponsorship_offers(public_reference,version,fingerprint,amount_minor,currency,snapshot,provenance) VALUES('SYNTHETIC-VISIBILITY',$1,$2,50000,'CAD',$3::jsonb,'historical_qualification') RETURNING id",
            [
              snapshot.version,
              digest(JSON.stringify(snapshot)),
              JSON.stringify(snapshot)
            ]
          )
        ).rows[0];
        const commitment = (
          await pool.query(
            "INSERT INTO sponsorship_commitments(contribution_id,offer_id,provenance,state,activated_at) VALUES($1,$2,'qualified_historical','active',NOW()) RETURNING id",
            [contribution.id, offer.id]
          )
        ).rows[0];
        const obligation = (
          await pool.query(
            "INSERT INTO sponsorship_obligations(commitment_id,contribution_id,benefit_id,channel,target,ordinal) VALUES($1,$2,'facebook_batch','facebook','openg20',1) RETURNING id",
            [commitment.id, contribution.id]
          )
        ).rows[0];
        // Synthetic ledger fixture isolates visibility; fulfilment integration tests
        // separately exercise proof qualification and settlement through real ports.
        const evidence = (
          await pool.query(
            "INSERT INTO sponsorship_fulfilment_evidence(obligation_id,contribution_id,obligation_version,channel,target,delivery_id,delivery_version,mode,account_id,provenance,external_post_id,external_post_url,message,source_snapshot,content_fingerprint,delivered_at,actor) VALUES($1,$2,1,'facebook','openg20',$3,$4,'live','20','provider_verified','20_99','https://www.facebook.com/20_99',$5,'[]'::jsonb,$6,NOW(),'synthetic-visibility-fixture') RETURNING *",
            [
              obligation.id,
              contribution.id,
              initial.id,
              initial.version,
              initial.message,
              digest(initial.message)
            ]
          )
        ).rows[0];
        await pool.query(
          "UPDATE sponsorship_obligations SET state='fulfilled',fulfilment_evidence_id=$2 WHERE id=$1",
          [obligation.id, evidence.id]
        );
        await pool.query(
          "UPDATE publication_deliveries SET message='New internal draft description',version=version+1 WHERE id=$1",
          [initial.id]
        );
        const delivery = await row(initial.id);
        const fulfilledBefore = (
          await pool.query(
            'SELECT * FROM sponsorship_obligations WHERE id=$1',
            [obligation.id]
          )
        ).rows[0];
        const check = (requestId) =>
          service.command(
            {
              action: 'check-visibility',
              id: delivery.id,
              version: delivery.version,
              confirmation: delivery.id,
              requestId
            },
            'visibility-tester'
          );
        const requestId = randomUUID();
        lookups = 0;
        await check(requestId);
        await check(requestId);
        assert.equal(lookups, 1);
        assert.equal(
          (
            await pool.query(
              'SELECT state FROM sponsorship_fulfilment_visibility WHERE evidence_id=$1',
              [evidence.id]
            )
          ).rows[0].state,
          'visible'
        );
        response = {
          id: '20_99',
          from: { id: '20' },
          message: 'Name and recognition removed',
          is_published: true
        };
        await check(randomUUID());
        for (const failure of [403, 404, 'timeout']) {
          response = failure;
          await check(randomUUID());
        }
        const states = (
          await pool.query(
            'SELECT state,count(*)::int count FROM sponsorship_fulfilment_visibility GROUP BY state ORDER BY state'
          )
        ).rows;
        assert.deepEqual(states, [
          { state: 'changed', count: 1 },
          { state: 'unknown', count: 3 },
          { state: 'visible', count: 1 }
        ]);
        assert.deepEqual(
          (
            await pool.query(
              'SELECT * FROM sponsorship_fulfilment_evidence WHERE id=$1',
              [evidence.id]
            )
          ).rows[0],
          evidence
        );
        assert.deepEqual(
          (
            await pool.query('SELECT * FROM fund_contributions WHERE id=$1', [
              contribution.id
            ])
          ).rows[0],
          contribution
        );
        assert.deepEqual(
          (
            await pool.query(
              'SELECT * FROM sponsorship_obligations WHERE id=$1',
              [obligation.id]
            )
          ).rows[0],
          fulfilledBefore
        );
        assert.deepEqual(await row(initial.id), delivery);
        await assert.rejects(
          pool.query(
            "UPDATE sponsorship_fulfilment_visibility SET state='missing' WHERE evidence_id=$1",
            [evidence.id]
          ),
          { code: '23514' }
        );
        await assert.rejects(
          service.command(
            {
              action: 'check-visibility',
              id: delivery.id,
              version: delivery.version,
              confirmation: delivery.id,
              requestId
            },
            'different-actor'
          ),
          { code: 'VISIBILITY_REQUEST_CONFLICT' }
        );
        env.SOCIAL_PUBLICATION_OPENG20_LINKEDIN_ACCOUNT_ID = '20';
        env.SOCIAL_PUBLICATION_OPENG20_LINKEDIN_ACCESS_TOKEN = 'synthetic';
        env.SOCIAL_PUBLICATION_LINKEDIN_API_BASE_URL =
          'https://reconciliation.test/linkedin';
        const linkedinDelivery = (
          await pool.query(
            "INSERT INTO publication_deliveries(feed_id,kind,message,scheduled_at,account_id,mode,status,published_at) VALUES('openg20:linkedin','news','Qualified LinkedIn history',NOW(),'urn:li:organization:20','live','published',NOW()) RETURNING *"
          )
        ).rows[0];
        const linkedinObligation = (
          await pool.query(
            "INSERT INTO sponsorship_obligations(commitment_id,contribution_id,benefit_id,channel,target,ordinal) VALUES($1,$2,'linkedin_batch','linkedin','openg20',1) RETURNING id",
            [commitment.id, contribution.id]
          )
        ).rows[0];
        const linkedinEvidence = (
          await pool.query(
            "INSERT INTO sponsorship_fulfilment_evidence(obligation_id,contribution_id,obligation_version,channel,target,delivery_id,delivery_version,mode,account_id,provenance,external_post_id,message,source_snapshot,content_fingerprint,delivered_at,actor) VALUES($1,$2,1,'linkedin','openg20',$3,1,'live','urn:li:organization:20','provider_verified','urn:li:ugcPost:99','Qualified LinkedIn history','[]'::jsonb,$4,NOW(),'synthetic-visibility-fixture') RETURNING id",
            [
              linkedinObligation.id,
              contribution.id,
              linkedinDelivery.id,
              digest('Qualified LinkedIn history')
            ]
          )
        ).rows[0];
        await service.command(
          {
            action: 'check-visibility',
            id: linkedinDelivery.id,
            version: linkedinDelivery.version,
            confirmation: linkedinDelivery.id,
            requestId: randomUUID()
          },
          'visibility-tester'
        );
        assert.equal(
          (
            await pool.query(
              'SELECT state FROM sponsorship_fulfilment_visibility WHERE evidence_id=$1',
              [linkedinEvidence.id]
            )
          ).rows[0].state,
          'visible'
        );
      }
    );
  }
);
