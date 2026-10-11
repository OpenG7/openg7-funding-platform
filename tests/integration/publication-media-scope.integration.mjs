import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { PublicationAutomationService } from '../../dist/apps/funding-api/src/publication-automation/service.js';

test(
  'publication media batch scope with disposable PostgreSQL',
  { timeout: 90000 },
  async (t) => {
    const database = await startDisposablePostgres();
    t.after(database.stop);
    const pool = database.pool;
    const bytes = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#ffffff' }
    })
      .webp()
      .toBuffer();
    const hash = createHash('sha256').update(bytes).digest('hex');
    const objects = new Map();
    const reads = [];
    const storage = {
      readPrivateObject: async (key) => {
        reads.push(key);
        return objects.get(key) ?? null;
      }
    };
    const service = new PublicationAutomationService(pool, storage, {
      SOCIAL_PUBLICATION_MODE: 'mock',
      SOCIAL_PUBLICATION_WORKER_ENABLED: 'true'
    });
    const feedId = 'openg20:facebook';
    let future;
    let due;

    async function reset() {
      await pool.query(
        'TRUNCATE fund_contributions,publication_deliveries,publication_recurrences,social_publication_jobs,sponsor_publication_drafts,sponsor_publication_batches,publication_slots,admin_audit_log CASCADE'
      );
      await pool.query(
        "UPDATE publication_feeds SET paused=TRUE,auto_prepare=FALSE,connection='unchecked',account_fingerprint=NULL,last_prepared_at=NULL,capacity=5,horizon_days=14"
      );
      await pool.query(
        'UPDATE publication_worker_settings SET enabled=NULL,version=1'
      );
      objects.clear();
      reads.length = 0;
      future = new Date(Date.now() + 60000).toISOString();
      due = new Date(Date.now() + 120000);
      await service.command({ action: 'check', feedId }, 'tester');
      const feed = (await service.state()).feeds.find((f) => f.id === feedId);
      await service.command(
        { action: 'settings', settings: { ...feed, paused: false } },
        'tester'
      );
    }

    async function sponsor(name) {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO fund_contributions(id,contribution_type,amount_cents,status,public_display_consent,sponsor_review_status,sponsor_company_name,sponsor_public_summary,sponsor_feed_target,sponsor_feed_channels) VALUES($1,'sponsorship_interest',25000,'paid',TRUE,'approved',$2,'Approved synthetic summary','openg20','["facebook"]')`,
        [id, name]
      );
      return id;
    }

    async function media(contributionId, count = 1, newer = false) {
      const ids = Array.from({ length: count }, () => randomUUID());
      await pool.query(
        `INSERT INTO sponsor_media_assets(id,contribution_id,kind,review_status,original_filename,original_mime_type,original_size_bytes,original_storage_key,processed_size_bytes,processed_storage_key,public_storage_key,public_url,checksum_sha256,width,height,alt_text,created_at)
         SELECT id,$2,'supporting_image','approved','fixture.webp','image/webp',$3,id::text||'/original',$3,id::text||'/processed',id::text||'/public','https://example.test/fixture.webp',$4,2,2,'Approved synthetic image',$5 FROM unnest($1::uuid[]) AS fixture(id)`,
        [
          ids,
          contributionId,
          bytes.length,
          hash,
          new Date(Date.now() + (newer ? 60000 : 0))
        ]
      );
      for (const id of ids) objects.set(`${id}/processed`, bytes);
      return ids;
    }

    async function batch(contributionIds) {
      const id = (
        await pool.query(
          "INSERT INTO sponsor_publication_batches(channel,capacity,status,scheduled_at) VALUES('facebook',$1,'scheduled',$2) RETURNING id",
          [contributionIds.length, future]
        )
      ).rows[0].id;
      const draftIds = contributionIds.map(() => randomUUID()).sort();
      for (const [index, contributionId] of contributionIds.entries()) {
        await pool.query(
          `INSERT INTO sponsor_publication_drafts(id,contribution_id,feed_target,channel,title,body,disclosure_text,batch_id) VALUES($1,$2,'openg20','facebook','Synthetic title','Synthetic sponsor body','Sponsored',$3)`,
          [draftIds[index], contributionId, id]
        );
      }
      return id;
    }

    async function fixtures() {
      await reset();
      const a1 = await sponsor('Synthetic A1');
      const a2 = await sponsor('Synthetic A2');
      const b = await sponsor('Synthetic B');
      const [mediaA1] = await media(a1);
      const [mediaA2] = await media(a2);
      const [mediaB] = await media(b);
      const batchA = await batch([a1, a2]);
      const batchB = await batch([b]);
      return { a1, a2, b, mediaA1, mediaA2, mediaB, batchA, batchB };
    }

    async function compose(batchId, mediaId = null) {
      return (
        await service.command(
          {
            action: 'compose',
            feedId,
            kind: batchId ? 'sponsorship' : 'news',
            batchId,
            message: 'Exact synthetic publication',
            scheduledAt: future,
            mediaId
          },
          'tester'
        )
      ).id;
    }

    async function record(id) {
      return (await service.state()).deliveries.find((row) => row.id === id);
    }

    async function raw(id) {
      return (
        await pool.query('SELECT * FROM publication_deliveries WHERE id=$1', [
          id
        ])
      ).rows[0];
    }

    function approval(job) {
      return {
        action: 'approve',
        id: job.id,
        version: job.version,
        confirmation: job.id,
        approveSponsors: job.sponsors
          .filter((sponsor) => sponsor.reviewStatus === 'pending_review')
          .map(({ id, version }) => ({ id, version }))
      };
    }

    async function approve(id) {
      await service.command(approval(await record(id)), 'reviewer');
    }

    async function snapshot() {
      const tables = [
        'publication_deliveries',
        'sponsor_publication_batches',
        'sponsor_publication_drafts',
        'fund_contributions',
        'admin_audit_log'
      ];
      return Promise.all(
        tables.map(
          async (table) =>
            (await pool.query(`SELECT * FROM ${table} ORDER BY id`)).rows
        )
      );
    }

    // Model a saved pre-fix selection using a snapshot produced by the normal
    // editorial command. The fixture changes no media/source schema or bytes.
    async function assignForeignMedia(id, mediaId) {
      const editorialId = await compose(undefined, mediaId);
      const editorial = await raw(editorialId);
      await pool.query(
        'UPDATE publication_deliveries SET media_id=$2,media_snapshot=$3::jsonb WHERE id=$1',
        [id, mediaId, JSON.stringify(editorial.media_snapshot)]
      );
    }

    await t.test(
      'composition rejects another batch image before storage or writes',
      async () => {
        const f = await fixtures();
        const before = await snapshot();
        await assert.rejects(compose(f.batchA, f.mediaB), {
          code: 'MEDIA_NOT_APPROVED',
          status: 409
        });
        assert.deepEqual(reads, []);
        assert.deepEqual(await snapshot(), before);
      }
    );

    await t.test(
      'editing rejects another batch image without changing the saved draft or audit',
      async () => {
        const f = await fixtures();
        const id = await compose(f.batchA, f.mediaA1);
        const job = await record(id);
        reads.length = 0;
        const before = await snapshot();
        await assert.rejects(
          service.command(
            {
              action: 'edit',
              id,
              version: job.version,
              message: 'Rejected foreign image edit',
              scheduledAt: future,
              mediaId: f.mediaB
            },
            'tester'
          ),
          { code: 'MEDIA_NOT_APPROVED', status: 409 }
        );
        assert.deepEqual(reads, []);
        assert.deepEqual(await snapshot(), before);
      }
    );

    await t.test(
      'combined approval rejects a saved foreign image before sponsor approval or storage',
      async () => {
        const f = await fixtures();
        const id = await compose(f.batchA, f.mediaA1);
        await assignForeignMedia(id, f.mediaB);
        await pool.query(
          "UPDATE fund_contributions SET sponsor_review_status='pending_review',updated_at=NOW() WHERE id=$1",
          [f.a1]
        );
        const command = approval(await record(id));
        assert.equal(command.approveSponsors.length, 1);
        reads.length = 0;
        const before = await snapshot();
        await assert.rejects(service.command(command, 'reviewer'), {
          code: 'MEDIA_NOT_APPROVED',
          status: 409
        });
        assert.deepEqual(reads, []);
        assert.deepEqual(await snapshot(), before);
      }
    );

    await t.test(
      'both dossiers in a batch may supply its image through composition, editing and dispatch',
      async () => {
        const f = await fixtures();
        const id = await compose(f.batchA, f.mediaA1);
        assert.deepEqual(
          (await raw(id)).source_snapshot.map(
            (source) => source.contribution_id
          ),
          [f.a1, f.a2]
        );
        const job = await record(id);
        await service.command(
          {
            action: 'edit',
            id,
            version: job.version,
            message: job.message,
            scheduledAt: future,
            mediaId: f.mediaA2
          },
          'tester'
        );
        reads.length = 0;
        await approve(id);
        await service.tick(due);
        await service.tick(due);
        const published = await record(id);
        assert.equal(published.status, 'published');
        assert.equal(published.mediaId, f.mediaA2);
        assert.ok(reads.length > 0);
        assert.deepEqual([...new Set(reads)], [`${f.mediaA2}/processed`]);
        const audits = (
          await pool.query(
            "SELECT id FROM admin_audit_log WHERE entity_id=$1 AND action='publication_automation.published'",
            [id]
          )
        ).rows;
        assert.equal(audits.length, 1);
      }
    );

    await t.test(
      'an editorial delivery keeps the global eligible media catalogue and publishes a different batch image',
      async () => {
        const f = await fixtures();
        const id = await compose(undefined, f.mediaB);
        assert.equal((await record(id)).batchId, null);
        assert.deepEqual(
          (await service.mediaOptions(id)).map((asset) => asset.id).sort(),
          [f.mediaA1, f.mediaA2, f.mediaB].sort()
        );
        reads.length = 0;
        await approve(id);
        await service.tick(due);
        assert.equal((await record(id)).status, 'published');
        assert.deepEqual([...new Set(reads)], [`${f.mediaB}/processed`]);
      }
    );

    await t.test(
      'the media catalogue filters batch membership before its 200-asset limit',
      async () => {
        const f = await fixtures();
        const id = await compose(f.batchA);
        const editorialId = await compose();
        const newerForeignIds = new Set(await media(f.b, 201, true));
        const global = await service.mediaOptions();
        const editorial = await service.mediaOptions(editorialId);
        assert.equal(global.length, 200);
        assert.ok(global.every((asset) => newerForeignIds.has(asset.id)));
        assert.deepEqual(
          editorial.map((asset) => asset.id).sort(),
          global.map((asset) => asset.id).sort()
        );
        assert.deepEqual(
          (await service.mediaOptions(id)).map((asset) => asset.id).sort(),
          [f.mediaA1, f.mediaA2].sort()
        );
        await assert.rejects(service.mediaOptions('invalid-id'), {
          code: 'INVALID_FILTER',
          status: 400
        });
        await assert.rejects(service.mediaOptions(randomUUID()), {
          code: 'DELIVERY_NOT_FOUND',
          status: 404
        });
        assert.deepEqual(reads, []);
      }
    );

    await t.test(
      'combined acceptance approves a pending dossier with its own saved image transactionally',
      async () => {
        const f = await fixtures();
        const id = await compose(f.batchA, f.mediaA1);
        const original = await raw(id);
        await pool.query(
          "UPDATE fund_contributions SET sponsor_review_status='pending_review',updated_at=NOW() WHERE id=$1",
          [f.a1]
        );
        assert.deepEqual(
          (await service.mediaOptions(id)).map((asset) => asset.id),
          [f.mediaA2]
        );
        await approve(id);
        const sponsor = (
          await pool.query(
            'SELECT sponsor_review_status,sponsor_site_visibility_held FROM fund_contributions WHERE id=$1',
            [f.a1]
          )
        ).rows[0];
        assert.equal(sponsor.sponsor_review_status, 'approved');
        assert.equal(sponsor.sponsor_site_visibility_held, true);
        assert.equal((await record(id)).status, 'approved');
        assert.deepEqual(
          (await raw(id)).media_snapshot,
          original.media_snapshot
        );
        assert.ok(
          (await service.mediaOptions(id)).some(
            (asset) => asset.id === f.mediaA1
          )
        );
        await service.tick(due);
        assert.equal((await record(id)).status, 'published');
      }
    );

    await t.test(
      'a legacy authorized delivery with a foreign image is revoked before storage or dispatch',
      async () => {
        const f = await fixtures();
        const id = await compose(f.batchA, f.mediaA1);
        await approve(id);
        await assignForeignMedia(id, f.mediaB);
        const original = await raw(id);
        reads.length = 0;
        await service.tick(due);
        await service.tick(due);
        const blocked = await raw(id);
        assert.equal(blocked.status, 'blocked');
        assert.equal(blocked.error_code, 'MEDIA_NOT_APPROVED');
        assert.equal(blocked.approved_at, null);
        assert.equal(blocked.approved_by, null);
        assert.equal(blocked.published_at, null);
        assert.equal(blocked.external_post_id, null);
        assert.equal(blocked.attempts, 0);
        assert.equal(blocked.version, original.version + 1);
        assert.deepEqual(blocked.media_snapshot, original.media_snapshot);
        assert.deepEqual(blocked.source_snapshot, original.source_snapshot);
        assert.deepEqual(reads, []);
        const audits = (
          await pool.query(
            "SELECT action,metadata FROM admin_audit_log WHERE entity_id=$1 AND action IN ('publication_automation.media_invalidated','publication_automation.published')",
            [id]
          )
        ).rows;
        assert.equal(audits.length, 1);
        assert.equal(
          audits[0].action,
          'publication_automation.media_invalidated'
        );
        assert.equal(audits[0].metadata.code, 'MEDIA_NOT_APPROVED');
      }
    );
  }
);
