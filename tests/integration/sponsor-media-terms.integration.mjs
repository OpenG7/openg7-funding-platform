import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { getSponsorMediaUsageTerms } from '../../dist/packages/funding-core/src/index.js';
import {
  createSponsorMediaAsset,
  getSponsorMediaStorageRecord
} from '../../dist/apps/funding-api/src/sponsor-media.repository.js';
import { updateSponsorMediaUsage } from '../../dist/apps/funding-api/src/sponsor-media-usage.repository.js';
import { readSponsorMediaFollowupUploadReceipt } from '../../dist/apps/funding-api/src/sponsor-media/followup-upload-receipt.js';

const rights = {
  state: 'confirmed',
  channels: ['website', 'facebook'],
  targets: ['openg7'],
  transformations: ['technical'],
  credit: null,
  restrictions: null
};
const acceptance = (locale = 'fr-CA') => {
  const { text, ...terms } = getSponsorMediaUsageTerms(locale);
  return { ...terms, accepted: true };
};
const code = (expected) => (error) =>
  error.code === expected || error.cause?.code === expected;

test(
  'media terms are exact prospective evidence with atomic, replayable rights and a current-only projection in disposable PostgreSQL',
  { timeout: 180000 },
  async (t) => {
    const database = await startDisposablePostgres();
    t.after(database.stop);
    const pool = database.pool;
    t.mock.method(globalThis, 'fetch', async () => {
      throw new Error('No external requests permitted.');
    });
    async function input(locale = 'fr-CA') {
      const contributionId = (
        await pool.query(
          "INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,sponsor_review_status) VALUES('sponsorship_interest',50000,'cad','paid','pending_review') RETURNING id"
        )
      ).rows[0].id;
      return {
        id: randomUUID(),
        requestId: randomUUID(),
        requestFingerprint: 'c'.repeat(64),
        contributionId,
        kind: 'supporting_image',
        uploadedBy: 'sponsor',
        auditActor: 'sponsor-followup',
        storageDriver: 'local',
        originalFilename: 'synthetic.png',
        originalMimeType: 'image/png',
        originalSizeBytes: 100,
        originalStorageKey: randomUUID() + '/original.png',
        processedSizeBytes: 80,
        processedStorageKey: randomUUID() + '/processed.webp',
        originalChecksumSha256: 'a'.repeat(64),
        checksumSha256: 'b'.repeat(64),
        width: 32,
        height: 32,
        altText: null,
        maxSupportingImages: 1,
        usage: rights,
        termsAcceptance: acceptance(locale)
      };
    }
    const counts = async (contributionId) =>
      (
        await pool.query(
          `SELECT
      (SELECT count(*)::int FROM sponsor_media_assets WHERE contribution_id=$1) AS assets,
      (SELECT count(*)::int FROM sponsor_media_terms_acceptances WHERE contribution_id=$1) AS acceptances,
      (SELECT count(*)::int FROM sponsor_media_usage_history WHERE contribution_id=$1) AS history,
      (SELECT count(*)::int FROM sponsor_media_workspace_commands WHERE contribution_id=$1) AS uploads`,
          [contributionId]
        )
      ).rows[0];
    const update = (
      request,
      asset,
      usage = rights,
      termsAcceptance = acceptance()
    ) => ({
      contributionId: request.contributionId,
      assetId: asset.id,
      requestId: randomUUID(),
      expectedVersion: asset.version,
      actor: 'sponsor-followup',
      usage,
      ...(termsAcceptance ? { termsAcceptance } : {})
    });

    await t.test(
      'both languages preserve canonical text, exact choices, two distinct file hashes and honest link identity',
      async () => {
        for (const locale of ['fr-CA', 'en']) {
          const request = await input(locale),
            created = await createSponsorMediaAsset(pool, request);
          assert.equal(created.status, 'created');
          assert.equal(created.asset.reviewStatus, 'pending_review');
          assert.equal(created.asset.publicUrl, null);
          const summary = created.asset.usageAcceptance;
          assert.equal(summary.source, 'platform_acceptance');
          assert.equal(summary.locale, locale);
          assert.equal(summary.termsVersion, request.termsAcceptance.version);
          assert.equal(
            summary.termsFingerprint,
            request.termsAcceptance.fingerprint
          );
          assert.ok(Number.isFinite(Date.parse(summary.acceptedAt)));
          const evidence = (
            await pool.query(
              'SELECT * FROM sponsor_media_terms_acceptances WHERE id=$1',
              [summary.id]
            )
          ).rows[0];
          assert.equal(evidence.asset_id, request.id);
          assert.equal(evidence.contribution_id, request.contributionId);
          assert.equal(evidence.request_id, request.requestId);
          assert.deepEqual(evidence.usage_rights, rights);
          assert.equal(
            evidence.original_checksum_sha256,
            request.originalChecksumSha256
          );
          assert.equal(
            evidence.processed_checksum_sha256,
            request.checksumSha256
          );
          assert.equal(
            evidence.terms_text,
            getSponsorMediaUsageTerms(locale).text
          );
          assert.equal(evidence.actor, 'sponsor-followup');
          assert.equal(evidence.identity_mode, 'private_followup_link');
          const stored = await getSponsorMediaStorageRecord(pool, request.id);
          assert.deepEqual(stored.usageAcceptance, summary);
          assert.match(
            summary.acceptedAt,
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
          );
          const snapshot = (
            await pool.query(
              "SELECT moderation_snapshot('media',$1) AS snapshot",
              [request.id]
            )
          ).rows[0].snapshot;
          assert.equal(snapshot.usageAcceptanceId, summary.id);
          assert.deepEqual(
            {
              ...stored.usageAcceptance,
              acceptedAt: new Date(
                stored.usageAcceptance.acceptedAt
              ).toISOString()
            },
            {
              ...summary,
              acceptedAt: new Date(summary.acceptedAt).toISOString()
            }
          );
          assert.deepEqual(await counts(request.contributionId), {
            assets: 1,
            acceptances: 1,
            history: 1,
            uploads: 1
          });
          assert.equal(Object.hasOwn(stored.usageAcceptance, 'actor'), false);
          assert.equal(
            Object.hasOwn(stored.usageAcceptance, 'termsText'),
            false
          );
          for (const sql of [
            'UPDATE sponsor_media_terms_acceptances SET terms_locale=terms_locale WHERE id=$1',
            'DELETE FROM sponsor_media_terms_acceptances WHERE id=$1'
          ])
            await assert.rejects(pool.query(sql, [summary.id]), /immutable/i);
        }
      }
    );

    await t.test(
      'missing, forged, stale or language-mismatched acceptances cannot create an upload or evidence',
      async () => {
        const base = await input();
        for (const patch of [
          { termsAcceptance: undefined },
          { termsAcceptance: { ...base.termsAcceptance, accepted: false } },
          { termsAcceptance: { ...base.termsAcceptance, version: 'old' } },
          {
            termsAcceptance: {
              ...base.termsAcceptance,
              fingerprint: 'f'.repeat(64)
            }
          },
          { termsAcceptance: { ...base.termsAcceptance, locale: 'en' } },
          { originalChecksumSha256: undefined },
          { usage: { ...rights, state: 'withdrawn' } }
        ])
          await assert.rejects(
            createSponsorMediaAsset(pool, { ...base, ...patch })
          );
        assert.deepEqual(await counts(base.contributionId), {
          assets: 0,
          acceptances: 0,
          history: 0,
          uploads: 0
        });
        const unpaid = await input();
        await pool.query(
          "UPDATE fund_contributions SET status='pending' WHERE id=$1",
          [unpaid.contributionId]
        );
        assert.equal(
          (await createSponsorMediaAsset(pool, unpaid)).status,
          'contribution_not_found'
        );
        assert.deepEqual(await counts(unpaid.contributionId), {
          assets: 0,
          acceptances: 0,
          history: 0,
          uploads: 0
        });
      }
    );

    await t.test(
      'a failure after evidence insertion rolls back asset, evidence, history, receipt and audit together',
      async () => {
        const request = await input();
        const failing = {
          connect: async () => {
            const client = await pool.connect();
            return {
              release: () => client.release(),
              query: (sql, ...args) => {
                if (
                  typeof sql === 'string' &&
                  sql.includes('INSERT INTO sponsor_media_usage_history')
                )
                  throw new Error('Synthetic history failure');
                return client.query(sql, ...args);
              }
            };
          }
        };
        await assert.rejects(createSponsorMediaAsset(failing, request));
        assert.deepEqual(await counts(request.contributionId), {
          assets: 0,
          acceptances: 0,
          history: 0,
          uploads: 0
        });
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM admin_audit_log WHERE entity_id=$1 AND action='sponsorship.media.upload'",
              [request.id]
            )
          ).rows[0].n,
          0
        );
      }
    );

    await t.test(
      'concurrent upload attempts at a quota of one share one asset, one acceptance and one receipt',
      async () => {
        const request = await input(),
          second = {
            ...request,
            id: randomUUID(),
            originalStorageKey: 'second/original',
            processedStorageKey: 'second/processed'
          };
        const [a, b] = await Promise.all([
          createSponsorMediaAsset(pool, request),
          createSponsorMediaAsset(pool, second)
        ]);
        assert.equal(a.status, 'created');
        assert.deepEqual(a.asset, b.asset);
        assert.deepEqual(await counts(request.contributionId), {
          assets: 1,
          acceptances: 1,
          history: 1,
          uploads: 1
        });
        assert.deepEqual(
          (
            await createSponsorMediaAsset(pool, {
              ...request,
              id: randomUUID()
            })
          ).asset,
          a.asset
        );
        const receipt = await readSponsorMediaFollowupUploadReceipt(
          pool,
          request.contributionId,
          request.requestId,
          request.requestFingerprint
        );
        assert.deepEqual(receipt, { uploaded: true, asset: a.asset });
        await assert.rejects(
          createSponsorMediaAsset(pool, {
            ...request,
            id: randomUUID(),
            requestFingerprint: 'd'.repeat(64)
          }),
          code('MEDIA_REQUEST_CONFLICT')
        );
        assert.equal(
          await readSponsorMediaFollowupUploadReceipt(
            pool,
            randomUUID(),
            request.requestId
          ),
          null
        );
        assert.deepEqual(await counts(request.contributionId), {
          assets: 1,
          acceptances: 1,
          history: 1,
          uploads: 1
        });
      }
    );

    await t.test(
      'rights edits require acceptance, bind the current file, replay once and withdrawal clears the current proof without erasing it',
      async () => {
        const request = await input(),
          created = await createSponsorMediaAsset(pool, request);
        const missing = update(request, created.asset, rights, null);
        await assert.rejects(
          updateSponsorMediaUsage(pool, missing),
          code('MEDIA_TERMS_ACCEPTANCE_REQUIRED')
        );
        const foreign = await input();
        await assert.rejects(
          updateSponsorMediaUsage(pool, {
            ...update(request, created.asset),
            contributionId: foreign.contributionId
          }),
          code('MEDIA_NOT_FOUND')
        );
        const command = update(request, created.asset, {
          ...rights,
          channels: ['website']
        });
        const [a, b] = await Promise.all([
          updateSponsorMediaUsage(pool, command),
          updateSponsorMediaUsage(pool, { ...command })
        ]);
        assert.deepEqual(a, b);
        assert.notEqual(
          a.asset.usageAcceptance.id,
          created.asset.usageAcceptance.id
        );
        await assert.rejects(
          updateSponsorMediaUsage(pool, {
            ...command,
            termsAcceptance: acceptance('en')
          }),
          code('IDEMPOTENCY_CONFLICT')
        );
        const withdrawal = update(
          request,
          a.asset,
          { ...rights, state: 'withdrawn' },
          null
        );
        const withdrawn = await updateSponsorMediaUsage(pool, withdrawal);
        assert.equal(withdrawn.asset.usage.state, 'withdrawn');
        assert.equal(withdrawn.asset.usageAcceptance, undefined);
        assert.equal(
          (await getSponsorMediaStorageRecord(pool, request.id))
            .usageAcceptance,
          undefined
        );
        assert.deepEqual(await counts(request.contributionId), {
          assets: 1,
          acceptances: 2,
          history: 3,
          uploads: 1
        });
        assert.deepEqual(
          await updateSponsorMediaUsage(pool, withdrawal),
          withdrawn
        );
        const manual = await updateSponsorMediaUsage(pool, {
          ...update(request, withdrawn.asset, rights, null),
          actor: 'synthetic-admin',
          evidenceReference: 'Synthetic separately received written permission'
        });
        assert.equal(manual.asset.usageAcceptance, undefined);
        assert.equal(
          (await getSponsorMediaStorageRecord(pool, request.id))
            .usageAcceptance,
          undefined
        );
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS n FROM sponsor_media_terms_acceptances WHERE contribution_id=$1',
              [request.contributionId]
            )
          ).rows[0].n,
          2
        );
      }
    );

    await t.test(
      'an acceptance is never projected for a changed file or an inherited rule, and old confirmed uploads get no new proof',
      async () => {
        const request = await input(),
          created = await createSponsorMediaAsset(pool, request);
        await pool.query(
          'UPDATE sponsor_media_assets SET checksum_sha256=$2 WHERE id=$1',
          [request.id, 'e'.repeat(64)]
        );
        assert.equal(
          (await getSponsorMediaStorageRecord(pool, request.id))
            .usageAcceptance,
          undefined
        );
        await pool.query(
          "UPDATE sponsor_media_assets SET checksum_sha256=$2,usage_inheritance='inherit' WHERE id=$1",
          [request.id, request.checksumSha256]
        );
        assert.equal(
          (await getSponsorMediaStorageRecord(pool, request.id))
            .usageAcceptance,
          undefined
        );
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS n FROM sponsor_media_terms_acceptances WHERE id=$1',
              [created.asset.usageAcceptance.id]
            )
          ).rows[0].n,
          1
        );
        const legacy = await input();
        delete legacy.termsAcceptance;
        delete legacy.requestId;
        delete legacy.requestFingerprint;
        legacy.auditActor = 'synthetic-older-capture';
        delete legacy.originalChecksumSha256;
        const prior = await createSponsorMediaAsset(pool, legacy);
        assert.equal(prior.asset.usage.state, 'confirmed');
        assert.equal(prior.asset.usageAcceptance, undefined);
        assert.equal(
          (await getSponsorMediaStorageRecord(pool, legacy.id)).usageAcceptance,
          undefined
        );
      }
    );
  }
);
