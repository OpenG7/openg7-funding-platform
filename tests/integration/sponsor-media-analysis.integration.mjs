import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import sharp from 'sharp';
import { SponsorMediaAnalysisService } from '../../dist/apps/funding-api/src/sponsor-media-analysis/service.js';
import { assertSponsorMediaAnalysisReadiness } from '../../dist/apps/funding-api/src/sponsor-media-analysis-readiness.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

test(
  'durable private media suggestions require an exact human decision and preserve every approval boundary',
  { timeout: 180000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);
    await assertSponsorMediaAnalysisReadiness(pool);
    const bytes = await sharp({
      create: { width: 320, height: 240, channels: 3, background: '#237096' }
    })
      .webp()
      .toBuffer();
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const actor = 'synthetic-media-operator',
      storage = { readPrivateObject: async () => bytes };
    const service = new SponsorMediaAnalysisService(pool, storage);
    const id = randomUUID();
    await pool.query(
      `INSERT INTO fund_contributions(id,contribution_type,amount_cents,currency,status,paid_at,public_reference) VALUES($1,'sponsorship_interest',5000,'cad','paid',NOW(),$2)`,
      [id, 'SYNTHETIC-MEDIA-' + id]
    );
    async function asset() {
      const assetId = randomUUID();
      return (
        await pool.query(
          `INSERT INTO sponsor_media_assets(id,contribution_id,kind,uploaded_by,original_filename,original_mime_type,original_size_bytes,original_storage_key,processed_size_bytes,processed_storage_key,checksum_sha256,width,height) VALUES($1,$2,'supporting_image','admin','synthetic.webp','image/webp',$3,$4,$3,$5,$6,320,240) RETURNING id,updated_at::text AS version`,
          [
            assetId,
            id,
            bytes.length,
            'synthetic-original/' + assetId,
            'synthetic-processed/' + assetId,
            checksum
          ]
        )
      ).rows[0];
    }
    const currentAsset = async (assetId) =>
      (
        await pool.query(
          'SELECT updated_at::text AS version,alt_text,review_status,public_url,checksum_sha256 FROM sponsor_media_assets WHERE id=$1',
          [assetId]
        )
      ).rows[0];
    const queue = (a, rerun = false) => ({
      requestId: randomUUID(),
      contributionId: id,
      assetId: a.id,
      expectedVersion: a.version,
      rerun
    });
    const review = (
      run,
      a,
      decision = 'accept',
      draft = {
        altText: 'A manually verified synthetic image.',
        classification: 'illustration'
      }
    ) => ({
      requestId: randomUUID(),
      contributionId: id,
      runId: run.id,
      expectedVersion: a.version,
      expectedReviewVersion: run.review?.version ?? 0,
      decision,
      confirmation: a.id,
      draft
    });
    const count = async (table) =>
      Number(
        (await pool.query('SELECT count(*) AS n FROM ' + table)).rows[0].n
      );
    const a = await asset();
    const externalBefore = {
      moderation: await count('moderation_decisions'),
      deliveries: await count('publication_deliveries'),
      emails: await count('email_messages')
    };
    await t.test(
      'reads are passive and start deduplicates canonical actor-bound request payloads',
      async () => {
        assert.deepEqual((await service.read(id)).runs, []);
        const command = queue(a);
        const results = await Promise.all([
          service.start(command, actor),
          service.start(
            Object.fromEntries(Object.entries(command).reverse()),
            actor
          )
        ]);
        assert.equal(results[0].runs[0].id, results[1].runs[0].id);
        assert.deepEqual(await service.receipt(id, command.requestId, actor), {
          found: true,
          action: 'run',
          resultId: results[0].runs[0].id
        });
        assert.deepEqual(await service.receipt(id, randomUUID(), actor), {
          found: false
        });
        await assert.rejects(
          service.receipt(id, command.requestId, 'another-actor'),
          { code: 'MEDIA_ANALYSIS_RECEIPT_FORBIDDEN' }
        );
        assert.equal(await count('sponsor_media_analysis_runs'), 1);
        await assert.rejects(
          service.start({ ...command, rerun: true }, actor),
          { code: 'MEDIA_ANALYSIS_REQUEST_CONFLICT' }
        );
        await assert.rejects(service.start(command, 'another-actor'), {
          code: 'MEDIA_ANALYSIS_REQUEST_CONFLICT'
        });
        await service.start(queue(a), actor);
        assert.equal(await count('sponsor_media_analysis_runs'), 1);
      }
    );
    await t.test(
      'local worker succeeds technically without vision, rights, N0 or approval',
      async () => {
        await Promise.all([service.tick(), service.tick()]);
        const run = (await service.read(id)).runs[0];
        assert.equal(run.state, 'succeeded');
        assert.equal(run.suggestion.altText, null);
        assert.equal(run.suggestion.capabilities.vision, 'not_configured');
        assert.equal(await count('sponsor_media_analysis_suggestions'), 1);
        assert.equal(
          (await currentAsset(a.id)).review_status,
          'pending_review'
        );
        assert.equal((await currentAsset(a.id)).alt_text, null);
      }
    );
    await t.test(
      'saving and editing a proposal is independent; explicit acceptance uses metadata and audit atomically',
      async () => {
        let run = (await service.read(id)).runs[0];
        await service.review(review(run, a, 'save'), actor);
        assert.equal((await currentAsset(a.id)).alt_text, null);
        run = (await service.read(id)).runs[0];
        assert.equal(run.review.decision, 'saved');
        const command = review(run, a);
        await service.review(command, actor);
        await service.review(
          Object.fromEntries(Object.entries(command).reverse()),
          actor
        );
        const saved = await currentAsset(a.id);
        assert.equal(saved.alt_text, command.draft.altText);
        assert.equal(saved.review_status, 'pending_review');
        assert.equal(saved.public_url, null);
        assert.equal(
          (await service.read(id)).runs[0].review.decision,
          'accepted'
        );
        assert.equal(
          (
            await pool.query(
              `SELECT count(*)::int AS n FROM admin_audit_log WHERE action='sponsorship.media.metadata' AND entity_id=$1`,
              [a.id]
            )
          ).rows[0].n,
          1
        );
        await assert.rejects(
          service.review(
            {
              ...command,
              requestId: randomUUID(),
              expectedVersion: saved.version,
              expectedReviewVersion: 2
            },
            actor
          ),
          { code: 'MEDIA_ANALYSIS_REVIEW_TERMINAL' }
        );
        assert.throws(
          () =>
            service.review(
              {
                ...command,
                requestId: randomUUID(),
                draft: { ...command.draft, usageRights: { confirmed: true } }
              },
              actor
            ),
          { code: 'MEDIA_ANALYSIS_INVALID' }
        );
      }
    );
    await t.test(
      'rejection is terminal and only an explicit rerun creates a new retained generation',
      async () => {
        const b = await asset();
        await service.start(queue(b), actor);
        await service.tick();
        let run = (await service.read(id)).runs.find((r) => r.assetId === b.id);
        await service.review(
          review(run, b, 'reject', {
            altText: null,
            classification: 'unknown'
          }),
          actor
        );
        await service.start(queue(b), actor);
        assert.equal(
          (await service.read(id)).runs.find((r) => r.assetId === b.id).id,
          run.id
        );
        await assert.rejects(
          service.review(review({ ...run, review: { version: 1 } }, b), actor),
          { code: 'MEDIA_ANALYSIS_REVIEW_TERMINAL' }
        );
        await service.start(queue(b, true), actor);
        assert.notEqual(
          (await service.read(id)).runs.find((r) => r.assetId === b.id).id,
          run.id
        );
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS n FROM sponsor_media_analysis_reviews WHERE run_id=$1',
              [run.id]
            )
          ).rows[0].n,
          1
        );
        await service.tick();
      }
    );
    await t.test(
      'invalid bytes fail safely, an expired attempt is fenced and changed binaries cancel late results',
      async () => {
        const b = await asset();
        const failing = new SponsorMediaAnalysisService(pool, {
          readPrivateObject: async () => Buffer.from('invalid')
        });
        await failing.start(queue(b), actor);
        await failing.tick();
        assert.equal(
          (await service.read(id)).runs.find((r) => r.assetId === b.id)
            .errorCode,
          'MEDIA_ANALYSIS_CHECKSUM_MISMATCH'
        );
        await failing.start(queue(b, true), actor);
        await pool.query(
          `UPDATE sponsor_media_analysis_runs SET state='processing',attempts=3,claim_token=$2,lease_expires_at=clock_timestamp()-INTERVAL '1 second' WHERE asset_id=$1 AND state='queued'`,
          [b.id, randomUUID()]
        );
        await service.tick();
        assert.equal(
          (await service.read(id)).runs.find((r) => r.assetId === b.id)
            .errorCode,
          'MEDIA_ANALYSIS_ATTEMPTS_EXHAUSTED'
        );
        const c = await asset();
        await service.start(queue(c), actor);
        let entered, finish;
        const started = new Promise((resolve) => (entered = resolve)),
          delayed = new Promise((resolve) => (finish = resolve));
        const held = new SponsorMediaAnalysisService(pool, {
          readPrivateObject: async () => {
            entered();
            return delayed;
          }
        });
        const tick = held.tick();
        await started;
        await pool.query(
          'UPDATE sponsor_media_assets SET checksum_sha256=$2 WHERE id=$1',
          [c.id, '0'.repeat(64)]
        );
        finish(bytes);
        await tick;
        const run = (await service.read(id)).runs.find(
          (r) => r.assetId === c.id
        );
        assert.equal(run.state, 'cancelled');
        assert.equal(run.stale, true);
        assert.equal(run.suggestion, null);
      }
    );
    await t.test(
      'immutable inputs/proposals/reviews and audit rollback protect every human decision',
      async () => {
        const d = await asset();
        await service.start(queue(d), actor);
        await service.tick();
        const run = (await service.read(id)).runs.find(
          (r) => r.assetId === d.id
        );
        for (const sql of [
          "UPDATE sponsor_media_analysis_runs SET checksum=repeat('0',64) WHERE id=$1",
          'DELETE FROM sponsor_media_analysis_runs WHERE id=$1',
          "UPDATE sponsor_media_analysis_suggestions SET snapshot='{}'::jsonb WHERE run_id=$1"
        ])
          await assert.rejects(pool.query(sql, [run.id]));
        await pool.query(
          `CREATE FUNCTION synthetic_fail_analysis_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='sponsorship.media.analysis.accepted' THEN RAISE EXCEPTION 'synthetic audit unavailable'; END IF; RETURN NEW; END $$;CREATE TRIGGER synthetic_fail_analysis_audit BEFORE INSERT ON admin_audit_log FOR EACH ROW EXECUTE FUNCTION synthetic_fail_analysis_audit()`
        );
        try {
          await assert.rejects(service.review(review(run, d), actor), {
            code: 'MEDIA_ANALYSIS_UNAVAILABLE'
          });
          assert.equal((await currentAsset(d.id)).alt_text, null);
          assert.equal(
            (await service.read(id)).runs.find((r) => r.assetId === d.id)
              .review,
            null
          );
        } finally {
          await pool.query(
            'DROP TRIGGER synthetic_fail_analysis_audit ON admin_audit_log;DROP FUNCTION synthetic_fail_analysis_audit()'
          );
        }
      }
    );
    await t.test(
      'reads retain completed analyses for all 100 supporting images and the logo',
      async () => {
        const contributionId = randomUUID(),
          assetIds = Array.from({ length: 101 }, () => randomUUID());
        await pool.query(
          `INSERT INTO fund_contributions(id,contribution_type,amount_cents,currency,status,paid_at,public_reference) VALUES($1,'sponsorship_interest',5000,'cad','paid',NOW(),$2)`,
          [contributionId, 'SYNTHETIC-MEDIA-' + contributionId]
        );
        await pool.query(
          `INSERT INTO sponsor_media_assets(id,contribution_id,kind,uploaded_by,original_filename,original_mime_type,original_size_bytes,original_storage_key,processed_size_bytes,processed_storage_key,checksum_sha256,width,height)
          SELECT fixture.id,$1,CASE WHEN fixture.position=101 THEN 'logo' ELSE 'supporting_image' END,'admin','synthetic.webp','image/webp',$3,'synthetic-original/'||fixture.id,$3,'synthetic-processed/'||fixture.id,$4,320,240
          FROM unnest($2::uuid[]) WITH ORDINALITY AS fixture(id,position)`,
          [contributionId, assetIds, bytes.length, checksum]
        );
        await pool.query(
          `WITH completed AS (
            INSERT INTO sponsor_media_analysis_runs(contribution_id,asset_id,checksum,adapter_version,generation,requested_by,state,attempts,finished_at)
            SELECT $1,fixture.id,$3,'local_technical_v1',1,$4,'succeeded',1,clock_timestamp() FROM unnest($2::uuid[]) AS fixture(id) RETURNING id
          )
          INSERT INTO sponsor_media_analysis_suggestions(run_id,snapshot)
          SELECT completed.id,source.snapshot FROM completed CROSS JOIN LATERAL (SELECT snapshot FROM sponsor_media_analysis_suggestions WHERE run_id=(SELECT id FROM sponsor_media_analysis_runs WHERE asset_id=$5 ORDER BY generation LIMIT 1)) AS source`,
          [contributionId, assetIds, checksum, actor, a.id]
        );
        const response = await service.read(contributionId);
        assert.equal(response.runs.length, 101);
        assert.deepEqual(
          response.runs.map((run) => run.assetId).sort(),
          assetIds.sort()
        );
        assert.ok(
          response.runs.every(
            (run) => run.state === 'succeeded' && run.suggestion !== null
          )
        );
      }
    );
    assert.deepEqual(
      {
        moderation: await count('moderation_decisions'),
        deliveries: await count('publication_deliveries'),
        emails: await count('email_messages')
      },
      externalBefore
    );
  }
);
