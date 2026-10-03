import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createAdminAccountingHttpHandler } from '../dist/apps/funding-api/src/admin-accounting.http.js';
import { adminRoleAllows } from '../dist/apps/funding-api/src/admin-identity.js';
import {
  AdminExpenseValidationError,
  allowedAdminExpenseStatuses,
  createAdminExpense
} from '../dist/apps/funding-api/src/fund-admin.repository.js';
import { readBody } from '../dist/apps/funding-api/src/http-transport.js';

const actor = 'synthetic-owner';
const version = '2026-09-24 12:00:00.123456+00';
const createInput = {
  projectName: 'Synthetic project',
  publicDescription: 'Synthetic public description',
  expectedOutcome: 'Synthetic outcome',
  progressStatus: 'planned',
  amountAllocated: 12.34,
  currency: 'CAD',
  status: 'draft'
};
const updateInput = { expenseId: '42', expectedVersion: version };

const fixture = ({
  denied,
  role = 'owner',
  listError,
  summaryError,
  createError,
  updateError,
  mutationResult,
  publicDate = '2026-09-24T12:00:00.000Z',
  expenseDate = '2026-09-25T12:00:00.000Z',
  create = undefined,
  summary = undefined,
  list = undefined
} = {}) => {
  const calls = [];
  const expense = {
    id: '42',
    project_name: 'Synthetic project',
    public_description: 'Synthetic public description',
    expected_outcome: 'Synthetic outcome',
    progress_status: 'planned',
    proof_url: null,
    proof_source: null,
    proof_published_at: null,
    amount_allocated: 12.34,
    currency: 'CAD',
    status: 'draft',
    published_at: null,
    created_at: expenseDate,
    updated_at: expenseDate
  };
  const listed = {
    data_source: 'database',
    summary: {
      total_count: 1,
      published_count: 0,
      draft_count: 1,
      private_count: 0,
      archived_count: 0,
      total_allocated: 12.34,
      published_allocated: 0,
      currency: 'CAD'
    },
    expenses: [expense],
    last_updated_at: expenseDate
  };
  const publicSummary = {
    data_source: 'database',
    total_received: 100,
    total_fees: 3,
    total_net: 97,
    total_refunded: 0,
    total_payouts: 20,
    current_available_estimate: 97,
    contributions_count: 1,
    currency: 'CAD',
    monthly_summary: [],
    latest_public_allocations: [],
    public_builders: [],
    last_updated_at: publicDate
  };
  const mutated = mutationResult ?? { updated: true, expense };
  const writeJson = (_request, response, status, payload) => {
    calls.push({ name: 'json', value: status });
    Object.assign(response, { status, payload });
  };
  const handler = createAdminAccountingHttpHandler({
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
    getAdminAuditActor: () => {
      calls.push({ name: 'actor' });
      return actor;
    },
    readBody: async (request, limit) => {
      calls.push({ name: 'body', value: limit });
      return readBody(request, limit);
    },
    writeJson,
    allowedAdminExpenseStatuses,
    isNonEmptySponsorText: (value, maxLength) =>
      typeof value === 'string' &&
      value.trim().length > 0 &&
      value.trim().length <= maxLength,
    isValidOptionalBoundedText: (value, maxLength) =>
      value == null ||
      (typeof value === 'string' && value.trim().length <= maxLength),
    isValidOptionalNonEmptyBoundedText: (value, maxLength) =>
      value === undefined ||
      (typeof value === 'string' &&
        value.trim().length > 0 &&
        value.trim().length <= maxLength),
    isValidOptionalIsoDate: (value) =>
      value == null ||
      value === '' ||
      (typeof value === 'string' && Number.isFinite(Date.parse(value))),
    isValidAdminExpectedVersion: (value) =>
      typeof value === 'string' &&
      value.trim().length > 0 &&
      value.trim().length <= 128,
    listAdminExpenses: async (id) => {
      calls.push({ name: 'list', value: id });
      if (listError) throw listError;
      return list ? list(id) : listed;
    },
    createAdminExpense: async (input, audit) => {
      calls.push({ name: 'create', value: { input, audit } });
      if (createError) throw createError;
      return create ? create(input, audit) : mutated;
    },
    updateAdminExpense: async (input, audit) => {
      calls.push({ name: 'update', value: { input, audit } });
      if (updateError) throw updateError;
      return mutated;
    },
    getPublicTransparencySummary: async () => {
      calls.push({ name: 'summary' });
      if (summaryError) throw summaryError;
      return summary ? summary() : publicSummary;
    },
    AdminExpenseValidationError,
    reportFailure: (...args) => calls.push({ name: 'report', value: args })
  });
  return {
    listed,
    publicSummary,
    mutated,
    calls,
    names: () => calls.map((call) => call.name),
    values: (name) =>
      calls.filter((call) => call.name === name).map((c) => c.value),
    async run(
      url,
      { method = 'GET', body = undefined, contentType = undefined } = {}
    ) {
      const request = Object.assign(
        Readable.from([Buffer.from(body ?? JSON.stringify(createInput))]),
        {
          method,
          url,
          headers: contentType ? { 'content-type': contentType } : {}
        }
      );
      const response = {
        headers: {},
        setHeader(name, value) {
          this.headers[name] = value;
        }
      };
      const handled = await handler(request, response);
      return { handled, ...response };
    }
  };
};

test('accounting reads preserve route aliases, exact bigint scope and no-store', async (t) => {
  for (const prefix of ['/admin/', '/api/admin/']) {
    for (const id of [undefined, '1', '9223372036854775807']) {
      await t.test(`${prefix}expenses ${id}`, async () => {
        const f = fixture();
        const result = await f.run(
          `${prefix}expenses${id ? `?expenseId=${id}` : ''}`
        );
        assert.equal(result.handled, true);
        assert.equal(result.status, 200);
        assert.equal(result.headers['Cache-Control'], 'no-store');
        assert.deepEqual(result.payload, f.listed);
        assert.deepEqual(f.values('list'), [id]);
        assert.deepEqual(f.names(), ['access', 'list', 'json']);
      });
    }
  }
});

test('invalid expense read scopes stop before persistence', async (t) => {
  for (const id of [
    '',
    '0',
    '-1',
    '01',
    '1.1',
    '1e2',
    'abc',
    '9223372036854775808',
    '10000000000000000000'
  ]) {
    await t.test(id || 'empty', async () => {
      const f = fixture();
      const result = await f.run(`/admin/expenses?expenseId=${id}`);
      assert.equal(result.status, 400);
      assert.deepEqual(result.payload, { error: 'Invalid expenseId.' });
      assert.equal(result.headers['Cache-Control'], 'no-store');
      assert.deepEqual(f.names(), ['access', 'json']);
    });
  }
});

test('access rejection precedes private reads, body parsing and mutation', async (t) => {
  for (const denied of [401, 403, 503]) {
    for (const prefix of ['/admin/', '/api/admin/']) {
      for (const [path, method] of [
        ['expenses', 'GET'],
        ['expenses', 'POST'],
        ['expenses/update', 'POST'],
        ['transparency', 'GET']
      ]) {
        await t.test(`${denied} ${method} ${prefix}${path}`, async () => {
          const f = fixture({ denied });
          const result = await f.run(`${prefix}${path}`, {
            method,
            body: '{invalid'
          });
          assert.equal(result.handled, true);
          assert.equal(result.status, denied);
          assert.deepEqual(result.headers, {});
          assert.deepEqual(f.names(), ['access', 'json']);
        });
      }
    }
  }
});

test('expense mutations keep the owner-only API policy while reads permit all admin roles', async (t) => {
  for (const role of ['reader', 'operator']) {
    for (const prefix of ['/admin/', '/api/admin/']) {
      for (const path of ['expenses', 'expenses/update']) {
        await t.test(`${role} ${prefix}${path}`, async () => {
          const f = fixture({ role });
          const result = await f.run(`${prefix}${path}`, {
            method: 'POST',
            body: '{invalid'
          });
          assert.equal(result.status, 403);
          assert.deepEqual(f.names(), ['access', 'json']);
        });
      }
      for (const path of ['expenses', 'transparency']) {
        const result = await fixture({ role }).run(`${prefix}${path}`);
        assert.equal(result.status, 200);
      }
    }
  }
});

test('unowned routes and methods fall through without access or body reads', async (t) => {
  for (const [path, method] of [
    ['/admin/expenses', 'PUT'],
    ['/api/admin/expenses', 'DELETE'],
    ['/admin/expenses/update', 'GET'],
    ['/admin/transparency', 'POST'],
    ['/admin/expenses/extra', 'GET'],
    ['/admin/expenses/', 'GET'],
    ['/public/fund-transparency', 'GET'],
    ['/admin/publication-drafts', 'GET'],
    [undefined, 'GET']
  ]) {
    await t.test(`${method} ${path}`, async () => {
      const f = fixture();
      const result = await f.run(path, { method });
      assert.equal(result.handled, false);
      assert.equal(result.status, undefined);
      assert.deepEqual(result.headers, {});
      assert.deepEqual(f.names(), []);
    });
  }
});

test('expense mutations forward exact input and authenticated audit context through both aliases', async (t) => {
  for (const prefix of ['/admin/', '/api/admin/']) {
    for (const [path, input, operation, action] of [
      ['expenses', createInput, 'create', 'achievement.created'],
      ['expenses/update', updateInput, 'update', 'achievement.updated']
    ]) {
      await t.test(`${prefix}${path}`, async () => {
        const f = fixture();
        const result = await f.run(`${prefix}${path}`, {
          method: 'POST',
          body: JSON.stringify(input)
        });
        assert.equal(result.handled, true);
        assert.equal(result.status, 200);
        assert.deepEqual(result.payload, f.mutated);
        assert.deepEqual(f.values(operation), [
          { input, audit: { actor, action } }
        ]);
        assert.deepEqual(f.names(), [
          'access',
          'body',
          'actor',
          operation,
          'json'
        ]);
        // These existing routes retain the transport's default 256 KiB limit.
        assert.deepEqual(f.values('body'), [undefined]);
      });
    }
  }
});

test('malformed, non-object and oversized mutation bodies never reach persistence', async (t) => {
  for (const path of ['expenses', 'expenses/update']) {
    for (const body of [
      '{invalid',
      'null',
      '[]',
      '"text"',
      '42',
      ' '.repeat(256 * 1024 + 1)
    ]) {
      await t.test(
        `${path} ${body.length > 100 ? 'oversized' : body}`,
        async () => {
          const f = fixture();
          const result = await f.run(`/admin/${path}`, {
            method: 'POST',
            body
          });
          assert.equal(result.status, 400);
          assert.deepEqual(result.payload, {
            error: path.endsWith('update')
              ? 'Invalid expense update request body.'
              : 'Invalid expense request body.'
          });
          assert.deepEqual(f.names(), ['access', 'body', 'json']);
        }
      );
    }
  }
});

test('expense field validation rejects invalid money, proof, text, dates and statuses before audit', async (t) => {
  const cases = [
    ['projectName', ' ', 'Expense project name is invalid.'],
    ['projectName', 'x'.repeat(161), 'Expense project name is invalid.'],
    [
      'publicDescription',
      'x'.repeat(1001),
      'Expense public description is invalid.'
    ],
    ['expectedOutcome', null, 'Expense expected outcome is invalid.'],
    ['progressStatus', 'finished', 'Expense progress status is invalid.'],
    [
      'proofUrl',
      'http://example.test/proof',
      'Expense proof URL is invalid.',
      'invalid_proof'
    ],
    [
      'proofUrl',
      'https://user:password@example.test/proof',
      'Expense proof URL is invalid.',
      'invalid_proof'
    ],
    ['proofSource', 'x'.repeat(501), 'Expense proof source is invalid.'],
    ['proofPublishedAt', 'invalid', 'Expense proof date is invalid.'],
    [
      'amountAllocated',
      1.001,
      'Allocation amount must contain exact positive minor units.',
      'invalid_amount'
    ],
    [
      'amountAllocated',
      0,
      'Allocation amount must contain exact positive minor units.',
      'invalid_amount'
    ],
    [
      'amountAllocated',
      '12.34',
      'Allocation amount must contain exact positive minor units.',
      'invalid_amount'
    ],
    [
      'amountAllocated',
      Number.MAX_SAFE_INTEGER,
      'Allocation amount must contain exact positive minor units.',
      'invalid_amount'
    ],
    ['currency', 'USD', 'Expense currency is not supported.'],
    ['status', 'removed', 'Expense status is invalid.'],
    ['publishedAt', 123, 'Expense published date is invalid.']
  ];
  for (const [path, base] of [
    ['expenses', createInput],
    ['expenses/update', updateInput]
  ]) {
    for (const [field, value, error, code] of cases) {
      await t.test(
        `${path} ${field} ${String(value).slice(0, 30)}`,
        async () => {
          const f = fixture();
          const result = await f.run(`/admin/${path}`, {
            method: 'POST',
            body: JSON.stringify({ ...base, [field]: value })
          });
          assert.equal(result.status, 400);
          assert.deepEqual(result.payload, {
            ...(code ? { code } : {}),
            error
          });
          assert.deepEqual(f.names(), ['access', 'body', 'json']);
        }
      );
    }
  }
});

test('update identity and version checks keep their established validation order', async (t) => {
  for (const [patch, error] of [
    [{ expenseId: '0', expectedVersion: '' }, 'Invalid expense id.'],
    [{ expenseId: 42 }, 'Invalid expense id.'],
    [{ expectedVersion: '' }, 'Invalid expense version.'],
    [{ expectedVersion: 'x'.repeat(129) }, 'Invalid expense version.']
  ]) {
    await t.test(JSON.stringify(patch), async () => {
      const f = fixture();
      const result = await f.run('/admin/expenses/update', {
        method: 'POST',
        body: JSON.stringify({ ...updateInput, ...patch })
      });
      assert.equal(result.status, 400);
      assert.deepEqual(result.payload, { error });
      assert.deepEqual(f.names(), ['access', 'body', 'json']);
    });
  }
  const f = fixture();
  const input = { ...updateInput, expenseId: '9223372036854775808' };
  const result = await f.run('/admin/expenses/update', {
    method: 'POST',
    body: JSON.stringify(input)
  });
  assert.equal(result.status, 200);
  assert.deepEqual(f.values('update')[0].input, input);
});

test('update audit action prioritizes visibility, then progress, then proof changes', async (t) => {
  for (const [patch, action] of [
    [
      {
        status: 'published',
        progressStatus: 'delivered',
        proofSource: 'source'
      },
      'achievement.published'
    ],
    [{ status: 'active' }, 'achievement.published'],
    [{ status: 'private', progressStatus: 'delivered' }, 'achievement.hidden'],
    [{ status: 'archived', proofUrl: null }, 'achievement.archived'],
    [
      { progressStatus: 'delivered', proofSource: 'source' },
      'achievement.progress_changed'
    ],
    [{ proofUrl: null }, 'achievement.proof_changed'],
    [{ proofSource: null }, 'achievement.proof_changed'],
    [{ proofPublishedAt: null }, 'achievement.proof_changed'],
    [{ projectName: 'Changed' }, 'achievement.updated']
  ]) {
    await t.test(action + JSON.stringify(patch), async () => {
      const f = fixture();
      const input = { ...updateInput, ...patch };
      const result = await f.run('/admin/expenses/update', {
        method: 'POST',
        body: JSON.stringify(input)
      });
      assert.equal(result.status, 200);
      assert.deepEqual(f.values('update'), [
        { input, audit: { actor, action } }
      ]);
    });
  }
});

test('visibility confirmation remains a repository decision and travels unchanged', async (t) => {
  for (const confirmation of [
    undefined,
    'incorrect',
    'CREATE_PUBLIC_ALLOCATION'
  ]) {
    await t.test(String(confirmation), async () => {
      const f = fixture({
        create: (input, audit) => createAdminExpense(null, input, audit)
      });
      const input = {
        ...createInput,
        status: 'published',
        ...(confirmation === undefined ? {} : { confirmation })
      };
      const result = await f.run('/admin/expenses', {
        method: 'POST',
        body: JSON.stringify(input)
      });
      assert.deepEqual(f.values('create'), [
        { input, audit: { actor, action: 'achievement.created' } }
      ]);
      // Null persistence is intentional: no database, mutation or external effect.
      assert.equal(
        result.status,
        confirmation === 'CREATE_PUBLIC_ALLOCATION' ? 404 : 400
      );
      if (result.status === 400)
        assert.equal(result.payload.code, 'confirmation_required');
      assert.deepEqual(f.values('report'), []);
    });
  }
  const error = new AdminExpenseValidationError(
    'confirmation_required',
    'Confirm this allocation.'
  );
  const f = fixture({ updateError: error });
  const input = { ...updateInput, status: 'private', confirmation: '42' };
  const result = await f.run('/admin/expenses/update', {
    method: 'POST',
    body: JSON.stringify(input)
  });
  assert.deepEqual(f.values('update')[0].input, input);
  assert.equal(result.status, 400);
  assert.deepEqual(result.payload, { code: error.code, error: error.message });
  assert.deepEqual(f.values('report'), []);
});

test('missing create result and stale update retain distinct failure contracts', async (t) => {
  for (const [path, status, payload] of [
    [
      'expenses',
      404,
      { error: 'Expense could not be created or fund_allocations is missing.' }
    ],
    [
      'expenses/update',
      409,
      {
        code: 'version_conflict',
        error:
          'Allocation changed or is no longer available. Refresh before trying again.'
      }
    ]
  ]) {
    await t.test(path, async () => {
      const f = fixture({ mutationResult: { updated: false, expense: null } });
      const result = await f.run(`/admin/${path}`, {
        method: 'POST',
        body: JSON.stringify(
          path.endsWith('update') ? updateInput : createInput
        )
      });
      assert.equal(result.status, status);
      assert.deepEqual(result.payload, payload);
      assert.deepEqual(f.values('report'), []);
    });
  }
});

test('accounting dependency failures return safe errors and preserve reporting', async (t) => {
  const error = new Error('Synthetic persistence failure.');
  for (const [path, method, options, payload, message] of [
    [
      'expenses',
      'GET',
      { listError: error },
      'Admin expenses could not be loaded.',
      'Failed to load admin expenses.'
    ],
    [
      'expenses',
      'POST',
      { createError: error },
      'Admin expense could not be created.',
      'Failed to create admin expense.'
    ],
    [
      'expenses/update',
      'POST',
      { updateError: error },
      'Admin expense could not be updated.',
      'Failed to update admin expense.'
    ],
    [
      'transparency',
      'GET',
      { summaryError: error },
      'Admin transparency could not be loaded.',
      'Failed to load admin transparency.'
    ],
    [
      'transparency',
      'GET',
      { listError: error },
      'Admin transparency could not be loaded.',
      'Failed to load admin transparency.'
    ]
  ]) {
    await t.test(`${method} ${path} ${Object.keys(options)[0]}`, async () => {
      const f = fixture(options);
      const result = await f.run(`/admin/${path}`, {
        method,
        body: JSON.stringify(
          path.endsWith('update') ? updateInput : createInput
        )
      });
      assert.equal(result.handled, true);
      assert.equal(result.status, 502);
      assert.deepEqual(result.payload, { error: payload });
      assert.deepEqual(f.values('report'), [[message, error]]);
    });
  }
});

test('admin transparency combines public and private projections without recomputing money', async (t) => {
  for (const prefix of ['/admin/', '/api/admin/']) {
    for (const [publicDate, expenseDate, expected] of [
      ['2026-09-26T00:00:00Z', '2026-09-25T00:00:00Z', '2026-09-26T00:00:00Z'],
      ['2026-09-24T00:00:00Z', '2026-09-25T00:00:00Z', '2026-09-25T00:00:00Z'],
      [
        '2026-09-25T00:00:00.000Z',
        '2026-09-25T00:00:00Z',
        '2026-09-25T00:00:00Z'
      ]
    ]) {
      await t.test(`${prefix} ${publicDate} ${expenseDate}`, async () => {
        const f = fixture({ publicDate, expenseDate });
        const result = await f.run(`${prefix}transparency`);
        assert.equal(result.handled, true);
        assert.equal(result.status, 200);
        assert.deepEqual(result.payload, {
          data_source: 'database',
          public_summary: f.publicSummary,
          expenses_summary: f.listed.summary,
          expenses: f.listed.expenses,
          last_updated_at: expected
        });
        assert.deepEqual(f.values('list'), [undefined]);
        assert.deepEqual(f.names(), ['access', 'summary', 'list', 'json']);
        assert.deepEqual(result.headers, {});
      });
    }
  }
});

test('transparency starts both projections before waiting for either result', async () => {
  let resolvePublic;
  let resolveExpenses;
  const f = fixture({
    summary: () =>
      new Promise((resolve) => {
        resolvePublic = resolve;
      }),
    list: () =>
      new Promise((resolve) => {
        resolveExpenses = resolve;
      })
  });
  const pending = f.run('/admin/transparency');
  assert.deepEqual(f.names(), ['access', 'summary', 'list']);
  resolveExpenses(f.listed);
  resolvePublic(f.publicSummary);
  const result = await pending;
  assert.equal(result.status, 200);
});
