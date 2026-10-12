import assert from 'node:assert/strict';
import test from 'node:test';
import { observeProviderResult } from '../../dist/apps/funding-api/src/publication-automation/delivery-outcomes.js';

import {
  createPublicationWorkerClaimsFixture,
  gate,
  poolPausedAfterClaim,
  withPausedTick
} from './support/publication-worker-claims.fixtures.mjs';

test(
  'publication claim fencing with disposable PostgreSQL',
  { timeout: 360000 },
  async (t) => {
    const {
      pool,
      service,
      serviceFor,
      reset,
      provider,
      activate,
      record,
      audits,
      compose,
      expire,
      quarantine,
      reapprove,
      projections,
      facebookSuccess,
      facebookFeed,
      facebookBase,
      linkedinFeed,
      linkedinBase,
      createApprovedImage
    } = await createPublicationWorkerClaimsFixture(t);

    await t.test(
      'concurrent acknowledgements produce one observation per active claim',
      async (st) => {
        await reset();
        provider(st, facebookSuccess);
        await activate();
        const { id, due } = await compose();
        const pause = gate();
        await withPausedTick(
          serviceFor(poolPausedAfterClaim(pool, pause)),
          due,
          pause,
          async (claim) => {
            const acknowledgement = {
              externalPostId: '20_9',
              externalPostUrl: 'https://www.facebook.com/20_9'
            };
            const before = await record(id);
            await Promise.all([
              observeProviderResult({ pool }, claim, acknowledgement),
              observeProviderResult({ pool }, claim, acknowledgement)
            ]);
            assert.deepEqual(await record(id), before);
            assert.deepEqual(
              (await audits(id, 'provider_result_observed')).map(
                ({ metadata }) => metadata
              ),
              [
                {
                  claimVersion: claim.version,
                  mode: 'live',
                  feedId: facebookFeed,
                  ...acknowledgement
                }
              ]
            );
            await assert.rejects(
              observeProviderResult({ pool }, claim, {
                ...acknowledgement,
                externalPostId: '20_10'
              }),
              { code: 'PROVIDER_RESULT_CONFLICT' }
            );
            await pool.query(
              'UPDATE publication_deliveries SET version=version+1 WHERE id=$1',
              [id]
            );
            const newer = await record(id);
            await assert.rejects(
              observeProviderResult({ pool }, claim, acknowledgement),
              /PUBLICATION_CLAIM_LOST/
            );
            assert.deepEqual(await record(id), newer);
            assert.equal(
              (await audits(id, 'provider_result_observed')).length,
              1
            );
            assert.equal((await audits(id, 'published')).length, 0);
          }
        );
      }
    );

    await t.test(
      'an expired claim stops before dispatch and quarantines only its own version',
      async (st) => {
        await reset();
        const calls = provider(st, facebookSuccess);
        await activate();
        const { id, due } = await compose();
        const approved = await record(id);
        const pause = gate();
        await withPausedTick(
          serviceFor(poolPausedAfterClaim(pool, pause)),
          due,
          pause,
          async (claim, running) => {
            assert.equal(claim.version, approved.version + 1);
            await expire(id);
            pause.resume();
            await running;
            const row = await record(id);
            assert.equal(row.status, 'uncertain');
            assert.equal(row.version, claim.version + 1);
            assert.equal(row.error_code, 'LEASE_EXPIRED');
            assert.equal(row.external_post_id, null);
            assert.equal(row.lease_until, null);
            assert.equal(calls.length, 0);
            assert.deepEqual(
              (await audits(id, 'claim')).map((a) => a.metadata),
              [{ attempt: 1, claimVersion: claim.version }]
            );
            assert.deepEqual(
              (await audits(id, 'uncertain')).map((a) => a.metadata),
              [{ code: 'LEASE_EXPIRED', claimVersion: claim.version }]
            );
            assert.equal((await audits(id, 'published')).length, 0);
          }
        );
      }
    );

    await t.test(
      'an old claim cannot dispatch after absence review and a newer claim',
      async (st) => {
        await reset();
        const calls = provider(st, facebookSuccess);
        await activate();
        const { id, due } = await compose();
        const oldPause = gate();
        await withPausedTick(
          serviceFor(poolPausedAfterClaim(pool, oldPause)),
          due,
          oldPause,
          async (oldClaim, oldRunning) => {
            const uncertain = await quarantine(id, due);
            assert.equal(uncertain.version, oldClaim.version + 1);
            const nextDue = await reapprove(id);
            const newPause = gate();
            await withPausedTick(
              serviceFor(poolPausedAfterClaim(pool, newPause)),
              nextDue,
              newPause,
              async (newClaim) => {
                assert.ok(newClaim.version > oldClaim.version);
                assert.equal(newClaim.attempts, 2);
                const before = await record(id);
                oldPause.resume();
                await oldRunning;
                assert.deepEqual(await record(id), before);
                assert.equal(calls.length, 0);
                assert.equal((await audits(id, 'uncertain')).length, 1);
                assert.equal((await audits(id, 'late_result')).length, 0);
              }
            );
            assert.equal((await record(id)).status, 'published');
            assert.equal(calls.length, 1);
            assert.equal((await audits(id, 'published')).length, 1);
            assert.equal((await audits(id, 'absence_review')).length, 1);
          }
        );
      }
    );

    await t.test(
      'revoked approval invalidates even an otherwise fresh claim',
      async (st) => {
        await reset();
        const calls = provider(st, facebookSuccess);
        await activate();
        const { id, due } = await compose();
        const pause = gate();
        await withPausedTick(
          serviceFor(poolPausedAfterClaim(pool, pause)),
          due,
          pause,
          async (claim, running) => {
            await pool.query(
              'UPDATE publication_deliveries SET approved_at=NULL,approved_by=NULL WHERE id=$1',
              [id]
            );
            pause.resume();
            await running;
            const row = await record(id);
            assert.equal(row.status, 'uncertain');
            assert.equal(row.version, claim.version + 1);
            assert.equal(row.approved_at, null);
            assert.equal(calls.length, 0);
            assert.equal((await audits(id, 'published')).length, 0);
          }
        );
      }
    );

    await t.test(
      'a late provider success quarantines its expired claim without publishing batch projections',
      async (st) => {
        await reset();
        const pause = gate();
        const calls = provider(st, async (request, number) => {
          const response = facebookSuccess(request, number);
          if (response) await pause.pause();
          return response;
        });
        await activate();
        const { id, due } = await compose({ batch: true });
        const before = await projections(id);
        await withPausedTick(serviceFor(), due, pause, async (_, running) => {
          const claim = await record(id);
          await expire(id);
          pause.resume();
          await running;
          const row = await record(id);
          assert.equal(row.status, 'uncertain');
          assert.equal(row.version, claim.version + 1);
          assert.equal(row.external_post_id, null);
          assert.deepEqual(await projections(id), before);
          assert.equal(calls.length, 1);
          assert.equal((await audits(id, 'published')).length, 0);
          assert.deepEqual(
            (await audits(id, 'late_result')).map((a) => a.metadata),
            [
              {
                claimVersion: claim.version,
                mode: 'live',
                feedId: facebookFeed,
                externalPostId: '20_1',
                externalPostUrl: 'https://www.facebook.com/20_1'
              }
            ]
          );
        });
      }
    );

    await t.test(
      'a late success preserves a newer publishing claim and only audits the old external proof',
      async (st) => {
        await reset();
        const oldPause = gate();
        const calls = provider(st, async (request, number) => {
          const response = facebookSuccess(request, number);
          if (response && number === 1) await oldPause.pause();
          return response;
        });
        await activate();
        const { id, due } = await compose({ batch: true });
        await withPausedTick(
          serviceFor(),
          due,
          oldPause,
          async (_, oldRunning) => {
            const oldClaim = await record(id);
            await quarantine(id, due);
            const nextDue = await reapprove(id);
            const newPause = gate();
            await withPausedTick(
              serviceFor(poolPausedAfterClaim(pool, newPause)),
              nextDue,
              newPause,
              async (newClaim) => {
                assert.ok(newClaim.version > oldClaim.version);
                const before = await record(id);
                const beforeProjections = await projections(id);
                oldPause.resume();
                await oldRunning;
                assert.deepEqual(await record(id), before);
                assert.deepEqual(await projections(id), beforeProjections);
                assert.equal(calls.length, 1);
                assert.equal((await audits(id, 'uncertain')).length, 1);
                assert.equal((await audits(id, 'published')).length, 0);
                assert.deepEqual(
                  (await audits(id, 'late_result')).map((a) => a.metadata),
                  [
                    {
                      claimVersion: oldClaim.version,
                      mode: 'live',
                      feedId: facebookFeed,
                      externalPostId: '20_1',
                      externalPostUrl: 'https://www.facebook.com/20_1'
                    }
                  ]
                );
              }
            );
            const row = await record(id);
            assert.equal(row.status, 'published');
            assert.equal(row.external_post_id, '20_2');
            const after = await projections(id);
            assert.equal(after.batch[0].status, 'published');
            assert.equal(after.drafts[0].status, 'published');
            assert.equal(
              after.drafts[0].public_url,
              'https://www.facebook.com/20_2'
            );
            assert.equal(after.slot[0].status, 'published');
            assert.equal(calls.length, 2);
            assert.equal((await audits(id, 'published')).length, 1);
          }
        );
      }
    );

    await t.test(
      'an obsolete provider 403 cannot block a newer result or mark its feed as broken',
      async (st) => {
        await reset();
        const pause = gate();
        const calls = provider(st, async (request, number) => {
          if (
            request.method !== 'POST' ||
            request.url !== `${facebookBase}/20/feed`
          )
            return null;
          if (number === 1) {
            await pause.pause();
            return Response.json(
              {
                error: { message: 'Synthetic obsolete authorization failure' }
              },
              { status: 403 }
            );
          }
          return Response.json({ id: '20_2' });
        });
        await activate();
        const { id, due } = await compose();
        await withPausedTick(serviceFor(), due, pause, async (_, running) => {
          await quarantine(id, due);
          const nextDue = await reapprove(id);
          await serviceFor().tick(nextDue);
          const before = await record(id);
          assert.equal(before.status, 'published');
          pause.resume();
          await running;
          assert.deepEqual(await record(id), before);
          assert.equal(
            (await service.feeds()).find((f) => f.id === facebookFeed)
              .connection,
            'ready'
          );
          assert.equal(calls.length, 2);
          assert.equal((await audits(id, 'blocked')).length, 0);
          assert.equal((await audits(id, 'uncertain')).length, 1);
          assert.equal((await audits(id, 'published')).length, 1);
          assert.equal((await audits(id, 'late_result')).length, 0);
        });
      }
    );

    await t.test(
      'an obsolete LinkedIn upload cannot persist its cache or continue to image lookup/publication',
      async (st) => {
        await reset();
        const pause = gate();
        const uploadUrl =
          'https://www.linkedin.com/dms-uploads/claim-fence-fixture';
        const calls = provider(st, async (request) => {
          if (
            request.method === 'POST' &&
            request.url === `${linkedinBase}/images?action=initializeUpload`
          ) {
            return Response.json({
              value: { image: 'urn:li:image:old-claim-fixture', uploadUrl }
            });
          }
          if (request.method === 'PUT' && request.url === uploadUrl) {
            await pause.pause();
            return new Response(null, { status: 201 });
          }
          return null;
        });
        await activate(linkedinFeed);
        const mediaId = await createApprovedImage();
        const { id, due } = await compose({ feedId: linkedinFeed, mediaId });
        await withPausedTick(
          serviceFor(),
          due,
          pause,
          async (_, oldRunning) => {
            const oldClaim = await record(id);
            await quarantine(id, due);
            const nextDue = await reapprove(id);
            const newPause = gate();
            await withPausedTick(
              serviceFor(poolPausedAfterClaim(pool, newPause)),
              nextDue,
              newPause,
              async (newClaim, newRunning) => {
                assert.ok(newClaim.version > oldClaim.version);
                const before = await record(id);
                pause.resume();
                await oldRunning;
                assert.deepEqual(await record(id), before);
                assert.equal(before.provider_media_id, null);
                assert.deepEqual(
                  calls.map(({ method, url }) => ({ method, url })),
                  [
                    {
                      method: 'POST',
                      url: `${linkedinBase}/images?action=initializeUpload`
                    },
                    { method: 'PUT', url: uploadUrl }
                  ]
                );
                assert.equal((await audits(id, 'published')).length, 0);
                assert.equal((await audits(id, 'late_result')).length, 0);
                // End the new claim without performing a second upload: revocation also
                // proves that no current authorization can be inherited from the old one.
                await pool.query(
                  'UPDATE publication_deliveries SET approved_at=NULL,approved_by=NULL WHERE id=$1',
                  [id]
                );
                newPause.resume();
                await newRunning;
                const after = await record(id);
                assert.equal(after.status, 'uncertain');
                assert.equal(after.provider_media_id, null);
                assert.equal(calls.length, 2);
              }
            );
          }
        );
      }
    );
  }
);
