import assert from 'node:assert/strict';
import test from 'node:test';

import { FundingSponsorshipFollowupClient } from '../dist/apps/funding-web/src/app/features/funding/services/funding-sponsorship-followup.client.js';
import {
  followupAccessExpired,
  SponsorshipFollowupError
} from '../dist/apps/funding-web/src/app/features/funding/models/sponsorship-followup-ui.js';

const baseUrl = 'https://funding.example.test/api';
const token = 'synthetic token+/=&?';
const encodedToken = 'synthetic+token%2B%2F%3D%26%3F';
const file = new File(['synthetic image'], 'sponsor.png', {
  type: 'image/png'
});
const draft = {
  token,
  expectedRevision: 4,
  data: {
    companyName: 'Synthetic sponsor',
    contactName: 'Synthetic contact',
    contactEmail: 'sponsor@example.test',
    message: 'Draft message'
  }
};
const details = { token, draftRevision: 4, ...draft.data };
const deletion = {
  token,
  assetId: 'synthetic asset/+',
  expectedVersion: 'v4',
  confirmed: true
};
const jsonEndpoints = [
  {
    name: 'follow-up',
    invoke: (client) => client.getSponsorshipFollowup(token),
    path: `/sponsorship-followup?token=${encodedToken}`,
    options: { method: 'GET', headers: { Accept: 'application/json' } },
    typedError: true
  },
  {
    name: 'draft read',
    invoke: (client) => client.getSponsorshipDraft(token),
    path: `/sponsorship-followup/draft?token=${encodedToken}`,
    options: { cache: 'no-store' },
    typedError: true
  },
  {
    name: 'draft save',
    invoke: (client) => client.saveSponsorshipDraft(draft),
    path: '/sponsorship-followup/draft',
    options: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft)
    },
    typedError: true,
    errorCode: true
  },
  {
    name: 'details',
    invoke: (client) => client.submitSponsorshipFollowupDetails(details),
    path: '/sponsorship-followup/details',
    options: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(details)
    },
    typedError: true,
    errorCode: true
  },
  {
    name: 'media list',
    invoke: (client) => client.getSponsorshipMedia(token),
    path: `/sponsorship-followup/media?token=${encodedToken}`,
    options: { headers: { Accept: 'application/json' } },
    fallback: 'Sponsorship media could not be loaded.'
  },
  {
    name: 'media delete',
    invoke: (client) => client.deleteSponsorshipMedia(deletion),
    path: '/sponsorship-followup/media/delete',
    options: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(deletion)
    },
    serverError: true,
    fallback: 'Sponsor media could not be deleted.'
  }
];
const endpoints = [
  ...jsonEndpoints,
  {
    name: 'access recovery',
    invoke: (client) =>
      client.requestSponsorshipAccess('sponsor@example.test', 'fr-CA'),
    typedError: true
  },
  {
    name: 'media preview',
    invoke: (client) =>
      client.getSponsorshipMediaPreview(token, 'synthetic asset/+'),
    fallback: 'Sponsorship media preview could not be loaded.'
  },
  {
    name: 'media upload',
    invoke: (client) => client.uploadSponsorshipMedia(token, 'logo', file),
    serverError: true,
    fallback: 'Sponsor media could not be uploaded.'
  }
];

test('follow-up JSON endpoints preserve payloads, token encoding, headers, cache and response data', async (t) => {
  for (const endpoint of jsonEndpoints) {
    await t.test(endpoint.name, async (t) => {
      const client = new FundingSponsorshipFollowupClient(baseUrl);
      const response = {
        synthetic: true,
        paymentStatus: 'pending',
        reviewStatus: 'pending',
        publicVisible: false,
        revision: 5
      };
      const fetchMock = t.mock.method(
        globalThis,
        'fetch',
        async (url, options) => {
          assert.equal(url, baseUrl + endpoint.path);
          assert.deepEqual(options, endpoint.options);
          return Response.json(response);
        }
      );
      assert.deepEqual(await endpoint.invoke(client), response);
      assert.equal(fetchMock.mock.callCount(), 1);
    });
  }
});

test('access recovery preserves email, FR/EN locale, optional AbortSignal and strict acceptance', async (t) => {
  for (const locale of ['fr-CA', 'en']) {
    for (const withSignal of [false, true]) {
      await t.test(`${locale}: signal ${withSignal}`, async (t) => {
        const client = new FundingSponsorshipFollowupClient(baseUrl);
        const signal = withSignal ? new AbortController().signal : undefined;
        const email = ' Sponsor+synthetic@example.test ';
        const fetchMock = t.mock.method(
          globalThis,
          'fetch',
          async (url, options) => {
            assert.equal(url, baseUrl + '/sponsorship-followup/recover');
            assert.deepEqual(options, {
              signal,
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email, locale })
            });
            return Response.json({ accepted: true });
          }
        );
        assert.equal(
          await client.requestSponsorshipAccess(email, locale, signal),
          undefined
        );
        assert.equal(fetchMock.mock.callCount(), 1);
      });
    }
  }
  for (const accepted of [false, undefined, 'true', 1]) {
    await t.test(`rejected acceptance: ${accepted}`, async (t) => {
      const client = new FundingSponsorshipFollowupClient(baseUrl);
      const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
        Response.json({ accepted })
      );
      await assert.rejects(
        client.requestSponsorshipAccess('sponsor@example.test', 'en'),
        (error) => {
          assert.ok(error instanceof SponsorshipFollowupError);
          assert.equal(error.status, 200);
          assert.equal(error.code, '');
          return true;
        }
      );
      assert.equal(fetchMock.mock.callCount(), 1);
    });
  }
});

test('media preview encodes the asset path, keeps its private token in a header and returns the Blob', async (t) => {
  const client = new FundingSponsorshipFollowupClient(baseUrl);
  const blob = new Blob(['synthetic image'], { type: 'image/png' });
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(
      url,
      baseUrl + '/sponsorship-followup/media/content/synthetic%20asset%2F%2B'
    );
    assert.equal(new URL(url).search, '');
    assert.deepEqual(options, {
      headers: {
        Accept: 'image/*',
        'X-Sponsorship-Followup-Token': token
      }
    });
    return { ok: true, blob: async () => blob };
  });
  t.mock.method(URL, 'createObjectURL', () =>
    assert.fail('preview URL ownership belongs to its consumer')
  );
  assert.equal(
    await client.getSponsorshipMediaPreview(token, 'synthetic asset/+'),
    blob
  );
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('media upload preserves multipart File, token, kind and trimmed optional alt text', async (t) => {
  for (const kind of ['logo', 'supporting_image']) {
    for (const altText of [undefined, '', '  ', '  Synthetic description  ']) {
      await t.test(
        `${kind}: alt text ${JSON.stringify(altText)}`,
        async (t) => {
          const client = new FundingSponsorshipFollowupClient(baseUrl);
          const result = {
            uploaded: true,
            asset: { id: 'synthetic-asset', reviewStatus: 'pending_review' }
          };
          const fetchMock = t.mock.method(
            globalThis,
            'fetch',
            async (url, options) => {
              assert.equal(url, baseUrl + '/sponsorship-followup/media');
              assert.deepEqual(Object.keys(options).sort(), ['body', 'method']);
              assert.equal(options.method, 'POST');
              assert.ok(options.body instanceof FormData);
              assert.equal(options.body.get('token'), token);
              assert.equal(options.body.get('kind'), kind);
              const media = options.body.get('media');
              assert.ok(media instanceof File);
              assert.equal(media.name, file.name);
              assert.equal(media.type, file.type);
              assert.equal(await media.text(), await file.text());
              assert.equal(
                options.body.get('altText'),
                altText?.trim() || null
              );
              assert.deepEqual(
                [...options.body.keys()].sort(),
                altText?.trim()
                  ? ['altText', 'kind', 'media', 'token']
                  : ['kind', 'media', 'token']
              );
              return Response.json(result);
            }
          );
          assert.deepEqual(
            await client.uploadSponsorshipMedia(token, kind, file, altText),
            result
          );
          assert.equal(fetchMock.mock.callCount(), 1);
        }
      );
    }
  }
});

test('HTTP failures retain each endpoint error class, status, code or server message without retries', async (t) => {
  for (const endpoint of endpoints) {
    for (const status of [400, 401, 403, 404, 409, 410, 503]) {
      await t.test(`${endpoint.name}: ${status}`, async (t) => {
        const client = new FundingSponsorshipFollowupClient(baseUrl);
        const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
          Response.json(
            { code: 'SYNTHETIC_FAILURE', error: 'Synthetic server message' },
            { status }
          )
        );
        await assert.rejects(endpoint.invoke(client), (error) => {
          assert.equal(
            error instanceof SponsorshipFollowupError,
            Boolean(endpoint.typedError)
          );
          if (endpoint.typedError) {
            assert.equal(error.constructor, SponsorshipFollowupError);
            assert.equal(error.status, status);
            assert.equal(
              error.code,
              endpoint.errorCode ? 'SYNTHETIC_FAILURE' : ''
            );
            assert.equal(
              followupAccessExpired(error),
              [400, 401, 403, 404, 410].includes(status)
            );
            assert.equal(
              error.message,
              'Sponsorship follow-up request failed.'
            );
          } else {
            assert.equal(error.constructor, Error);
            assert.equal(error.status, undefined);
            assert.equal(
              error.message,
              endpoint.serverError
                ? 'Synthetic server message'
                : endpoint.fallback
            );
          }
          return true;
        });
        assert.equal(fetchMock.mock.callCount(), 1);
      });
    }
  }
});

test('malformed HTTP error bodies preserve fallback policies and recovery skips their parsing', async (t) => {
  for (const endpoint of endpoints) {
    await t.test(endpoint.name, async (t) => {
      const client = new FundingSponsorshipFollowupClient(baseUrl);
      const fetchMock = t.mock.method(
        globalThis,
        'fetch',
        async () => new Response('not JSON', { status: 503 })
      );
      await assert.rejects(endpoint.invoke(client), (error) => {
        if (endpoint.typedError) {
          assert.ok(error instanceof SponsorshipFollowupError);
          assert.equal(error.status, 503);
          assert.equal(error.code, '');
        } else {
          assert.equal(error.constructor, Error);
          assert.equal(error.message, endpoint.fallback);
        }
        return true;
      });
      assert.equal(fetchMock.mock.callCount(), 1);
    });
  }
});

test('failed recovery checks HTTP status before reading an acceptance body', async (t) => {
  const client = new FundingSponsorshipFollowupClient(baseUrl);
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => ({
    ok: false,
    status: 503,
    json: () => assert.fail('a failed recovery response must not be decoded')
  }));
  await assert.rejects(
    client.requestSponsorshipAccess('sponsor@example.test', 'fr-CA'),
    (error) => {
      assert.ok(error instanceof SponsorshipFollowupError);
      assert.equal(error.status, 503);
      return true;
    }
  );
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('network failures propagate the same error once for every follow-up endpoint', async (t) => {
  for (const endpoint of endpoints) {
    await t.test(endpoint.name, async (t) => {
      const client = new FundingSponsorshipFollowupClient(baseUrl);
      const networkError = new TypeError('Synthetic network failure');
      const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
        throw networkError;
      });
      await assert.rejects(
        endpoint.invoke(client),
        (error) => error === networkError
      );
      assert.equal(fetchMock.mock.callCount(), 1);
    });
  }
});

test('successful response decoding failures propagate without replaying mutations', async (t) => {
  for (const endpoint of endpoints) {
    await t.test(endpoint.name, async (t) => {
      const client = new FundingSponsorshipFollowupClient(baseUrl);
      const decodeError = new SyntaxError(
        'Synthetic response decoding failure'
      );
      const decode = async () => {
        throw decodeError;
      };
      const fetchMock = t.mock.method(globalThis, 'fetch', async () => ({
        ok: true,
        status: 200,
        json: decode,
        blob: decode
      }));
      await assert.rejects(
        endpoint.invoke(client),
        (error) => error === decodeError
      );
      assert.equal(fetchMock.mock.callCount(), 1);
    });
  }
});

test('access recovery abort preserves caller signal and abort reason without retrying', async (t) => {
  const client = new FundingSponsorshipFollowupClient(baseUrl);
  const controller = new AbortController();
  const reason = new DOMException('Synthetic cancellation', 'AbortError');
  controller.abort(reason);
  const fetchMock = t.mock.method(
    globalThis,
    'fetch',
    async (_url, options) => {
      assert.equal(options.signal, controller.signal);
      options.signal.throwIfAborted();
    }
  );
  await assert.rejects(
    client.requestSponsorshipAccess(
      'sponsor@example.test',
      'fr-CA',
      controller.signal
    ),
    (error) => error === reason
  );
  assert.equal(fetchMock.mock.callCount(), 1);
});
