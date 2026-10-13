import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { PublicationClaimLost } from '../dist/apps/funding-api/src/publication-automation/claims.js';
import {
  feedConfig,
  recurrenceTimes,
  validateSettings,
  validateContent
} from '../dist/apps/funding-api/src/publication-automation/policy.js';
import {
  sendDelivery,
  verifyRemote,
  checkConnection
} from '../dist/apps/funding-api/src/publication-automation/provider.js';

const settings = {
  id: 'openg7:facebook',
  paused: true,
  autoPrepare: true,
  timezone: 'America/Toronto',
  weekdays: [0],
  localTime: '10:00',
  capacity: 5,
  horizonDays: 14
};
test('feed credentials never fall back across OpenG7 and OpenG20', () => {
  const env = {
    SOCIAL_PUBLICATION_MODE: 'live',
    SOCIAL_PUBLICATION_FACEBOOK_PAGE_ID: '7',
    SOCIAL_PUBLICATION_FACEBOOK_PAGE_ACCESS_TOKEN: 'synthetic'
  };
  assert.equal(feedConfig('openg7:facebook', env).accountId, '7');
  assert.equal(feedConfig('openg20:facebook', env).accountId, '');
  assert.equal(
    feedConfig('openg20:facebook', {
      ...env,
      SOCIAL_PUBLICATION_OPENG20_FACEBOOK_ACCOUNT_ID: '20'
    }).config.facebook.pageAccessToken,
    ''
  );
});
test('recurrences preserve local time across DST and skip nonexistent wall times', () => {
  assert.deepEqual(
    recurrenceTimes(settings, new Date('2030-03-09T12:00:00Z')),
    ['2030-03-10T14:00:00.000Z', '2030-03-17T14:00:00.000Z']
  );
  assert.deepEqual(
    recurrenceTimes(
      { ...settings, localTime: '02:30' },
      new Date('2030-03-09T12:00:00Z')
    ),
    ['2030-03-17T06:30:00.000Z']
  );
  assert.deepEqual(
    recurrenceTimes(
      { ...settings, localTime: '01:30', horizonDays: 2 },
      new Date('2030-11-02T12:00:00Z')
    ),
    ['2030-11-03T05:30:00.000Z']
  );
});
test('rejects oversized schedules, invalid time zones and ambiguous timestamps', () => {
  for (const override of [
    { horizonDays: 365 },
    { capacity: 0 },
    { weekdays: [] },
    { localTime: '24:00' },
    { timezone: 'invalid' }
  ])
    assert.throws(() => validateSettings({ ...settings, ...override }));
  assert.throws(() => validateContent('x', '2030-01-01T10:00'));
  assert.throws(() => validateContent('x'.repeat(2901), '2030-01-01T10:00Z'));
});
const env = {
  SOCIAL_PUBLICATION_MODE: 'live',
  SOCIAL_PUBLICATION_OPENG20_FACEBOOK_ACCOUNT_ID: '20',
  SOCIAL_PUBLICATION_OPENG20_FACEBOOK_ACCESS_TOKEN: 'fixture',
  SOCIAL_PUBLICATION_OPENG20_LINKEDIN_ACCOUNT_ID: '20',
  SOCIAL_PUBLICATION_OPENG20_LINKEDIN_ACCESS_TOKEN: 'fixture'
};
const job = {
  id: 'job',
  feedId: 'openg20:facebook',
  mode: 'live',
  accountId: '20',
  message: 'Exact approved text',
  mediaId: null,
  mediaAlt: 'Approved image'
};
test('publishes the exact text to the selected account and redacts provider errors', async (t) => {
  let call;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    call = { url, init };
    return new Response(JSON.stringify({ id: '20_1' }));
  });
  const config = feedConfig(job.feedId, env).config;
  assert.equal((await sendDelivery(config, job, null)).externalPostId, '20_1');
  assert.match(call.url, /\/20\/feed$/);
  assert.equal(call.init.body.get('message'), job.message);
  assert.equal(call.init.redirect, 'error');
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { message: 'PRIVATE TOKEN' } }), {
      status: 403
    });
  await assert.rejects(
    sendDelivery(config, job, null),
    (error) =>
      error.outcome === 'rejected' && !error.message.includes('PRIVATE')
  );
});
test('429 is retryable, timeout/5xx/missing acknowledgement are uncertain', async (t) => {
  const config = feedConfig(job.feedId, env).config;
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response('{}', { status: 429 })
  );
  await assert.rejects(sendDelivery(config, job, null), { outcome: 'retry' });
  for (const response of [
    new Response('{}', { status: 503 }),
    new Response('{}')
  ]) {
    globalThis.fetch = async () => response;
    await assert.rejects(sendDelivery(config, job, null), {
      outcome: 'uncertain'
    });
  }
  globalThis.fetch = async () => {
    throw new Error('timeout');
  };
  await assert.rejects(sendDelivery(config, job, null), {
    outcome: 'uncertain'
  });
});
test('Facebook sends one approved photo with caption and requires the post id', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.match(url, /\/20\/photos$/);
    assert.equal(init.body.get('caption'), job.message);
    assert.equal(init.body.get('alt_text_custom'), job.mediaAlt);
    assert.ok(init.body.get('source') instanceof Blob);
    return new Response(JSON.stringify({ id: 'photo', post_id: '20_2' }));
  });
  assert.equal(
    (
      await sendDelivery(
        feedConfig(job.feedId, env).config,
        { ...job, mediaId: 'image' },
        Buffer.from('fixture')
      )
    ).externalPostId,
    '20_2'
  );
});
test('LinkedIn persists the image reference and resumes processing without reuploading', async (t) => {
  const j = { ...job, feedId: 'openg20:linkedin', mediaId: 'image' };
  const c = feedConfig(j.feedId, env).config;
  const urls = [];
  let persisted = '';
  t.mock.method(globalThis, 'fetch', async (url) => {
    urls.push(url);
    if (url.includes('initializeUpload'))
      return Response.json({
        value: {
          image: 'urn:li:image:abc',
          uploadUrl: 'https://www.linkedin.com/dms-uploads/abc'
        }
      });
    if (url.includes('dms-uploads')) return new Response('', { status: 201 });
    return Response.json({ status: 'WAITING_UPLOAD' });
  });
  await assert.rejects(
    sendDelivery(c, j, Buffer.from('fixture'), null, async (id) => {
      persisted = id;
    }),
    { code: 'MEDIA_PROCESSING', outcome: 'retry' }
  );
  assert.equal(persisted, 'urn:li:image:abc');
  globalThis.fetch = async (url, init) => {
    urls.push(url);
    if (url.includes('/images/')) return Response.json({ status: 'AVAILABLE' });
    assert.equal(JSON.parse(init.body).content.media.id, persisted);
    return new Response('', {
      status: 201,
      headers: { 'x-restli-id': 'urn:li:share:99' }
    });
  };
  await sendDelivery(c, j, Buffer.from('fixture'), persisted);
  assert.equal(urls.filter((u) => u.includes('initializeUpload')).length, 1);
});
test('refuses foreign upload URLs and mismatched remote publications', async (t) => {
  const c = feedConfig('openg20:linkedin', env).config;
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({
      value: {
        image: 'urn:li:image:abc',
        uploadUrl: 'https://attacker.test/upload'
      }
    })
  );
  await assert.rejects(
    sendDelivery(c, { ...job, feedId: 'openg20:linkedin' }, Buffer.from('x')),
    { code: 'INVALID_UPLOAD' }
  );
  globalThis.fetch = async () =>
    Response.json({
      author: 'urn:li:organization:7',
      commentary: job.message,
      lifecycleState: 'PUBLISHED'
    });
  await assert.rejects(
    verifyRemote(c, { ...job, feedId: 'openg20:linkedin' }, 'urn:li:share:1'),
    { code: 'POST_MISMATCH' }
  );
  globalThis.fetch = async () => Response.json({ id: '7' });
  await assert.rejects(
    checkConnection(feedConfig(job.feedId, env).config, 'facebook', '20'),
    { code: 'ACCOUNT_MISMATCH' }
  );
});

test('LinkedIn rechecks ownership before every request and propagates a lost claim unchanged', async (t) => {
  const j = { ...job, feedId: 'openg20:linkedin', mediaId: 'image' };
  const config = feedConfig(j.feedId, env).config;
  const lost = new PublicationClaimLost();
  for (const stopAt of [1, 2, 3, 4]) {
    let checks = 0;
    let calls = 0;
    let persisted = null;
    t.mock.method(globalThis, 'fetch', async (url) => {
      calls++;
      if (url.includes('initializeUpload'))
        return Response.json({
          value: {
            image: 'urn:li:image:synthetic',
            uploadUrl: 'https://www.linkedin.com/dms-uploads/synthetic'
          }
        });
      if (url.includes('dms-uploads')) return new Response('', { status: 201 });
      if (url.includes('/images/'))
        return Response.json({ status: 'AVAILABLE' });
      assert.fail('a revoked claim cannot submit its public post');
    });
    await assert.rejects(
      sendDelivery(
        config,
        j,
        Buffer.from('synthetic'),
        null,
        async (id) => {
          persisted = id;
        },
        async () => {
          if (++checks === stopAt) throw lost;
        }
      ),
      (error) => error === lost
    );
    assert.equal(calls, stopAt - 1);
    assert.equal(persisted, stopAt >= 3 ? 'urn:li:image:synthetic' : null);
    t.mock.restoreAll();
  }
});

const albumFixture = () => {
  const images = ['First', 'Second'].map((alt) => {
    const bytes = Buffer.from(alt);
    return {
      bytes,
      alt,
      sha256: createHash('sha256').update(bytes).digest('hex')
    };
  });
  return {
    images,
    job: {
      ...job,
      feedId: 'openg20:linkedin',
      mediaId: 'approved-album',
      publicationFormat: 'image_collection',
      mediaImages: images.map(({ alt, sha256 }) => ({
        alt,
        sha256,
        width: 10,
        height: 10
      }))
    }
  };
};

test('LinkedIn collection persists each upload and resumes an interrupted second upload without a public post', async (t) => {
  const f = albumFixture(),
    config = feedConfig(f.job.feedId, env).config;
  const calls = [],
    saved = [];
  let initialized = 0;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, init });
    if (url.includes('initializeUpload')) {
      initialized++;
      return Response.json({
        value: {
          image: `urn:li:image:synthetic${initialized}`,
          uploadUrl: `https://www.linkedin.com/dms-uploads/synthetic${initialized}`
        }
      });
    }
    if (url.endsWith('/synthetic2'))
      throw new Error('Synthetic second-upload timeout');
    if (url.includes('dms-uploads')) return new Response('', { status: 201 });
    assert.fail('No public post before the collection uploads are durable.');
  });
  await assert.rejects(
    sendDelivery(config, f.job, f.images, null, async (id) => saved.push(id)),
    { outcome: 'retry' }
  );
  assert.deepEqual(JSON.parse(saved[0]), ['urn:li:image:synthetic1']);
  assert.equal(saved.length, 1);
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (url.includes('initializeUpload'))
      return Response.json({
        value: {
          image: 'urn:li:image:synthetic3',
          uploadUrl: 'https://www.linkedin.com/dms-uploads/synthetic3'
        }
      });
    if (url.includes('dms-uploads')) {
      assert.deepEqual(Buffer.from(init.body), f.images[1].bytes);
      return new Response('', { status: 201 });
    }
    if (url.includes('/images/')) return Response.json({ status: 'AVAILABLE' });
    const content = JSON.parse(init.body).content;
    assert.deepEqual(content, {
      multiImage: {
        images: [
          { id: 'urn:li:image:synthetic1', altText: 'First' },
          { id: 'urn:li:image:synthetic3', altText: 'Second' }
        ]
      }
    });
    return new Response('', {
      status: 201,
      headers: { 'x-restli-id': 'urn:li:share:123' }
    });
  };
  assert.equal(
    (
      await sendDelivery(config, f.job, f.images, saved[0], async (id) =>
        saved.push(id)
      )
    ).externalPostId,
    'urn:li:share:123'
  );
  assert.deepEqual(JSON.parse(saved[1]), [
    'urn:li:image:synthetic1',
    'urn:li:image:synthetic3'
  ]);
  assert.equal(calls.filter((call) => call.url.includes('/posts')).length, 1);
});

test('LinkedIn media reconciliation compares immutable URNs and public account/content, preserving inaccessible reads', async (t) => {
  const f = albumFixture(),
    config = feedConfig(f.job.feedId, env).config;
  const id = 'urn:li:share:123',
    ids = ['urn:li:image:one', 'urn:li:image:two'];
  const remote = {
    id,
    author: 'urn:li:organization:20',
    commentary: f.job.message,
    lifecycleState: 'PUBLISHED',
    visibility: 'PUBLIC',
    content: { multiImage: { images: ids.map((id) => ({ id })) } }
  };
  const imageResponse = (url) =>
    Response.json({
      id: decodeURIComponent(url.split('/').at(-1)),
      owner: 'urn:li:organization:20',
      status: 'AVAILABLE'
    });
  t.mock.method(globalThis, 'fetch', async (url) =>
    url.includes('/images/') ? imageResponse(url) : Response.json(remote)
  );
  assert.equal((await verifyRemote(config, f.job, id, ids)).externalPostId, id);
  await assert.rejects(verifyRemote(config, f.job, id), {
    code: 'MEDIA_RECONCILIATION_REQUIRED'
  });
  for (const change of [
    { author: 'urn:li:organization:7' },
    { id: 'urn:li:share:456' },
    { visibility: 'CONNECTIONS' },
    { commentary: 'Edited recognition' },
    { lifecycleState: 'DRAFT' },
    {
      content: {
        multiImage: { images: [...ids].reverse().map((id) => ({ id })) }
      }
    },
    { content: { multiImage: { images: [{ id: ids[0] }] } } },
    { content: { media: { id: ids[0] } } }
  ]) {
    globalThis.fetch = async (url) =>
      url.includes('/images/')
        ? imageResponse(url)
        : Response.json({ ...remote, ...change });
    await assert.rejects(verifyRemote(config, f.job, id, ids), {
      code: 'POST_MISMATCH'
    });
  }
  const single = {
    ...f.job,
    publicationFormat: 'collective_text',
    mediaImages: undefined
  };
  globalThis.fetch = async (url) =>
    url.includes('/images/')
      ? imageResponse(url)
      : Response.json({ ...remote, content: { media: { id: ids[0] } } });
  assert.equal(
    (await verifyRemote(config, single, id, ids.slice(0, 1))).externalPostId,
    id
  );
  globalThis.fetch = async (url) =>
    url.includes('/images/')
      ? Response.json({
          id: ids[0],
          owner: 'urn:li:organization:7',
          status: 'AVAILABLE'
        })
      : Response.json({ ...remote, content: { media: { id: ids[0] } } });
  await assert.rejects(verifyRemote(config, single, id, ids.slice(0, 1)), {
    code: 'POST_MISMATCH'
  });
  globalThis.fetch = async (url) =>
    url.includes('/images/')
      ? Response.json({
          id: ids[0],
          owner: 'urn:li:organization:20',
          status: 'PROCESSING'
        })
      : Response.json({ ...remote, content: { media: { id: ids[0] } } });
  await assert.rejects(verifyRemote(config, single, id, ids.slice(0, 1)), {
    code: 'MEDIA_REMOTE_UNAVAILABLE'
  });
  for (const status of [403, 404, 503]) {
    globalThis.fetch = async (url) =>
      url.includes('/images/')
        ? new Response('{}', { status })
        : Response.json({ ...remote, content: { media: { id: ids[0] } } });
    await assert.rejects(verifyRemote(config, single, id, ids.slice(0, 1)), {
      code: `PROVIDER_HTTP_${status}`
    });
  }
  globalThis.fetch = async () => {
    throw new Error('Synthetic timeout');
  };
  await assert.rejects(verifyRemote(config, single, id, ids.slice(0, 1)), {
    code: 'PROVIDER_UNREACHABLE'
  });
});

test('collections reject altered bytes, invalid counts and Facebook before any provider request', async (t) => {
  const f = albumFixture();
  t.mock.method(globalThis, 'fetch', async () =>
    assert.fail('Rejected media cannot reach a provider.')
  );
  for (const images of [
    [],
    f.images.slice(0, 1),
    [...f.images, ...f.images],
    [{ ...f.images[0], bytes: Buffer.from('altered') }, f.images[1]]
  ]) {
    await assert.rejects(
      sendDelivery(feedConfig(f.job.feedId, env).config, f.job, images)
    );
  }
  await assert.rejects(
    sendDelivery(
      feedConfig(job.feedId, env).config,
      { ...f.job, feedId: job.feedId },
      f.images
    ),
    { code: 'FORMAT_UNAVAILABLE' }
  );
});
