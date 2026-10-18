import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import sharp from 'sharp';
import { SponsorMediaUploadService } from '../../dist/apps/funding-api/src/sponsor-media-upload.service.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

test(
  'canonical admin upload shares the media model and safely reconciles concurrent nonce attempts',
  { timeout: 180000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);
    const bytes = await sharp({
      create: { width: 64, height: 64, channels: 3, background: '#237096' }
    })
      .png()
      .toBuffer();
    const actor = 'synthetic-media-uploader',
      objects = new Map(),
      writes = [],
      deletes = [];
    const storage = {
      driver: 'local',
      writePrivateObject: async (input) => {
        writes.push(input.key);
        objects.set(input.key, input.data);
      },
      deletePrivateObject: async (key) => {
        deletes.push(key);
        return objects.delete(key);
      }
    };
    const service = new SponsorMediaUploadService(pool, storage, {
      maxUploadBytes: 1024 * 1024,
      maxSupportingImages: 1
    });
    async function contribution() {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO fund_contributions(id,contribution_type,amount_cents,currency,status,paid_at,public_reference) VALUES($1,'sponsorship_interest',5000,'cad','paid',NOW(),$2)`,
        [id, 'SYNTHETIC-UPLOAD-' + id]
      );
      return id;
    }
    const input = (contributionId) => ({
      requestId: randomUUID(),
      contributionId,
      kind: 'supporting_image',
      filename: 'synthetic.png',
      contentType: 'image/png',
      bytes
    });
    const count = async (sql, params = []) =>
      Number((await pool.query(sql, params)).rows[0].n);
    await t.test(
      'concurrent attempts with one request create one asset and only clean their losing nonce',
      async () => {
        const request = input(await contribution());
        let arrivals = 0,
          release;
        const bothWritten = new Promise((resolve) => (release = resolve));
        const concurrentStorage = {
          ...storage,
          writePrivateObject: async (data) => {
            await storage.writePrivateObject(data);
            if (data.key.endsWith('processed.webp')) {
              arrivals++;
              if (arrivals === 2) release();
              await bothWritten;
            }
          }
        };
        const concurrent = new SponsorMediaUploadService(
          pool,
          concurrentStorage,
          { maxUploadBytes: 1024 * 1024, maxSupportingImages: 1 }
        );
        const [first, second] = await Promise.all([
          concurrent.upload(request, actor),
          concurrent.upload({ ...request }, actor)
        ]);
        assert.equal(first.asset.id, second.asset.id);
        assert.equal(first.asset.kind, 'supporting_image');
        assert.equal(first.asset.reviewStatus, 'pending_review');
        assert.equal(first.asset.usage.state, 'needs_confirmation');
        assert.equal(
          await count(
            'SELECT count(*) AS n FROM sponsor_media_assets WHERE contribution_id=$1',
            [request.contributionId]
          ),
          1
        );
        const owned = [...objects.keys()].filter((key) =>
          key.includes(request.contributionId)
        );
        assert.equal(owned.length, 2);
        assert.ok(owned.every((key) => key.includes(first.asset.id)));
        assert.equal(deletes.length, 2);
        assert.ok(deletes.every((key) => !key.includes(first.asset.id)));
        assert.equal(
          await count(
            "SELECT count(*) AS n FROM admin_audit_log WHERE action='sponsorship.media.upload' AND entity_id=$1",
            [first.asset.id]
          ),
          1
        );
        const written = writes.length;
        assert.equal(
          (await service.upload(request, actor)).asset.id,
          first.asset.id
        );
        assert.equal(writes.length, written);
        await assert.rejects(
          service.upload({ ...request, filename: 'different.png' }, actor),
          { code: 'MEDIA_REQUEST_CONFLICT' }
        );
        await assert.rejects(service.upload(request, 'another-actor'), {
          code: 'MEDIA_REQUEST_CONFLICT'
        });
        assert.equal(writes.length, written);
        await assert.rejects(
          service.upload({ ...request, requestId: randomUUID() }, actor),
          { code: 'supporting_image_limit_reached' }
        );
        assert.equal(
          [...objects.keys()].filter((key) =>
            key.includes(request.contributionId)
          ).length,
          2
        );
      }
    );
    await t.test(
      'one canonical logo replaces a pending logo without writing the historical logo column',
      async () => {
        const id = await contribution();
        const first = await service.upload(
            { ...input(id), kind: 'logo' },
            actor
          ),
          second = await service.upload({ ...input(id), kind: 'logo' }, actor);
        assert.notEqual(first.asset.id, second.asset.id);
        assert.equal(
          [...objects.keys()].filter((key) => key.includes(id)).length,
          2
        );
        assert.equal(
          [...objects.keys()].some((key) => key.includes(first.asset.id)),
          false
        );
        assert.equal(
          await count(
            "SELECT count(*) AS n FROM sponsor_media_assets WHERE contribution_id=$1 AND kind='logo' AND deleted_at IS NULL",
            [id]
          ),
          1
        );
        assert.equal(
          (
            await pool.query(
              'SELECT sponsor_logo_url FROM fund_contributions WHERE id=$1',
              [id]
            )
          ).rows[0].sponsor_logo_url,
          null
        );
      }
    );
    await t.test(
      'replacement cleanup failure stays auditable without turning a committed upload into another attempt',
      async () => {
        const id = await contribution(),
          first = await service.upload({ ...input(id), kind: 'logo' }, actor),
          request = { ...input(id), kind: 'logo' };
        const failing = new SponsorMediaUploadService(
          pool,
          {
            ...storage,
            deletePrivateObject: async (key) => {
              if (key.includes(first.asset.id))
                throw new Error('synthetic storage unavailable');
              return storage.deletePrivateObject(key);
            }
          },
          { maxUploadBytes: 1024 * 1024, maxSupportingImages: 1 }
        );
        const second = await failing.upload(request, actor);
        assert.equal(second.uploaded, true);
        assert.notEqual(second.asset.id, first.asset.id);
        assert.equal(
          [...objects.keys()].filter((key) => key.includes(id)).length,
          4
        );
        const deferred = (
          await pool.query(
            "SELECT metadata FROM admin_audit_log WHERE action='sponsorship.media.replacement_cleanup.deferred' AND entity_id=$1",
            [first.asset.id]
          )
        ).rows;
        assert.equal(deferred.length, 1);
        assert.equal(deferred[0].metadata.replacementAssetId, second.asset.id);
        assert.equal(deferred[0].metadata.requestId, request.requestId);
        const previousWrites = writes.length;
        assert.equal(
          (await failing.upload(request, actor)).asset.id,
          second.asset.id
        );
        assert.equal(writes.length, previousWrites);
      }
    );
    await t.test(
      'a replacement cleanup audit outage cannot change the confirmed upload outcome',
      async () => {
        const id = await contribution(),
          first = await service.upload({ ...input(id), kind: 'logo' }, actor);
        await pool.query(
          `CREATE FUNCTION synthetic_fail_cleanup_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE 'sponsorship.media.replacement_cleanup.%' THEN RAISE EXCEPTION 'synthetic audit unavailable'; END IF; RETURN NEW; END $$;CREATE TRIGGER synthetic_fail_cleanup_audit BEFORE INSERT ON admin_audit_log FOR EACH ROW EXECUTE FUNCTION synthetic_fail_cleanup_audit()`
        );
        const messages = [],
          original = console.error;
        console.error = (...args) => messages.push(args);
        try {
          const request = { ...input(id), kind: 'logo' },
            result = await service.upload(request, actor);
          assert.equal(result.uploaded, true);
          assert.equal(
            [...objects.keys()].filter((key) => key.includes(id)).length,
            2
          );
          assert.equal(
            messages[0][1].code,
            'MEDIA_REPLACEMENT_CLEANUP_AUDIT_UNAVAILABLE'
          );
          const audit = (
            await pool.query(
              "SELECT actor,metadata FROM admin_audit_log WHERE action='sponsorship.media.upload' AND entity_id=$1",
              [result.asset.id]
            )
          ).rows;
          assert.equal(audit.length, 1);
          assert.equal(audit[0].actor, actor);
          assert.equal(audit[0].metadata.requestId, request.requestId);
          assert.equal(audit[0].metadata.replacedAssetId, first.asset.id);
          assert.equal(
            (await service.upload(request, actor)).asset.id,
            result.asset.id
          );
        } finally {
          console.error = original;
          await pool.query(
            'DROP TRIGGER synthetic_fail_cleanup_audit ON admin_audit_log;DROP FUNCTION synthetic_fail_cleanup_audit()'
          );
        }
      }
    );
    await t.test(
      'known audit rollback cleans only its nonce and never leaves an upload receipt',
      async () => {
        const request = input(await contribution());
        await pool.query(
          `CREATE FUNCTION synthetic_fail_upload_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='sponsorship.media.upload' THEN RAISE EXCEPTION 'synthetic audit unavailable'; END IF; RETURN NEW; END $$;CREATE TRIGGER synthetic_fail_upload_audit BEFORE INSERT ON admin_audit_log FOR EACH ROW EXECUTE FUNCTION synthetic_fail_upload_audit()`
        );
        try {
          await assert.rejects(service.upload(request, actor), {
            code: 'SPONSOR_MEDIA_UPLOAD_UNAVAILABLE'
          });
          assert.equal(
            [...objects.keys()].filter((key) =>
              key.includes(request.contributionId)
            ).length,
            0
          );
          assert.equal(
            await count(
              'SELECT count(*) AS n FROM sponsor_media_workspace_commands WHERE contribution_id=$1',
              [request.contributionId]
            ),
            0
          );
        } finally {
          await pool.query(
            'DROP TRIGGER synthetic_fail_upload_audit ON admin_audit_log;DROP FUNCTION synthetic_fail_upload_audit()'
          );
        }
      }
    );
    await t.test(
      'a lost COMMIT response retains committed objects and stable replay returns the receipt without new storage',
      async () => {
        const request = input(await contribution());
        let loseCommit = true;
        const uncertainPool = {
          query: (...args) => pool.query(...args),
          connect: async () => {
            const client = await pool.connect();
            return {
              query: async (...args) => {
                const result = await client.query(...args);
                if (args[0] === 'COMMIT' && loseCommit) {
                  loseCommit = false;
                  throw new Error('synthetic lost response');
                }
                return result;
              },
              release: () => client.release()
            };
          }
        };
        const uncertain = new SponsorMediaUploadService(
          uncertainPool,
          storage,
          { maxUploadBytes: 1024 * 1024, maxSupportingImages: 1 }
        );
        await assert.rejects(uncertain.upload(request, actor), {
          code: 'SPONSOR_MEDIA_UPLOAD_UNCONFIRMED'
        });
        assert.equal(
          [...objects.keys()].filter((key) =>
            key.includes(request.contributionId)
          ).length,
          2
        );
        const priorWrites = writes.length,
          recovered = await service.upload(request, actor);
        assert.equal(recovered.uploaded, true);
        assert.equal(writes.length, priorWrites);
        assert.equal(
          await count(
            'SELECT count(*) AS n FROM sponsor_media_assets WHERE contribution_id=$1',
            [request.contributionId]
          ),
          1
        );
      }
    );
  }
);
