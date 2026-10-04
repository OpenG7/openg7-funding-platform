import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';

import { createApiRequestListener } from '../dist/apps/funding-api/src/http-composition/request-listener.js';

const fixture = (state = {}) => {
  const reports = [];
  const writes = [];
  let destroys = 0;
  const request = {
    method: 'POST',
    url: '/api/sponsorship-followup?tracking=synthetic-private-token',
    headers: { authorization: 'Bearer synthetic-private-token' },
    body: 'Synthetic private request body'
  };
  const response = {
    destroyed: false,
    writableEnded: false,
    headersSent: false,
    ...state,
    destroy() {
      destroys += 1;
      this.destroyed = true;
    }
  };
  const context = {
    async handleRequest(incoming, outgoing) {
      assert.equal(incoming, request);
      assert.equal(outgoing, response);
      await Promise.resolve();
      throw new Error('Synthetic private provider diagnostics');
    },
    writeJson(incoming, outgoing, status, payload) {
      assert.equal(incoming, request);
      assert.equal(outgoing, response);
      writes.push({ status, payload });
    },
    reportFailure(...args) {
      reports.push(args);
    }
  };
  return {
    context,
    request,
    response,
    reports,
    writes,
    get destroys() {
      return destroys;
    }
  };
};

test('listener passes through successful dispatch without reporting or writing a fallback', async () => {
  const f = fixture();
  let calls = 0;
  f.context.handleRequest = async (incoming, outgoing) => {
    assert.equal(incoming, f.request);
    assert.equal(outgoing, f.response);
    calls += 1;
    await Promise.resolve();
    outgoing.writableEnded = true;
  };
  const listener = createApiRequestListener(f.context);
  assert.equal(calls, 0, 'Composing a listener must not dispatch.');
  assert.equal(listener(f.request, f.response), undefined);
  await setImmediate();
  assert.equal(calls, 1);
  assert.deepEqual(f.reports, []);
  assert.deepEqual(f.writes, []);
  assert.equal(f.destroys, 0);
});

test('asynchronous failure writes the stable safe 500 when the response is available', async () => {
  const f = fixture();
  createApiRequestListener(f.context)(f.request, f.response);
  await setImmediate();
  assert.deepEqual(f.reports, [['Unhandled API request failure.']]);
  assert.deepEqual(f.writes, [
    {
      status: 500,
      payload: {
        code: 'INTERNAL_ERROR',
        error: 'The request could not be completed.'
      }
    }
  ]);
  assert.equal(f.destroys, 0);
});

test('asynchronous failure preserves destroyed and ended responses, including sent headers', async () => {
  for (const state of [
    { destroyed: true },
    { writableEnded: true },
    { destroyed: true, headersSent: true },
    { writableEnded: true, headersSent: true }
  ]) {
    const f = fixture(state);
    createApiRequestListener(f.context)(f.request, f.response);
    await setImmediate();
    assert.deepEqual(f.reports, [['Unhandled API request failure.']]);
    assert.deepEqual(f.writes, []);
    assert.equal(f.destroys, 0);
  }
});

test('asynchronous failure destroys a started response instead of appending a 500 body', async () => {
  const f = fixture({ headersSent: true });
  createApiRequestListener(f.context)(f.request, f.response);
  await setImmediate();
  assert.deepEqual(f.reports, [['Unhandled API request failure.']]);
  assert.deepEqual(f.writes, []);
  assert.equal(f.destroys, 1);
  assert.equal(f.response.destroyed, true);
});
