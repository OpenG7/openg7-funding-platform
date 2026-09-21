import assert from 'node:assert/strict';
import test from 'node:test';
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
