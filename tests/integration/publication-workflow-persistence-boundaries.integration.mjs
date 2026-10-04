import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import {
  assignBatchToPublicationSlot,
  assignDraftToPublicationBatch,
  cancelAdminPublicationBatch,
  createAdminPublicationBatch,
  createAdminPublicationDraft,
  createAdminPublicationSlot,
  createSocialPublicationJobForBatch,
  getPublicationBatchById,
  listAdminPublicationDrafts,
  listAdminSocialPublicationJobs,
  markSocialPublicationJobFailed,
  markSocialPublicationJobPublished,
  markSocialPublicationJobPublishing,
  publishAdminPublicationBatch,
  scheduleAdminPublicationBatch,
  unassignDraftFromPublicationBatch,
  updateAdminPublicationDraft
} from '../../dist/apps/funding-api/src/fund-admin.repository.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

const future = (days) => new Date(Date.now() + days * 86_400_000).toISOString();

test(
  'manual publication and legacy jobs preserve persistence boundaries in disposable PostgreSQL',
  { timeout: 90000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);
    const sponsor = async ({
      consent = true,
      review = 'approved',
      status = 'paid'
    } = {}) => {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO fund_contributions (
        id, contribution_type, amount_cents, currency, status,
        public_display_consent, sponsor_review_status, sponsor_company_name,
        sponsor_public_summary, sponsor_message, sponsor_website_url
      ) VALUES ($1::uuid, 'sponsorship_interest', 25000, 'cad', $2, $3, $4,
                'Synthetic publication sponsor', 'Approved public summary',
                'Synthetic private message', 'https://example.test/sponsor')`,
        [id, status, consent, review]
      );
      return id;
    };
    const draft = async ({ channel = 'facebook' } = {}) => {
      const created = await createAdminPublicationDraft(pool, {
        contributionId: await sponsor(),
        feedTarget: 'openg7',
        channel
      });
      assert.equal(created.updated, true);
      const approved = await updateAdminPublicationDraft(pool, {
        draftId: created.draft.id,
        status: 'approved'
      });
      assert.equal(approved.updated, true);
      return approved.draft;
    };
    const batch = async ({ capacity = 2, channel = 'facebook' } = {}) => {
      const result = await createAdminPublicationBatch(pool, {
        channel,
        capacity,
        notes: '  Synthetic note  '
      });
      assert.equal(result.updated, true);
      assert.equal(result.batch.notes, 'Synthetic note');
      return result.batch;
    };
    const fixture = async () => {
      const slot = (
        await createAdminPublicationSlot(pool, {
          feedTarget: 'openg7',
          channel: 'facebook',
          startsAt: future(10),
          capacity: 2
        })
      ).slot;
      const createdBatch = await batch();
      const first = await draft();
      const second = await draft();
      for (const record of [first, second]) {
        assert.equal(
          (
            await assignDraftToPublicationBatch(pool, {
              draftId: record.id,
              batchId: createdBatch.id
            })
          ).updated,
          true
        );
      }
      // Stable historical dates make collective text order observable.
      await pool.query(
        'UPDATE sponsor_publication_drafts SET created_at=$2::timestamptz WHERE id=$1::uuid',
        [first.id, '2026-09-01T00:00:00Z']
      );
      await pool.query(
        'UPDATE sponsor_publication_drafts SET created_at=$2::timestamptz WHERE id=$1::uuid',
        [second.id, '2026-09-02T00:00:00Z']
      );
      assert.equal(
        (
          await assignBatchToPublicationSlot(pool, {
            slotId: slot.id,
            batchId: createdBatch.id
          })
        ).updated,
        true
      );
      const job = await createSocialPublicationJobForBatch(pool, {
        batchId: createdBatch.id,
        provider: 'facebook',
        mode: 'mock'
      });
      assert.ok(job);
      return {
        slotId: slot.id,
        batchId: createdBatch.id,
        draftIds: [first.id, second.id],
        jobId: job.id,
        job
      };
    };
    const snapshot = async ({ slotId, batchId, draftIds, jobId }) => {
      const results = await Promise.all([
        pool.query('SELECT * FROM publication_slots WHERE id=$1::uuid', [
          slotId
        ]),
        pool.query(
          'SELECT * FROM sponsor_publication_batches WHERE id=$1::uuid',
          [batchId]
        ),
        pool.query(
          'SELECT * FROM sponsor_publication_drafts WHERE id=ANY($1::uuid[]) ORDER BY id',
          [draftIds]
        ),
        pool.query('SELECT * FROM social_publication_jobs WHERE id=$1::uuid', [
          jobId
        ])
      ]);
      return {
        slot: results[0].rows[0],
        batch: results[1].rows[0],
        drafts: results[2].rows,
        job: results[3].rows[0]
      };
    };
    const resultInput = (record) => ({
      jobId: record.jobId,
      externalPostId: 'synthetic-external-post',
      externalPostUrl: 'https://example.test/publication'
    });

    await t.test(
      'draft creation requires consent and review, and replay preserves human content',
      async () => {
        for (const options of [
          { consent: false },
          { review: 'pending_review' },
          { status: 'pending' }
        ]) {
          assert.deepEqual(
            await createAdminPublicationDraft(pool, {
              contributionId: await sponsor(options),
              feedTarget: 'openg7',
              channel: 'facebook'
            }),
            { updated: false, draft: null }
          );
        }
        const record = await draft();
        const changed = await updateAdminPublicationDraft(pool, {
          draftId: record.id,
          body: '  Human publication text  ',
          reviewNote: '  Reviewed manually  '
        });
        assert.equal(changed.draft.body, 'Human publication text');
        assert.equal(changed.draft.review_note, 'Reviewed manually');
        assert.equal(changed.draft.approved_at, record.approved_at);
        const replay = await createAdminPublicationDraft(pool, {
          contributionId: record.contribution_id,
          feedTarget: 'openg7',
          channel: 'facebook'
        });
        assert.deepEqual(replay.draft, changed.draft);
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS count FROM sponsor_publication_drafts WHERE contribution_id=$1::uuid',
              [record.contribution_id]
            )
          ).rows[0].count,
          1
        );
        assert.equal(
          (await updateAdminPublicationDraft(pool, { draftId: record.id }))
            .updated,
          false
        );
      }
    );

    await t.test(
      'manual mutations retain capacity, channel, schedule, cancellation and publication replay',
      async () => {
        const createdBatch = await batch({ capacity: 1 });
        const first = await draft();
        const second = await draft();
        const otherChannel = await draft({ channel: 'linkedin' });
        assert.equal(
          (
            await publishAdminPublicationBatch(pool, {
              batchId: createdBatch.id
            })
          ).updated,
          false,
          'an open batch is not published'
        );
        for (const record of [otherChannel]) {
          assert.equal(
            (
              await assignDraftToPublicationBatch(pool, {
                batchId: createdBatch.id,
                draftId: record.id
              })
            ).updated,
            false
          );
        }
        assert.equal(
          (
            await assignDraftToPublicationBatch(pool, {
              batchId: createdBatch.id,
              draftId: first.id
            })
          ).updated,
          true
        );
        for (const record of [first, second]) {
          assert.equal(
            (
              await assignDraftToPublicationBatch(pool, {
                batchId: createdBatch.id,
                draftId: record.id
              })
            ).updated,
            false
          );
        }
        assert.equal(
          (await getPublicationBatchById(pool, createdBatch.id))
            .capacityAvailable,
          0
        );
        assert.equal(
          (
            await scheduleAdminPublicationBatch(pool, {
              batchId: createdBatch.id,
              scheduledAt: future(-1)
            })
          ).updated,
          false
        );
        const scheduledAt = future(5);
        assert.equal(
          (
            await scheduleAdminPublicationBatch(pool, {
              batchId: createdBatch.id,
              scheduledAt
            })
          ).updated,
          true
        );
        const scheduledDraft = (
          await listAdminPublicationDrafts(pool, { id: first.id })
        ).drafts[0];
        assert.equal(scheduledDraft.status, 'scheduled');
        assert.equal(
          Date.parse(scheduledDraft.scheduled_at),
          Date.parse(scheduledAt)
        );
        const unassigned = await unassignDraftFromPublicationBatch(pool, {
          draftId: first.id
        });
        assert.equal(unassigned.draft.status, 'approved');
        assert.equal(unassigned.draft.scheduled_at, null);
        assert.equal(unassigned.draft.batch_id, null);
        assert.equal(
          (
            await assignDraftToPublicationBatch(pool, {
              batchId: createdBatch.id,
              draftId: first.id
            })
          ).updated,
          true
        );
        const published = await publishAdminPublicationBatch(pool, {
          batchId: createdBatch.id
        });
        assert.equal(published.updated, true);
        assert.equal(published.batch.status, 'published');
        assert.equal(
          (await listAdminPublicationDrafts(pool, { id: first.id })).drafts[0]
            .status,
          'published'
        );
        const replay = await publishAdminPublicationBatch(pool, {
          batchId: createdBatch.id
        });
        assert.equal(replay.updated, false);
        assert.equal(replay.batch.publishedAt, published.batch.publishedAt);
        assert.equal(
          (await unassignDraftFromPublicationBatch(pool, { draftId: first.id }))
            .updated,
          false
        );
        assert.equal(
          (
            await cancelAdminPublicationBatch(pool, {
              batchId: createdBatch.id
            })
          ).updated,
          false
        );

        const cancelled = await fixture();
        assert.equal(
          (
            await cancelAdminPublicationBatch(pool, {
              batchId: cancelled.batchId
            })
          ).updated,
          true
        );
        const released = (
          await listAdminPublicationDrafts(pool, { all: true })
        ).drafts.filter((record) => cancelled.draftIds.includes(record.id));
        assert.equal(released.length, 2);
        for (const record of released) {
          assert.equal(record.batch_id, null);
          assert.equal(record.slot_id, null);
          assert.equal(record.scheduled_at, null);
          assert.equal(record.status, 'approved');
        }
      }
    );

    await t.test(
      'legacy job retries keep one key, draft order, safe errors and atomic final results',
      async () => {
        const record = await fixture();
        assert.deepEqual(record.job.draftIds, record.draftIds);
        assert.equal(
          record.job.idempotencyKey,
          `social-publication-batch:${record.batchId}:facebook`
        );
        assert.ok(record.job.body.includes('Approved public summary'));
        assert.ok(!record.job.body.includes('Synthetic private message'));
        const duplicate = await createSocialPublicationJobForBatch(pool, {
          batchId: record.batchId,
          provider: 'facebook',
          mode: 'mock'
        });
        assert.equal(duplicate.id, record.jobId);
        const claimed = await markSocialPublicationJobPublishing(
          pool,
          record.jobId
        );
        assert.equal(claimed.status, 'publishing');
        assert.ok(claimed.attemptedAt);
        assert.equal(
          await markSocialPublicationJobPublishing(pool, record.jobId),
          null
        );
        const publishingReplay = await createSocialPublicationJobForBatch(
          pool,
          { batchId: record.batchId, provider: 'facebook', mode: 'mock' }
        );
        assert.equal(publishingReplay.status, 'publishing');
        const failed = await markSocialPublicationJobFailed(pool, {
          jobId: record.jobId,
          errorCode: 'E'.repeat(200),
          errorMessage: 'M'.repeat(1100)
        });
        assert.equal(failed.status, 'failed');
        assert.equal(failed.errorCode.length, 160);
        assert.equal(failed.errorMessage.length, 1000);
        const retry = await createSocialPublicationJobForBatch(pool, {
          batchId: record.batchId,
          provider: 'facebook',
          mode: 'mock'
        });
        assert.equal(retry.id, record.jobId);
        assert.equal(retry.status, 'pending');
        assert.equal(retry.errorCode, null);
        assert.equal(retry.errorMessage, null);
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS count FROM social_publication_jobs WHERE batch_id=$1::uuid',
              [record.batchId]
            )
          ).rows[0].count,
          1
        );
        await markSocialPublicationJobPublishing(pool, record.jobId);
        const published = await markSocialPublicationJobPublished(
          pool,
          resultInput(record)
        );
        assert.equal(published.published, true);
        assert.equal(published.job.status, 'published');
        assert.equal(published.batch.status, 'published');
        const state = await snapshot(record);
        assert.equal(state.slot.status, 'published');
        for (const row of state.drafts) {
          assert.equal(row.status, 'published');
          assert.equal(row.public_url, resultInput(record).externalPostUrl);
        }
        const replay = await markSocialPublicationJobPublished(
          pool,
          resultInput(record)
        );
        assert.equal(replay.job.publishedAt, published.job.publishedAt);
        assert.equal(replay.batch.publishedAt, published.batch.publishedAt);
        assert.equal(
          await markSocialPublicationJobPublishing(pool, record.jobId),
          null
        );
        assert.equal(
          await createSocialPublicationJobForBatch(pool, {
            batchId: record.batchId,
            provider: 'facebook',
            mode: 'mock'
          }),
          null
        );
        const listed = await listAdminSocialPublicationJobs(pool, {
          mode: 'mock',
          configuredChannels: ['facebook']
        });
        assert.equal(
          listed.jobs.find((job) => job.id === record.jobId).status,
          'published'
        );
        assert.deepEqual(
          await markSocialPublicationJobPublished(pool, {
            ...resultInput(record),
            jobId: randomUUID()
          }),
          { published: false, mode: 'disabled', job: null, batch: null }
        );
      }
    );

    await t.test(
      'administrative authorization guards preserve exact version and roll back job publication',
      async () => {
        const record = await fixture();
        const state = await snapshot(record);
        const deliveryId = randomUUID();
        await pool.query(
          `INSERT INTO publication_deliveries (id, feed_id, kind, batch_id, message,
        scheduled_at, account_id, mode, version, status, approved_at, approved_by)
       VALUES ($1::uuid, 'openg7:facebook', 'sponsorship', $2::uuid,
         'Exact authorized synthetic message', $3, 'synthetic-account', 'mock',
         7, 'approved', NOW(), 'synthetic-admin')`,
          [deliveryId, record.batchId, state.batch.scheduled_at]
        );
        const authorization = (
          await pool.query(
            'SELECT * FROM publication_deliveries WHERE id=$1::uuid',
            [deliveryId]
          )
        ).rows[0];
        for (const action of [
          () =>
            updateAdminPublicationDraft(pool, {
              draftId: record.draftIds[0],
              body: 'Unauthorized source edit'
            }),
          () =>
            unassignDraftFromPublicationBatch(pool, {
              draftId: record.draftIds[0]
            }),
          () => publishAdminPublicationBatch(pool, { batchId: record.batchId }),
          () => markSocialPublicationJobPublished(pool, resultInput(record))
        ]) {
          await assert.rejects(action(), (error) => error.code === '55000');
          assert.deepEqual(await snapshot(record), state);
          assert.deepEqual(
            (
              await pool.query(
                'SELECT * FROM publication_deliveries WHERE id=$1::uuid',
                [deliveryId]
              )
            ).rows[0],
            authorization
          );
        }
        await pool.query(
          "UPDATE publication_deliveries SET status='cancelled' WHERE id=$1::uuid",
          [deliveryId]
        );
        assert.equal(
          (await markSocialPublicationJobPublished(pool, resultInput(record)))
            .published,
          true
        );
      }
    );

    await t.test(
      'a failed final slot write rolls back job, batch and draft updates before retry',
      async () => {
        const record = await fixture();
        const before = await snapshot(record);
        await pool.query(`CREATE FUNCTION reject_workflow_slot() RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Synthetic final slot failure' USING ERRCODE='P0001'; END $$;
      CREATE TRIGGER reject_workflow_slot BEFORE UPDATE ON publication_slots
      FOR EACH ROW EXECUTE FUNCTION reject_workflow_slot();`);
        try {
          await assert.rejects(
            markSocialPublicationJobPublished(pool, resultInput(record)),
            (error) => error.code === 'P0001'
          );
          assert.deepEqual(await snapshot(record), before);
        } finally {
          await pool.query(
            'DROP TRIGGER reject_workflow_slot ON publication_slots; DROP FUNCTION reject_workflow_slot()'
          );
        }
        assert.equal(
          (await markSocialPublicationJobPublished(pool, resultInput(record)))
            .published,
          true
        );
        assert.equal((await snapshot(record)).slot.status, 'published');
      }
    );
  }
);
