import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { composePublicationRecognition } from '../../dist/packages/funding-core/src/index.js';
import { createAdminPublicationAutomationHttpHandler } from '../../dist/apps/funding-api/src/admin-publication-automation.http.js';
import { PublicationAutomationError } from '../../dist/apps/funding-api/src/publication-automation/policy.js';
import { PublicationAutomationService } from '../../dist/apps/funding-api/src/publication-automation/service.js';
import { recordModerationDecision } from '../../dist/apps/funding-api/src/moderation/repository.js';
import { withPostgresTransaction } from '../../dist/apps/funding-api/src/postgres-transaction.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { recordFixtureSponsorshipAgreement } from './support/sponsorship-agreement-fixture.mjs';
import {
  fixtureModerationActor,
  fixtureModerationDecision
} from './support/moderation-fixture.mjs';

test(
  'a fresh dossier gets read-only preparation possibilities while the worker remains disabled',
  { timeout: 120000 },
  async (t) => {
    const database = await startDisposablePostgres();
    t.after(database.stop);
    const pool = database.pool;
    const service = new PublicationAutomationService(
      pool,
      {},
      {
        SOCIAL_PUBLICATION_MODE: 'mock'
      }
    );
    t.mock.method(globalThis, 'fetch', () => {
      throw new Error(
        'Read-only forecasts and private preparation must not send'
      );
    });
    const handler = createAdminPublicationAutomationHttpHandler({
      publicBaseOrigin: 'https://funding.example.test',
      ensureAdminAccess: () => true,
      getAdminAuditActor: () => {
        throw new Error('A GET must not acquire a mutation actor');
      },
      readBody: () => {
        throw new Error('A GET must not read a body');
      },
      writeJson: (_request, response, status, payload) => {
        Object.assign(response, { status, payload });
      },
      publicationAutomation: service,
      PublicationAutomationError
    });
    const observedTables = [
      'fund_contributions',
      'sponsorship_commitments',
      'sponsorship_obligations',
      'sponsor_publication_drafts',
      'sponsor_publication_batches',
      'publication_deliveries',
      'publication_slots',
      'publication_recurrences',
      'publication_feeds',
      'publication_worker_settings',
      'publication_account_reservations',
      'publication_account_leases',
      'sponsorship_obligation_reservations',
      'admin_audit_log'
    ];
    async function facts() {
      return (
        await pool.query(
          observedTables
            .map(
              (table) =>
                `SELECT '${table}' AS name,COALESCE(jsonb_agg(to_jsonb(value) ORDER BY to_jsonb(value)::text),'[]'::jsonb) AS rows FROM ${table} value`
            )
            .join(' UNION ALL ')
        )
      ).rows;
    }
    async function get(filter = {}) {
      const before = await facts();
      const response = {};
      const handled = await handler(
        {
          method: 'GET',
          url:
            '/api/admin/publication-automation?' +
            new URLSearchParams(filter).toString(),
          headers: {}
        },
        response
      );
      assert.equal(handled, true);
      assert.equal(response.status, 200, JSON.stringify(response.payload));
      assert.equal(response.payload.workerEnabled, false);
      assert.deepEqual(
        await facts(),
        before,
        'GET must not mutate persisted facts'
      );
      return response.payload;
    }
    async function reset(capacity = 5) {
      await pool.query(
        'TRUNCATE fund_contributions,publication_deliveries,publication_slots,publication_recurrences,sponsor_publication_batches,sponsor_publication_drafts,admin_audit_log CASCADE'
      );
      await pool.query(
        "UPDATE publication_feeds SET paused=FALSE,auto_prepare=TRUE,timezone='UTC',weekdays='{0,1,2,3,4,5,6}',local_time='10:00',horizon_days=3,capacity=$1",
        [capacity]
      );
    }
    async function seed({
      channel = 'facebook',
      format = 'collective_text',
      quantity = 1,
      agreement = true,
      summary = '  Résumé synthétique complet.  '
    } = {}) {
      const id = randomUUID();
      const name = `Atelier synthétique ${id.slice(0, 8)}`;
      await pool.query(
        `INSERT INTO fund_contributions(id,contribution_type,amount_cents,currency,status,public_display_consent,sponsor_review_status,sponsor_company_name,sponsor_public_summary,sponsor_feed_target,sponsor_feed_channels)
         VALUES($1,'sponsorship_interest',50000,'CAD','paid',TRUE,'pending_review',$2,$3,'openg7',$4::jsonb)`,
        [id, name, summary, JSON.stringify([channel])]
      );
      if (agreement)
        await recordFixtureSponsorshipAgreement(pool, id, {
          benefits: [{ channel, target: 'openg7', quantity, format }]
        });
      const obligations = (
        await pool.query(
          'SELECT id,ordinal FROM sponsorship_obligations WHERE contribution_id=$1 ORDER BY ordinal,id',
          [id]
        )
      ).rows;
      return { id, name, channel, format, summary, obligations };
    }
    async function source(
      record,
      status,
      obligationId = record.obligations[0].id,
      batchId = null
    ) {
      return (
        await pool.query(
          `INSERT INTO sponsor_publication_drafts(contribution_id,feed_target,channel,title,body,disclosure_text,obligation_id,status,batch_id)
           VALUES($1,'openg7',$2,'Titre privé','Reconnaissance complète.','Commandite rémunérée.',$3,$4,$5) RETURNING id`,
          [record.id, record.channel, obligationId, status, batchId]
        )
      ).rows[0].id;
    }

    await t.test(
      'the first passage is proposed before any draft exists and preparation uses the same content',
      async () => {
        await reset();
        const record = await seed({ quantity: 2 });
        await seed();
        const state = await get({ sponsorshipId: record.id });
        assert.equal(state.queue.total, 0);
        assert.deepEqual(state.deliveries, []);
        assert.equal(state.preparationCandidates.length, 1);
        const candidate = state.preparationCandidates[0];
        assert.equal(candidate.sponsorshipId, record.id);
        assert.equal(candidate.obligationId, record.obligations[0].id);
        assert.equal(Object.hasOwn(candidate, 'draftId'), false);
        assert.equal(candidate.name, record.name);
        assert.equal(candidate.publicationFormat, 'collective_text');
        assert.equal(candidate.nextOpportunity.action, 'PREPARE_FEED');
        assert.equal(candidate.nextOpportunity.reason, 'AVAILABLE_IN_HORIZON');
        assert.ok(
          Date.parse(candidate.nextOpportunity.proposedAt) > Date.now()
        );
        const expectedContent = {
          name: record.name,
          title: `Merci à ${record.name}`,
          body: record.summary.trim(),
          disclosureText: 'Commandite rémunérée.'
        };
        assert.equal(
          candidate.renderedLength,
          composePublicationRecognition([
            {
              id: candidate.obligationId,
              contributionId: record.id,
              ...expectedContent
            }
          ]).length
        );
        assert.equal(
          Object.hasOwn(await get(), 'preparationCandidates'),
          false,
          'Unfiltered global reads retain their existing persisted scope'
        );
        assert.deepEqual(
          (await get({ sponsorshipId: record.id, deliveryId: randomUUID() }))
            .preparationCandidates,
          undefined
        );
        await service.prepare('openg7:facebook', fixtureModerationActor);
        const draft = (
          await pool.query(
            'SELECT * FROM sponsor_publication_drafts WHERE contribution_id=$1',
            [record.id]
          )
        ).rows[0];
        assert.equal(draft.obligation_id, candidate.obligationId);
        assert.equal(draft.title, expectedContent.title);
        assert.equal(draft.body, expectedContent.body);
        assert.equal(draft.disclosure_text, expectedContent.disclosureText);
        const prepared = await get({ sponsorshipId: record.id });
        assert.deepEqual(prepared.preparationCandidates, []);
        assert.equal(prepared.queue.total, 1);
        assert.equal(prepared.deliveries[0].status, 'draft');
        assert.equal(prepared.deliveries[0].approvedAt, null);
        assert.equal(
          prepared.deliveries[0].scheduledAt,
          candidate.nextOpportunity.proposedAt
        );
      }
    );

    await t.test(
      'payment, consent, review, visibility and recorded terms remain required',
      async () => {
        await reset();
        const modifications = [
          "status='pending'",
          'public_display_consent=FALSE',
          "sponsor_review_status='rejected'",
          "sponsor_feed_status='hidden'"
        ];
        for (const modification of modifications) {
          const record = await seed();
          await pool.query(
            `UPDATE fund_contributions SET ${modification} WHERE id=$1`,
            [record.id]
          );
          assert.deepEqual(
            (await get({ sponsorshipId: record.id })).preparationCandidates,
            []
          );
        }
        const unqualified = await seed({ agreement: false });
        assert.deepEqual(
          (await get({ sponsorshipId: unqualified.id })).preparationCandidates,
          []
        );
        const closed = await seed();
        await pool.query(
          "UPDATE sponsorship_obligations SET state='adjusted' WHERE contribution_id=$1",
          [closed.id]
        );
        assert.deepEqual(
          (await get({ sponsorshipId: closed.id })).preparationCandidates,
          []
        );
      }
    );

    await t.test(
      'existing sources, human refusals and unresolved external outcomes cannot create another candidate',
      async () => {
        await reset();
        for (const status of ['draft', 'rejected']) {
          const record = await seed({ quantity: 2 });
          await source(record, status);
          assert.deepEqual(
            (await get({ sponsorshipId: record.id })).preparationCandidates,
            []
          );
        }
        const legacyRefusal = await seed();
        await source(legacyRefusal, 'rejected', null);
        assert.deepEqual(
          (await get({ sponsorshipId: legacyRefusal.id }))
            .preparationCandidates,
          []
        );
        const uncertain = await seed();
        const batchId = (
          await pool.query(
            "INSERT INTO sponsor_publication_batches(channel,capacity,status) VALUES('facebook',5,'open') RETURNING id"
          )
        ).rows[0].id;
        await source(
          uncertain,
          'cancelled',
          uncertain.obligations[0].id,
          batchId
        );
        await pool.query(
          `INSERT INTO publication_deliveries(feed_id,kind,batch_id,message,scheduled_at,account_id,mode,status)
         VALUES('openg7:facebook','sponsorship',$1,'Résultat externe inconnu.',NOW()+interval '1 day','mock-openg7:facebook','mock','uncertain')`,
          [batchId]
        );
        assert.deepEqual(
          (await get({ sponsorshipId: uncertain.id })).preparationCandidates,
          []
        );
      }
    );

    await t.test(
      'current content, moderation, pause and collection prerequisites suppress unchecked dates',
      async () => {
        await reset();
        const tooLong = await seed({ summary: 'x'.repeat(3000) });
        const invalid = (await get({ sponsorshipId: tooLong.id }))
          .preparationCandidates[0];
        assert.equal(invalid.reason, 'INDIVIDUAL_TEXT_TOO_LONG');
        assert.equal(invalid.status, 'needs_correction');
        assert.equal(invalid.nextOpportunity.proposedAt, null);
        const restricted = await seed();
        const subject = { type: 'sponsorship', id: restricted.id };
        const decision = await fixtureModerationDecision(pool, subject, 'N1');
        await withPostgresTransaction(pool, (db) =>
          recordModerationDecision(db, {
            subject,
            decision,
            actor: fixtureModerationActor
          })
        );
        const moderation = (await get({ sponsorshipId: restricted.id }))
          .preparationCandidates[0];
        assert.equal(
          moderation.nextOpportunity.reason,
          'MODERATION_REVIEW_REQUIRED'
        );
        assert.equal(moderation.nextOpportunity.proposedAt, null);
        const paused = await seed();
        await pool.query(
          "UPDATE publication_feeds SET paused=TRUE WHERE id='openg7:facebook'"
        );
        const pause = (await get({ sponsorshipId: paused.id }))
          .preparationCandidates[0];
        assert.equal(pause.nextOpportunity.reason, 'FEED_PAUSED');
        assert.equal(pause.nextOpportunity.proposedAt, null);
        const collection = await seed({
          channel: 'linkedin',
          format: 'image_collection'
        });
        await pool.query(
          "UPDATE publication_feeds SET capacity=1 WHERE id='openg7:linkedin'"
        );
        const insufficient = (await get({ sponsorshipId: collection.id }))
          .preparationCandidates[0];
        assert.equal(insufficient.publicationFormat, 'image_collection');
        assert.equal(
          insufficient.nextOpportunity.reason,
          'CAPACITY_INSUFFICIENT'
        );
        assert.equal(insufficient.nextOpportunity.proposedAt, null);
        await pool.query(
          "UPDATE publication_feeds SET capacity=5 WHERE id='openg7:linkedin'"
        );
        const singleton = (await get({ sponsorshipId: collection.id }))
          .preparationCandidates[0];
        assert.equal(
          singleton.nextOpportunity.reason,
          'GROUP_PARTICIPANTS_REQUIRED'
        );
        assert.equal(singleton.nextOpportunity.proposedAt, null);
      }
    );
  }
);
