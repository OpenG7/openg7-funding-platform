import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';

import { PublicationAutomationService } from '../../dist/apps/funding-api/src/publication-automation/service.js';
import { sources } from '../../dist/apps/funding-api/src/publication-automation/sources.js';
import { resolvePublicationVisual } from '../../dist/apps/funding-api/src/publication-automation/visuals.js';
import { preparationQueue } from '../../dist/apps/funding-api/src/publication-automation/preparation-queue.js';
import { createPreparationOpportunityPlanner } from '../../dist/apps/funding-api/src/publication-automation/preparation-opportunity.js';
import { preparationCandidateOpportunities } from '../../dist/apps/funding-api/src/publication-automation/preparation-candidate-opportunities.js';
import { createAdminPublicationDraftOnConnection } from '../../dist/apps/funding-api/src/fund-publication-drafts.repository.js';
import { AdminAutomaticRunsService } from '../../dist/apps/funding-api/src/admin-automatic-runs.service.js';
import {
  quoteSponsorshipOffer,
  recordCheckoutSponsorshipOffer
} from '../../dist/apps/funding-api/src/sponsorship-commitments/offers.js';
import {
  createSponsorshipObligations,
  loadSponsorshipCommitment
} from '../../dist/apps/funding-api/src/sponsorship-commitments/repository.js';
import {
  assertPublicationObligations,
  capturePublicationObligations,
  recordSocialFulfilment
} from '../../dist/apps/funding-api/src/sponsorship-fulfilment.repository.js';
import { withPostgresTransaction } from '../../dist/apps/funding-api/src/postgres-transaction.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import {
  approveFixtureSubject,
  fixtureModerationActor as actor
} from './support/moderation-fixture.mjs';
import { recordFixtureSponsorshipAgreement } from './support/sponsorship-agreement-fixture.mjs';

const now = new Date('2099-01-01T09:00:00Z');

test(
  'v4 plans and fulfils individual and collective obligations independently',
  { timeout: 120000 },
  async (t) => {
    const database = await startDisposablePostgres();
    t.after(database.stop);
    const pool = database.pool;
    const env = { SOCIAL_PUBLICATION_MODE: 'live' };
    for (const target of ['OPENG7', 'OPENG20'])
      for (const channel of ['FACEBOOK', 'LINKEDIN']) {
        env[`SOCIAL_PUBLICATION_${target}_${channel}_ACCOUNT_ID`] =
          channel === 'FACEBOOK' ? '123' : 'urn:li:organization:123';
        env[`SOCIAL_PUBLICATION_${target}_${channel}_ACCESS_TOKEN`] =
          'synthetic-dual-publication-test';
      }
    const storage = {
      readPrivateObject() {
        throw new Error('Text promises must not require an image.');
      }
    };
    const service = new PublicationAutomationService(pool, storage, env);
    t.mock.method(globalThis, 'fetch', () => {
      throw new Error('Planning and evidence fixtures must never send.');
    });

    async function reset() {
      await pool.query(
        'TRUNCATE fund_contributions,publication_deliveries,publication_slots,publication_recurrences,sponsor_publication_batches,sponsor_publication_drafts,admin_audit_log CASCADE'
      );
      await pool.query(
        "UPDATE publication_feeds SET paused=FALSE,auto_prepare=TRUE,timezone='UTC',weekdays='{0,1,2,3,4,5,6}',local_time='10:00',horizon_days=7,capacity=5,last_prepared_at=NULL"
      );
    }

    async function seed(amountMinor = 1500, review = 'approved') {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO fund_contributions(id,contribution_type,amount_cents,currency,status,paid_at,public_display_consent,sponsor_review_status,sponsor_company_name,sponsor_public_summary)
         VALUES($1,'sponsorship_interest',$2,'CAD','paid',NOW(),TRUE,$3,$4,'Complete synthetic presentation.')`,
        [id, amountMinor, review, `Synthetic partner ${id.slice(0, 8)}`]
      );
      await withPostgresTransaction(pool, async (db) => {
        await db.query(
          "INSERT INTO sponsorship_commitments(contribution_id,provenance,state,qualification_reason) VALUES($1,'historical_unverified','needs_confirmation','synthetic_agreement')",
          [id]
        );
        // Explicit accepted-quote setup; payment activation and Checkout replay
        // are exercised separately in sponsorship-v4.integration.mjs.
        const quote = quoteSponsorshipOffer(amountMinor, 'CAD');
        const operationId = randomUUID();
        await db.query(
          `INSERT INTO checkout_operations(id,key_hash,request_hash,state,params,contribution_input)
           VALUES($1,$2,$2,'prepared','{}','{}')`,
          [operationId, createHash('sha256').update(operationId).digest('hex')]
        );
        await recordCheckoutSponsorshipOffer(db, operationId, {
          publicReference: id,
          quote
        });
        const commitment = (
          await db.query(
            `UPDATE sponsorship_commitments SET offer_id=(SELECT id FROM sponsorship_offers WHERE checkout_operation_id=$2),
              provenance='accepted_offer',state='active',qualification_reason=NULL,activated_at=NOW()
             WHERE contribution_id=$1 RETURNING id`,
            [id, operationId]
          )
        ).rows[0];
        await createSponsorshipObligations(db, commitment.id, id, quote);
      });
      if (review === 'approved')
        await approveFixtureSubject(pool, { type: 'sponsorship', id });
      return id;
    }

    const jobs = async () =>
      (
        await pool.query(
          "SELECT * FROM publication_deliveries WHERE status<>'cancelled' ORDER BY scheduled_at,id"
        )
      ).rows;
    const obligations = async (id) =>
      (await loadSponsorshipCommitment(pool, id)).obligations;
    async function reserve(row) {
      row.obligation_snapshot = await withPostgresTransaction(pool, (db) =>
        capturePublicationObligations(db, row)
      );
      await pool.query(
        'UPDATE publication_deliveries SET obligation_snapshot=$2::jsonb WHERE id=$1',
        [row.id, JSON.stringify(row.obligation_snapshot)]
      );
      return row;
    }
    const evidence = (row, postId) =>
      withPostgresTransaction(pool, (db) =>
        recordSocialFulfilment(
          db,
          row,
          postId,
          `https://www.facebook.com/${postId}`,
          actor,
          'provider_acknowledged'
        )
      );

    await t.test(
      'approval gates new planning and a waiting collective does not delay its individual text',
      async () => {
        await reset();
        const id = await seed(1000, 'pending_review');
        await service.prepare('openg7:facebook', actor, now);
        assert.equal((await jobs()).length, 0);
        assert.equal(
          Number(
            (
              await pool.query(
                'SELECT count(*) FROM sponsor_publication_drafts WHERE contribution_id=$1',
                [id]
              )
            ).rows[0].count
          ),
          0
        );
        await pool.query(
          "UPDATE fund_contributions SET sponsor_review_status='approved',updated_at=NOW() WHERE id=$1",
          [id]
        );
        await approveFixtureSubject(pool, { type: 'sponsorship', id });
        await service.prepare('openg7:facebook', actor, now);
        const prepared = await jobs();
        assert.equal(prepared.length, 1);
        assert.equal(prepared[0].publication_format, 'individual_text');
        assert.equal(prepared[0].source_snapshot.length, 1);
        assert.equal(prepared[0].status, 'draft');
        assert.equal(prepared[0].approved_at, null);
        assert.equal(prepared[0].media_id, null);
        assert.equal(prepared[0].attempts, 0);
        const visual = await resolvePublicationVisual(
          pool,
          storage,
          prepared[0],
          false
        );
        assert.equal(visual.snapshot, null);
        const drafts = (
          await pool.query(
            'SELECT obligation_id,batch_id FROM sponsor_publication_drafts WHERE contribution_id=$1',
            [id]
          )
        ).rows;
        assert.equal(drafts.length, 2);
        assert.equal(
          new Set(drafts.map((draft) => draft.obligation_id)).size,
          2
        );
        assert.equal(
          drafts.filter((draft) => draft.batch_id === null).length,
          1
        );
        const queue = await withPostgresTransaction(
          pool,
          async (db) =>
            preparationQueue(
              db,
              await service.feeds(db),
              { sponsorshipId: id },
              now
            ),
          { readOnlySnapshot: true }
        );
        const collective = queue.entries.find(
          (entry) => entry.publicationFormat === 'collective_text'
        );
        assert.equal(collective.minimumParticipants, 2);
        assert.equal(
          collective.nextOpportunity.reason,
          'GROUP_PARTICIPANTS_REQUIRED'
        );
        assert.equal(collective.nextOpportunity.action, 'PREPARE_FEED');
      }
    );

    await t.test(
      'dual channels retain separate jobs, reservations and proofs under repeated preparation',
      async () => {
        await reset();
        const first = await seed();
        const second = await seed();
        const forecasts = await withPostgresTransaction(
          pool,
          async (db) => {
            const feeds = await service.feeds(db);
            return preparationCandidateOpportunities(
              db,
              feeds,
              first,
              await createPreparationOpportunityPlanner(db, feeds, now)
            );
          },
          { readOnlySnapshot: true }
        );
        const collectiveForecast = forecasts.find(
          (candidate) =>
            candidate.feedId === 'openg7:facebook' &&
            candidate.publicationFormat === 'collective_text'
        );
        assert.equal(
          collectiveForecast.nextOpportunity.reason,
          'GROUP_PARTICIPANTS_REQUIRED'
        );
        assert.equal(collectiveForecast.nextOpportunity.action, 'PREPARE_FEED');
        assert.equal(collectiveForecast.nextOpportunity.proposedAt, null);
        for (const feed of ['openg7:facebook', 'openg7:linkedin'])
          await Promise.all([
            service.prepare(feed, actor, now),
            service.prepare(feed, actor, now)
          ]);
        const prepared = await jobs();
        assert.equal(prepared.length, 6);
        assert(
          prepared.every((row) => row.status === 'draft' && !row.approved_at)
        );
        for (const feed of ['openg7:facebook', 'openg7:linkedin']) {
          const channel = prepared.filter((row) => row.feed_id === feed);
          assert.equal(channel.length, 3);
          assert.equal(
            channel.filter(
              (row) => row.publication_format === 'individual_text'
            ).length,
            2
          );
          const collective = channel.find(
            (row) => row.publication_format === 'collective_text'
          );
          assert.equal(collective.source_snapshot.length, 2);
          assert.equal(
            new Set(
              collective.source_snapshot.map((source) => source.contribution_id)
            ).size,
            2
          );
          assert.equal(
            new Set(channel.map((row) => row.scheduled_at.toISOString())).size,
            3
          );
        }
        const individual = prepared.find(
          (row) =>
            row.feed_id === 'openg7:facebook' &&
            row.publication_format === 'individual_text' &&
            row.source_snapshot[0].contribution_id === first
        );
        const collective = prepared.find(
          (row) =>
            row.feed_id === 'openg7:facebook' &&
            row.publication_format === 'collective_text'
        );
        await reserve(individual);
        assert.equal(individual.obligation_snapshot.length, 1);
        assert.equal(
          individual.obligation_snapshot[0].format,
          'individual_text'
        );
        assert.equal(
          Object.hasOwn(
            individual.obligation_snapshot[0],
            'minimumParticipants'
          ),
          false
        );
        await evidence(individual, '123_1001');
        let current = await obligations(first);
        assert.equal(
          current.find(
            (obligation) => obligation.benefitId === 'facebook_individual'
          ).state,
          'fulfilled'
        );
        assert.equal(
          current.find(
            (obligation) => obligation.benefitId === 'facebook_batch'
          ).state,
          'pending'
        );

        await assert.rejects(
          withPostgresTransaction(pool, (db) =>
            capturePublicationObligations(db, {
              ...collective,
              source_snapshot: [
                collective.source_snapshot.find(
                  (source) => source.contribution_id === first
                )
              ]
            })
          ),
          { code: 'COLLECTIVE_REQUIRES_MULTIPLE_SPONSORS' }
        );
        await reserve(collective);
        assert(
          collective.obligation_snapshot.every(
            (obligation) => obligation.minimumParticipants === 2
          )
        );
        await assert.rejects(
          withPostgresTransaction(pool, (db) =>
            assertPublicationObligations(db, {
              ...collective,
              obligation_snapshot: collective.obligation_snapshot.map(
                (obligation) => ({ ...obligation, minimumParticipants: 1 })
              )
            })
          ),
          { code: 'SOURCE_COMMITMENT_CHANGED' }
        );
        await assert.rejects(evidence(collective, '123_1001'), /duplicate key/);
        await evidence(collective, '123_1002');
        current = await obligations(first);
        assert.equal(
          current.filter(
            (obligation) =>
              obligation.channel === 'facebook' &&
              obligation.state === 'fulfilled'
          ).length,
          2
        );
        assert.equal(
          current.filter(
            (obligation) =>
              obligation.channel === 'linkedin' &&
              obligation.state === 'fulfilled'
          ).length,
          0
        );
        assert.equal(
          (await obligations(second)).find(
            (obligation) => obligation.benefitId === 'facebook_individual'
          ).state,
          'pending'
        );

        const linkedinIndividual = prepared.find(
          (row) =>
            row.feed_id === 'openg7:linkedin' &&
            row.publication_format === 'individual_text'
        );
        await assert.rejects(
          resolvePublicationVisual(
            pool,
            storage,
            {
              ...linkedinIndividual,
              source_snapshot: prepared.find(
                (row) =>
                  row.feed_id === 'openg7:linkedin' &&
                  row.publication_format === 'collective_text'
              ).source_snapshot
            },
            false
          ),
          { code: 'INDIVIDUAL_REQUIRES_ONE_SPONSOR' }
        );
      }
    );

    await t.test(
      'an explicitly selected second v4 right can own a source before the first right is fulfilled',
      async () => {
        await reset();
        const id = await seed();
        const passages = (
          await pool.query(
            "SELECT id FROM sponsorship_obligations WHERE contribution_id=$1 AND channel='facebook' ORDER BY ordinal,id",
            [id]
          )
        ).rows;
        assert.equal(passages.length, 2);
        const prepareSelected = (obligationId, contributionId = id) =>
          withPostgresTransaction(pool, (db) =>
            createAdminPublicationDraftOnConnection(
              db,
              { contributionId, feedTarget: 'openg7', channel: 'facebook' },
              actor,
              {
                requestId: randomUUID(),
                runId: randomUUID(),
                expectedObligationId: obligationId,
                preserveExistingDeliveries: true
              }
            )
          );
        const selected = await prepareSelected(passages[1].id);
        assert.equal(selected.updated, true);
        assert.equal(selected.created, true);
        const bound = (
          await pool.query(
            'SELECT obligation_id FROM sponsor_publication_drafts WHERE id=$1',
            [selected.draft.id]
          )
        ).rows[0];
        assert.equal(bound.obligation_id, passages[1].id);
        const replay = await prepareSelected(passages[1].id);
        assert.equal(replay.updated, true);
        assert.equal(replay.created, false);
        assert.equal(replay.draft.id, selected.draft.id);
        assert.equal((await prepareSelected(passages[0].id)).created, true);
        const another = await seed();
        assert.equal(
          (await prepareSelected(passages[1].id, another)).updated,
          false
        );
        assert.equal((await jobs()).length, 0);
        assert(
          (await obligations(id)).every(
            (obligation) => obligation.state === 'pending'
          )
        );
        assert.equal(
          Number(
            (
              await pool.query(
                'SELECT count(*) FROM sponsor_publication_drafts'
              )
            ).rows[0].count
          ),
          2
        );
      }
    );

    await t.test(
      'the private automatic runner prepares each distinct v4 benefit on a channel',
      async () => {
        await reset();
        const id = await seed();
        const runner = new AdminAutomaticRunsService(pool);
        let state = await runner.start({ requestId: randomUUID() }, actor);
        while (state.run.status === 'running')
          state = await runner.advance(
            {
              runId: state.run.id,
              expectedVersion: state.run.version,
              requestId: randomUUID()
            },
            actor
          );
        const prepared = (
          await pool.query(
            `SELECT o.benefit_id FROM sponsor_publication_drafts d
         JOIN sponsorship_obligations o ON o.id=d.obligation_id
         WHERE d.contribution_id=$1 ORDER BY o.benefit_id`,
            [id]
          )
        ).rows;
        assert.deepEqual(
          prepared.map((draft) => draft.benefit_id),
          [
            'facebook_batch',
            'facebook_individual',
            'linkedin_batch',
            'linkedin_individual'
          ]
        );
        assert.equal((await jobs()).length, 0);
        assert.equal(state.run.globalBalanced, false);
      }
    );

    await t.test(
      'historical singleton collectives retain their original scope',
      async () => {
        await reset();
        const id = randomUUID();
        await pool.query(
          `INSERT INTO fund_contributions(id,contribution_type,amount_cents,currency,status,public_display_consent,sponsor_review_status,sponsor_company_name)
         VALUES($1,'sponsorship_interest',50000,'CAD','paid',TRUE,'pending_review','Historical synthetic partner')`,
          [id]
        );
        await recordFixtureSponsorshipAgreement(pool, id, {
          channel: 'facebook'
        });
        await service.prepare('openg7:facebook', actor, now);
        const prepared = await jobs();
        assert.equal(prepared.length, 1);
        assert.equal(prepared[0].publication_format, 'collective_text');
        const members = await withPostgresTransaction(pool, (db) =>
          sources(db, prepared[0].batch_id, 'openg7:facebook', true)
        );
        assert.equal(members.length, 1);
        assert.equal(Object.hasOwn(members[0], 'minimumParticipants'), false);
        assert.equal(
          Object.hasOwn((await obligations(id))[0], 'minimumParticipants'),
          false
        );
      }
    );
  }
);
