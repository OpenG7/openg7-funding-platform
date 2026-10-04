import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import test from 'node:test';

import { createAdminSponsorshipMediaHttpHandler } from '../../dist/apps/funding-api/src/admin-sponsorship-media.http.js';
import { createPublicSponsorMediaHttpHandler } from '../../dist/apps/funding-api/src/public-sponsor-media.http.js';
import { insertAdminAuditLog } from '../../dist/apps/funding-api/src/fund-admin.repository.js';
import { updateSponsorshipReview } from '../../dist/apps/funding-api/src/fund-contributions.repository.js';
import { readBody } from '../../dist/apps/funding-api/src/http-transport.js';
import {
  getApprovedPublicSponsorMedia,
  getSponsorMediaStorageRecord,
  listPublicSponsorMediaByContributionIds,
  listSponsorMediaAssets,
  reviewSponsorMediaAsset
} from '../../dist/apps/funding-api/src/sponsor-media.repository.js';
import { setSponsorshipWebsiteVisibility } from '../../dist/apps/funding-api/src/sponsorship-website.service.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

test(
  'approved media remain private until website visibility and known URLs are revoked immediately',
  { timeout: 90000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);
    const origin = 'https://funding.example.test';
    const image = Buffer.from('synthetic-private-processed-image');
    const privateReads = [];
    const failures = [];
    const isUuid = (value) =>
      typeof value === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value
      );
    const writeJson = (_request, response, status, payload) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(payload));
    };
    const storage = {
      driver: 'ovh-s3',
      async readPrivateObject(key) {
        privateReads.push(key);
        return image;
      },
      async publishObject() {
        assert.fail(
          'media review must not create an anonymously readable copy'
        );
      },
      async readPublicObject() {
        assert.fail('public delivery must read the controlled private object');
      },
      async deletePublicObject() {
        assert.fail('this recipe must not modify historical public objects');
      }
    };
    const admin = createAdminSponsorshipMediaHttpHandler({
      publicBaseOrigin: origin,
      SPONSOR_MEDIA_ALT_TEXT_MAX_LENGTH: 300,
      ensureAdminAccess(request, response) {
        if (request.headers.authorization === 'Bearer synthetic-admin-session')
          return true;
        writeJson(request, response, 401, { error: 'Unauthorized' });
        return false;
      },
      getAdminAuditActor: () => 'synthetic-media-reviewer',
      readBody,
      writeJson,
      isValidUuid: isUuid,
      isValidAdminExpectedVersion: (value) =>
        typeof value === 'string' && value.length > 0,
      routeAssetId: () => null,
      getSponsorMediaStorageRecord: (id) =>
        getSponsorMediaStorageRecord(pool, id),
      reviewSponsorMediaAsset: (input) => reviewSponsorMediaAsset(pool, input),
      sponsorMediaStorage: storage,
      sponsorMediaPublicUrl: (id) => `/api/public/sponsor-media/${id}`,
      writeSponsorMediaMutationFailure: (request, response, status) =>
        writeJson(request, response, status === 'conflict' ? 409 : 404, {
          error: status
        }),
      insertAdminAuditLog: (input) => insertAdminAuditLog(pool, input),
      reportFailure: (...args) => failures.push(args)
    });
    const publicMedia = createPublicSponsorMediaHttpHandler({
      databaseAvailable: () => true,
      writeJson,
      writeBinary(_request, response, status, bytes, contentType, headers) {
        response.writeHead(status, { 'Content-Type': contentType, ...headers });
        response.end(bytes);
      },
      routeAssetId(url, ...prefixes) {
        const pathname = new URL(url, origin).pathname;
        const prefix = prefixes.find((value) => pathname.startsWith(value));
        const id = prefix ? pathname.slice(prefix.length) : '';
        return isUuid(id) ? id : null;
      },
      getApprovedPublicSponsorMedia: (id) =>
        getApprovedPublicSponsorMedia(pool, id),
      sponsorMediaStorage: storage,
      getSponsorLogoFilenameFromUrl: () => null,
      reportFailure: (...args) => failures.push(args)
    });
    const server = createServer(async (request, response) => {
      try {
        if (await admin(request, response)) return;
        if (await publicMedia(request, response)) return;
        writeJson(request, response, 404, { error: 'Not found' });
      } catch (error) {
        failures.push(error);
        writeJson(request, response, 500, {
          error: 'Synthetic handler failure'
        });
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const localOrigin = `http://127.0.0.1:${server.address().port}`;
    const contributionId = (
      await pool.query(`INSERT INTO fund_contributions
        (contribution_type, amount_cents, currency, status, public_display_consent,
         sponsor_review_status, sponsor_company_name)
        VALUES ('sponsorship_interest', 25000, 'cad', 'paid', FALSE,
          'pending_review', 'Synthetic private sponsor') RETURNING id`)
    ).rows[0].id;
    const seedAsset = async (legacy = false) =>
      (
        await pool.query(
          `INSERT INTO sponsor_media_assets
            (contribution_id, kind, original_filename, original_mime_type,
             original_size_bytes, original_storage_key, processed_size_bytes,
             processed_storage_key, public_storage_key, public_url, checksum_sha256,
             width, height, review_status)
           VALUES ($1, 'supporting_image', 'synthetic.png', 'image/png', 100,
             'private/original/' || gen_random_uuid(), 80,
             'private/processed/' || gen_random_uuid(), $2, $3, repeat('a', 64),
             100, 100, $4) RETURNING id, updated_at::text AS version,
               processed_storage_key`,
          [
            contributionId,
            legacy ? 'public/sponsors/synthetic-legacy.webp' : null,
            legacy
              ? 'https://storage.example.invalid/synthetic-legacy.webp'
              : null,
            legacy ? 'approved' : 'pending_review'
          ]
        )
      ).rows[0];
    const fresh = await seedAsset();
    const path = `/api/public/sponsor-media/${fresh.id}`;
    const reviewResponse = await fetch(
      localOrigin + '/api/admin/sponsorships/media/review',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer synthetic-admin-session',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          assetId: fresh.id,
          expectedVersion: fresh.version,
          reviewStatus: 'approved',
          altText: 'Synthetic approved presentation'
        })
      }
    );
    assert.equal(reviewResponse.status, 200);
    const reviewed = (await reviewResponse.json()).asset;
    assert.equal(reviewed.publicUrl, path);
    const persisted = await getSponsorMediaStorageRecord(pool, fresh.id);
    assert.equal(persisted.reviewStatus, 'approved');
    assert.equal(persisted.publicStorageKey, null);
    const expectPrivate = async (assetPath) => {
      const before = privateReads.length;
      const response = await fetch(localOrigin + assetPath);
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: 'Not found' });
      assert.equal(
        privateReads.length,
        before,
        'ineligible media are not read'
      );
    };
    await expectPrivate(path);
    await pool.query(
      'UPDATE fund_contributions SET public_display_consent=TRUE WHERE id=$1',
      [contributionId]
    );
    const version = async () =>
      (
        await pool.query(
          'SELECT updated_at::text AS version FROM fund_contributions WHERE id=$1',
          [contributionId]
        )
      ).rows[0].version;
    assert.equal(
      (
        await updateSponsorshipReview(pool, {
          contributionId,
          expectedVersion: await version(),
          reviewStatus: 'approved',
          reviewNote: null
        })
      ).status,
      'updated'
    );
    await expectPrivate(path);
    const decide = async (visible) => {
      assert.equal(
        await setSponsorshipWebsiteVisibility(
          pool,
          {
            contributionId,
            expectedVersion: await version(),
            visible,
            confirmed: true
          },
          'synthetic-media-reviewer'
        ),
        'updated'
      );
    };
    const expectVisible = async (assetPath, privateKey) => {
      const response = await fetch(localOrigin + assetPath);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('content-type'), 'image/webp');
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), image);
      assert.equal(privateReads.at(-1), privateKey);
    };
    await decide(true);
    await expectVisible(path, fresh.processed_storage_key);
    await decide(false);
    await expectPrivate(path);
    assert.equal(
      (await listSponsorMediaAssets(pool, contributionId))[0].publicUrl,
      path
    );
    await decide(true);
    await expectVisible(path, fresh.processed_storage_key);
    const legacy = await seedAsset(true);
    const legacyPath = `/api/public/sponsor-media/${legacy.id}`;
    const publicAssets = (
      await listPublicSponsorMediaByContributionIds(pool, [contributionId])
    ).get(contributionId);
    assert.doesNotMatch(
      JSON.stringify(publicAssets),
      /storage\.example|public\/sponsors|private\/processed/
    );
    assert.equal(
      publicAssets.find((asset) => asset.id === legacy.id).url,
      legacyPath
    );
    assert.equal(
      (await listSponsorMediaAssets(pool, contributionId)).find(
        (asset) => asset.id === legacy.id
      ).publicUrl,
      legacyPath
    );
    assert.equal(
      (await getSponsorMediaStorageRecord(pool, legacy.id)).publicStorageKey,
      'public/sponsors/synthetic-legacy.webp'
    );
    assert.equal(
      (
        await pool.query(
          'SELECT public_url FROM sponsor_media_assets WHERE id=$1',
          [legacy.id]
        )
      ).rows[0].public_url,
      'https://storage.example.invalid/synthetic-legacy.webp',
      'legacy database evidence is not rewritten while projections use the controlled route'
    );
    await expectVisible(legacyPath, legacy.processed_storage_key);
    await decide(false);
    await expectPrivate(path);
    await expectPrivate(legacyPath);
    await decide(true);
    await pool.query(
      'UPDATE fund_contributions SET public_display_consent=FALSE WHERE id=$1',
      [contributionId]
    );
    await expectPrivate(path);
    await expectPrivate(legacyPath);
    assert.deepEqual(failures, []);
  }
);

test(
  'migration 032 preserves historical media while allowing private approved media and retaining remediation keys',
  { timeout: 90000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres({ migrate: false });
    t.after(stop);
    const directory = new URL(
      '../../apps/funding-api/migrations/',
      import.meta.url
    );
    const migrations = (await readdir(directory))
      .filter(
        (filename) =>
          /^\d{3}_.+\.sql$/.test(filename) && Number(filename.slice(0, 3)) <= 31
      )
      .sort();
    for (const filename of migrations)
      await pool.query(await readFile(new URL(filename, directory), 'utf8'));
    const contributionId = (
      await pool.query(`INSERT INTO fund_contributions
        (contribution_type, amount_cents, currency, status)
        VALUES ('sponsorship_interest', 25000, 'cad', 'paid') RETURNING id`)
    ).rows[0].id;
    const seed = async (legacy = false) =>
      (
        await pool.query(
          `INSERT INTO sponsor_media_assets
            (contribution_id, kind, original_filename, original_mime_type,
             original_size_bytes, original_storage_key, processed_size_bytes,
             processed_storage_key, public_storage_key, public_url, checksum_sha256,
             width, height, review_status)
           VALUES ($1, 'supporting_image', 'synthetic.png', 'image/png', 100,
             'private/original/' || gen_random_uuid(), 80,
             'private/processed/' || gen_random_uuid(), $2, $3, repeat('a', 64),
             100, 100, $4) RETURNING *`,
          [
            contributionId,
            legacy ? 'public/sponsors/synthetic-legacy.webp' : null,
            legacy
              ? 'https://storage.example.invalid/synthetic-legacy.webp'
              : null,
            legacy ? 'approved' : 'pending_review'
          ]
        )
      ).rows[0];
    const legacy = await seed(true);
    await seed();
    const historicallyRejected = await seed();
    await pool.query(
      "UPDATE sponsor_media_assets SET review_status='rejected' WHERE id=$1",
      [historicallyRejected.id]
    );
    const historicalRows = (
      await pool.query('SELECT * FROM sponsor_media_assets ORDER BY id')
    ).rows;
    await pool.query(
      await readFile(
        new URL('032_keep_approved_sponsor_media_private.sql', directory),
        'utf8'
      )
    );
    assert.deepEqual(
      (await pool.query('SELECT * FROM sponsor_media_assets ORDER BY id')).rows,
      historicalRows,
      'the migration changes constraints without rewriting historical objects or metadata'
    );
    const fresh = await seed();
    const version = async (id) =>
      (
        await pool.query(
          'SELECT updated_at::text AS version FROM sponsor_media_assets WHERE id=$1',
          [id]
        )
      ).rows[0].version;
    const approved = await reviewSponsorMediaAsset(pool, {
      assetId: fresh.id,
      expectedVersion: await version(fresh.id),
      reviewStatus: 'approved',
      altText: 'Synthetic private photo',
      publicStorageKey: null,
      publicUrl: `/api/public/sponsor-media/${fresh.id}`,
      reviewedBy: 'synthetic-media-reviewer'
    });
    assert.equal(approved.status, 'updated');
    assert.equal(approved.asset.publicStorageKey, null);
    await assert.rejects(
      pool.query(
        'UPDATE sponsor_media_assets SET public_url=NULL WHERE id=$1',
        [fresh.id]
      ),
      { code: '23514' },
      'approved media still require a controlled presentation URL'
    );
    const rejected = await reviewSponsorMediaAsset(pool, {
      assetId: legacy.id,
      expectedVersion: await version(legacy.id),
      reviewStatus: 'rejected',
      altText: null,
      publicStorageKey: legacy.public_storage_key,
      publicUrl: null,
      reviewedBy: 'synthetic-media-reviewer'
    });
    assert.equal(rejected.status, 'updated');
    assert.equal(rejected.asset.publicUrl, null);
    assert.equal(rejected.asset.publicStorageKey, legacy.public_storage_key);
    await assert.rejects(
      pool.query('UPDATE sponsor_media_assets SET public_url=$2 WHERE id=$1', [
        legacy.id,
        `/api/public/sponsor-media/${legacy.id}`
      ]),
      { code: '23514' },
      'rejected media cannot retain an exposed presentation URL'
    );
    const constraints = (
      await pool.query(`SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint WHERE conrelid='sponsor_media_assets'::regclass
        AND conname='sponsor_media_assets_review_exposure_check'`)
    ).rows;
    assert.equal(constraints.length, 1);
  }
);
