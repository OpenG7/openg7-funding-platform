import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createAdminEmailHttpHandler } from '../dist/apps/funding-api/src/admin-email.http.js';
import { readBody } from '../dist/apps/funding-api/src/http-transport.js';

const requestId = '10000000-0000-4000-8000-000000000001';
const messageId = '20000000-0000-1000-8000-000000000002';
const recipient = 'synthetic-recipient@example.test';
const actor = 'synthetic-owner';
const timestamp = '2026-10-01T00:00:00.000Z';

const message = (status = 'failed') => ({
  id: messageId,
  template_key: 'admin_email_test',
  recipient_email: recipient,
  from_email: 'synthetic-sender@example.test',
  reply_to_email: null,
  subject: 'Synthetic test message',
  status,
  attempts: 1,
  max_attempts: 5,
  next_attempt_at: timestamp,
  sent_at: status === 'sent' ? timestamp : null,
  last_error: null,
  metadata: {},
  created_at: timestamp,
  updated_at: timestamp
});

const testResult = {
  requestId,
  status: 'queued',
  to: recipient,
  queued: true,
  attempted: false,
  sent: false,
  messageId,
  error: null
};

class EmailConfigurationTestError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

// These ports never connect to a database, SMTP provider or administrative session.
const fixture = ({
  authorizationStatus,
  accessStatus,
  databaseAvailable = true,
  smtpConfigured = true,
  fallbackRecipient = recipient,
  existingMessage = message(),
  updatedMessage = message('sent'),
  failureAt,
  failure = new Error('synthetic internal failure'),
  retryResult = {
    attempted: 1,
    sent: 1,
    failed: 0,
    messageIds: [messageId],
    sentMessageIds: [messageId],
    failedMessageIds: []
  }
} = {}) => {
  const calls = [];
  const record = (name, value) => calls.push({ name, value });
  const fail = (name) => {
    if (failureAt === name) throw failure;
  };
  const writeJson = (_request, response, status, payload) => {
    record('respond', status);
    response.status = status;
    response.payload = payload;
  };
  const authorize = (name, status) => (request, response) => {
    record(name);
    if (status !== undefined) {
      writeJson(request, response, status, {
        error: 'synthetic access rejection'
      });
      return false;
    }
    return true;
  };
  let messageReads = 0;
  const handler = createAdminEmailHttpHandler({
    publicBaseOrigin: 'https://funding.example.test',
    databaseAvailable: () => {
      record('database');
      return databaseAvailable;
    },
    ensureAdminAuthorization: authorize('authorization', authorizationStatus),
    ensureAdminAccess: authorize('access', accessStatus),
    getAdminAuditActor: () => {
      record('actor');
      return actor;
    },
    readBody: async (request, maxBytes) => {
      record('readBody', maxBytes);
      fail('readBody');
      return readBody(request, maxBytes);
    },
    writeJson,
    getTransactionalEmailConfigStatus: () => {
      record('smtp');
      return { configured: smtpConfigured };
    },
    adminNotificationRecipient: () => {
      record('recipient');
      return fallbackRecipient;
    },
    isValidSponsorEmail: (value) =>
      typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    isEmailTestRequestId: (value) =>
      typeof value === 'string' &&
      /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(
        value
      ),
    isValidUuid: (value) =>
      typeof value === 'string' &&
      /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value),
    EmailConfigurationTestError,
    getEmailConfigurationTest: async (id, requestingActor) => {
      record('getTest', { requestId: id, actor: requestingActor });
      fail('getTest');
      return testResult;
    },
    queueEmailConfigurationTest: async (input) => {
      record('queueTest', input);
      fail('queueTest');
      return testResult;
    },
    listAdminEmailQueue: async (scope) => {
      record('list', scope);
      fail('list');
      return { data_source: 'database', messages: [existingMessage] };
    },
    getAdminEmailQueueMessageById: async (id) => {
      const name = messageReads++ ? 'updatedMessage' : 'existingMessage';
      record(name, id);
      fail(name);
      return name === 'existingMessage' ? existingMessage : updatedMessage;
    },
    retryAdminEmailQueueMessage: async (id) => {
      record('retry', id);
      fail('retry');
      return retryResult;
    },
    reconcileEmailDelivery: async (input, requestingActor) => {
      record('reconcile', { input, actor: requestingActor });
      fail('reconcile');
      return true;
    },
    insertAdminAuditLog: async (input) => {
      record('audit', input);
      fail('audit');
    },
    reportFailure: (summary, error) => record('report', { summary, error })
  });

  const run = async ({
    method = 'POST',
    url = '/admin/email/test',
    body = JSON.stringify({ requestId, to: recipient }),
    contentType = 'application/json; charset=utf-8'
  } = {}) => {
    const request = Readable.from([Buffer.from(body)]);
    Object.assign(request, {
      method,
      url,
      headers: contentType ? { 'content-type': contentType } : {}
    });
    const response = {
      headers: {},
      setHeader(name, value) {
        record('header', { name, value });
        this.headers[name] = value;
      }
    };
    return { handled: await handler(request, response), response };
  };

  return {
    calls,
    run,
    names: () => calls.map(({ name }) => name),
    values: (name) =>
      calls.filter((call) => call.name === name).map((call) => call.value)
  };
};

for (const [method, url] of [
  ['GET', '/health'],
  ['DELETE', '/admin/email/test'],
  ['PUT', '/admin/email-queue/retry'],
  ['POST', '/admin/email-queue'],
  ['GET', '/admin/email/test/extra'],
  ['POST', '/api/admin/email-queue/retry/extra'],
  ['GET', undefined]
]) {
  test(`admin email handler leaves ${method} ${url} to its route owner`, async () => {
    const h = fixture();
    const result = await h.run({ method, url: url ?? '' });
    assert.equal(result.handled, false);
    assert.deepEqual(h.calls, []);
  });
}

for (const prefix of ['', '/api']) {
  for (const [method, suffix, check] of [
    ['POST', '/email/test', 'authorization'],
    ['GET', `/email/test?requestId=${requestId}`, 'authorization'],
    ['GET', '/email-queue?messageId=synthetic%20id', 'access'],
    ['POST', '/email-queue/retry', 'access']
  ]) {
    for (const status of [401, 403]) {
      test(`${method} ${prefix}/admin${suffix} rejects access ${status} before other work`, async () => {
        const h = fixture({
          authorizationStatus: status,
          accessStatus: status
        });
        const { handled, response } = await h.run({
          method,
          url: `${prefix}/admin${suffix}`,
          body: 'invalid body'
        });
        assert.equal(handled, true);
        assert.equal(response.status, status);
        assert.deepEqual(
          h.names(),
          suffix.startsWith('/email/test')
            ? ['header', check, 'respond']
            : [check, 'respond']
        );
        if (check === 'authorization') {
          assert.equal(response.headers['Cache-Control'], 'private, no-store');
        }
      });
    }
  }
}

for (const method of ['POST', 'GET']) {
  test(`email test ${method} reports missing database before request validation or SMTP`, async () => {
    const h = fixture({ databaseAvailable: false, smtpConfigured: false });
    const { response } = await h.run({ method, body: 'invalid' });
    assert.equal(response.status, 503);
    assert.deepEqual(response.payload, {
      error: 'Email test requires DATABASE_URL and migration 010.'
    });
    assert.deepEqual(h.names(), [
      'header',
      'authorization',
      'database',
      'respond'
    ]);
  });
}

test('email queue preserves the composed access gate database rejection', async () => {
  const h = fixture({ accessStatus: 503 });
  const { response } = await h.run({
    method: 'GET',
    url: '/admin/email-queue'
  });
  assert.equal(response.status, 503);
  assert.deepEqual(h.names(), ['access', 'respond']);
});

for (const query of ['', '?requestId=invalid', `?requestId=${messageId}`]) {
  test(`email test GET requires a valid v4 request id (${query || 'absent'})`, async () => {
    const h = fixture();
    const { response } = await h.run({
      method: 'GET',
      url: `/admin/email/test${query}`
    });
    assert.equal(response.status, 400);
    assert.deepEqual(response.payload, { code: 'INVALID_EMAIL_TEST' });
    assert.deepEqual(h.names(), [
      'header',
      'authorization',
      'database',
      'respond'
    ]);
  });
}

test('email test GET scopes its read to the requesting actor without retrying or auditing', async () => {
  const h = fixture({ smtpConfigured: false });
  const { response } = await h.run({
    method: 'GET',
    url: `/api/admin/email/test?requestId=${requestId}`
  });
  assert.equal(response.status, 200);
  assert.deepEqual(response.payload, testResult);
  assert.deepEqual(h.values('getTest'), [{ requestId, actor }]);
  assert.deepEqual(h.names(), [
    'header',
    'authorization',
    'database',
    'actor',
    'getTest',
    'respond'
  ]);
});

for (const method of ['GET', 'POST']) {
  for (const [failure, status, code] of [
    [
      new EmailConfigurationTestError(404, 'EMAIL_TEST_NOT_FOUND'),
      404,
      'EMAIL_TEST_NOT_FOUND'
    ],
    [
      new EmailConfigurationTestError(409, 'EMAIL_TEST_CONFLICT'),
      409,
      'EMAIL_TEST_CONFLICT'
    ],
    [
      new EmailConfigurationTestError(503, 'EMAIL_TEST_UNAVAILABLE'),
      503,
      'EMAIL_TEST_UNAVAILABLE'
    ],
    [new Error('synthetic private diagnostic'), 503, 'EMAIL_TEST_UNAVAILABLE']
  ]) {
    test(`email test ${method} preserves ${status}/${code} service errors`, async () => {
      const h = fixture({
        failureAt: method === 'GET' ? 'getTest' : 'queueTest',
        failure
      });
      const { response } = await h.run({
        method,
        url: `/admin/email/test?requestId=${requestId}`
      });
      assert.equal(response.status, status);
      assert.deepEqual(response.payload, { code });
      assert.equal(response.headers['Cache-Control'], 'private, no-store');
      assert.equal(h.values('audit').length, 0);
      assert.equal(h.values('retry').length, 0);
    });
  }
}

test('email test POST reports SMTP configuration before inspecting its body or content type', async () => {
  const h = fixture({ smtpConfigured: false });
  const { response } = await h.run({
    body: 'invalid',
    contentType: 'text/plain'
  });
  assert.equal(response.status, 400);
  assert.deepEqual(response.payload, {
    code: 'SMTP_NOT_CONFIGURED',
    error: 'SMTP email provider is not configured.'
  });
  assert.deepEqual(h.names(), [
    'header',
    'authorization',
    'database',
    'smtp',
    'respond'
  ]);
});

for (const contentType of ['', 'text/plain', 'application/json-patch+json']) {
  test(`email test POST rejects unsupported content type ${contentType || 'absent'}`, async () => {
    const h = fixture();
    const { response } = await h.run({ contentType });
    assert.equal(response.status, 415);
    assert.deepEqual(response.payload, { code: 'INVALID_EMAIL_TEST' });
    assert.equal(h.values('readBody').length, 0);
  });
}

for (const body of [
  'invalid',
  'null',
  '[]',
  '"string"',
  '42',
  '{}',
  JSON.stringify({ requestId: messageId }),
  JSON.stringify({ requestId, unexpected: true }),
  JSON.stringify({ requestId, to: null }),
  JSON.stringify({ requestId, to: 42 })
]) {
  test(`email test POST rejects invalid schema ${body}`, async () => {
    const h = fixture();
    const { response } = await h.run({ body });
    assert.equal(response.status, 400);
    assert.deepEqual(response.payload, {
      code: 'INVALID_EMAIL_TEST',
      error: 'Invalid email test request body.'
    });
    assert.equal(h.values('queueTest').length, 0);
    assert.equal(h.values('audit').length, 0);
  });
}

for (const body of [
  JSON.stringify({ requestId, to: `  ${recipient}  ` }),
  JSON.stringify({ requestId }),
  JSON.stringify({ requestId, to: '   ' })
]) {
  test(`email test POST delegates actor, id and resolved recipient (${body})`, async () => {
    const h = fixture();
    const { response } = await h.run({
      body,
      contentType: ' Application/JSON ; charset=utf-8'
    });
    assert.equal(response.status, 200);
    assert.deepEqual(response.payload, testResult);
    assert.deepEqual(h.values('queueTest'), [
      { requestId, to: recipient, actor }
    ]);
    assert.deepEqual(h.values('readBody'), [16 * 1024]);
    assert.equal(h.values('getTest').length, 0);
    assert.equal(h.values('audit').length, 0);
  });
}

for (const body of [
  JSON.stringify({ requestId, to: 'invalid' }),
  JSON.stringify({ requestId })
]) {
  test(`email test POST rejects an invalid resolved recipient (${body})`, async () => {
    const h = fixture({ fallbackRecipient: '' });
    const { response } = await h.run({ body });
    assert.equal(response.status, 400);
    assert.deepEqual(response.payload, {
      code: 'INVALID_RECIPIENT',
      error: 'A valid test email is required.'
    });
    assert.equal(h.values('queueTest').length, 0);
  });
}

for (const [url, payload] of [
  [
    '/admin/email/test',
    { code: 'INVALID_EMAIL_TEST', error: 'Invalid email test request body.' }
  ],
  [
    '/admin/email-queue/retry',
    { error: 'Invalid email queue retry request body.' }
  ]
]) {
  for (const failureAt of [undefined, 'readBody']) {
    test(`${url} rejects ${failureAt ? 'body read failure' : 'a body larger than 16 KiB'}`, async () => {
      const h = fixture({ failureAt });
      const { response } = await h.run({
        url,
        body: ' '.repeat(16 * 1024 + 1)
      });
      assert.equal(response.status, 400);
      assert.deepEqual(response.payload, payload);
      assert.deepEqual(h.values('readBody'), [16 * 1024]);
      assert.equal(h.values('queueTest').length, 0);
      assert.equal(h.values('retry').length, 0);
    });
  }
}

for (const [url, id] of [
  ['/admin/email-queue', undefined],
  ['/api/admin/email-queue?messageId=synthetic%20id', 'synthetic id'],
  ['/api/admin/email-queue?messageId=', '']
]) {
  test(`email queue GET preserves the selected scope (${url})`, async () => {
    const h = fixture();
    const { response } = await h.run({ method: 'GET', url });
    assert.equal(response.status, 200);
    assert.deepEqual(h.values('list'), [{ id }]);
    assert.deepEqual(h.names(), ['access', 'list', 'respond']);
    assert.deepEqual(response.headers, {});
  });
}

test('email queue GET reports a failed database read without exposing the diagnostic', async () => {
  const h = fixture({ failureAt: 'list' });
  const { response } = await h.run({
    method: 'GET',
    url: '/admin/email-queue'
  });
  assert.equal(response.status, 502);
  assert.deepEqual(response.payload, {
    error: 'Admin email queue could not be loaded. Apply migration 010.'
  });
  assert.deepEqual(h.names(), ['access', 'list', 'report', 'respond']);
  assert.equal(
    h.values('report')[0].summary,
    'Failed to load admin email queue.'
  );
});

test('email queue retry checks database availability after its access gate', async () => {
  const h = fixture({ databaseAvailable: false });
  const { response } = await h.run({
    url: '/admin/email-queue/retry',
    body: 'invalid'
  });
  assert.equal(response.status, 503);
  assert.deepEqual(response.payload, {
    error: 'Email queue retry requires DATABASE_URL and migration 010.'
  });
  assert.deepEqual(h.names(), ['access', 'database', 'respond']);
});

for (const body of [
  'invalid',
  'null',
  '{}',
  '[]',
  '42',
  JSON.stringify({ messageId: 42 })
]) {
  test(`email queue retry rejects invalid input (${body})`, async () => {
    const h = fixture();
    const { response } = await h.run({ url: '/admin/email-queue/retry', body });
    assert.equal(response.status, 400);
    assert.deepEqual(response.payload, {
      error:
        body === 'invalid'
          ? 'Invalid email queue retry request body.'
          : 'Email message id is invalid.'
    });
    assert.equal(h.values('existingMessage').length, 0);
    assert.equal(h.values('retry').length, 0);
    assert.equal(h.values('audit').length, 0);
  });
}

for (const [existingMessage, status, error] of [
  [null, 404, 'Email queue message was not found.'],
  [message('sent'), 409, 'Sent email messages cannot be retried.']
]) {
  test(`email queue retry preserves ${status} before attempts or audit`, async () => {
    const h = fixture({ existingMessage });
    const { response } = await h.run({
      url: '/admin/email-queue/retry',
      body: JSON.stringify({ messageId })
    });
    assert.equal(response.status, status);
    assert.deepEqual(response.payload, { error });
    assert.deepEqual(h.names(), [
      'access',
      'database',
      'readBody',
      'existingMessage',
      'respond'
    ]);
  });
}

test('email queue retry retains read, attempt, refreshed read, audit, response ordering', async () => {
  const h = fixture();
  const { response } = await h.run({
    url: '/api/admin/email-queue/retry',
    body: JSON.stringify({ messageId, legacyIgnoredField: true }),
    contentType: 'text/plain'
  });
  assert.equal(response.status, 200);
  assert.deepEqual(response.payload, {
    attempted: 1,
    sent: 1,
    failed: 0,
    messageIds: [messageId],
    sentMessageIds: [messageId],
    failedMessageIds: [],
    message: message('sent')
  });
  assert.deepEqual(h.values('audit'), [
    {
      actor,
      action: 'email_queue.retry',
      entityType: 'email_message',
      entityId: messageId,
      summary: `Email queue message ${messageId} retried manually.`,
      metadata: {
        templateKey: 'admin_email_test',
        recipientEmail: recipient,
        attempted: 1,
        sent: 1,
        failed: 0
      }
    }
  ]);
  assert.deepEqual(h.names(), [
    'access',
    'database',
    'readBody',
    'existingMessage',
    'retry',
    'updatedMessage',
    'actor',
    'audit',
    'respond'
  ]);
  assert.deepEqual(h.values('readBody'), [16 * 1024]);
});

test('email queue retry exposes a concurrent claim without creating a second attempt', async () => {
  const retryResult = {
    attempted: 0,
    sent: 0,
    failed: 0,
    messageIds: [],
    sentMessageIds: [],
    failedMessageIds: []
  };
  const h = fixture({
    existingMessage: message('sending'),
    updatedMessage: message('sending'),
    retryResult
  });
  const { response } = await h.run({
    url: '/admin/email-queue/retry',
    body: JSON.stringify({ messageId })
  });
  assert.equal(response.status, 200);
  assert.deepEqual(response.payload, {
    ...retryResult,
    message: message('sending')
  });
  assert.deepEqual(h.values('retry'), [messageId]);
  assert.equal(h.values('audit')[0].metadata.attempted, 0);
});

for (const failureAt of [
  'existingMessage',
  'retry',
  'updatedMessage',
  'audit'
]) {
  test(`email queue retry reports ${failureAt} failure without another attempt or false success`, async () => {
    const h = fixture({ failureAt });
    const { response } = await h.run({
      url: '/admin/email-queue/retry',
      body: JSON.stringify({ messageId })
    });
    assert.equal(response.status, 502);
    assert.deepEqual(response.payload, {
      error: 'Email queue message could not be retried.'
    });
    assert.equal(
      h.values('retry').length,
      failureAt === 'existingMessage' ? 0 : 1
    );
    assert.deepEqual(h.values('respond'), [502]);
    assert.equal(
      h.values('report')[0].summary,
      'Failed to retry email queue message.'
    );
    if (failureAt === 'audit') {
      assert.deepEqual(h.names().slice(-4), [
        'actor',
        'audit',
        'report',
        'respond'
      ]);
    }
  });
}

test('an uncertain SMTP message cannot use ordinary retry', async () => {
  const f = fixture({ existingMessage: message('uncertain') });
  const { response } = await f.run({
    url: '/api/admin/email-queue/retry',
    body: JSON.stringify({ messageId })
  });
  assert.equal(response.status, 409);
  assert.equal(response.payload.code, 'EMAIL_DELIVERY_RECONCILIATION_REQUIRED');
  assert.equal(f.values('retry').length, 0);
  assert.equal(f.values('audit').length, 0);
});
const reconcileBody = {
  messageId,
  expectedUpdatedAt: timestamp,
  confirmation: messageId,
  outcome: 'sent',
  evidenceReference: 'synthetic-case:123'
};
for (const [name, changes] of [
  ['missing confirmation', { confirmation: undefined }],
  ['wrong target', { confirmation: requestId }],
  ['missing version', { expectedUpdatedAt: undefined }],
  ['invalid version', { expectedUpdatedAt: 'invalid' }],
  ['unknown outcome', { outcome: 'unknown' }],
  ['private evidence text', { evidenceReference: 'body with spaces' }],
  ['extra field', { secret: 'synthetic' }]
]) {
  test(
    'email reconciliation rejects ' + name + ' before mutation',
    async () => {
      const f = fixture();
      const { response } = await f.run({
        url: '/api/admin/email-queue/reconcile',
        body: JSON.stringify({ ...reconcileBody, ...changes })
      });
      assert.equal(response.status, 400);
      assert.equal(f.values('reconcile').length, 0);
    }
  );
}
test('email reconciliation keeps access, content type, audit port and failure boundaries', async () => {
  const denied = fixture({ accessStatus: 403 });
  assert.equal(
    (
      await denied.run({
        url: '/api/admin/email-queue/reconcile',
        body: JSON.stringify(reconcileBody)
      })
    ).response.status,
    403
  );
  assert.equal(denied.values('reconcile').length, 0);
  const type = fixture();
  assert.equal(
    (
      await type.run({
        url: '/api/admin/email-queue/reconcile',
        contentType: 'text/plain',
        body: JSON.stringify(reconcileBody)
      })
    ).response.status,
    415
  );
  const f = fixture();
  const result = await f.run({
    url: '/api/admin/email-queue/reconcile',
    body: JSON.stringify(reconcileBody)
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.response.payload.updated, true);
  assert.deepEqual(f.values('reconcile'), [{ input: reconcileBody, actor }]);
  assert.equal(f.values('retry').length, 0);
  const fail = fixture({ failureAt: 'reconcile' });
  assert.equal(
    (
      await fail.run({
        url: '/api/admin/email-queue/reconcile',
        body: JSON.stringify(reconcileBody)
      })
    ).response.status,
    502
  );
});
