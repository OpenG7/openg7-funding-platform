import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createPublicReferencesHttpHandlers } from '../dist/apps/funding-api/src/public-references.http.js';
import { readBody } from '../dist/apps/funding-api/src/http-transport.js';

const reference = 'OG7-2026-ABCDEF';
const email = 'synthetic@example.test';
const fixture = ({
  hasDatabase = true,
  lookup = null,
  references = [],
  queue = { queued: true, sent: false },
  failures = {}
} = {}) => {
  const calls = [];
  const record = (name, value) => {
    calls.push({ name, value });
    if (failures[name]) throw failures[name];
  };
  const handlers = createPublicReferencesHttpHandlers({
    publicBaseOrigin: 'https://funding.example.test',
    hasDatabase,
    readBody: async (request, limit) => {
      record('body', limit);
      return readBody(request, limit);
    },
    writeJson: (_request, response, status, payload) => {
      record('response', { status, payload });
      Object.assign(response, { status, payload });
    },
    normalizeReferenceRecoveryEmail: (value) =>
      typeof value === 'string' &&
      /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim())
        ? value.trim().toLowerCase()
        : null,
    createReferenceRecoveryIdempotencyKey: () =>
      'synthetic-hourly-idempotency-key',
    lookupPublicContributionReference: async (value) => {
      record('lookup', value);
      return lookup;
    },
    listContributionReferencesByEmail: async (value) => {
      record('references', value);
      return references;
    },
    queueContributionReferenceRecoveryEmail: async (input) => {
      record('queue', input);
      return queue;
    },
    reportFailure: (...args) => record('failure', args),
    reportWarning: (...args) => record('warning', args)
  });
  const invoke = async (
    kind,
    payload,
    { url = `/reference-${kind}`, method = 'POST' } = {}
  ) => {
    const request = Readable.from([
      typeof payload === 'string' ? payload : JSON.stringify(payload)
    ]);
    Object.assign(request, { method, url, headers: {} });
    const response = {};
    const handler =
      kind === 'lookup'
        ? handlers.handleReferenceLookupRequest
        : handlers.handleReferenceRecoveryRequest;
    return { handled: await handler(request, response), ...response };
  };
  return { calls, invoke };
};

test('Reference routes preserve POST/alias dispatch and reject database absence before reading', async () => {
  for (const kind of ['lookup', 'recovery']) {
    for (const method of ['GET', 'PATCH']) {
      const f = fixture();
      assert.deepEqual(await f.invoke(kind, {}, { method }), {
        handled: false
      });
      assert.deepEqual(f.calls, []);
    }
    const f = fixture({ hasDatabase: false });
    assert.deepEqual(
      await f.invoke(kind, '{', { url: `/api/reference-${kind}?x=1` }),
      {
        handled: true,
        status: 503,
        payload: { error: `Reference ${kind} requires DATABASE_URL.` }
      }
    );
    assert.deepEqual(
      f.calls.map(({ name }) => name),
      ['response']
    );
  }
  const lookup = fixture();
  assert.deepEqual(
    await lookup.invoke('lookup', {}, { url: '/reference-recovery' }),
    { handled: false }
  );
  assert.deepEqual(lookup.calls, []);
});

test('Reference lookup normalizes references and preserves found/absent public responses', async () => {
  for (const lookup of [
    null,
    { found: true, publicReference: reference, paymentStatus: 'paid' }
  ]) {
    const f = fixture({ lookup });
    assert.deepEqual(
      await f.invoke(
        'lookup',
        { reference: ' og7-2026-abcdef ' },
        { url: '/api/reference-lookup' }
      ),
      {
        handled: true,
        status: 200,
        payload: lookup ?? { found: false, publicReference: reference }
      }
    );
    assert.equal(f.calls[0].value, 4096);
    assert.deepEqual(f.calls[1], { name: 'lookup', value: reference });
  }
});

test('Reference validation and bounded body failures precede readers', async () => {
  for (const [kind, input, error] of [
    ['lookup', '{', 'Invalid reference lookup request body.'],
    [
      'lookup',
      { reference: 'invalid' },
      'A valid OpenG7 reference is required.'
    ],
    ['lookup', null, 'A valid OpenG7 reference is required.'],
    ['lookup', 'x'.repeat(4097), 'Invalid reference lookup request body.'],
    ['recovery', '{', 'Invalid reference recovery request body.'],
    ['recovery', { email: 'invalid' }, 'A valid email address is required.'],
    ['recovery', null, 'A valid email address is required.'],
    ['recovery', 'x'.repeat(8193), 'Invalid reference recovery request body.']
  ]) {
    const f = fixture();
    assert.deepEqual(await f.invoke(kind, input), {
      handled: true,
      status: 400,
      payload: { error }
    });
    assert.deepEqual(
      f.calls.map(({ name }) => name),
      ['body', 'response']
    );
  }
});

test('Reference recovery hides matches and queue failures; repetitions retain the recovery key', async () => {
  for (const options of [
    {},
    { references: [{ publicReference: reference }] },
    {
      references: [{ publicReference: reference }],
      queue: { queued: false, sent: false }
    },
    {
      references: [{ publicReference: reference }],
      failures: { queue: new Error('synthetic private message') }
    }
  ]) {
    const f = fixture(options);
    for (let repetition = 0; repetition < 2; repetition++) {
      assert.deepEqual(
        await f.invoke(
          'recovery',
          { email: ' Synthetic@example.test ' },
          { url: '/api/reference-recovery' }
        ),
        {
          handled: true,
          status: 202,
          payload: { accepted: true }
        }
      );
    }
    assert.equal(f.calls[0].value, 8192);
    for (const call of f.calls.filter(({ name }) => name === 'queue')) {
      assert.deepEqual(call.value, {
        to: email,
        references: options.references,
        idempotencyKey: 'synthetic-hourly-idempotency-key'
      });
    }
    for (const call of f.calls.filter(({ name }) =>
      ['failure', 'warning'].includes(name)
    )) {
      assert.deepEqual(call.value, [
        'Reference recovery email could not be queued or sent.'
      ]);
    }
  }
});

test('Lookup failures remain 502; recovery database failure stays private and allows a subsequent retry', async () => {
  const lookup = fixture({
    failures: { lookup: new Error('synthetic outage') }
  });
  assert.equal((await lookup.invoke('lookup', { reference })).status, 502);
  const failures = { references: new Error('synthetic private data') };
  const recovery = fixture({ failures });
  assert.deepEqual(await recovery.invoke('recovery', { email }), {
    handled: true,
    status: 502,
    payload: { error: 'Reference recovery request could not be processed.' }
  });
  assert.deepEqual(
    recovery.calls.find(({ name }) => name === 'failure').value,
    ['Failed to process reference recovery request.']
  );
  delete failures.references;
  assert.equal((await recovery.invoke('recovery', { email })).status, 202);
});
