import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createAdminDocumentsHttpHandler } from '../dist/apps/funding-api/src/admin-documents.http.js';
import { readBody } from '../dist/apps/funding-api/src/http-transport.js';

const contributionId = '00000000-0000-4000-8000-00000000000a';
const documentId = '00000000-0000-4000-8000-00000000000b';
const requestId = '00000000-0000-4000-8000-00000000000c';
const actor = 'synthetic-owner';
const recipient = 'synthetic-recipient@example.test';
const invoice = { id: documentId, invoiceNumber: 'SYNTHETIC-INV-001' };
const creditNote = { id: documentId, creditNoteNumber: 'SYNTHETIC-CN-001' };
const pdf = Buffer.from('%PDF-synthetic');
const backfill = {
  data_source: 'database',
  eligible_count: 4,
  missing_count: 3,
  processed_count: 2,
  created_count: 1,
  skipped_count: 1,
  remaining_count: 1,
  failed_count: 0,
  invoiceIds: [documentId]
};
const queued = {
  queued: true,
  attempted: false,
  sent: false,
  messageId: requestId,
  error: null
};
const documentKinds = [
  {
    kind: 'invoice',
    route: 'sponsorship-invoices',
    idKey: 'invoiceId',
    snapshot: invoice,
    label: 'invoice'
  },
  {
    kind: 'creditNote',
    route: 'sponsorship-credit-notes',
    idKey: 'creditNoteId',
    snapshot: creditNote,
    label: 'credit note'
  }
];
const routes = [
  ['sponsorship-invoices', 'GET'],
  ['sponsorship-invoices/backfill', 'POST'],
  ...documentKinds.flatMap(({ route }) => [
    [`${route}/pdf`, 'GET'],
    [`${route}/resend`, 'POST']
  ])
];

class DocumentResendConflict extends Error {
  code = 'REQUEST_CONFLICT';
}

const fixture = ({
  denied,
  database = true,
  smtp = true,
  errors = {},
  missing = false,
  resendResult = queued
} = {}) => {
  const calls = [];
  const listed = { invoices: [], data_source: 'database' };
  const refreshed = { id: documentId, email_status: 'queued' };
  const record = (name, value) => {
    calls.push({ name, value });
    if (errors[name]) throw errors[name];
  };
  const writeJson = (_request, response, status, payload) => {
    record('json', status);
    Object.assign(response, { status, payload });
  };
  const snapshotPort = (kind, snapshot) => async (id) => {
    record(`${kind}.snapshot`, id);
    return missing ? null : snapshot;
  };
  const projectionPort = (kind) => async (id) => {
    record(`${kind}.projection`, id);
    return refreshed;
  };
  const renderPort = (kind) => async (snapshot) => {
    record(`${kind}.render`, snapshot);
    return pdf;
  };
  const filenamePort = (kind) => (snapshot) => {
    record(`${kind}.filename`, snapshot);
    return `synthetic-${kind}.pdf`;
  };
  const handler = createAdminDocumentsHttpHandler({
    publicBaseOrigin: 'https://funding.example.test',
    databaseAvailable: () => {
      record('database');
      return database;
    },
    ensureAdminAccess: (request, response) => {
      record('access');
      if (!denied) return true;
      writeJson(request, response, denied, { error: 'Access rejected.' });
      return false;
    },
    getAdminAuditActor: () => {
      record('actor');
      return actor;
    },
    readBody: async (request, limit) => {
      record('body', limit);
      return readBody(request, limit);
    },
    writeJson,
    writePdf: (_request, response, status, payload, filename) => {
      record('pdf', { status, filename });
      Object.assign(response, { status, payload, filename });
    },
    getTransactionalEmailConfigStatus: () => {
      record('smtp');
      return { configured: smtp };
    },
    isValidUuid: (value) =>
      typeof value === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value
      ),
    isValidSponsorEmail: (value) =>
      typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    listAdminSponsorshipInvoices: async (id) => {
      record('list', id);
      return listed;
    },
    backfillMissingSponsorshipInvoices: async (input) => {
      record('backfill', input);
      return backfill;
    },
    insertAdminAuditLog: async (input) => record('audit', input),
    getSponsorshipInvoiceById: snapshotPort('invoice', invoice),
    getAdminSponsorshipInvoiceById: projectionPort('invoice'),
    getSponsorshipCreditNoteById: snapshotPort('creditNote', creditNote),
    getAdminSponsorshipCreditNoteById: projectionPort('creditNote'),
    renderSponsorshipInvoicePdf: renderPort('invoice'),
    renderSponsorshipCreditNotePdf: renderPort('creditNote'),
    sponsorshipInvoicePdfFilename: filenamePort('invoice'),
    sponsorshipCreditNotePdfFilename: filenamePort('creditNote'),
    queueAdminDocumentResend: async (input, authenticatedActor) => {
      record('resend', { input, actor: authenticatedActor });
      return resendResult;
    },
    DocumentResendConflict,
    reportFailure: (...args) => record('report', args)
  });
  return {
    calls,
    listed,
    refreshed,
    names: () => calls.map(({ name }) => name),
    values: (name) =>
      calls.filter((call) => call.name === name).map(({ value }) => value),
    async run(url, { method = 'GET', body = '' } = {}) {
      const request = Object.assign(Readable.from([Buffer.from(body)]), {
        method,
        url,
        headers: {}
      });
      const response = {
        headers: {},
        setHeader(name, value) {
          this.headers[name] = value;
        }
      };
      return { handled: await handler(request, response), ...response };
    }
  };
};

const resendInput = ({ idKey }, overrides = {}) => ({
  [idKey]: documentId,
  requestId,
  confirmation: documentId,
  to: recipient,
  ...overrides
});

test('document aliases deny absent, expired and forbidden access before any parsing or data read', async (t) => {
  for (const denied of [401, 403, 503]) {
    for (const prefix of ['/admin/', '/api/admin/']) {
      for (const [route, method] of routes) {
        await t.test(`${denied} ${prefix}${route}`, async () => {
          const f = fixture({ denied });
          const result = await f.run(`${prefix}${route}?invoiceId=invalid`, {
            method,
            body: '{invalid'
          });
          assert.equal(result.handled, true);
          assert.equal(result.status, denied);
          assert.deepEqual(f.names(), ['access', 'json']);
        });
      }
    }
  }
});

test('unowned paths and methods fall through without authorization or side effects', async (t) => {
  for (const [url, method] of [
    ['/admin/sponsorships', 'GET'],
    ['/admin/sponsorship-invoices/other', 'GET'],
    ['/admin/sponsorship-invoices-extra', 'GET'],
    ['/admin/sponsorship-invoices', 'POST'],
    ['/admin/sponsorship-invoices/backfill', 'GET'],
    ['/admin/sponsorship-invoices/pdf', 'POST'],
    ['/admin/sponsorship-credit-notes/resend', 'GET']
  ]) {
    await t.test(`${method} ${url}`, async () => {
      const f = fixture();
      assert.equal((await f.run(url, { method })).handled, false);
      assert.deepEqual(f.names(), []);
    });
  }
});

test('invoice listing preserves optional and raw contribution selection for the repository', async (t) => {
  for (const prefix of ['/admin/', '/api/admin/']) {
    for (const id of [undefined, '', contributionId, 'legacy-selection']) {
      await t.test(`${prefix}${id}`, async () => {
        const f = fixture({ database: false });
        const query = id === undefined ? '' : `?contributionId=${id}`;
        const result = await f.run(`${prefix}sponsorship-invoices${query}`);
        assert.equal(result.status, 200);
        assert.deepEqual(result.payload, f.listed);
        assert.deepEqual(f.values('list'), [id]);
        assert.deepEqual(f.names(), ['access', 'list', 'json']);
      });
    }
  }
  const f = fixture({ errors: { list: new Error('synthetic failure') } });
  const result = await f.run('/admin/sponsorship-invoices');
  assert.equal(result.status, 502);
  assert.deepEqual(result.payload, {
    error:
      'Admin sponsorship invoices could not be loaded. Apply migrations 010, 011 and 012.'
  });
});

test('PDF, resend and backfill require storage before body parsing or SMTP checks', async (t) => {
  for (const [route, method] of routes.slice(1)) {
    await t.test(route, async () => {
      const f = fixture({ database: false });
      const result = await f.run(`/admin/${route}`, {
        method,
        body: '{invalid'
      });
      assert.equal(result.status, 503);
      assert.deepEqual(f.names(), ['access', 'database', 'json']);
    });
  }
});

test('backfill accepts only confirmed global or UUID scopes and audits before success', async (t) => {
  for (const prefix of ['/admin/', '/api/admin/']) {
    for (const input of [
      { confirmation: 'BACKFILL_INVOICES' },
      { confirmation: 'BACKFILL_INVOICES', limit: 1 },
      { contributionId, confirmation: contributionId, limit: 1000 }
    ]) {
      await t.test(`${prefix}${JSON.stringify(input)}`, async () => {
        const f = fixture();
        const result = await f.run(`${prefix}sponsorship-invoices/backfill`, {
          method: 'POST',
          body: JSON.stringify(input)
        });
        assert.equal(result.status, 200);
        assert.deepEqual(result.payload, backfill);
        assert.deepEqual(f.values('body'), [16 * 1024]);
        assert.deepEqual(f.values('backfill'), [
          {
            contributionId: input.contributionId,
            limit: input.limit,
            confirmation: input.confirmation
          }
        ]);
        assert.deepEqual(f.names(), [
          'access',
          'database',
          'body',
          'backfill',
          'actor',
          'audit',
          'json'
        ]);
        const audit = f.values('audit')[0];
        assert.equal(audit.actor, actor);
        assert.equal(audit.action, 'sponsorship_invoice.backfill');
        assert.deepEqual(audit.metadata, {
          contributionId: input.contributionId ?? null,
          eligibleCount: 4,
          missingCount: 3,
          processedCount: 2,
          createdCount: 1,
          skippedCount: 1,
          remainingCount: 1,
          failedCount: 0,
          invoiceIds: [documentId]
        });
      });
    }
  }
});

test('backfill rejects malformed scopes, missing confirmation, excessive bodies and invalid limits before mutation', async (t) => {
  for (const [body, code] of [
    ['{invalid', undefined],
    ['1', undefined],
    [JSON.stringify({ contributionId: 'invalid' }), undefined],
    [JSON.stringify({ contributionId: null }), undefined],
    ['', 'confirmation_required'],
    ['null', 'confirmation_required'],
    [JSON.stringify({ confirmation: 'wrong' }), 'confirmation_required'],
    [
      JSON.stringify({ contributionId, confirmation: 'BACKFILL_INVOICES' }),
      'confirmation_required'
    ],
    ...[0, -1, 1.5, 1001].map((limit) => [
      JSON.stringify({ confirmation: 'BACKFILL_INVOICES', limit }),
      undefined
    ]),
    [' '.repeat(16 * 1024 + 1), undefined]
  ]) {
    await t.test(body.slice(0, 90) || 'empty', async () => {
      const f = fixture();
      const result = await f.run('/admin/sponsorship-invoices/backfill', {
        method: 'POST',
        body
      });
      assert.equal(result.status, 400);
      assert.equal(result.payload.code, code);
      assert.deepEqual(f.names(), ['access', 'database', 'body', 'json']);
    });
  }
});

test('backfill service and audit failures report 502 without a success response', async (t) => {
  for (const stage of ['backfill', 'audit']) {
    await t.test(stage, async () => {
      const f = fixture({
        errors: { [stage]: new Error('synthetic failure') }
      });
      const result = await f.run('/admin/sponsorship-invoices/backfill', {
        method: 'POST',
        body: JSON.stringify({ confirmation: 'BACKFILL_INVOICES' })
      });
      assert.equal(result.status, 502);
      assert.equal(f.values('backfill').length, 1);
      assert.equal(f.values('audit').length, stage === 'audit' ? 1 : 0);
      assert.deepEqual(f.values('json'), [502]);
      assert.deepEqual(result.payload, {
        error:
          'Sponsorship invoices could not be backfilled. Check migrations 011/012 and contribution data.'
      });
    });
  }
});

test('document PDFs select and render the persisted snapshot with the correct filename', async (t) => {
  for (const document of documentKinds) {
    for (const prefix of ['/admin/', '/api/admin/']) {
      await t.test(`${prefix}${document.route}`, async () => {
        const f = fixture();
        const result = await f.run(
          `${prefix}${document.route}/pdf?${document.idKey}=%20${documentId}%20`
        );
        assert.equal(result.handled, true);
        assert.equal(result.status, 200);
        assert.equal(result.payload, pdf);
        assert.equal(result.filename, `synthetic-${document.kind}.pdf`);
        assert.deepEqual(f.values(`${document.kind}.snapshot`), [documentId]);
        assert.deepEqual(f.values(`${document.kind}.render`), [
          document.snapshot
        ]);
        assert.deepEqual(f.names(), [
          'access',
          'database',
          `${document.kind}.snapshot`,
          `${document.kind}.render`,
          `${document.kind}.filename`,
          'pdf'
        ]);
      });
    }
  }
});

test('document PDF invalid IDs, missing snapshots and render failures never return a PDF', async (t) => {
  for (const document of documentKinds) {
    for (const [name, options, query, status] of [
      ['missing id', {}, '', 400],
      ['invalid id', {}, `?${document.idKey}=invalid`, 400],
      [
        'missing snapshot',
        { missing: true },
        `?${document.idKey}=${documentId}`,
        404
      ],
      [
        'snapshot failure',
        {
          errors: {
            [`${document.kind}.snapshot`]: new Error('private failure')
          }
        },
        `?${document.idKey}=${documentId}`,
        502
      ],
      [
        'render failure',
        {
          errors: { [`${document.kind}.render`]: new Error('private failure') }
        },
        `?${document.idKey}=${documentId}`,
        502
      ]
    ]) {
      await t.test(`${document.kind} ${name}`, async () => {
        const f = fixture(options);
        const result = await f.run(`/admin/${document.route}/pdf${query}`);
        assert.equal(result.status, status);
        assert.equal(f.names().includes('pdf'), false);
        assert.equal(
          JSON.stringify(result.payload).includes('private failure'),
          false
        );
        if (status === 400)
          assert.deepEqual(f.names(), ['access', 'database', 'json']);
      });
    }
  }
});

test('confirmed resends preserve the request UUID, actor, snapshot and queue result', async (t) => {
  for (const document of documentKinds) {
    for (const prefix of ['/admin/', '/api/admin/']) {
      await t.test(`${prefix}${document.route}`, async () => {
        const f = fixture();
        const input = resendInput(document, { to: ` ${recipient} ` });
        const run = () =>
          f.run(`${prefix}${document.route}/resend`, {
            method: 'POST',
            body: JSON.stringify(input)
          });
        const result = await run();
        assert.equal(result.status, 200);
        assert.deepEqual(result.payload, {
          ...queued,
          [document.kind]: f.refreshed
        });
        assert.deepEqual(f.values('body'), [16 * 1024]);
        assert.deepEqual(f.values('resend'), [
          {
            input: {
              to: recipient,
              [document.kind]: document.snapshot,
              requestId
            },
            actor
          }
        ]);
        assert.deepEqual(f.names(), [
          'access',
          'database',
          'smtp',
          'body',
          `${document.kind}.snapshot`,
          'actor',
          'resend',
          `${document.kind}.projection`,
          'json'
        ]);
        await run();
        assert.deepEqual(f.values('resend')[1], f.values('resend')[0]);
        assert.equal(f.names().includes('audit'), false);
        assert.equal(
          f.names().some((name) => name.endsWith('.render')),
          false
        );
      });
    }
  }
});

test('already sent resend receipts are projected without inventing another send', async () => {
  const sent = { ...queued, queued: false, sent: true };
  const f = fixture({ resendResult: sent });
  const result = await f.run('/admin/sponsorship-invoices/resend', {
    method: 'POST',
    body: JSON.stringify(resendInput(documentKinds[0]))
  });
  assert.deepEqual(result.payload, { ...sent, invoice: f.refreshed });
});

test('resend SMTP, request parsing and confirmation failures stop before queue access', async (t) => {
  for (const document of documentKinds) {
    const cases = [
      ['SMTP missing', { smtp: false }, '{invalid', undefined],
      ['malformed body', {}, '{invalid', undefined],
      ['oversized body', {}, ' '.repeat(16 * 1024 + 1), undefined],
      ['null body', {}, 'null', undefined],
      [
        'invalid document',
        {},
        JSON.stringify(resendInput(document, { [document.idKey]: 'invalid' })),
        undefined
      ],
      [
        'wrong confirmation',
        {},
        JSON.stringify(resendInput(document, { confirmation: 'wrong' })),
        'CONFIRMATION_REQUIRED'
      ],
      [
        'missing request UUID',
        {},
        JSON.stringify(resendInput(document, { requestId: undefined })),
        'CONFIRMATION_REQUIRED'
      ]
    ];
    for (const [name, options, body, code] of cases) {
      await t.test(`${document.kind} ${name}`, async () => {
        const f = fixture(options);
        const result = await f.run(`/admin/${document.route}/resend`, {
          method: 'POST',
          body
        });
        assert.equal(result.status, 400);
        assert.equal(result.payload.code, code);
        assert.equal(f.names().includes('resend'), false);
        assert.equal(f.names().includes(`${document.kind}.snapshot`), false);
        if (name === 'SMTP missing')
          assert.deepEqual(f.names(), ['access', 'database', 'smtp', 'json']);
      });
    }
  }
});

test('resend missing snapshots and invalid recipients never queue a document', async (t) => {
  for (const document of documentKinds) {
    for (const [name, options, to, status] of [
      ['missing snapshot', { missing: true }, recipient, 404],
      ['missing recipient', {}, undefined, 400],
      ['invalid recipient', {}, 'invalid', 400]
    ]) {
      await t.test(`${document.kind} ${name}`, async () => {
        const f = fixture(options);
        const result = await f.run(`/admin/${document.route}/resend`, {
          method: 'POST',
          body: JSON.stringify(resendInput(document, { to }))
        });
        assert.equal(result.status, status);
        assert.equal(f.names().includes('resend'), false);
        assert.deepEqual(f.values(`${document.kind}.snapshot`), [documentId]);
      });
    }
  }
});

test('resend request conflicts remain 409 while service and projection failures remain safe 502 responses', async (t) => {
  for (const document of documentKinds) {
    for (const [name, stage, error, status] of [
      [
        'request conflict',
        'resend',
        new DocumentResendConflict('Synthetic conflicting request.'),
        409
      ],
      ['queue failure', 'resend', new Error('private failure'), 502],
      [
        'snapshot failure',
        `${document.kind}.snapshot`,
        new Error('private failure'),
        502
      ],
      [
        'projection failure',
        `${document.kind}.projection`,
        new Error('private failure'),
        502
      ]
    ]) {
      await t.test(`${document.kind} ${name}`, async () => {
        const f = fixture({ errors: { [stage]: error } });
        const result = await f.run(`/admin/${document.route}/resend`, {
          method: 'POST',
          body: JSON.stringify(resendInput(document))
        });
        assert.equal(result.status, status);
        assert.equal(
          f.values('resend').length,
          stage === `${document.kind}.snapshot` ? 0 : 1
        );
        assert.deepEqual(f.values('json'), [status]);
        if (status === 409) {
          assert.deepEqual(result.payload, {
            code: 'REQUEST_CONFLICT',
            error: 'Synthetic conflicting request.'
          });
          assert.equal(f.names().includes('report'), false);
        } else {
          assert.equal(
            JSON.stringify(result.payload).includes('private failure'),
            false
          );
          // Resend logs intentionally omit the exception and private payload.
          assert.deepEqual(f.values('report'), [
            [`Failed to resend sponsorship ${document.label}.`]
          ]);
        }
      });
    }
  }
});
