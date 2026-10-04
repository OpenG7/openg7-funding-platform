import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createAdminPublicationDraftsHttpHandler } from '../dist/apps/funding-api/src/admin-publication-drafts.http.js';
import { createAdminPublicationSlotsHttpHandler } from '../dist/apps/funding-api/src/admin-publication-slots.http.js';
import { createAdminPublicationBatchesHttpHandler } from '../dist/apps/funding-api/src/admin-publication-batches.http.js';
import { adminRoleAllows } from '../dist/apps/funding-api/src/admin-identity.js';
import { allowedPublicationDraftStatuses } from '../dist/apps/funding-api/src/fund-admin.repository.js';
import { readBody } from '../dist/apps/funding-api/src/http-transport.js';

const id = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const actor = 'synthetic-publication-operator';
const future = '2099-02-04T10:00:00-05:00';
const draft = {
  id,
  sponsor_company_name: 'Synthetic sponsor',
  contribution_id: otherId,
  feed_target: 'openg7',
  channel: 'linkedin',
  status: 'approved'
};
const slot = {
  id,
  feedTarget: 'openg7',
  channel: 'linkedin',
  startsAt: new Date(future).toISOString(),
  timezone: 'America/Toronto',
  capacity: 3,
  capacityUsed: 1,
  assignedDraftIds: [otherId]
};
const batch = {
  id,
  channel: 'linkedin',
  capacity: 3,
  capacityAvailable: 1,
  status: 'open',
  scheduledAt: future,
  assignedDraftIds: [otherId]
};
const mutations = [
  [
    'publication-drafts',
    'createAdminPublicationDraft',
    { contributionId: otherId, feedTarget: 'openg7', channel: 'linkedin' },
    'publication_draft.create',
    404
  ],
  [
    'publication-drafts/update',
    'updateAdminPublicationDraft',
    { draftId: id, status: 'approved', scheduledAt: '2000-01-01T00:00:00Z' },
    'publication_draft.approved',
    404
  ],
  [
    'publication-slots',
    'createAdminPublicationSlot',
    {
      feedTarget: 'openg7',
      channel: 'linkedin',
      startsAt: future,
      capacity: 3
    },
    'publication_slot.create',
    404
  ],
  [
    'publication-slots/update',
    'updateAdminPublicationSlot',
    { slotId: id },
    'publication_slot.update',
    409
  ],
  [
    'publication-slots/assign-batch',
    'assignBatchToPublicationSlot',
    { slotId: id, batchId: otherId },
    'publication_slot.assign_batch',
    409
  ],
  [
    'publication-slots/assign-draft',
    'assignDraftToPublicationSlot',
    { slotId: id, draftId: otherId },
    'publication_slot.assign_draft',
    409
  ],
  [
    'publication-slots/publish',
    'publishAdminPublicationSlot',
    { slotId: id },
    'publication_slot.publish',
    409
  ],
  [
    'publication-slots/cancel',
    'cancelAdminPublicationSlot',
    { slotId: id },
    'publication_slot.cancel',
    409
  ],
  [
    'publication-batches',
    'createAdminPublicationBatch',
    { channel: 'linkedin', capacity: 3 },
    'publication_batch.create',
    404
  ],
  [
    'publication-batches/assign',
    'assignDraftToPublicationBatch',
    { batchId: id, draftId: otherId },
    'publication_batch.assign',
    409
  ],
  [
    'publication-batches/unassign',
    'unassignDraftFromPublicationBatch',
    { draftId: id },
    'publication_batch.unassign',
    404
  ],
  [
    'publication-batches/schedule',
    'scheduleAdminPublicationBatch',
    { batchId: id, scheduledAt: future },
    'publication_batch.schedule',
    409
  ],
  [
    'publication-batches/publish',
    'publishAdminPublicationBatch',
    { batchId: id },
    'publication_batch.publish',
    409
  ],
  [
    'publication-batches/cancel',
    'cancelAdminPublicationBatch',
    { batchId: id },
    'publication_batch.cancel',
    409
  ]
];
const reads = [
  ['publication-drafts', 'listAdminPublicationDrafts', 'draftId'],
  ['publication-slots', 'listAdminPublicationSlots', 'slotId'],
  ['publication-batches', 'listAdminPublicationBatches', 'batchId'],
  ['social-publication-jobs', 'listAdminSocialPublicationJobs']
];

const fixture = ({ denied, role = 'operator', overrides = {} } = {}) => {
  const calls = [];
  const writeJson = (_request, response, status, payload) => {
    calls.push({ name: 'json', value: status });
    Object.assign(response, { status, payload });
  };
  const record = (name, fallback) => async (value) => {
    calls.push({ name, value });
    return name in overrides ? overrides[name](value) : fallback;
  };
  const dependencies = {
    publicBaseOrigin: 'https://funding.example.test',
    ensureAdminAccess: (request, response) => {
      calls.push({ name: 'access' });
      const rejected =
        denied ??
        (adminRoleAllows(
          role,
          request.method,
          new URL(request.url, 'https://funding.example.test').pathname
        )
          ? undefined
          : 403);
      if (!rejected) return true;
      writeJson(request, response, rejected, { error: 'Access rejected.' });
      return false;
    },
    getAdminAuditActor: () => actor,
    readBody: async (request, limit) => {
      calls.push({ name: 'body', value: limit });
      return readBody(request, limit);
    },
    writeJson,
    isValidUuid: (value) =>
      typeof value === 'string' &&
      /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value),
    isAllowedSponsorFeedChannel: (value) =>
      ['facebook', 'linkedin'].includes(value),
    isAllowedSponsorFeedTarget: (value) =>
      [undefined, null, '', 'openg7', 'openg20'].includes(value),
    isValidOptionalBoundedText: (value, limit) =>
      value == null ||
      (typeof value === 'string' && value.trim().length <= limit),
    isValidOptionalNonEmptyBoundedText: (value, limit) =>
      value === undefined ||
      (typeof value === 'string' &&
        value.trim().length > 0 &&
        value.trim().length <= limit),
    isValidOptionalIsoDate: (value) =>
      value == null ||
      value === '' ||
      (typeof value === 'string' && Number.isFinite(Date.parse(value))),
    isValidOptionalHttpsUrl: (value) =>
      value == null ||
      value === '' ||
      (typeof value === 'string' && value.startsWith('https://')),
    allowedPublicationDraftStatuses,
    socialPublicationRuntime: () => ({
      mode: 'mock',
      configuredChannels: ['linkedin']
    }),
    reportFailure: (message, error) =>
      calls.push({ name: 'report', value: { message, error } }),
    reportWarning: (message, error) =>
      calls.push({ name: 'warning', value: { message, error } }),
    insertAdminAuditLog: record('audit'),
    getPublicationBatchById: record('getPublicationBatchById', batch),
    queuePublicationBatchFullNotification: record('notification', {
      queued: true,
      sent: false
    })
  };
  for (const [, name] of reads)
    dependencies[name] = record(name, { items: [name] });
  for (const [, name] of mutations)
    dependencies[name] = record(name, { updated: true, draft, slot, batch });
  const handlers = [
    createAdminPublicationDraftsHttpHandler(dependencies),
    createAdminPublicationSlotsHttpHandler(dependencies),
    createAdminPublicationBatchesHttpHandler(dependencies)
  ];
  return {
    calls,
    names: () => calls.map((call) => call.name),
    values: (name) =>
      calls.filter((call) => call.name === name).map((call) => call.value),
    async run(url, { method = 'GET', input, body } = {}) {
      const request = Object.assign(
        Readable.from([Buffer.from(body ?? JSON.stringify(input ?? {}))]),
        { method, url, headers: {} }
      );
      const response = {};
      let handled = false;
      for (const handler of handlers) {
        if (await handler(request, response)) {
          handled = true;
          break;
        }
      }
      return { handled, ...response };
    }
  };
};

test('publication routes reject absent, forbidden and unavailable admin access before reading or acting', async (t) => {
  const routes = [
    ...reads.map(([path]) => [path, 'GET']),
    ...mutations.map(([path]) => [path, 'POST']),
    ['publication-batches/publish-social', 'POST']
  ];
  for (const denied of [401, 403, 503]) {
    for (const [path, method] of routes) {
      await t.test(`${denied} ${method} ${path}`, async () => {
        const f = fixture({ denied });
        const result = await f.run(`/api/admin/${path}`, {
          method,
          body: '{invalid'
        });
        assert.equal(result.handled, true);
        assert.equal(result.status, denied);
        assert.deepEqual(f.names(), ['access', 'json']);
      });
    }
  }
});

test('reader role may read publication state but cannot mutate it', async () => {
  for (const [path] of reads) {
    assert.equal(
      (await fixture({ role: 'reader' }).run(`/api/admin/${path}`)).status,
      200
    );
  }
  for (const [path, , input] of mutations) {
    const f = fixture({ role: 'reader' });
    assert.equal(
      (await f.run(`/admin/${path}`, { method: 'POST', input })).status,
      403
    );
    assert.deepEqual(f.names(), ['access', 'json']);
  }
});

test('publication reads retain aliases, exact filters and safe provider runtime', async () => {
  for (const prefix of ['/admin/', '/api/admin/']) {
    for (const [path, name, filter] of reads) {
      for (const scope of [undefined, '', 'synthetic scope']) {
        const f = fixture();
        const query =
          filter && scope !== undefined
            ? `?${filter}=${encodeURIComponent(scope)}`
            : '';
        const result = await f.run(prefix + path + query);
        assert.equal(result.handled, true);
        assert.equal(result.status, 200);
        assert.deepEqual(result.payload, { items: [name] });
        assert.deepEqual(f.values(name), [
          filter
            ? { id: scope }
            : { mode: 'mock', configuredChannels: ['linkedin'] }
        ]);
        assert.deepEqual(f.names(), ['access', name, 'json']);
      }
    }
  }
});

test('successful publication mutations retain domain inputs and actor audit before success', async (t) => {
  for (const prefix of ['/admin/', '/api/admin/']) {
    for (const [path, name, input, action] of mutations) {
      await t.test(prefix + path, async () => {
        const f = fixture();
        const result = await f.run(prefix + path, { method: 'POST', input });
        assert.equal(result.status, 200);
        const audit = f.values('audit')[0];
        assert.equal(audit.actor, actor);
        assert.equal(audit.action, action);
        assert.equal(audit.entityId, id);
        assert.ok(f.names().indexOf(name) < f.names().indexOf('audit'));
        assert.ok(f.names().indexOf('audit') < f.names().indexOf('json'));
        assert.deepEqual(f.values('body'), [undefined]);
        const expected =
          path === 'publication-slots'
            ? {
                ...input,
                startsAt: new Date(future).toISOString(),
                timezone: 'America/Toronto'
              }
            : path === 'publication-slots/update'
              ? { ...input, startsAt: undefined, timezone: undefined }
              : input;
        assert.deepEqual(f.values(name), [expected]);
      });
    }
  }
});

test('publication mutation failures preserve conflicts, missing records and safe provider errors without success audit', async (t) => {
  for (const [path, name, input, , missingStatus] of mutations) {
    for (const failure of ['ineligible', 'exception']) {
      await t.test(`${path} ${failure}`, async () => {
        const failureValue = new Error('Synthetic private provider diagnostic');
        const f = fixture({
          overrides: {
            [name]: () => {
              if (failure === 'exception') throw failureValue;
              return { updated: false };
            }
          }
        });
        const result = await f.run(`/api/admin/${path}`, {
          method: 'POST',
          input
        });
        assert.equal(
          result.status,
          failure === 'exception' ? 502 : missingStatus
        );
        assert.equal(f.values('audit').length, 0);
        assert.equal(
          JSON.stringify(result.payload).includes(failureValue.message),
          false
        );
        assert.equal(
          f.values('report').length,
          failure === 'exception' ? 1 : 0
        );
      });
    }
  }
});

test('malformed and oversized publication bodies stop before domain mutation', async () => {
  for (const [path] of mutations) {
    for (const body of [
      '{invalid',
      ' '.repeat(256 * 1024 + 1),
      'null',
      '[]',
      'true',
      '42',
      '"synthetic-request"'
    ]) {
      const f = fixture();
      const result = await f.run(`/api/admin/${path}`, {
        method: 'POST',
        body
      });
      assert.equal(result.status, 400);
      assert.deepEqual(f.names(), ['access', 'body', 'json']);
    }
  }
});

test('publication input validation retains text, enum, capacity, future-date and timezone boundaries', async () => {
  const cases = [
    [
      'publication-drafts',
      { contributionId: 'invalid', feedTarget: 'openg7', channel: 'linkedin' }
    ],
    ['publication-drafts', { contributionId: id, channel: 'linkedin' }],
    [
      'publication-drafts',
      { contributionId: id, feedTarget: 'openg20', channel: 'unknown' }
    ],
    ['publication-drafts/update', { draftId: id, title: 'x'.repeat(161) }],
    ['publication-drafts/update', { draftId: id, body: 'x'.repeat(2501) }],
    [
      'publication-drafts/update',
      { draftId: id, disclosureText: 'x'.repeat(301) }
    ],
    ['publication-drafts/update', { draftId: id, status: 'unknown' }],
    [
      'publication-drafts/update',
      { draftId: id, publicUrl: 'http://example.invalid' }
    ],
    ['publication-drafts/update', { draftId: id, scheduledAt: 'invalid' }],
    [
      'publication-drafts/update',
      { draftId: id, reviewNote: 'x'.repeat(1001) }
    ],
    ['publication-slots/update', { slotId: id, startsAt: '2000-01-01' }],
    ['publication-slots/update', { slotId: id, timezone: 'invalid/timezone' }],
    ['publication-slots/update', { slotId: id, capacity: 0 }],
    ['publication-slots/update', { slotId: id, capacity: 51 }],
    ['publication-slots/update', { slotId: id, capacity: 1.5 }],
    ['publication-slots/update', { slotId: id, notes: 'x'.repeat(501) }],
    ['publication-batches', { channel: 'unknown', capacity: 1 }],
    ['publication-batches', { channel: 'linkedin', capacity: 51 }],
    [
      'publication-batches/schedule',
      { batchId: id, scheduledAt: '2000-01-01' }
    ],
    ['publication-slots/assign-batch', { slotId: id, batchId: 'invalid' }],
    ['publication-slots/assign-draft', { slotId: 'invalid', draftId: id }],
    ['publication-batches/assign', { batchId: id, draftId: 'invalid' }]
  ];
  for (const [path, input] of cases) {
    const f = fixture();
    const result = await f.run(`/api/admin/${path}`, { method: 'POST', input });
    assert.equal(result.status, 400, path + ' ' + JSON.stringify(input));
    assert.deepEqual(f.names(), ['access', 'body', 'json']);
  }
  for (const capacity of [1, 50]) {
    const f = fixture();
    assert.equal(
      (
        await f.run('/admin/publication-slots', {
          method: 'POST',
          input: {
            channel: 'facebook',
            startsAt: future,
            timezone: ' America/Toronto ',
            capacity
          }
        })
      ).status,
      200
    );
    assert.equal(
      f.values('createAdminPublicationSlot')[0].timezone,
      'America/Toronto'
    );
  }
});

test('a full open batch queues one logical notification after assignment and audit', async () => {
  const f = fixture({
    overrides: {
      getPublicationBatchById: () => ({ ...batch, capacityAvailable: 0 })
    }
  });
  const result = await f.run('/api/admin/publication-batches/assign', {
    method: 'POST',
    input: { batchId: id, draftId: otherId }
  });
  assert.equal(result.status, 200);
  assert.deepEqual(f.values('notification'), [
    {
      batchId: id,
      idempotencyKey: `publication-batch:${id}:full`,
      channel: 'linkedin',
      capacity: 3
    }
  ]);
  assert.deepEqual(f.names(), [
    'access',
    'body',
    'assignDraftToPublicationBatch',
    'audit',
    'getPublicationBatchById',
    'notification',
    'json'
  ]);
  for (const current of [
    null,
    batch,
    { ...batch, status: 'scheduled', capacityAvailable: 0 }
  ]) {
    const quiet = fixture({
      overrides: { getPublicationBatchById: () => current }
    });
    assert.equal(
      (
        await quiet.run('/admin/publication-batches/assign', {
          method: 'POST',
          input: { batchId: id, draftId: otherId }
        })
      ).status,
      200
    );
    assert.equal(quiet.values('notification').length, 0);
  }
});

test('notification rejection remains a warning while an uncertain notification exception remains a failure', async () => {
  const overrides = {
    getPublicationBatchById: () => ({ ...batch, capacityAvailable: 0 })
  };
  const rejected = fixture({
    overrides: {
      ...overrides,
      notification: () => ({
        queued: false,
        sent: false,
        error: 'synthetic-rejected'
      })
    }
  });
  assert.equal(
    (
      await rejected.run('/admin/publication-batches/assign', {
        method: 'POST',
        input: { batchId: id, draftId: otherId }
      })
    ).status,
    200
  );
  assert.equal(rejected.values('warning').length, 1);
  const uncertain = fixture({
    overrides: {
      ...overrides,
      notification: () => {
        throw new Error('Synthetic uncertainty');
      }
    }
  });
  assert.equal(
    (
      await uncertain.run('/admin/publication-batches/assign', {
        method: 'POST',
        input: { batchId: id, draftId: otherId }
      })
    ).status,
    502
  );
  assert.equal(uncertain.values('audit').length, 1);
  assert.equal(uncertain.values('report').length, 1);
});

test('legacy social publish never bypasses final approval even with a confirmed payload', async () => {
  for (const prefix of ['/admin/', '/api/admin/']) {
    const f = fixture();
    const result = await f.run(prefix + 'publication-batches/publish-social', {
      method: 'POST',
      input: { batchId: id, confirmation: id }
    });
    assert.equal(result.handled, true);
    assert.equal(result.status, 409);
    assert.equal(result.payload.code, 'FINAL_APPROVAL_REQUIRED');
    assert.deepEqual(f.names(), ['access', 'json']);
  }
});

test('publication reads and audit failures never return private diagnostics or false success', async () => {
  for (const [path, name] of reads) {
    const f = fixture({
      overrides: {
        [name]: () => {
          throw new Error('Private diagnostic');
        }
      }
    });
    const result = await f.run(`/admin/${path}`);
    assert.equal(result.status, 502);
    assert.equal(
      JSON.stringify(result.payload).includes('Private diagnostic'),
      false
    );
  }
  const f = fixture({
    overrides: {
      audit: () => {
        throw new Error('Private audit diagnostic');
      }
    }
  });
  assert.equal(
    (
      await f.run('/admin/publication-drafts', {
        method: 'POST',
        input: mutations[0][2]
      })
    ).status,
    502
  );
  assert.deepEqual(f.names(), [
    'access',
    'body',
    'createAdminPublicationDraft',
    'audit',
    'report',
    'json'
  ]);
});

test('publication handlers leave other methods and adjacent paths for the next route', async () => {
  for (const [url, method] of [
    ['/admin/publication-drafts/other', 'GET'],
    ['/admin/publication-slots', 'DELETE'],
    ['/admin/publication-batches/assign/other', 'POST'],
    ['/admin/publication-automation', 'POST'],
    ['/health', 'GET']
  ]) {
    const f = fixture();
    assert.equal((await f.run(url, { method })).handled, false);
    assert.deepEqual(f.calls, []);
  }
});
