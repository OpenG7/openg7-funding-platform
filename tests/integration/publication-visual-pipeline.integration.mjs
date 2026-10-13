import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';

import sharp from 'sharp';

import { composePublicationRecognition } from '../../dist/packages/funding-core/src/index.js';
import { PublicationAutomationService } from '../../dist/apps/funding-api/src/publication-automation/service.js';
import { updateSponsorMediaUsage } from '../../dist/apps/funding-api/src/sponsor-media-usage.repository.js';
import { getModerationContent } from '../../dist/apps/funding-api/src/moderation/repository.js';
import { withPostgresTransaction } from '../../dist/apps/funding-api/src/postgres-transaction.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { approveFixtureSubject } from './support/moderation-fixture.mjs';
import { recordFixtureSponsorshipAgreement } from './support/sponsorship-agreement-fixture.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const actor = 'admin:00000000-0000-4000-8000-000000000003';

test(
  'qualified portraits and composites traverse the actual PostgreSQL publication pipeline',
  { timeout: 180000 },
  async (t) => {
    const database = await startDisposablePostgres();
    t.after(database.stop);
    const { pool } = database;
    const objects = new Map();
    let feedId = 'openg20:facebook';
    const providerBase = 'https://publication-visual.test/facebook';
    const env = {
      SOCIAL_PUBLICATION_MODE: 'live',
      SOCIAL_PUBLICATION_WORKER_ENABLED: 'true',
      SOCIAL_PUBLICATION_FACEBOOK_GRAPH_BASE_URL: providerBase,
      SOCIAL_PUBLICATION_OPENG20_FACEBOOK_ACCOUNT_ID: '20',
      SOCIAL_PUBLICATION_OPENG20_FACEBOOK_ACCESS_TOKEN:
        'synthetic-visual-credential',
      SOCIAL_PUBLICATION_LINKEDIN_API_BASE_URL:
        'https://publication-visual.test/linkedin',
      SOCIAL_PUBLICATION_OPENG20_LINKEDIN_ACCOUNT_ID: '20',
      SOCIAL_PUBLICATION_OPENG20_LINKEDIN_ACCESS_TOKEN:
        'synthetic-linkedin-credential'
    };
    const service = new PublicationAutomationService(
      pool,
      { readPrivateObject: async (key) => objects.get(key) ?? null },
      env
    );
    const row = async (id) =>
      (
        await pool.query('SELECT * FROM publication_deliveries WHERE id=$1', [
          id
        ])
      ).rows[0];
    const posts = [];
    const unexpected = [];
    let outcome = 'acknowledged';
    let afterPost;
    const uploaded = new Map();
    let failedInitializationAt;
    let remoteFailure;
    let imageStatus = 'AVAILABLE';
    let openTransactionsAtSend = null;
    t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
      const linkedInBase = 'https://publication-visual.test/linkedin';
      if (
        String(url).startsWith(linkedInBase) ||
        String(url).startsWith('https://www.linkedin.com/dms-uploads/')
      ) {
        if (String(url).includes('organizationAcls'))
          return Response.json({
            elements: [
              { organization: 'urn:li:organization:20', role: 'ADMINISTRATOR' }
            ]
          });
        if (String(url).includes('initializeUpload')) {
          if (uploaded.size + 1 === failedInitializationAt) {
            failedInitializationAt = undefined;
            return new Response('{}', { status: 503 });
          }
          const key = `synthetic${uploaded.size + 1}`;
          uploaded.set(`urn:li:image:${key}`, null);
          return Response.json({
            value: {
              image: `urn:li:image:${key}`,
              uploadUrl: `https://www.linkedin.com/dms-uploads/${key}`
            }
          });
        }
        if (String(url).includes('dms-uploads')) {
          uploaded.set(
            `urn:li:image:${String(url).split('/').at(-1)}`,
            Buffer.from(init.body)
          );
          return new Response('', { status: 201 });
        }
        if (String(url).includes('/images/'))
          return Response.json({
            id: decodeURIComponent(String(url).split('/').at(-1)),
            owner: 'urn:li:organization:20',
            status: imageStatus
          });
        if ((init.method ?? 'GET') === 'GET') {
          if (remoteFailure)
            return new Response('{}', { status: remoteFailure });
          const post = posts.find(
            (post) =>
              post.acknowledgement ===
              decodeURIComponent(String(url).split('/').at(-1))
          );
          return post
            ? Response.json({ ...post.payload, id: post.acknowledgement })
            : new Response('{}', { status: 404 });
        }
        assert(String(url).endsWith('/posts'));
        const payload = JSON.parse(init.body);
        const acknowledgement = `urn:li:share:${100 + posts.length}`;
        posts.push({ payload, acknowledgement });
        if (outcome === 'lost')
          throw new Error('Synthetic LinkedIn post response lost.');
        return new Response('', {
          status: 201,
          headers: { 'x-restli-id': acknowledgement }
        });
      }
      if (String(url) === `${providerBase}/me?fields=id`)
        return Response.json({ id: '20' });
      if (
        String(url) !== `${providerBase}/20/photos` ||
        init.method !== 'POST'
      ) {
        unexpected.push(String(url));
        throw new Error('Unexpected synthetic visual provider request.');
      }
      openTransactionsAtSend = (
        await pool.query(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND xact_start IS NOT NULL AND state<>'idle'"
        )
      ).rows[0].n;
      assert.equal(
        openTransactionsAtSend,
        0,
        'Provider HTTP must not retain a database transaction.'
      );
      assert(init.body instanceof FormData);
      const source = init.body.get('source');
      assert(source instanceof Blob);
      assert.equal(source.type, 'image/jpeg');
      const bytes = Buffer.from(await source.arrayBuffer());
      const acknowledgement = `20_${100 + posts.length}`;
      posts.push({
        bytes,
        hash: sha256(bytes),
        caption: init.body.get('caption'),
        acknowledgement
      });
      await afterPost?.();
      if (outcome === 'lost')
        throw new Error(
          'Synthetic response was lost after receiving the approved JPEG.'
        );
      return Response.json({ post_id: acknowledgement });
    });
    t.after(() => assert.deepEqual(unexpected, []));

    async function fixture(
      format,
      count,
      {
        beforeCompose,
        deferPhotoSelection = false,
        sourceMedia = false,
        reset = true,
        indexOffset = 0,
        channel = 'facebook'
      } = {}
    ) {
      feedId = `openg20:${channel}`;
      if (reset) {
        await pool.query(
          'TRUNCATE fund_contributions,publication_deliveries,sponsor_publication_drafts,sponsor_publication_batches,publication_slots,admin_audit_log CASCADE'
        );
        await pool.query(
          "UPDATE publication_feeds SET paused=TRUE,auto_prepare=FALSE,connection='unchecked',account_fingerprint=NULL,last_prepared_at=NULL"
        );
        await pool.query(
          'UPDATE publication_worker_settings SET enabled=TRUE,version=1'
        );
        objects.clear();
        posts.length = 0;
        outcome = 'acknowledged';
        afterPost = undefined;
        uploaded.clear();
        failedInitializationAt = undefined;
        remoteFailure = undefined;
        imageStatus = 'AVAILABLE';
        openTransactionsAtSend = null;
      }
      await service.command({ action: 'check', feedId }, actor);
      const feed = (await service.feeds()).find((item) => item.id === feedId);
      await service.command(
        { action: 'settings', settings: { ...feed, paused: false } },
        actor
      );
      const scheduledAt = new Date(
        Date.now() + 120000 + indexOffset * 120000
      ).toISOString();
      const batchId = randomUUID();
      await pool.query(
        "INSERT INTO sponsor_publication_batches(id,channel,capacity,status,scheduled_at,publication_format) VALUES($1,$5,$2,'scheduled',$3,$4)",
        [batchId, count, scheduledAt, format, channel]
      );
      const people = [];
      for (let index = 0; index < count; index++) {
        const contributionId = randomUUID();
        const assetId = randomUUID();
        const draftId = randomUUID();
        const name = `Synthetic workshop ${index + indexOffset + 1}`;
        const credit = `Synthetic photograph credit ${index + indexOffset + 1}`;
        const bytes = await sharp({
          create: {
            width: 12,
            height: 8,
            channels: 4,
            background: {
              r: 35 + index * 17,
              g: 95 + index * 11,
              b: 165 - index * 13,
              alpha: 0.5
            }
          }
        })
          .png()
          .toBuffer();
        const key = `${assetId}/processed`;
        objects.set(key, bytes);
        await pool.query(
          "INSERT INTO fund_contributions(id,contribution_type,amount_cents,currency,status,paid_at,public_display_consent,sponsor_review_status,sponsor_company_name,sponsor_public_summary,email_private) VALUES($1,'sponsorship_interest',50000,'cad','paid',clock_timestamp(),TRUE,'approved',$2,'An explicitly qualified synthetic agreement.',$3)",
          [contributionId, name, `visual-${index + 1}@example.invalid`]
        );
        const usage = {
          state: 'confirmed',
          channels: [channel],
          targets: ['openg20'],
          transformations:
            format === 'image_collection'
              ? ['technical']
              : [
                  'technical',
                  format === 'individual_portrait' ? 'portrait' : 'composite'
                ],
          credit,
          restrictions: null
        };
        await pool.query(
          `INSERT INTO sponsor_media_assets(id,contribution_id,kind,review_status,original_filename,original_mime_type,original_size_bytes,original_storage_key,processed_size_bytes,processed_storage_key,checksum_sha256,width,height,alt_text,public_url,usage_rights)
        VALUES($1::uuid,$2,'supporting_image','approved','synthetic.png','image/png',$3,$1::uuid::text||'/original',$3,$4,$5,12,8,'Approved synthetic photograph','https://example.test/synthetic.webp',$6::jsonb)`,
          [
            assetId,
            contributionId,
            bytes.length,
            key,
            sha256(bytes),
            JSON.stringify(usage)
          ]
        );
        const agreement = await recordFixtureSponsorshipAgreement(
          pool,
          contributionId,
          {
            benefits: [{ channel, target: 'openg20', quantity: 1, format }]
          }
        );
        const obligation = agreement.obligations.find(
          (item) => item.channel === channel
        );
        await pool.query(
          `INSERT INTO sponsor_publication_drafts(id,contribution_id,feed_target,channel,title,body,disclosure_text,batch_id,status,scheduled_at,obligation_id)
        VALUES($1,$2,'openg20',$7,$3,'Complete synthetic source text.','Paid sponsorship.',$4,'scheduled',$5,$6)`,
          [
            draftId,
            contributionId,
            `Full title for ${name}`,
            batchId,
            scheduledAt,
            obligation.id,
            channel
          ]
        );
        await approveFixtureSubject(pool, {
          type: 'sponsorship',
          id: contributionId
        });
        await approveFixtureSubject(pool, { type: 'media', id: assetId });
        const assetVersion = (
          await pool.query(
            'SELECT updated_at::text AS version FROM sponsor_media_assets WHERE id=$1',
            [assetId]
          )
        ).rows[0].version;
        people.push({
          contributionId,
          assetId,
          draftId,
          name,
          credit,
          email: `visual-${index + 1}@example.invalid`,
          sourceHash: sha256(bytes),
          assetVersion,
          obligationId: obligation.id
        });
      }
      const message = [
        composePublicationRecognition(
          people.map((person) => ({
            id: person.draftId,
            contributionId: person.contributionId,
            name: person.name,
            title: `Full title for ${person.name}`,
            body: 'Complete synthetic source text.',
            disclosureText: 'Paid sponsorship.'
          }))
        ),
        ...people.map((person) => person.credit)
      ].join('\n\n');
      await beforeCompose?.(people);
      const { id } = await service.command(
        {
          action: 'compose',
          feedId,
          kind: 'sponsorship',
          batchId,
          message,
          scheduledAt,
          publicationFormat: format,
          ...(sourceMedia ? { mediaId: people[0].assetId } : {}),
          photoSelections:
            deferPhotoSelection || sourceMedia
              ? []
              : people.map((person) => ({
                  contributionId: person.contributionId,
                  assetId: person.assetId,
                  assetVersion: person.assetVersion
                }))
        },
        actor
      );
      const draft = await row(id);
      if (deferPhotoSelection) {
        assert.equal(draft.media_id, null);
        assert.equal(draft.media_snapshot, null);
        return {
          id,
          people,
          draft,
          due: new Date(Date.parse(scheduledAt) + 1000)
        };
      }
      if (sourceMedia) {
        assert.equal(draft.media_id, people[0].assetId);
        assert.equal(draft.media_snapshot.id, people[0].assetId);
        assert.equal(draft.media_snapshot.hash, people[0].sourceHash);
      } else {
        assert.equal(draft.media_id, null);
        assert.equal(draft.media_snapshot.kind, 'derived');
        assert.equal(draft.media_snapshot.id, id);
        assert.equal(draft.media_snapshot.sources.length, count);
      }
      const preview = await service.imagePreview(id, draft.version);
      assert.equal(
        preview.sha256,
        format === 'image_collection'
          ? draft.media_snapshot.images[0].derivedHash
          : draft.media_snapshot.derivedHash
      );
      assert.equal(preview.mimeType, 'image/jpeg');
      const metadata = await sharp(preview.bytes).metadata();
      assert.equal(metadata.format, 'jpeg');
      assert.equal(metadata.width, preview.width);
      assert.equal(metadata.height, preview.height);
      assert.equal(
        posts.length,
        0,
        'Preparation and private preview never publish.'
      );
      await approveFixtureSubject(pool, { type: 'publication_delivery', id });
      await service.command(
        { action: 'approve', id, version: draft.version, confirmation: id },
        actor
      );
      const approvedMessages = (
        await pool.query(
          "SELECT * FROM email_messages WHERE template_key='sponsorship_obligation' AND metadata->>'event'='date_approved' AND metadata->>'obligationId'=ANY($1::text[])",
          [people.map((person) => person.obligationId)]
        )
      ).rows;
      assert.equal(approvedMessages.length, count);
      for (const person of people) {
        const notification = approvedMessages.find(
          (item) => item.metadata.obligationId === person.obligationId
        );
        assert(notification);
        assert.equal(notification.status, 'queued');
        assert.equal(notification.recipient_email, person.email);
        assert.equal(
          notification.metadata.eventId,
          `${id}:${draft.version + 1}`
        );
        assert.equal(notification.metadata.obligationVersion, 1);
      }
      return {
        id,
        people,
        draft,
        preview,
        due: new Date(Date.parse(scheduledAt) + 1000)
      };
    }

    await t.test(
      'eight distinct portraits create eight jobs and eight exact individual proofs',
      async () => {
        const fixtures = [];
        for (let index = 0; index < 8; index++)
          fixtures.push(
            await fixture('individual_portrait', 1, {
              reset: index === 0,
              indexOffset: index
            })
          );
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS n FROM publication_deliveries'
            )
          ).rows[0].n,
          8
        );
        assert.equal(posts.length, 0);
        for (const f of fixtures) {
          // Only this disposable fixture advances the account's real-clock cooldown.
          await pool.query(
            "UPDATE publication_account_leases SET next_dispatch_at=clock_timestamp()-INTERVAL '1 second' WHERE delivery_id IS NULL"
          );
          await service.tick(f.due);
          const delivered = await row(f.id);
          assert.equal(
            delivered.status,
            'published',
            JSON.stringify({
              errorCode: delivered.error_code,
              posts: posts.length,
              openTransactionsAtSend
            })
          );
          assert.deepEqual(posts.at(-1).bytes, f.preview.bytes);
        }
        const evidence = (
          await pool.query(
            'SELECT * FROM sponsorship_fulfilment_evidence ORDER BY contribution_id'
          )
        ).rows;
        assert.equal(posts.length, 8);
        assert.equal(evidence.length, 8);
        assert.equal(
          new Set(evidence.map((proof) => proof.obligation_id)).size,
          8
        );
        for (const f of fixtures) {
          const proof = evidence.find(
            (proof) => proof.obligation_id === f.people[0].obligationId
          );
          assert(proof);
          assert.equal(proof.delivery_id, f.id);
          assert.equal(
            proof.media_snapshot.sources[0].media.id,
            f.people[0].assetId
          );
          assert.equal(proof.media_snapshot.derivedHash, f.preview.sha256);
        }
        await service.tick(fixtures.at(-1).due);
        assert.equal(posts.length, 8);
      }
    );

    for (const count of [2, 8, 10])
      await t.test(
        `LinkedIn collection (${count}) previews/uploads every exact JPEG and recovers a lost response by immutable URNs`,
        async () => {
          const f = await fixture('image_collection', count, {
            channel: 'linkedin'
          });
          const previewVersion = (await row(f.id)).version;
          const orderedPeople = [...f.people].sort((left, right) =>
            left.contributionId.localeCompare(right.contributionId)
          );
          assert.deepEqual(
            f.draft.media_snapshot.images.map((image) => ({
              contributionId: image.contributionId,
              assetId: image.assetId
            })),
            orderedPeople.map(({ contributionId, assetId }) => ({
              contributionId,
              assetId
            }))
          );
          assert.deepEqual(
            f.draft.media_snapshot.sources.map((source) => ({
              contributionId: source.contributionId,
              assetId: source.media.id,
              sourceHash: source.media.hash
            })),
            orderedPeople.map(({ contributionId, assetId, sourceHash }) => ({
              contributionId,
              assetId,
              sourceHash
            }))
          );
          const previews = [];
          for (let index = 0; index < count; index++) {
            const image = await service.imagePreview(
              f.id,
              previewVersion,
              index
            );
            assert.equal(
              image.sha256,
              f.draft.media_snapshot.images[index].derivedHash
            );
            assert.equal(image.mimeType, 'image/jpeg');
            assert.equal(sha256(image.bytes), image.sha256);
            const metadata = await sharp(image.bytes).metadata();
            assert.equal(metadata.format, 'jpeg');
            assert.equal(metadata.width, image.width);
            assert.equal(metadata.height, image.height);
            previews.push(image);
          }
          assert.equal(
            new Set(previews.map((image) => image.sha256)).size,
            count
          );
          await assert.rejects(
            service.imagePreview(f.id, previewVersion, count),
            { code: count === 10 ? 'INVALID_FILTER' : 'MEDIA_NOT_FOUND' }
          );
          outcome = 'lost';
          await service.tick(f.due);
          const uncertain = await row(f.id);
          assert.equal(uncertain.status, 'uncertain');
          assert.equal(posts.length, 1);
          assert.equal(
            (await pool.query('SELECT * FROM sponsorship_fulfilment_evidence'))
              .rowCount,
            0
          );
          const ids = JSON.parse(uncertain.provider_media_id);
          assert.equal(ids.length, count);
          assert.deepEqual(
            posts[0].payload.content.multiImage.images.map((image) => image.id),
            ids
          );
          for (let index = 0; index < count; index++)
            assert.deepEqual(uploaded.get(ids[index]), previews[index].bytes);
          await service.tick(f.due);
          assert.equal(posts.length, 1);
          const command = {
            action: 'reconcile',
            id: f.id,
            version: uncertain.version,
            confirmation: f.id,
            externalPostId: posts[0].acknowledgement
          };
          for (const status of [403, 404, 503]) {
            remoteFailure = status;
            await assert.rejects(service.command(command, actor), {
              code: 'REMOTE_POST_UNVERIFIED'
            });
            assert.equal((await row(f.id)).status, 'uncertain');
            assert.equal(posts.length, 1);
          }
          remoteFailure = undefined;
          await service.command(command, actor);
          const delivered = await row(f.id);
          assert.equal(delivered.status, 'published');
          const evidence = (
            await pool.query('SELECT * FROM sponsorship_fulfilment_evidence')
          ).rows;
          assert.equal(evidence.length, count);
          assert.equal(
            new Set(evidence.map((proof) => proof.obligation_id)).size,
            count
          );
          assert(
            evidence.every((proof) => proof.provenance === 'provider_verified')
          );
          for (const proof of evidence) {
            assert.deepEqual(proof.provider_media_ids, ids);
            assert.deepEqual(proof.media_snapshot, delivered.media_snapshot);
          }
          await service.command(
            {
              action: 'check-visibility',
              id: f.id,
              version: delivered.version,
              confirmation: f.id,
              requestId: randomUUID()
            },
            actor
          );
          assert.equal(
            (
              await pool.query(
                "SELECT * FROM sponsorship_fulfilment_visibility WHERE state='visible'"
              )
            ).rowCount,
            count
          );
          remoteFailure = 404;
          await service.command(
            {
              action: 'check-visibility',
              id: f.id,
              version: delivered.version,
              confirmation: f.id,
              requestId: randomUUID()
            },
            actor
          );
          assert.equal(
            (
              await pool.query(
                "SELECT * FROM sponsorship_fulfilment_visibility WHERE state='unknown'"
              )
            ).rowCount,
            count
          );
          assert.equal(
            (
              await pool.query(
                "SELECT * FROM sponsorship_obligations WHERE state='fulfilled'"
              )
            ).rowCount,
            count
          );
          assert.equal(posts.length, 1);
        }
      );

    await t.test(
      'collection schema rejects incomplete JPEG manifests and the preview detects a reordered manifest before approval',
      async () => {
        const f = await fixture('image_collection', 2, {
          channel: 'linkedin',
          deferPhotoSelection: true
        });
        await service.command(
          {
            action: 'edit',
            id: f.id,
            version: f.draft.version,
            message: f.draft.message,
            scheduledAt: f.draft.scheduled_at.toISOString(),
            mediaId: null,
            publicationFormat: 'image_collection',
            photoSelections: f.people.map((person) => ({
              contributionId: person.contributionId,
              assetId: person.assetId,
              assetVersion: person.assetVersion
            }))
          },
          actor
        );
        const current = await row(f.id),
          original = current.media_snapshot;
        for (const images of [
          [],
          original.images.slice(0, 1),
          [
            { ...original.images[0], derivedHash: 'invalid' },
            original.images[1]
          ],
          [{}, original.images[1]]
        ])
          await assert.rejects(
            withPostgresTransaction(pool, (db) =>
              db.query(
                'UPDATE publication_deliveries SET media_snapshot=$2::jsonb WHERE id=$1',
                [f.id, JSON.stringify({ ...original, images })]
              )
            ),
            { code: '23514' }
          );
        await assert.rejects(
          withPostgresTransaction(pool, (db) =>
            db.query(
              "UPDATE publication_deliveries SET feed_id='openg20:facebook' WHERE id=$1",
              [f.id]
            )
          ),
          { code: '23514' }
        );
        assert.deepEqual((await row(f.id)).media_snapshot, original);
        await pool.query(
          'UPDATE publication_deliveries SET media_snapshot=$2::jsonb WHERE id=$1',
          [
            f.id,
            JSON.stringify({
              ...original,
              images: [...original.images].reverse()
            })
          ]
        );
        await assert.rejects(service.imagePreview(f.id, current.version), {
          code: 'MEDIA_CHANGED'
        });
        assert.equal(posts.length, 0);
        assert.equal((await row(f.id)).approved_at, null);
      }
    );

    await t.test(
      'ten-photo collection retains its approval through partial uploads and processing, then publishes once with every cached JPEG',
      async () => {
        const f = await fixture('image_collection', 10, {
          channel: 'linkedin'
        });
        const approved = await row(f.id);
        const previews = await Promise.all(
          Array.from({ length: 10 }, (_, index) =>
            service.imagePreview(f.id, approved.version, index)
          )
        );
        assert.equal(new Set(previews.map((image) => image.sha256)).size, 10);
        failedInitializationAt = 5;
        imageStatus = 'PROCESSING';
        await service.tick(f.due);
        const partial = await row(f.id);
        assert.equal(partial.status, 'approved');
        assert.equal(partial.error_code, 'PROVIDER_HTTP_503');
        const prefixIds = JSON.parse(partial.provider_media_id);
        assert.equal(prefixIds.length, 4);
        assert.equal(uploaded.size, 4);
        for (const [index, id] of prefixIds.entries())
          assert.deepEqual(uploaded.get(id), previews[index].bytes);
        assert.equal(posts.length, 0);
        assert.equal(
          (await pool.query('SELECT * FROM sponsorship_fulfilment_evidence'))
            .rowCount,
          0
        );
        await pool.query(
          "UPDATE publication_account_leases SET next_dispatch_at=clock_timestamp()-INTERVAL '1 second' WHERE delivery_id IS NULL"
        );
        await service.tick(new Date(f.due.getTime() + 300000));
        const waiting = await row(f.id);
        assert.equal(waiting.status, 'approved');
        assert.equal(waiting.error_code, 'MEDIA_PROCESSING');
        assert(waiting.approved_at);
        for (const current of [partial, waiting])
          for (const field of [
            'approved_at',
            'approved_by',
            'source_snapshot',
            'obligation_snapshot',
            'media_snapshot',
            'photo_selections',
            'message',
            'scheduled_at',
            'account_id',
            'mode',
            'publication_format'
          ]) {
            assert.notEqual(approved[field], undefined);
            assert.deepEqual(current[field], approved[field]);
          }
        const ids = JSON.parse(waiting.provider_media_id);
        assert.equal(ids.length, 10);
        assert.deepEqual(ids.slice(0, 4), prefixIds);
        assert.equal(uploaded.size, 10);
        for (const [index, id] of ids.entries()) {
          const bytes = uploaded.get(id);
          assert.deepEqual(bytes, previews[index].bytes);
          assert.equal(sha256(bytes), previews[index].sha256);
          assert.equal((await sharp(bytes).metadata()).format, 'jpeg');
        }
        assert.equal(posts.length, 0);
        assert.equal(
          (await pool.query('SELECT * FROM sponsorship_fulfilment_evidence'))
            .rowCount,
          0
        );
        imageStatus = 'AVAILABLE';
        await pool.query(
          "UPDATE publication_account_leases SET next_dispatch_at=clock_timestamp()-INTERVAL '1 second' WHERE delivery_id IS NULL"
        );
        await service.tick(new Date(f.due.getTime() + 600000));
        const delivered = await row(f.id);
        assert.equal(delivered.status, 'published');
        assert.deepEqual(JSON.parse(delivered.provider_media_id), ids);
        assert.equal(uploaded.size, 10);
        assert.equal(posts.length, 1);
        assert.deepEqual(
          posts[0].payload.content.multiImage.images.map((image) => image.id),
          ids
        );
        assert.deepEqual(
          posts[0].payload.content.multiImage.images.map(
            (image) => image.altText
          ),
          approved.media_snapshot.images.map((image) => image.alt)
        );
        const evidence = (
          await pool.query('SELECT * FROM sponsorship_fulfilment_evidence')
        ).rows;
        assert.equal(evidence.length, 10);
        assert.equal(
          new Set(evidence.map((proof) => proof.obligation_id)).size,
          10
        );
        for (const proof of evidence) {
          assert.deepEqual(proof.provider_media_ids, ids);
          assert.deepEqual(proof.media_snapshot, approved.media_snapshot);
        }
        await service.tick(new Date(f.due.getTime() + 900000));
        assert.equal(uploaded.size, 10);
        assert.equal(posts.length, 1);
        assert.equal(
          (await pool.query('SELECT * FROM sponsorship_fulfilment_evidence'))
            .rowCount,
          10
        );
      }
    );

    for (const format of ['collective_text', 'individual_portrait'])
      await t.test(
        `LinkedIn ${format} acknowledges one exact image and keeps its immutable URN for visibility`,
        async () => {
          const f = await fixture(format, 1, {
            channel: 'linkedin',
            sourceMedia: format === 'collective_text'
          });
          await service.tick(f.due);
          const delivered = await row(f.id);
          assert.equal(delivered.status, 'published');
          assert.equal(posts.length, 1);
          assert.deepEqual(
            uploaded.get(delivered.provider_media_id),
            f.preview.bytes
          );
          const proof = (
            await pool.query(
              'SELECT * FROM sponsorship_fulfilment_evidence WHERE delivery_id=$1',
              [f.id]
            )
          ).rows[0];
          assert.equal(proof.provenance, 'provider_acknowledged');
          assert.deepEqual(proof.provider_media_ids, [
            delivered.provider_media_id
          ]);
          await service.command(
            {
              action: 'check-visibility',
              id: f.id,
              version: delivered.version,
              confirmation: f.id,
              requestId: randomUUID()
            },
            actor
          );
          assert.equal(
            (
              await pool.query(
                'SELECT state FROM sponsorship_fulfilment_visibility WHERE evidence_id=$1',
                [proof.id]
              )
            ).rows[0].state,
            'visible'
          );
          assert.equal(posts.length, 1);
        }
      );

    for (const [format, count] of [
      ['individual_portrait', 1],
      ['collective_composite', 2],
      ['collective_composite', 8]
    ]) {
      await t.test(
        `${format} (${count} participants) sends the preview JPEG once and records its exact qualified obligation evidence`,
        async () => {
          const f = await fixture(format, count);
          await service.tick(f.due);
          const delivered = await row(f.id);
          assert.equal(
            delivered.status,
            'published',
            JSON.stringify({
              errorCode: delivered.error_code,
              posts: posts.length,
              openTransactionsAtSend
            })
          );
          assert.equal(posts.length, 1);
          assert.deepEqual(posts[0].bytes, f.preview.bytes);
          assert.equal(posts[0].hash, delivered.media_snapshot.derivedHash);
          assert.equal(posts[0].caption, delivered.message);
          assert.equal(
            new Set(f.people.map((person) => person.sourceHash)).size,
            count
          );
          for (const person of f.people) {
            assert(delivered.message.includes(person.name));
            assert(delivered.message.split('\n').includes(person.credit));
            const source = delivered.media_snapshot.sources.find(
              (item) => item.contributionId === person.contributionId
            );
            assert.equal(source.name, person.name);
            assert.equal(source.media.id, person.assetId);
            assert.equal(source.media.hash, person.sourceHash);
            assert.equal(source.media.version, person.assetVersion);
            assert.equal(source.media.usage.credit, person.credit);
          }
          const evidence = (
            await pool.query(
              'SELECT * FROM sponsorship_fulfilment_evidence WHERE delivery_id=$1 ORDER BY contribution_id',
              [f.id]
            )
          ).rows;
          assert.equal(evidence.length, count);
          for (const proof of evidence) {
            assert.equal(proof.mode, 'live');
            assert.equal(proof.provenance, 'provider_acknowledged');
            assert.equal(proof.media_snapshot.derivedHash, f.preview.sha256);
            assert.deepEqual(proof.media_snapshot, delivered.media_snapshot);
            assert.equal(proof.external_post_id, posts[0].acknowledgement);
          }
          const fulfilledMessages = (
            await pool.query(
              "SELECT * FROM email_messages WHERE template_key='sponsorship_obligation' AND metadata->>'event'='fulfilled' AND metadata->>'obligationId'=ANY($1::text[])",
              [f.people.map((person) => person.obligationId)]
            )
          ).rows;
          assert.equal(fulfilledMessages.length, count);
          for (const proof of evidence) {
            const person = f.people.find(
              (item) => item.obligationId === proof.obligation_id
            );
            const notification = fulfilledMessages.find(
              (item) => item.metadata.obligationId === proof.obligation_id
            );
            assert(person);
            assert(notification);
            assert.equal(notification.status, 'queued');
            assert.equal(notification.recipient_email, person.email);
            assert.equal(notification.metadata.eventId, proof.id);
            assert.equal(notification.metadata.obligationVersion, 2);
          }
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::int AS n FROM sponsorship_obligations WHERE contribution_id=ANY($1::uuid[]) AND state='fulfilled' AND fulfilment_evidence_id IS NOT NULL",
                [f.people.map((person) => person.contributionId)]
              )
            ).rows[0].n,
            count
          );
          await service.tick(f.due);
          assert.equal(posts.length, 1);
          assert.equal(
            (
              await pool.query(
                'SELECT count(*)::int AS n FROM sponsorship_fulfilment_evidence WHERE delivery_id=$1',
                [f.id]
              )
            ).rows[0].n,
            count
          );
        }
      );
    }

    for (const incident of ['response-lost', 'rights-withdrawn-after-post']) {
      await t.test(
        `${incident} preserves the actual JPEG outcome without fulfilment or text-only media reconciliation`,
        async () => {
          const f = await fixture('collective_composite', 2);
          if (incident === 'response-lost') outcome = 'lost';
          else
            afterPost = async () => {
              const person = f.people[0];
              await updateSponsorMediaUsage(pool, {
                contributionId: person.contributionId,
                assetId: person.assetId,
                requestId: randomUUID(),
                expectedVersion: person.assetVersion,
                actor: 'sponsor-followup',
                usage: {
                  state: 'withdrawn',
                  channels: [],
                  targets: [],
                  transformations: [],
                  credit: null,
                  restrictions: null
                }
              });
            };
          await service.tick(f.due);
          const uncertain = await row(f.id);
          assert.equal(uncertain.status, 'uncertain');
          assert.equal(posts.length, 1);
          assert.deepEqual(posts[0].bytes, f.preview.bytes);
          assert.equal(
            (
              await pool.query(
                'SELECT count(*)::int AS n FROM sponsorship_fulfilment_evidence WHERE delivery_id=$1',
                [f.id]
              )
            ).rows[0].n,
            0
          );
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::int AS n FROM sponsorship_obligations WHERE contribution_id=ANY($1::uuid[]) AND state='fulfilled'",
                [f.people.map((person) => person.contributionId)]
              )
            ).rows[0].n,
            0
          );
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::int AS n FROM email_messages WHERE template_key='sponsorship_obligation' AND metadata->>'event'='fulfilled' AND metadata->>'obligationId'=ANY($1::text[])",
                [f.people.map((person) => person.obligationId)]
              )
            ).rows[0].n,
            0
          );
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::int AS n FROM email_messages WHERE template_key='sponsorship_obligation' AND metadata->>'event'='date_approved' AND metadata->>'obligationId'=ANY($1::text[])",
                [f.people.map((person) => person.obligationId)]
              )
            ).rows[0].n,
            2
          );
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::int AS n FROM fund_contributions WHERE id=ANY($1::uuid[]) AND status='paid'",
                [f.people.map((person) => person.contributionId)]
              )
            ).rows[0].n,
            2
          );
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::int AS n FROM admin_audit_log WHERE entity_id=$1 AND action='publication_automation.provider_result_observed'",
                [f.id]
              )
            ).rows[0].n,
            incident === 'response-lost' ? 0 : 1
          );
          assert.equal(
            (await service.state()).deliveries.find((item) => item.id === f.id)
              .accountRecoveryRequired,
            true
          );
          await service.tick(f.due);
          assert.equal(posts.length, 1);
          await assert.rejects(
            service.command(
              {
                action: 'reconcile',
                id: f.id,
                version: uncertain.version,
                confirmation: f.id,
                externalPostId: posts[0].acknowledgement
              },
              actor
            ),
            { code: 'MEDIA_RECONCILIATION_REQUIRED' }
          );
          assert.equal(posts.length, 1);
          assert.equal((await row(f.id)).status, 'uncertain');
        }
      );
    }

    await t.test(
      'replaced private source bytes cannot inherit the unchanged asset approval or create a publication',
      async () => {
        let original;
        await assert.rejects(
          fixture('individual_portrait', 1, {
            async beforeCompose(people) {
              original = people[0];
              const replacement = await sharp({
                create: {
                  width: 12,
                  height: 8,
                  channels: 4,
                  background: '#357a2780'
                }
              })
                .png()
                .toBuffer();
              assert.notEqual(sha256(replacement), original.sourceHash);
              objects.set(`${original.assetId}/processed`, replacement);
            }
          }),
          { code: 'MEDIA_CHANGED' }
        );
        const source = (
          await pool.query(
            'SELECT checksum_sha256,updated_at::text AS version FROM sponsor_media_assets WHERE id=$1',
            [original.assetId]
          )
        ).rows[0];
        assert.equal(source.checksum_sha256, original.sourceHash);
        assert.equal(source.version, original.assetVersion);
        assert.equal(posts.length, 0);
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS n FROM publication_deliveries'
            )
          ).rows[0].n,
          0
        );
      }
    );

    await t.test(
      'portraits and composites may be privately composed before photos but cannot be previewed or authorized until an explicit complete edit',
      async () => {
        for (const [format, count] of [
          ['individual_portrait', 1],
          ['collective_composite', 2]
        ]) {
          const f = await fixture(format, count, { deferPhotoSelection: true });
          assert.equal(f.draft.status, 'draft');
          assert.equal(f.draft.approved_at, null);
          assert.equal(f.draft.attempts, 0);
          assert.deepEqual(f.draft.photo_selections, []);
          await assert.rejects(service.imagePreview(f.id, f.draft.version), {
            code: 'COMPOSITE_PHOTOS_REQUIRED'
          });
          await approveFixtureSubject(pool, {
            type: 'publication_delivery',
            id: f.id
          });
          await assert.rejects(
            service.command(
              {
                action: 'approve',
                id: f.id,
                version: f.draft.version,
                confirmation: f.id
              },
              actor
            ),
            { code: 'COMPOSITE_PHOTOS_REQUIRED' }
          );
          assert.equal((await row(f.id)).approved_at, null);
          assert.equal(posts.length, 0);
          await service.command(
            {
              action: 'edit',
              id: f.id,
              version: f.draft.version,
              message: f.draft.message,
              scheduledAt: f.draft.scheduled_at.toISOString(),
              mediaId: null,
              publicationFormat: format,
              photoSelections: f.people.map((person) => ({
                contributionId: person.contributionId,
                assetId: person.assetId,
                assetVersion: person.assetVersion
              }))
            },
            actor
          );
          const edited = await row(f.id);
          assert.equal(edited.status, 'draft');
          assert.equal(edited.approved_at, null);
          assert.equal(edited.version, f.draft.version + 1);
          assert.equal(edited.media_snapshot.kind, 'derived');
          assert.equal(edited.media_snapshot.sources.length, count);
          const preview = await service.imagePreview(f.id, edited.version);
          assert.equal(preview.sha256, edited.media_snapshot.derivedHash);
          assert.equal((await sharp(preview.bytes).metadata()).format, 'jpeg');
          await service.tick(f.due);
          assert.equal(posts.length, 0);
          assert.equal((await row(f.id)).status, 'draft');
        }
      }
    );

    await t.test(
      'source and derived moderation snapshots preserve hashes and immutable history without storage keys or external image URLs',
      async () => {
        const content = (subject) =>
          withPostgresTransaction(pool, (db) =>
            getModerationContent(db, subject)
          );
        const assertProjection = (value) => {
          if (!value || typeof value !== 'object') return;
          for (const [key, item] of Object.entries(value)) {
            assert(
              !['key', 'storageKey', 'originalStorageKey'].includes(key),
              `Private storage field ${key} must not appear in review content.`
            );
            if (key === 'url' && item !== null)
              assert.match(
                item,
                /^\/api\/(public\/sponsor-media\/|admin\/publication-automation\/image-preview\?)/
              );
            assertProjection(item);
          }
        };
        for (const [format, count, sourceMedia] of [
          ['collective_text', 1, true],
          ['collective_composite', 2, false]
        ]) {
          const f = await fixture(format, count, { sourceMedia });
          const subject = { type: 'publication_delivery', id: f.id };
          const before = await content(subject);
          assertProjection(before.snapshot);
          assert.equal(
            before.snapshot.visual.derivedMedia.derivedHash,
            f.preview.sha256
          );
          if (sourceMedia)
            assert.equal(
              before.snapshot.visual.derivedMedia.hash,
              f.people[0].sourceHash
            );
          else
            for (const person of f.people) {
              const source = before.snapshot.visual.derivedMedia.sources.find(
                (item) => item.contributionId === person.contributionId
              );
              assert.equal(source.media.hash, person.sourceHash);
            }
          const mediaSubject = { type: 'media', id: f.people[0].assetId };
          const mediaBefore = await content(mediaSubject);
          assertProjection(mediaBefore.snapshot);
          assert.equal(mediaBefore.snapshot.checksum, f.people[0].sourceHash);
          const history = (
            await pool.query(
              'SELECT snapshot,content_fingerprint FROM moderation_content_versions WHERE subject_type=$1 AND subject_id=$2 AND content_version=$3',
              [subject.type, subject.id, before.contentVersion]
            )
          ).rows[0];
          await pool.query(
            "UPDATE sponsor_media_assets SET alt_text='New explicitly synthetic reviewed description' WHERE id=$1",
            [f.people[0].assetId]
          );
          const after = await content(subject);
          const mediaAfter = await content(mediaSubject);
          assert(after.contentVersion > before.contentVersion);
          assert(mediaAfter.contentVersion > mediaBefore.contentVersion);
          assertProjection(after.snapshot);
          assertProjection(mediaAfter.snapshot);
          assert.deepEqual(
            (
              await pool.query(
                'SELECT snapshot,content_fingerprint FROM moderation_content_versions WHERE subject_type=$1 AND subject_id=$2 AND content_version=$3',
                [subject.type, subject.id, before.contentVersion]
              )
            ).rows[0],
            history
          );
          await service.tick(f.due);
          assert.equal((await row(f.id)).status, 'blocked');
          assert.equal((await row(f.id)).approved_at, null);
          assert.equal(posts.length, 0);
        }
      }
    );
  }
);
