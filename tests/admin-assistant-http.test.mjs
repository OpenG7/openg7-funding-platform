import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createAdminAssistantHttpHandler } from '../dist/apps/funding-api/src/admin-assistant.http.js';
import { readBody } from '../dist/apps/funding-api/src/http-transport.js';

const sponsorshipId = '00000000-0000-4000-8000-000000000001';
const fixture = ({
  denied,
  accessDenied,
  failing,
  queryStatus = 'ok'
} = {}) => {
  const calls = [];
  const failure = new Error('synthetic private provider diagnostics');
  const results = {
    context: {
      status: 'unavailable',
      context: null,
      conversationMode: 'disabled'
    },
    summary: { counts: { urgent: 2, today: 3 }, attentionItems: [{}, {}] },
    query: {
      status: queryStatus,
      mode: 'disabled',
      provider: { name: 'disabled', model: null },
      toolInvocations: []
    },
    prepare: {
      status: 'ok',
      draft: { sent: false, published: false, persisted: false }
    }
  };
  const writeJson = (_request, response, status, payload, headers = {}) => {
    response.status = status;
    response.payload = payload;
    Object.assign(response.headers, headers);
    calls.push({ name: 'respond' });
  };
  const authorize = (name, status) => (request, response) => {
    calls.push({ name });
    if (!status) return true;
    writeJson(request, response, status, { error: 'Access rejected.' });
    return false;
  };
  const port = (name) => async (input) => {
    calls.push({ name, input });
    if (failing === name) throw failure;
    return results[name];
  };
  const handler = createAdminAssistantHttpHandler({
    publicBaseOrigin: 'https://funding.example.test',
    ensureAdminAuthorization: authorize('authorization', denied),
    ensureAdminAccess: authorize('access', denied ?? accessDenied),
    readBody: async (request, limit) => {
      calls.push({ name: 'body', limit });
      return readBody(request, limit);
    },
    writeJson,
    isValidUuid: (value) =>
      typeof value === 'string' &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        value
      ),
    adminAssistantConfig: { maxMessageLength: 2000 },
    getAdminAssistantContext: port('context'),
    buildAdminAssistantSummary: port('summary'),
    runAdminAssistantQuery: port('query'),
    prepareAdminAssistantDraft: port('prepare'),
    recordAdminAssistantAudit: async (request, action, metadata) => {
      calls.push({ name: 'audit', request, action, metadata });
      if (failing === 'audit') throw failure;
    },
    reportFailure: (message, error) =>
      calls.push({ name: 'report', message, error })
  });
  return {
    calls,
    results,
    failure,
    async run(url, { method = 'GET', body = '' } = {}) {
      const request = Object.assign(Readable.from([Buffer.from(body)]), {
        method,
        url,
        headers: { 'content-type': 'application/json' }
      });
      const response = { headers: {} };
      return {
        handled: await handler(request, response),
        request,
        ...response
      };
    }
  };
};

const routes = [
  ['context', 'GET', '', 'authorization'],
  ['summary', 'GET', '', 'access'],
  ['query', 'POST', '{"message":"  Question synthétique  "}', 'authorization'],
  ['prepare', 'POST', '{"type":"admin_note","language":"en"}', 'access']
];

test('assistant routes preserve both aliases, access checks and consultation-only ports', async (t) => {
  for (const prefix of ['/admin/assistant/', '/api/admin/assistant/']) {
    for (const [path, method, body, guard] of routes) {
      await t.test(prefix + path, async () => {
        const f = fixture();
        const result = await f.run(prefix + path, { method, body });
        assert.equal(result.handled, true);
        assert.equal(result.status, 200);
        assert.deepEqual(result.payload, f.results[path]);
        assert.equal(f.calls[0].name, guard);
        assert.deepEqual(
          f.calls
            .filter((call) => Object.hasOwn(f.results, call.name))
            .map((call) => call.name),
          [path]
        );
        if (path === 'query' || path === 'prepare')
          assert.equal(
            f.calls.find((call) => call.name === 'body').limit,
            16 * 1024
          );
        if (path === 'context' || path === 'prepare')
          assert.equal(result.headers['Cache-Control'], 'private, no-store');
        if (path === 'context')
          assert.equal(
            f.calls.some((call) => call.name === 'audit'),
            false
          );
        else {
          const audit = f.calls.find((call) => call.name === 'audit');
          assert.equal(audit.request, result.request);
          assert.equal(audit.action, 'admin_assistant.' + path);
          assert.ok(Number.isInteger(audit.metadata.durationMs));
          assert.ok(audit.metadata.durationMs >= 0);
          const { durationMs: _duration, ...metadata } = audit.metadata;
          assert.deepEqual(
            metadata,
            {
              summary: { urgent: 2, today: 3, itemCount: 2 },
              query: {
                status: 'ok',
                mode: 'disabled',
                provider: 'disabled',
                model: null,
                toolCalls: 0
              },
              prepare: { draftType: 'admin_note', status: 'ok' }
            }[path]
          );
          assert.ok(
            f.calls.indexOf(audit) <
              f.calls.findIndex((call) => call.name === 'respond')
          );
          assert.doesNotMatch(
            JSON.stringify(metadata),
            /Question synthétique|reference|recipient/
          );
        }
      });
    }
  }
});

test('absent, expired and forbidden sessions stop before parsing bodies, private reads or audits', async (t) => {
  for (const denied of [401, 403, 503]) {
    for (const [path, method, _body, guard] of routes) {
      await t.test(`${denied} ${path}`, async () => {
        const f = fixture({ denied });
        const result = await f.run('/api/admin/assistant/' + path, {
          method,
          body: '{'
        });
        assert.equal(result.status, denied);
        assert.equal(result.handled, true);
        assert.deepEqual(
          f.calls.map((call) => call.name),
          [guard, 'respond']
        );
      });
    }
  }
  const f = fixture({ accessDenied: 503 });
  assert.equal((await f.run('/admin/assistant/context')).status, 200);
  assert.equal(
    (
      await f.run('/admin/assistant/query', {
        method: 'POST',
        body: '{"message":"Question"}'
      })
    ).status,
    200
  );
  assert.equal((await f.run('/admin/assistant/summary')).status, 503);
});

test('context validates selection and passes only the requested sponsorship ID', async () => {
  const f = fixture();
  assert.equal(
    (await f.run('/admin/assistant/context?sponsorshipId=invalid')).status,
    400
  );
  assert.equal(
    f.calls.some((call) => call.name === 'context'),
    false
  );
  const selected = fixture();
  assert.equal(
    (
      await selected.run(
        '/admin/assistant/context?sponsorshipId=' + sponsorshipId
      )
    ).status,
    200
  );
  assert.equal(
    selected.calls.find((call) => call.name === 'context').input,
    sponsorshipId
  );
});

test('query normalizes text and enforces JSON, byte, message and sponsorship boundaries', async (t) => {
  for (const body of [
    '{',
    '',
    'null',
    '{}',
    '{"message":4}',
    '{"message":"  "}',
    JSON.stringify({ message: 'x'.repeat(2001) }),
    JSON.stringify({ message: 'Question', sponsorshipId: 'invalid' }),
    JSON.stringify({ message: 'Question', padding: 'x'.repeat(16 * 1024) })
  ]) {
    await t.test(body.slice(0, 70), async () => {
      const f = fixture();
      const result = await f.run('/admin/assistant/query', {
        method: 'POST',
        body
      });
      assert.equal(result.status, 400);
      assert.equal(
        f.calls.some((call) => call.name === 'query' || call.name === 'audit'),
        false
      );
    });
  }
  const f = fixture();
  await f.run('/api/admin/assistant/query', {
    method: 'POST',
    body: JSON.stringify({
      message: '  Question synthétique  ',
      sponsorshipId,
      ignored: 'unused'
    })
  });
  assert.deepEqual(f.calls.find((call) => call.name === 'query').input, {
    message: 'Question synthétique',
    sponsorshipId
  });
  const boundary = fixture();
  assert.equal(
    (
      await boundary.run('/admin/assistant/query', {
        method: 'POST',
        body: JSON.stringify({ message: 'x'.repeat(2000) })
      })
    ).status,
    200
  );
});

test('preparation accepts only known types and locales and bounds the reference without sending a draft', async (t) => {
  for (const body of [
    '{',
    '',
    'null',
    '{}',
    '{"type":"refund"}',
    '{"type":"admin_note","language":"fr"}',
    JSON.stringify({ type: 'admin_note', padding: 'x'.repeat(16 * 1024) })
  ]) {
    await t.test(body.slice(0, 70), async () => {
      const f = fixture();
      const result = await f.run('/admin/assistant/prepare', {
        method: 'POST',
        body
      });
      assert.equal(result.status, 400);
      assert.equal(
        f.calls.some(
          (call) => call.name === 'prepare' || call.name === 'audit'
        ),
        false
      );
    });
  }
  for (const type of [
    'sponsorship_reminder',
    'publication_draft',
    'admin_note',
    'slot_proposal'
  ]) {
    const f = fixture();
    const result = await f.run('/api/admin/assistant/prepare', {
      method: 'POST',
      body: JSON.stringify({
        type,
        language: 'fr-CA',
        reference: '  ' + 'r'.repeat(80) + '  ',
        confirmed: true
      })
    });
    assert.equal(result.status, 200);
    assert.deepEqual(f.calls.find((call) => call.name === 'prepare').input, {
      type,
      language: 'fr-CA',
      reference: 'r'.repeat(64)
    });
    assert.deepEqual(result.payload.draft, {
      sent: false,
      published: false,
      persisted: false
    });
  }
});

test('disabled and provider failure states remain structured responses and preserve audit status', async () => {
  for (const queryStatus of [
    'assistant_disabled',
    'provider_not_configured',
    'no_results',
    'timeout',
    'provider_error'
  ]) {
    const f = fixture({ queryStatus });
    const result = await f.run('/admin/assistant/query', {
      method: 'POST',
      body: '{"message":"Question"}'
    });
    assert.equal(result.status, 200);
    assert.equal(result.payload.status, queryStatus);
    assert.equal(
      f.calls.find((call) => call.name === 'audit').metadata.status,
      queryStatus
    );
  }
});

test('service failures return stable errors without provider diagnostics or false success', async () => {
  for (const [path, method, body] of routes) {
    const f = fixture({ failing: path });
    const result = await f.run('/api/admin/assistant/' + path, {
      method,
      body
    });
    assert.equal(result.status, path === 'context' ? 503 : 502);
    assert.doesNotMatch(
      JSON.stringify(result.payload),
      /synthetic private|diagnostics/
    );
    assert.equal(
      f.calls.some((call) => call.name === 'audit'),
      false
    );
    if (path === 'context')
      assert.equal(result.headers['Cache-Control'], 'private, no-store');
    else
      assert.equal(
        f.calls.find((call) => call.name === 'report').error,
        f.failure
      );
  }
  const f = fixture({ failing: 'audit' });
  assert.equal((await f.run('/admin/assistant/summary')).status, 502);
});

test('unowned paths and methods fall through without access checks or side effects', async () => {
  for (const [url, method] of [
    ['/admin/assistant/query', 'GET'],
    ['/api/admin/assistant/context', 'POST'],
    ['/admin/assistant/summary', 'POST'],
    ['/admin/assistant/prepare', 'GET'],
    ['/admin/assistant/summary/extra', 'GET'],
    ['/admin/sponsorships/request-information', 'POST'],
    ['/public/health', 'GET'],
    ['https://[', 'GET']
  ]) {
    const f = fixture();
    const result = await f.run(url, { method });
    assert.equal(result.handled, false);
    assert.equal(result.status, undefined);
    assert.deepEqual(f.calls, []);
  }
});
