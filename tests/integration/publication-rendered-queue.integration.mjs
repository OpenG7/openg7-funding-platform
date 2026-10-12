import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import {
  composePublicationRecognition,
  missingPublicationRecognitionSources,
  PUBLICATION_MESSAGE_MAX_CODE_UNITS
} from '../../dist/packages/funding-core/src/index.js';
import { PublicationAutomationService } from '../../dist/apps/funding-api/src/publication-automation/service.js';
import { prepare } from '../../dist/apps/funding-api/src/publication-automation/planning.js';
import { PublicationAutomationError } from '../../dist/apps/funding-api/src/publication-automation/policy.js';
import { repairSources } from '../../dist/apps/funding-api/src/publication-automation/sources.js';
import { recordModerationDecision } from '../../dist/apps/funding-api/src/moderation/repository.js';
import { withPostgresTransaction } from '../../dist/apps/funding-api/src/postgres-transaction.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { recordFixtureSponsorshipAgreement } from './support/sponsorship-agreement-fixture.mjs';
import {
  approveFixtureSubject,
  fixtureModerationActor,
  fixtureModerationDecision
} from './support/moderation-fixture.mjs';

test(
  'rendered preparation queue with disposable PostgreSQL',
  { timeout: 240000 },
  async (t) => {
    const database = await startDisposablePostgres();
    t.after(database.stop);
    const pool = database.pool;
    const feedId = 'openg7:facebook';
    const env = { SOCIAL_PUBLICATION_MODE: 'mock' };
    const service = new PublicationAutomationService(pool, {}, env);
    const subjectFor = (type, record) => ({
      type,
      id: type === 'sponsorship' ? record.id : record.draftId
    });
    async function restrict(subject, level) {
      const decision = await fixtureModerationDecision(pool, subject, level);
      return withPostgresTransaction(pool, (db) =>
        recordModerationDecision(db, {
          subject,
          decision,
          actor: fixtureModerationActor
        })
      );
    }
    const now = new Date();
    const wall = new Date(now.getTime() + 3600000);
    const localTime = wall.toISOString().slice(11, 16);
    const rollover = now.getUTCDate() === wall.getUTCDate() ? 0 : 1;
    const diagnostics = async () =>
      (
        await pool.query(
          "SELECT entity_id,metadata FROM admin_audit_log WHERE action='publication_automation.source_render_blocked' ORDER BY created_at,id"
        )
      ).rows;
    const assignments = async () =>
      (
        await pool.query(
          'SELECT id,contribution_id,batch_id,slot_id,scheduled_at,created_at FROM sponsor_publication_drafts ORDER BY created_at,id'
        )
      ).rows;
    const jobs = async () =>
      (
        await pool.query(
          'SELECT * FROM publication_deliveries ORDER BY scheduled_at,id'
        )
      ).rows;
    async function reset(slots = 3, capacity = 10) {
      await pool.query(
        'TRUNCATE fund_contributions,publication_deliveries,publication_recurrences,social_publication_jobs,sponsor_publication_drafts,sponsor_publication_batches,publication_slots,admin_audit_log CASCADE'
      );
      await pool.query(
        "UPDATE publication_feeds SET paused=TRUE,auto_prepare=FALSE,timezone='UTC',weekdays='{0,1,2,3,4,5,6}',local_time=$1,capacity=$2,horizon_days=$3,updated_at=NOW()",
        [localTime, capacity, slots + rollover]
      );
    }
    async function seed(specifications) {
      const records = specifications.map((specification, index) => ({
        id: randomUUID(),
        draftId: randomUUID(),
        name: `Atelier synthétique ${index}`,
        title: 'Titre éditorial',
        body: 'Corps complet de reconnaissance.',
        disclosureText: 'Commandite rémunérée.',
        createdAt: new Date(Date.UTC(2020, 0, 1, 0, 0, index)).toISOString(),
        ...specification
      }));
      await pool.query(
        `INSERT INTO fund_contributions(id,contribution_type,amount_cents,currency,status,public_display_consent,sponsor_review_status,sponsor_company_name,sponsor_feed_target,sponsor_feed_channels)
       SELECT id,'sponsorship_interest',25000,'CAD','paid',TRUE,'pending_review',name,'openg7','["facebook"]'::jsonb
       FROM jsonb_to_recordset($1::jsonb) AS input(id uuid,name text)`,
        [JSON.stringify(records)]
      );
      for (const record of records)
        await recordFixtureSponsorshipAgreement(pool, record.id, {
          channel: 'facebook'
        });
      await pool.query(
        `INSERT INTO sponsor_publication_drafts(id,contribution_id,feed_target,channel,title,body,disclosure_text,created_at)
       SELECT "draftId",id,'openg7','facebook',title,body,"disclosureText","createdAt"
       FROM jsonb_to_recordset($1::jsonb) AS input(id uuid,"draftId" uuid,title text,body text,"disclosureText" text,"createdAt" timestamptz)`,
        [JSON.stringify(records)]
      );
      return records;
    }
    const recognition = (record) => ({
      ...record,
      id: record.draftId,
      contributionId: record.id
    });
    async function assertComplete(deliveries, records) {
      for (const delivery of deliveries) {
        const members = (await assignments()).filter(
          (draft) => draft.batch_id === delivery.batch_id
        );
        const ordered = members
          .map((draft) => records.find((record) => record.draftId === draft.id))
          .sort((a, b) => a.draftId.localeCompare(b.draftId));
        assert.equal(
          delivery.message,
          composePublicationRecognition(ordered.map(recognition))
        );
        assert.ok(
          delivery.message.length <= PUBLICATION_MESSAGE_MAX_CODE_UNITS
        );
        assert.equal(delivery.status, 'draft');
        assert.equal(delivery.approved_at, null);
        assert.equal(delivery.published_at, null);
      }
    }

    await t.test(
      'eight complete blocks fill three recurrences as 3/3/2 and replay preserves members and dates',
      async () => {
        await reset();
        const records = await seed(
          Array.from({ length: 8 }, () => ({ body: 'x'.repeat(830) }))
        );
        await service.prepare(feedId, 'planner', now);
        const deliveries = await jobs();
        assert.equal(deliveries.length, 3);
        const before = await assignments();
        assert.deepEqual(
          deliveries.map(
            (delivery) =>
              before.filter((draft) => draft.batch_id === delivery.batch_id)
                .length
          ),
          [3, 3, 2]
        );
        await assertComplete(deliveries, records);
        await service.prepare(feedId, 'replay', now);
        assert.deepEqual(await assignments(), before);
        assert.deepEqual(await jobs(), deliveries);
        assert.deepEqual(await diagnostics(), []);
        const state = await service.state();
        assert.deepEqual(state.queue.summary, {
          retained: 8,
          deferred: 0,
          needsCorrection: 0
        });
        assert.equal(state.queue.total, 8);
      }
    );

    await t.test(
      'authoritative identity line counts, oversized individual remains unassigned and following valid source advances',
      async () => {
        await reset(1);
        const [oversized, valid] = await seed([
          {
            name: 'Identité autoritaire ' + 'n'.repeat(80),
            title: 'Titre bref',
            body: 'x'.repeat(2820),
            disclosureText: 'Mention.'
          },
          {}
        ]);
        assert.ok(
          [oversized.title, oversized.body, oversized.disclosureText].join(
            '\n\n'
          ).length < 2900
        );
        assert.ok(
          composePublicationRecognition([recognition(oversized)]).length > 2900
        );
        await service.prepare(feedId, 'planner', now);
        const rows = await assignments();
        assert.equal(
          rows.find((row) => row.id === oversized.draftId).batch_id,
          null
        );
        assert.equal(
          rows
            .find((row) => row.id === oversized.draftId)
            .created_at.toISOString(),
          oversized.createdAt
        );
        assert.ok(rows.find((row) => row.id === valid.draftId).batch_id);
        await assertComplete(await jobs(), [oversized, valid]);
        const cached = await diagnostics();
        assert.equal(cached.length, 1);
        assert.equal(cached[0].metadata.reason, 'SOURCE_TEXT_TOO_LONG');
        assert.deepEqual(Object.keys(cached[0].metadata).sort(), [
          'budget',
          'fingerprint',
          'policyVersion',
          'reason',
          'renderedLength'
        ]);
        const state = await service.state();
        assert.equal(
          state.queue.entries.find(
            (entry) => entry.draftId === oversized.draftId
          ).reason,
          'INDIVIDUAL_TEXT_TOO_LONG'
        );
        assert.deepEqual(state.queue.summary, {
          retained: 1,
          deferred: 0,
          needsCorrection: 1
        });
      }
    );

    await t.test(
      'a valid source that does not fit the current batch keeps its FIFO place before a smaller follower',
      async () => {
        await reset(2);
        const records = await seed([
          { body: 'a'.repeat(1700) },
          { body: 'b'.repeat(1500) },
          { body: 'Petit suivant.' }
        ]);
        await service.prepare(feedId, 'planner', now);
        const rows = await assignments();
        const deliveries = await jobs();
        assert.equal(deliveries.length, 2);
        assert.equal(rows[0].batch_id, deliveries[0].batch_id);
        assert.equal(rows[1].batch_id, deliveries[1].batch_id);
        assert.equal(rows[2].batch_id, deliveries[1].batch_id);
        assert.deepEqual(await diagnostics(), []);
        await assertComplete(deliveries, records);
      }
    );

    await t.test(
      '400 impossible sources are cached before the scan limit so source 401 progresses, with complete paginated counters',
      async () => {
        await reset(1, 1);
        const records = await seed([
          ...Array.from({ length: 400 }, () => ({ body: 'x'.repeat(3000) })),
          {}
        ]);
        await pool.query(
          `UPDATE sponsor_publication_drafts draft
      SET created_at='2020-01-01T00:00:00.123000Z'::timestamptz+(input.ordinality-1)*interval '1 microsecond'
      FROM unnest($1::uuid[]) WITH ORDINALITY input(id,ordinality) WHERE draft.id=input.id`,
          [records.map((record) => record.draftId)]
        );
        for (const record of records)
          record.createdAt = '2020-01-01T00:00:00.123Z';
        await service.prepare(feedId, 'planner', now);
        assert.equal((await diagnostics()).length, 400);
        assert.equal((await jobs()).length, 0);
        await service.prepare(feedId, 'next-pass', now);
        assert.equal((await diagnostics()).length, 400);
        assert.equal((await jobs()).length, 1);
        const rows = await assignments();
        assert.ok(rows.at(-1).batch_id);
        assert.equal(rows.filter((row) => row.batch_id).length, 1);
        const pages = [];
        for (const offset of [0, 200, 400]) {
          const state = await service.state(undefined, { queueOffset: offset });
          assert.equal(state.queue.total, 401);
          assert.deepEqual(state.queue.summary, {
            retained: 1,
            deferred: 0,
            needsCorrection: 400
          });
          assert.equal(state.queue.offset, offset);
          assert.equal(state.queue.limit, 200);
          assert.equal(state.queue.hasMore, offset < 400);
          pages.push(...state.queue.entries);
        }
        assert.equal(pages.length, 401);
        assert.equal(new Set(pages.map((entry) => entry.draftId)).size, 401);
        const dossier = await service.state(undefined, {
          sponsorshipId: records.at(-1).id
        });
        assert.equal(dossier.queue.scope, 'filtered');
        assert.equal(dossier.queue.total, 1);
        assert.equal(dossier.queue.entries[0].draftId, records.at(-1).draftId);
        await service.prepare(feedId, 'replay', now);
        assert.equal((await diagnostics()).length, 400);
        assert.equal((await jobs()).length, 1);
        await pool.query(
          'UPDATE sponsor_publication_drafts SET body=$2,updated_at=NOW() WHERE id=$1',
          [records[0].draftId, 'Texte corrigé.']
        );
        await pool.query(
          'UPDATE publication_feeds SET horizon_days=$2,updated_at=NOW() WHERE id=$1',
          [feedId, 2 + rollover]
        );
        await service.prepare(feedId, 'corrected', now);
        const corrected = (await assignments()).find(
          (row) => row.id === records[0].draftId
        );
        assert.ok(corrected.batch_id);
        assert.equal(corrected.created_at.toISOString(), records[0].createdAt);
        assert.equal((await diagnostics()).length, 400);
        assert.equal((await jobs()).length, 2);
      }
    );

    await t.test(
      'no-slot reason requires actual preparation; manual reservations and uncertain deliveries stay protected',
      async () => {
        await reset(1, 1);
        const records = await seed([{}, {}, {}]);
        const before = await service.state();
        assert.ok(
          before.queue.entries.every(
            (entry) => entry.reason === 'AWAITING_PREPARATION'
          )
        );
        const slot = (
          await pool.query(
            "INSERT INTO publication_slots(feed_target,channel,starts_at,timezone,capacity,status) VALUES('openg7','facebook',$1,'UTC',1,'open') RETURNING id",
            [new Date(now.getTime() + 86400000)]
          )
        ).rows[0].id;
        await pool.query(
          'UPDATE sponsor_publication_drafts SET slot_id=$2,scheduled_at=$3 WHERE id=$1',
          [records[2].draftId, slot, new Date(now.getTime() + 86400000)]
        );
        await service.prepare(feedId, 'planner', now);
        let state = await service.state();
        assert.equal(
          state.queue.entries.find(
            (entry) => entry.draftId === records[1].draftId
          ).reason,
          'NO_SLOT_IN_HORIZON'
        );
        assert.equal(
          state.queue.entries.find(
            (entry) => entry.draftId === records[2].draftId
          ).reason,
          'MANUAL_RESERVATION'
        );
        const delivery = (await jobs())[0];
        await pool.query(
          "UPDATE publication_deliveries SET status='uncertain' WHERE id=$1",
          [delivery.id]
        );
        state = await service.state();
        assert.ok(
          state.deliveries.some(
            (row) => row.id === delivery.id && row.status === 'uncertain'
          )
        );
        assert.ok(
          !state.queue.entries.some((entry) => entry.deliveryId === delivery.id)
        );
        assert.equal((await diagnostics()).length, 0);
      }
    );

    await t.test(
      'a changed member blocks retained claims for the entire collective draft, including unknown review',
      async () => {
        for (const mutation of [
          'public_display_consent=FALSE',
          "status='refunded'",
          'sponsor_review_status=NULL'
        ]) {
          await reset(1);
          const records = await seed([{}, {}]);
          await service.prepare(feedId, 'planner', now);
          await pool.query(
            `UPDATE fund_contributions SET ${mutation},updated_at=NOW() WHERE id=$1`,
            [records[1].id]
          );
          const state = await service.state(undefined, {
            sponsorshipId: records[0].id
          });
          assert.equal(state.queue.total, 1);
          assert.equal(state.queue.entries[0].status, 'deferred');
          assert.equal(state.queue.entries[0].reason, 'EXISTING_BATCH_INVALID');
          assert.equal((await jobs())[0].status, 'draft');
        }
      }
    );

    await t.test(
      'a manually scheduled source without association preserves its date and remains reserved',
      async () => {
        await reset(1);
        const records = await seed([{}, {}]);
        const scheduledAt = new Date(now.getTime() + 2 * 86400000);
        await pool.query(
          "UPDATE sponsor_publication_drafts SET status='scheduled',scheduled_at=$2 WHERE id=$1",
          [records[0].draftId, scheduledAt]
        );
        await service.prepare(feedId, 'planner', now);
        const reserved = (await assignments()).find(
          (row) => row.id === records[0].draftId
        );
        assert.equal(reserved.batch_id, null);
        assert.equal(reserved.slot_id, null);
        assert.equal(
          reserved.scheduled_at.toISOString(),
          scheduledAt.toISOString()
        );
        assert.ok(
          (await assignments()).find((row) => row.id === records[1].draftId)
            .batch_id
        );
        const entry = (await service.state()).queue.entries.find(
          (row) => row.draftId === records[0].draftId
        );
        assert.equal(entry.status, 'deferred');
        assert.equal(entry.reason, 'MANUAL_RESERVATION');
        assert.equal(entry.scheduledAt, scheduledAt.toISOString());
        assert.equal((await diagnostics()).length, 0);
      }
    );

    await t.test(
      'repair of an excluded member cannot truncate or remove an invalid retained base',
      async () => {
        await reset(1);
        const records = await seed([{}, {}]);
        await service.prepare(feedId, 'planner', now);
        const delivery = (await jobs())[0];
        await pool.query(
          'UPDATE sponsor_publication_drafts SET body=$2 WHERE id=$1',
          [records[0].draftId, 'x'.repeat(3000)]
        );
        await pool.query(
          'UPDATE fund_contributions SET public_display_consent=FALSE WHERE id=$1',
          [records[1].id]
        );
        const before = await assignments();
        assert.equal(await service.repairPreview(delivery.id), null);
        await assert.rejects(
          service.repair(delivery.id, 'irrelevant', 'reviewer'),
          { code: 'VERSION_CONFLICT' }
        );
        assert.deepEqual(await assignments(), before);
        assert.deepEqual(await jobs(), [delivery]);
        assert.equal((await diagnostics()).length, 0);
      }
    );

    await t.test(
      'repair replaces an excluded source without taking a manually scheduled candidate',
      async () => {
        await reset(1, 2);
        const records = await seed([{}, {}, {}, {}]);
        const scheduledAt = new Date(now.getTime() + 2 * 86400000);
        await pool.query(
          "UPDATE sponsor_publication_drafts SET status='scheduled',scheduled_at=$2 WHERE id=$1",
          [records[2].draftId, scheduledAt]
        );
        await service.prepare(feedId, 'planner', now);
        const delivery = (await jobs())[0];
        await pool.query(
          'UPDATE fund_contributions SET public_display_consent=FALSE WHERE id=$1',
          [records[1].id]
        );
        const reservedBefore = (await assignments()).find(
          (row) => row.id === records[2].draftId
        );
        const proposal = await service.repairPreview(delivery.id);
        assert.deepEqual(proposal.added, [records[3].id]);
        assert.ok(
          !proposal.sponsors.some((sponsor) => sponsor.id === records[2].id)
        );
        await service.repair(delivery.id, proposal.version, 'reviewer');
        assert.deepEqual(
          (await assignments()).find((row) => row.id === records[2].draftId),
          reservedBefore
        );
        const updated = (await jobs())[0];
        assert.equal(updated.status, 'draft');
        assert.equal(updated.approved_at, null);
        assert.equal(
          updated.scheduled_at.toISOString(),
          delivery.scheduled_at.toISOString()
        );
        assert.equal(updated.message, proposal.message);
        const retained = [records[0], records[3]].map(recognition);
        assert.equal(updated.message, composePublicationRecognition(retained));
        assert.deepEqual(
          missingPublicationRecognitionSources(updated.message, retained),
          []
        );
        assert.ok(updated.message.length <= PUBLICATION_MESSAGE_MAX_CODE_UNITS);
      }
    );

    await t.test(
      'N1 and N2 sources remain visible but cannot be recruited or negatively cached; correction alone grants no approval',
      async () => {
        for (const type of ['sponsorship', 'publication_draft']) {
          for (const level of ['N1', 'N2']) {
            await reset(1, 2);
            const records = await seed([{ body: 'x'.repeat(3000) }, {}]);
            const subject = subjectFor(type, records[0]);
            await restrict(subject, level);
            await service.prepare(feedId, 'planner', now);
            const firstJobs = await jobs();
            assert.equal(firstJobs.length, 1);
            assert.equal(
              (await assignments()).find((row) => row.id === records[0].draftId)
                .batch_id,
              null
            );
            assert.equal((await diagnostics()).length, 0);
            let state = await service.state();
            assert.deepEqual(state.queue.summary, {
              retained: 1,
              deferred: 1,
              needsCorrection: 0
            });
            assert.equal(
              state.queue.entries.find(
                (entry) => entry.draftId === records[0].draftId
              ).reason,
              'MODERATION_REVIEW_REQUIRED'
            );
            records[0].body = 'Corrected complete protected source.';
            await pool.query(
              'UPDATE sponsor_publication_drafts SET body=$2 WHERE id=$1',
              [records[0].draftId, records[0].body]
            );
            await service.prepare(feedId, 'after-correction', now);
            assert.equal(
              (await assignments()).find((row) => row.id === records[0].draftId)
                .batch_id,
              null
            );
            assert.equal((await diagnostics()).length, 0);
            assert.equal(
              (await service.state()).queue.entries.find(
                (entry) => entry.draftId === records[0].draftId
              ).reason,
              'MODERATION_REVIEW_REQUIRED'
            );
            await approveFixtureSubject(pool, subject);
            await service.prepare(feedId, 'after-explicit-N0', now);
            const after = await jobs();
            assert.equal(after.length, 1);
            assert.equal(after[0].id, firstJobs[0].id);
            assert.equal(
              after[0].scheduled_at.toISOString(),
              firstJobs[0].scheduled_at.toISOString()
            );
            await assertComplete(after, records);
            const source = (await assignments()).find(
              (row) => row.id === records[0].draftId
            );
            assert.equal(source.created_at.toISOString(), records[0].createdAt);
            if (type === 'publication_draft') {
              // Assigning the reviewed draft changes its versioned association.
              state = await service.state();
              assert.equal(state.queue.summary.retained, 0);
              assert.ok(
                state.queue.entries.every(
                  (entry) => entry.reason === 'MODERATION_REVIEW_REQUIRED'
                )
              );
              await approveFixtureSubject(pool, subject);
            }
            assert.equal((await service.state()).queue.summary.retained, 2);
          }
        }
      }
    );

    await t.test(
      'obsolete N0 on a dossier or draft cannot re-enter preparation until an explicit current decision',
      async () => {
        for (const type of ['sponsorship', 'publication_draft']) {
          await reset(1, 2);
          const records = await seed([{}, {}]);
          const subject = subjectFor(type, records[0]);
          await approveFixtureSubject(pool, subject);
          if (type === 'sponsorship') {
            records[0].name = 'Corrected authoritative synthetic identity';
            await pool.query(
              'UPDATE fund_contributions SET sponsor_company_name=$2 WHERE id=$1',
              [records[0].id, records[0].name]
            );
          } else {
            records[0].body = 'Corrected complete draft body.';
            await pool.query(
              'UPDATE sponsor_publication_drafts SET body=$2 WHERE id=$1',
              [records[0].draftId, records[0].body]
            );
          }
          await service.prepare(feedId, 'after-change', now);
          assert.equal(
            (await assignments()).find((row) => row.id === records[0].draftId)
              .batch_id,
            null
          );
          assert.equal(
            (await service.state()).queue.entries.find(
              (entry) => entry.draftId === records[0].draftId
            ).reason,
            'MODERATION_REVIEW_REQUIRED'
          );
          assert.equal((await diagnostics()).length, 0);
          await approveFixtureSubject(pool, subject);
          await service.prepare(feedId, 'after-explicit-N0', now);
          await assertComplete(await jobs(), records);
          if (type === 'publication_draft') {
            assert.equal((await service.state()).queue.summary.retained, 0);
            await approveFixtureSubject(pool, subject);
          }
          assert.equal((await service.state()).queue.summary.retained, 2);
        }
      }
    );

    await t.test(
      'moderation of one existing member preserves every member and date and blocks repair without restoring delivery approval',
      async () => {
        for (const level of ['N1', 'N2']) {
          await reset(1, 2);
          const records = await seed([{}, {}]);
          await service.prepare(feedId, 'planner', now);
          const subject = subjectFor('publication_draft', records[1]);
          await restrict(subject, level);
          const before = await assignments();
          const blocked = (await jobs())[0];
          assert.equal(blocked.status, 'blocked');
          assert.equal(blocked.approved_at, null);
          await service.prepare(feedId, 'during-hold', now);
          assert.deepEqual(await assignments(), before);
          assert.deepEqual(await jobs(), [blocked]);
          assert.deepEqual(await repairSources(pool, blocked), []);
          const state = await service.state();
          assert.deepEqual(state.queue.summary, {
            retained: 0,
            deferred: 2,
            needsCorrection: 0
          });
          assert.ok(
            state.queue.entries.every(
              (entry) => entry.reason === 'MODERATION_REVIEW_REQUIRED'
            )
          );
          await approveFixtureSubject(pool, subject);
          await service.prepare(feedId, 'after-N0', now);
          assert.deepEqual(await assignments(), before);
          assert.deepEqual(await jobs(), [blocked]);
          assert.equal((await service.state()).queue.summary.retained, 0);
          assert.equal((await diagnostics()).length, 0);
        }
      }
    );

    await t.test(
      'current or obsolete moderation of the final draft stays visible and prevents automatic refresh',
      async () => {
        for (const level of ['N1', 'N2', 'stale-N0']) {
          await reset(1, 2);
          const records = await seed([{}, {}]);
          await service.prepare(feedId, 'planner', now);
          let delivery = (await jobs())[0];
          const subject = { type: 'publication_delivery', id: delivery.id };
          if (level === 'stale-N0') {
            await approveFixtureSubject(pool, subject);
            await pool.query(
              'UPDATE publication_deliveries SET message=$2 WHERE id=$1',
              [delivery.id, `Editorial preface.\n\n${delivery.message}`]
            );
          } else await restrict(subject, level);
          delivery = (await jobs())[0];
          const before = await assignments();
          await service.prepare(feedId, 'during-final-review', now);
          assert.deepEqual(await jobs(), [delivery]);
          assert.deepEqual(await assignments(), before);
          const state = await service.state();
          assert.equal(state.queue.summary.retained, 0);
          assert.ok(
            state.queue.entries.every(
              (entry) => entry.reason === 'MODERATION_REVIEW_REQUIRED'
            )
          );
          await pool.query(
            'UPDATE fund_contributions SET public_display_consent=FALSE WHERE id=$1',
            [records[1].id]
          );
          assert.ok(
            (
              await service.sourceIssues(delivery.id)
            ).excludedSponsorIds.includes(records[1].id)
          );
          assert.equal(await service.repairPreview(delivery.id), null);
          assert.deepEqual(await repairSources(pool, delivery), []);
          assert.deepEqual(await assignments(), before);
          await approveFixtureSubject(pool, subject);
          const after = (await jobs())[0];
          assert.equal(after.status, delivery.status);
          assert.equal(after.approved_at, null);
          assert.equal(after.published_at, null);
          assert.equal(after.message, delivery.message);
          assert.deepEqual(await assignments(), before);
          assert.equal((await diagnostics()).length, 0);
        }
      }
    );

    await t.test(
      'an obsolete moderation decision cannot hide revoked consent from the existing preparation guard',
      async () => {
        await reset(1);
        const records = await seed([{}]);
        await service.prepare(feedId, 'planner', now);
        await approveFixtureSubject(
          pool,
          subjectFor('sponsorship', records[0])
        );
        await pool.query(
          'UPDATE fund_contributions SET sponsor_company_name=$2,public_display_consent=FALSE WHERE id=$1',
          [records[0].id, 'Changed synthetic identity']
        );
        const before = await assignments();
        const previous = (await jobs())[0];
        await service.prepare(feedId, 'after-revocation', now);
        const blocked = (await jobs())[0];
        assert.equal(blocked.status, 'blocked');
        assert.equal(blocked.error_code, 'SOURCE_NOT_ELIGIBLE');
        assert.equal(blocked.message, previous.message);
        assert.equal(
          blocked.scheduled_at.toISOString(),
          previous.scheduled_at.toISOString()
        );
        assert.equal(blocked.approved_at, null);
        assert.deepEqual(await assignments(), before);
        assert.equal((await diagnostics()).length, 0);
      }
    );

    await t.test(
      'two planners serialize account admission before actual feed locks without duplicate diagnostics or deliveries',
      async () => {
        await reset(1);
        await seed([{ body: 'x'.repeat(3000) }, {}]);
        const blocker = await pool.connect();
        const observer = await pool.connect();
        let pending;
        try {
          await blocker.query('BEGIN');
          await blocker.query(
            'SELECT id FROM publication_feeds WHERE id=$1 FOR UPDATE',
            [feedId]
          );
          pending = Promise.all([
            service.prepare(feedId, 'planner-one', now),
            service.prepare(feedId, 'planner-two', now)
          ]);
          const deadline = Date.now() + 10000;
          for (;;) {
            const waiting = (
              await observer.query(
                `SELECT count(*) FILTER(WHERE query LIKE 'SELECT id FROM publication_feeds WHERE id=%')::int AS feed,
                  count(*) FILTER(WHERE query LIKE '%preparation_account_mutex%' AND wait_event='advisory')::int AS account
                 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'`
              )
            ).rows[0];
            if (waiting.feed >= 1 && waiting.account >= 1) break;
            assert.ok(
              Date.now() < deadline,
              'One real PostgreSQL planner must wait on the feed lock and the other on account admission'
            );
            await delay(20);
          }
          await blocker.query('COMMIT');
          await pending;
          assert.equal((await diagnostics()).length, 1);
          assert.equal((await jobs()).length, 1);
          assert.equal(
            (await assignments()).filter((row) => row.batch_id).length,
            1
          );
        } finally {
          await blocker.query('ROLLBACK');
          blocker.release();
          observer.release();
          await pending?.catch(() => undefined);
        }
      }
    );

    await t.test(
      'an audit failure rolls back cached diagnosis, assignments and recurrence creation together',
      async () => {
        await reset(1);
        await seed([{ body: 'x'.repeat(3000) }, {}]);
        await pool.query(`CREATE FUNCTION fail_render_diagnostic() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.action='publication_automation.source_render_blocked' THEN RAISE EXCEPTION 'Synthetic diagnostic failure'; END IF; RETURN NEW; END $$`);
        await pool.query(
          'CREATE TRIGGER fail_render_diagnostic BEFORE INSERT ON admin_audit_log FOR EACH ROW EXECUTE FUNCTION fail_render_diagnostic()'
        );
        try {
          await assert.rejects(
            service.prepare(feedId, 'planner', now),
            /Synthetic diagnostic failure/
          );
          assert.equal((await diagnostics()).length, 0);
          assert.equal((await jobs()).length, 0);
          assert.ok(
            (await assignments()).every((row) => row.batch_id === null)
          );
          assert.equal(
            (
              await pool.query(
                'SELECT count(*)::int AS count FROM publication_recurrences'
              )
            ).rows[0].count,
            0
          );
        } finally {
          await pool.query(
            'DROP TRIGGER fail_render_diagnostic ON admin_audit_log'
          );
          await pool.query('DROP FUNCTION fail_render_diagnostic()');
        }
      }
    );

    await t.test(
      'composition failure remains visible without a delivery and read-only GET cannot create audits',
      async () => {
        await reset(1);
        await seed([{}]);
        const context = {
          pool,
          env,
          feeds: (db) => service.feeds(db),
          command: async () => {
            throw new PublicationAutomationError('INVALID_MESSAGE', 400);
          }
        };
        await prepare(context, feedId, 'planner', now);
        const batchId = (await assignments())[0].batch_id;
        assert.ok(batchId);
        assert.equal((await jobs()).length, 0);
        const beforeAudits = (
          await pool.query('SELECT count(*)::int AS count FROM admin_audit_log')
        ).rows[0].count;
        const state = await service.state();
        assert.equal(state.queue.entries[0].status, 'deferred');
        assert.equal(state.queue.entries[0].reason, 'PREPARATION_FAILED');
        assert.equal(state.queue.entries[0].deliveryId, null);
        const alternatePool = {
          query: (...args) => pool.query(...args),
          connect: () => pool.connect()
        };
        assert.equal(
          (await service.state(alternatePool)).queue.total,
          1,
          'an explicitly supplied pool also gets a transaction-owned cursor'
        );
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS count FROM admin_audit_log'
            )
          ).rows[0].count,
          beforeAudits
        );
        const client = await pool.connect();
        try {
          await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
          await client.query('SET LOCAL ROLE pg_read_all_data');
          assert.equal((await service.state(client)).queue.total, 1);
          await assert.rejects(
            client.query(
              "INSERT INTO admin_audit_log(action,entity_type) VALUES('forbidden','test')"
            )
          );
          await client.query('ROLLBACK');
        } finally {
          client.release();
        }
        for (const queueOffset of [-1, 0.5, NaN, Number.MAX_SAFE_INTEGER + 1])
          await assert.rejects(service.state(undefined, { queueOffset }), {
            code: 'INVALID_FILTER',
            status: 400
          });
      }
    );
  }
);
