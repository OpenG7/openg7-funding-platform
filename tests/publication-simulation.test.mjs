import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { socialSimulator } from './stripe-stub/social.mjs';
import { loadSocialPublicationConfig } from '../dist/apps/funding-api/src/social-publication.service.js';
import { feedConfig } from '../dist/apps/funding-api/src/publication-automation/policy.js';
import {
  checkConnection,
  sendDelivery,
  verifyRemote
} from '../dist/apps/funding-api/src/publication-automation/provider.js';

test('the optional mock receiver fails closed outside an explicit local simulation', () => {
  const env = {
    SOCIAL_PUBLICATION_MODE: 'mock',
    FUNDING_PLATFORM_ENV: 'test',
    SOCIAL_PUBLICATION_MOCK_URL: 'http://127.0.0.1:4242/__test__/social'
  };
  assert.equal(
    loadSocialPublicationConfig({ SOCIAL_PUBLICATION_MODE: 'mock' })
      .mockBaseUrl,
    undefined
  );
  assert.equal(
    loadSocialPublicationConfig(env).mockBaseUrl,
    env.SOCIAL_PUBLICATION_MOCK_URL
  );
  assert.equal(
    loadSocialPublicationConfig({
      ...env,
      SOCIAL_PUBLICATION_MOCK_URL: 'http://stripe-stub:4242/__test__/social/'
    }).mockBaseUrl,
    'http://stripe-stub:4242/__test__/social'
  );
  for (const override of [
    { FUNDING_PLATFORM_ENV: 'production' },
    { FUNDING_PLATFORM_ENV: undefined, NODE_ENV: 'production' },
    { FUNDING_PLATFORM_ENV: undefined, NODE_ENV: undefined },
    { SOCIAL_PUBLICATION_MODE: 'live' },
    { SOCIAL_PUBLICATION_MODE: 'disabled' },
    ...[
      'https://127.0.0.1/__test__/social',
      'http://example.test/__test__/social',
      'http://127.0.0.1.example.test/__test__/social',
      'http://user:secret@localhost/__test__/social',
      'http://localhost/__test__/social?secret=x',
      'http://localhost/__test__/social#x',
      'http://localhost/admin',
      'not-a-url'
    ].map((SOCIAL_PUBLICATION_MOCK_URL) => ({ SOCIAL_PUBLICATION_MOCK_URL }))
  ])
    assert.throws(() => loadSocialPublicationConfig({ ...env, ...override }), {
      code: 'SOCIAL_PUBLICATION_MOCK_URL_INVALID'
    });
  assert.notEqual(
    feedConfig('openg7:facebook', env).fingerprint,
    feedConfig('openg7:facebook', { SOCIAL_PUBLICATION_MODE: 'mock' })
      .fingerprint
  );
});

for (const channel of ['facebook', 'linkedin']) {
  test(`HTTP ${channel} simulation preserves a lost outcome and verifies the stored post`, async (t) => {
    const handler = socialSimulator();
    const server = createServer(async (req, res) => {
      if (!(await handler(req, res, new URL(req.url, 'http://localhost')))) {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    });
    const base = `http://127.0.0.1:${server.address().port}/__test__/social`;
    const config = loadSocialPublicationConfig({
      SOCIAL_PUBLICATION_MODE: 'mock',
      FUNDING_PLATFORM_ENV: 'test',
      SOCIAL_PUBLICATION_MOCK_URL: base
    });
    const job = {
      id: randomUUID(),
      feedId: `openg7:${channel}`,
      mode: 'mock',
      accountId: `mock-openg7:${channel}`,
      message: 'Texte exact de recette',
      mediaId: null
    };
    const post = async (path, data) =>
      fetch(base + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
    const receipts = async (id) =>
      (await fetch(base + '/receipts?deliveryId=' + id)).json();
    await checkConnection(config, channel, job.accountId);
    assert.equal(
      (
        await post('/faults', {
          deliveryId: job.id,
          fault: 'accepted-response-lost'
        })
      ).status,
      200
    );
    await assert.rejects(sendDelivery(config, job, null), {
      outcome: 'uncertain',
      code: 'PROVIDER_UNREACHABLE'
    });
    const lost = await receipts(job.id);
    assert.equal(lost.requests.length, 1);
    assert.equal(lost.posts.length, 1);
    assert.equal(
      (await verifyRemote(config, job, lost.posts[0].id)).externalPostId,
      lost.posts[0].id
    );
    assert.equal((await receipts(job.id)).requests.length, 1);
    for (const mismatch of [
      { message: 'Other text' },
      { accountId: 'other-account' },
      { feedId: 'openg20:' + channel },
      { id: randomUUID() }
    ])
      await assert.rejects(
        verifyRemote(config, { ...job, ...mismatch }, lost.posts[0].id),
        { code: 'POST_MISMATCH' }
      );
    await assert.rejects(
      verifyRemote(config, { ...job, mode: 'live' }, lost.posts[0].id),
      { code: 'MODE_CHANGED' }
    );
    await assert.rejects(
      verifyRemote(config, { ...job, mediaId: randomUUID() }, lost.posts[0].id),
      { code: 'MEDIA_RECONCILIATION_REQUIRED' }
    );
    await assert.rejects(verifyRemote(config, job, 'mock-' + randomUUID()), {
      code: 'PROVIDER_HTTP_404'
    });
    // A buggy second send would really create a duplicate, not be hidden by the fixture.
    await assert.rejects(sendDelivery(config, job, null), {
      outcome: 'uncertain',
      code: 'PROVIDER_MISSING_ID'
    });
    assert.equal((await receipts(job.id)).posts.length, 2);

    const absent = { ...job, id: randomUUID() };
    assert.equal(
      (
        await post('/faults', {
          deliveryId: absent.id,
          fault: 'absent-response-lost'
        })
      ).status,
      200
    );
    await assert.rejects(sendDelivery(config, absent, null), {
      outcome: 'uncertain'
    });
    assert.equal((await receipts(absent.id)).posts.length, 0);
    await assert.rejects(verifyRemote(config, absent, 'mock-' + absent.id), {
      code: 'PROVIDER_HTTP_404'
    });
    assert.equal(
      (await sendDelivery(config, absent, null)).externalPostId,
      'mock-' + absent.id
    );
    assert.equal((await receipts(absent.id)).requests.length, 2);
    assert.equal((await receipts(absent.id)).posts.length, 1);
  });
}

test('legacy mock reconciliation cannot confirm a delivery from another mode', async () => {
  await assert.rejects(
    verifyRemote(
      loadSocialPublicationConfig({ SOCIAL_PUBLICATION_MODE: 'mock' }),
      { id: 'id', mode: 'live' },
      'mock-id'
    ),
    { code: 'MODE_CHANGED' }
  );
});
