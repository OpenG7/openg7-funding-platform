import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createAdminSponsorshipAccessHttpHandler } from '../dist/apps/funding-api/src/admin-sponsorship-access.http.js';
import {
  SponsorshipAccessError,
  normalizeRecoveryEmail
} from '../dist/apps/funding-api/src/sponsorship-access.service.js';
import { readBody } from '../dist/apps/funding-api/src/http-transport.js';

const origin = 'https://funding.example.test';
const contributionId = '00000000-0000-4000-8000-000000000001';
const requestId = '00000000-0000-4000-8000-000000000002';
const recipient = 'synthetic@example.test';
const actor = 'synthetic-owner';
const input = {
  contributionId,
  requestId,
  recipient: ` ${recipient.toUpperCase()} `,
  confirmed: true
};
const fixture = ({ denied, available = true, failure } = {}) => {
  const calls = [];
  const receipt = { queued: true, sent: false };
  const writeJson = (_request, response, status, payload) => {
    calls.push(['json', status]);
    Object.assign(response, { status, payload });
  };
  const handler = createAdminSponsorshipAccessHttpHandler({
    publicBaseOrigin: origin,
    ttlDays: 14,
    databaseAvailable: () => {
      calls.push(['database']);
      return available;
    },
    ensureAdminAccess: (request, response) => {
      calls.push(['access']);
      if (!denied) return true;
      writeJson(request, response, denied, { error: 'Access rejected.' });
      return false;
    },
    getAdminAuditActor: () => {
      calls.push(['actor']);
      return actor;
    },
    readBody: (request, limit) => {
      calls.push(['body', limit]);
      return readBody(request, limit);
    },
    writeJson,
    isValidUuid: (value) =>
      typeof value === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value
      ),
    normalizeRecoveryEmail: (value) => {
      calls.push(['normalize', value]);
      return normalizeRecoveryEmail(value);
    },
    SponsorshipAccessError,
    getSponsorshipAccessRecipient: async (id) => {
      calls.push(['recipient', id]);
      if (failure) throw failure;
      return recipient;
    },
    issueSponsorshipAccess: async (...args) => {
      calls.push(['issue', ...args]);
      if (failure) throw failure;
      return receipt;
    }
  });
  return {
    calls,
    receipt,
    async request(
      url = '/admin/sponsorships/followup-access',
      { method = 'POST', value = input, body = JSON.stringify(value) } = {}
    ) {
      const request = Object.assign(Readable.from([body]), {
        method,
        url,
        headers: {}
      });
      const response = {};
      return { handled: await handler(request, response), ...response };
    }
  };
};

test('admin sponsorship access aliases preserve recipient reads, confirmation, locale and repeat request ids', async () => {
  for (const prefix of ['/admin/', '/api/admin/']) {
    const f = fixture();
    const read = await f.request(
      `${prefix}sponsorships/followup-access?contributionId=${contributionId}`,
      { method: 'GET' }
    );
    assert.deepEqual(read.payload, { recipient });
    assert.deepEqual(f.calls, [
      ['access'],
      ['database'],
      ['recipient', contributionId],
      ['json', 200]
    ]);
    for (const locale of ['en', 'fr-CA', 'other']) {
      for (let repeat = 0; repeat < 2; repeat++) {
        const result = await f.request(
          `${prefix}sponsorships/followup-access`,
          { value: { ...input, locale } }
        );
        assert.equal(result.status, 200);
        assert.deepEqual(result.payload, f.receipt);
      }
    }
    const issued = f.calls.filter(([name]) => name === 'issue');
    assert.equal(issued.length, 6);
    for (let index = 0; index < issued.length; index++)
      assert.deepEqual(issued[index], [
        'issue',
        contributionId,
        recipient,
        { baseUrl: origin, ttlDays: 14, locale: index < 2 ? 'en' : 'fr-CA' },
        { actor, requestId }
      ]);
    assert.deepEqual(
      f.calls.filter(([name]) => name === 'body').map(([, limit]) => limit),
      Array(6).fill(8192)
    );
  }
});

test('admin sponsorship access checks rights and pool before reading', async () => {
  for (const denied of [401, 403, 503]) {
    const f = fixture({ denied });
    const result = await f.request(undefined, { body: '{' });
    assert.equal(result.status, denied);
    assert.deepEqual(
      f.calls.map(([name]) => name),
      ['access', 'json']
    );
  }
  const f = fixture({ available: false });
  const result = await f.request(undefined, { body: '{' });
  assert.equal(result.status, 503);
  assert.deepEqual(result.payload, { error: 'Recovery is unavailable.' });
  assert.deepEqual(
    f.calls.map(([name]) => name),
    ['access', 'database', 'json']
  );
});

test('admin sponsorship access validates ids, explicit confirmation and recipient before issue', async () => {
  for (const value of [
    null,
    {},
    { ...input, contributionId: 'bad' },
    { ...input, requestId: 'bad' },
    { ...input, confirmed: false },
    { ...input, confirmed: 'true' },
    { ...input, recipient: 'bad' }
  ]) {
    const f = fixture();
    const result = await f.request(undefined, { value });
    assert.equal(result.status, 400);
    assert.deepEqual(result.payload, {
      error: 'Access link could not be queued.',
      code: 'validation'
    });
    assert.equal(
      f.calls.some(([name]) => name === 'issue'),
      false
    );
  }
  for (const suffix of ['', '?contributionId=', '?contributionId=bad']) {
    const f = fixture();
    assert.equal(
      (
        await f.request(`/admin/sponsorships/followup-access${suffix}`, {
          method: 'GET'
        })
      ).status,
      400
    );
    assert.equal(
      f.calls.some(([name]) => name === 'recipient'),
      false
    );
  }
});

test('admin sponsorship access retains parse, size, conflict and unavailable mappings', async () => {
  for (const [body, status] of [
    ['{', 400],
    [' '.repeat(8193), 503]
  ]) {
    const result = await fixture().request(undefined, { body });
    assert.equal(result.status, status);
    assert.deepEqual(result.payload, {
      error: 'Access link could not be queued.',
      code: 'unavailable'
    });
  }
  for (const [failure, status, code] of [
    [
      new SponsorshipAccessError(409, 'recipient_changed'),
      409,
      'recipient_changed'
    ],
    [
      new SponsorshipAccessError(409, 'request_conflict'),
      409,
      'request_conflict'
    ],
    [new Error('synthetic private provider detail'), 503, 'unavailable']
  ]) {
    for (const method of ['GET', 'POST']) {
      const result = await fixture({ failure }).request(
        `/api/admin/sponsorships/followup-access?contributionId=${contributionId}`,
        { method }
      );
      assert.equal(result.status, status);
      assert.deepEqual(result.payload, {
        error: 'Access link could not be queued.',
        code
      });
    }
  }
});

test('admin sponsorship access only owns exact GET and POST routes', async () => {
  const f = fixture();
  for (const [url, method] of [
    ['/admin/sponsorships/followup-access', 'DELETE'],
    ['/api/admin/sponsorships/followup-access', 'PUT'],
    ['/admin/sponsorships/followup-access/extra', 'GET']
  ])
    assert.equal((await f.request(url, { method })).handled, false);
  assert.deepEqual(f.calls, []);
});
