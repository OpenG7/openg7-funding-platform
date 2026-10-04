import assert from 'node:assert/strict';
import test from 'node:test';

import { AdminInspectionController } from '../dist/apps/funding-web/src/app/features/funding/components/admin-inspector/admin-inspection-controller.js';
import { AdminDashboardRequestError } from '../dist/apps/funding-web/src/app/features/funding/services/funding-admin-session.js';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

const invoice = {
  id: 'invoice-synthetic',
  contribution_id: 'contribution-synthetic',
  invoice_number: 'FAC-SYNTHETIC',
  sponsor_name: 'Synthetic sponsor',
  issuer_name: 'OpenG7',
  public_reference: 'OG7-SYNTHETIC',
  issued_at: '2026-10-04T12:00:00Z',
  total: 100.5,
  currency: 'CAD',
  line_items: [],
  credit_notes: []
};
const event = {
  id: 'evt_synthetic',
  type: 'charge.updated',
  status: 'failed',
  receivedAt: '2026-10-04T12:00:00Z',
  processedAt: null,
  error: 'processing_failed'
};
const invoiceContext = {
  kind: 'invoice',
  id: invoice.id,
  contributionId: invoice.contribution_id,
  fullUrl: '/admin/fundraiser/invoices'
};
const mediaContext = {
  kind: 'media',
  id: 'media-synthetic',
  fullUrl: '/admin/fundraiser/sponsors'
};
const stripeContext = {
  kind: 'stripe',
  id: event.id,
  fullUrl: '/admin/fundraiser/attention'
};
const localContext = {
  kind: 'email',
  id: 'email-synthetic',
  fullUrl: '/admin/fundraiser/email-queue',
  fields: [{ label: 'recipient', value: 'fixture@example.invalid' }]
};

const fixture = (t) => {
  const calls = [];
  const created = [];
  const revoked = [];
  let token = 'synthetic-admin-session';
  let expired = 0;
  t.mock.method(URL, 'createObjectURL', (blob) => {
    const url = `blob:synthetic-${created.length + 1}`;
    created.push({ blob, url });
    return url;
  });
  t.mock.method(URL, 'revokeObjectURL', (url) => revoked.push(url));
  const ports = {
    admin: {
      getStripeEvent: async (...args) => {
        calls.push(['stripe', ...args]);
        return { available: true, event };
      },
      getSponsorshipInvoices: async (...args) => {
        calls.push(['invoices', ...args]);
        return { invoices: [invoice] };
      },
      getSponsorshipInvoicePdf: async (...args) => {
        calls.push(['pdf', ...args]);
        return new Blob(['synthetic invoice'], { type: 'application/pdf' });
      },
      getSponsorMediaPreview: async (...args) => {
        calls.push(['media', ...args]);
        return new Blob(['synthetic image'], { type: 'image/png' });
      }
    },
    token: () => token,
    onSessionExpired: () => {
      expired++;
    }
  };
  return {
    controller: new AdminInspectionController(ports),
    ports,
    calls,
    created,
    revoked,
    expired: () => expired,
    setToken: (value) => {
      token = value;
    }
  };
};

const assertCleared = (f, state = 'idle') => {
  assert.equal(f.controller.state(), state);
  assert.deepEqual(f.controller.fields(), []);
  assert.equal(f.controller.invoice(), null);
  assert.equal(f.controller.processingFailed(), false);
  assert.equal(f.controller.resourceUrl(), null);
};

test('inspection has no constructor effects and preserves Stripe facts and local fields', async (t) => {
  const f = fixture(t);
  assertCleared(f);
  assert.deepEqual(f.calls, []);
  await f.controller.load(stripeContext);
  assert.equal(f.controller.state(), 'ready');
  assert.equal(f.controller.processingFailed(), true);
  assert.deepEqual(f.controller.fields(), [
    { label: 'id', value: event.id },
    { label: 'type', value: event.type },
    { label: 'status', value: event.status },
    { label: 'receivedAt', value: event.receivedAt },
    { label: 'processedAt', value: null }
  ]);
  assert.deepEqual(f.calls, [['stripe', 'synthetic-admin-session', event.id]]);
  await f.controller.load(localContext);
  assert.equal(f.controller.state(), 'ready');
  assert.equal(f.controller.fields(), localContext.fields);
  assert.equal(f.controller.processingFailed(), false);
  assert.equal(f.calls.length, 1);
  await f.controller.load(null);
  assertCleared(f);
  assert.deepEqual(f.created, []);
});

test('invoice selection uses the invoice ID and supports its contribution fallback', async (t) => {
  const f = fixture(t);
  await f.controller.load(invoiceContext);
  assert.equal(f.controller.state(), 'ready');
  assert.equal(f.controller.invoice(), invoice);
  assert.deepEqual(f.calls, [
    ['invoices', 'synthetic-admin-session', invoice.contribution_id],
    ['pdf', 'synthetic-admin-session', invoice.id]
  ]);
  assert.deepEqual(
    f.controller.fields().find((field) => field.label === 'amount'),
    { label: 'amount', value: 100.5, currency: 'CAD' }
  );
  assert.equal(f.controller.resourceUrl(), 'blob:synthetic-1');
  await f.controller.load({ ...invoiceContext, id: invoice.contribution_id });
  assert.equal(f.controller.invoice(), invoice);
  assert.equal(f.controller.resourceUrl(), 'blob:synthetic-2');
  assert.deepEqual(f.revoked, ['blob:synthetic-1']);
  f.controller.clear();
  f.controller.clear();
  assertCleared(f);
  assert.deepEqual(f.revoked, ['blob:synthetic-1', 'blob:synthetic-2']);
});

test('missing invoice and Stripe missing or unavailable states do not create previews', async (t) => {
  const f = fixture(t);
  await f.controller.load({ ...invoiceContext, id: 'different-invoice' });
  assertCleared(f, 'missing');
  assert.equal(
    f.calls.some(([kind]) => kind === 'pdf'),
    false
  );
  f.ports.admin.getStripeEvent = async () => ({ available: false, event });
  await f.controller.load(stripeContext);
  assertCleared(f, 'unavailable');
  f.ports.admin.getStripeEvent = async () => ({ available: true, event: null });
  await f.controller.load(stripeContext);
  assertCleared(f, 'missing');
  assert.deepEqual(f.created, []);
});

for (const [context, method, allowed] of [
  [invoiceContext, 'getSponsorshipInvoicePdf', ['application/pdf']],
  [
    mediaContext,
    'getSponsorMediaPreview',
    ['image/png', 'image/jpeg', 'image/webp']
  ]
]) {
  test(`${context.kind} validates the exact MIME before allocating its URL and remains retryable`, async (t) => {
    const f = fixture(t);
    for (const type of [
      '',
      'text/html',
      'image/svg+xml',
      'application/pdf; charset=utf-8'
    ]) {
      f.ports.admin[method] = async () =>
        new Blob(['invalid preview'], { type });
      await f.controller.load(context);
      assert.equal(f.controller.state(), 'error');
      assert.equal(f.controller.resourceUrl(), null);
    }
    if (context.kind === 'invoice') {
      f.ports.admin[method] = async () =>
        new Blob(['wrong kind'], { type: 'image/png' });
      await f.controller.load(context);
      assert.equal(f.controller.state(), 'error');
      assert.equal(f.controller.invoice(), invoice);
    } else {
      f.ports.admin[method] = async () =>
        new Blob(['wrong kind'], { type: 'application/pdf' });
      await f.controller.load(context);
      assert.equal(f.controller.state(), 'error');
    }
    assert.deepEqual(f.created, []);
    for (const type of allowed) {
      f.ports.admin[method] = async () => new Blob(['valid preview'], { type });
      await f.controller.load(context);
      assert.equal(f.controller.state(), 'ready');
      assert.equal(f.created.at(-1).blob.type, type);
    }
    f.controller.dispose();
    assert.equal(f.revoked.length, allowed.length);
  });
}

for (const status of [404, 503]) {
  test(`preview ${status} preserves the resource failure state and invoice facts`, async (t) => {
    const f = fixture(t);
    f.ports.admin.getSponsorshipInvoicePdf = async () => {
      throw new AdminDashboardRequestError(status);
    };
    await f.controller.load(invoiceContext);
    assert.equal(f.controller.state(), status === 404 ? 'missing' : 'error');
    assert.equal(f.controller.invoice(), invoice);
    assert.equal(
      f.controller
        .fields()
        .some((field) => field.value === invoice.sponsor_name),
      true
    );
    assert.equal(f.controller.resourceUrl(), null);
    assert.equal(f.expired(), 0);
  });
}

for (const status of [401, 403]) {
  test(`inspection ${status} removes every private field and distinguishes session expiration`, async (t) => {
    const f = fixture(t);
    await f.controller.load(stripeContext);
    assert.equal(f.controller.processingFailed(), true);
    await f.controller.load(invoiceContext);
    f.ports.admin.getSponsorshipInvoicePdf = async () => {
      throw new AdminDashboardRequestError(status);
    };
    await f.controller.load(invoiceContext);
    assertCleared(f, status === 403 ? 'forbidden' : 'idle');
    assert.deepEqual(f.revoked, ['blob:synthetic-1']);
    assert.equal(f.expired(), status === 401 ? 1 : 0);
  });
}

test('an absent token expires before any protected read or local field is exposed', async (t) => {
  const f = fixture(t);
  f.setToken('');
  await f.controller.load(localContext);
  await f.controller.load(invoiceContext);
  assertCleared(f);
  assert.deepEqual(f.calls, []);
  assert.equal(f.expired(), 2);
});

for (const outcome of ['resolve', 'reject']) {
  test(`token loss during a ${outcome} clears the invoice and prevents URL creation`, async (t) => {
    const f = fixture(t);
    const pending = deferred();
    const started = deferred();
    f.ports.admin.getSponsorshipInvoicePdf = () => {
      started.resolve();
      return pending.promise;
    };
    const request = f.controller.load(invoiceContext);
    await started.promise;
    assert.equal(f.controller.invoice(), invoice);
    f.setToken('');
    if (outcome === 'resolve')
      pending.resolve(new Blob(['private PDF'], { type: 'application/pdf' }));
    else pending.reject(new AdminDashboardRequestError(503));
    await request;
    assertCleared(f);
    assert.equal(f.expired(), 1);
    assert.deepEqual(f.created, []);
  });
}

test('session replacement invalidates a private response without expiring the new session', async (t) => {
  const f = fixture(t);
  const pending = deferred();
  f.ports.admin.getStripeEvent = () => pending.promise;
  const request = f.controller.load(stripeContext);
  f.setToken('different-synthetic-session');
  pending.resolve({ available: true, event });
  await request;
  assertCleared(f);
  assert.equal(f.expired(), 0);
});

for (const method of [
  'getSponsorshipInvoices',
  'getSponsorshipInvoicePdf',
  'getSponsorMediaPreview',
  'getStripeEvent'
]) {
  for (const action of ['change', 'close', 'dispose']) {
    for (const outcome of ['resolve', 'reject']) {
      test(`${method} late ${outcome} after ${action} has no private effects`, async (t) => {
        const f = fixture(t);
        const pending = deferred();
        const started = deferred();
        f.ports.admin[method] = () => {
          started.resolve();
          return pending.promise;
        };
        const context =
          method === 'getStripeEvent'
            ? stripeContext
            : method === 'getSponsorMediaPreview'
              ? mediaContext
              : invoiceContext;
        const request = f.controller.load(context);
        await started.promise;
        if (action === 'change') await f.controller.load(localContext);
        else if (action === 'close') f.controller.clear();
        else f.controller.dispose();
        if (outcome === 'reject')
          pending.reject(new AdminDashboardRequestError(401));
        else if (method === 'getStripeEvent')
          pending.resolve({ available: true, event });
        else if (method === 'getSponsorshipInvoices')
          pending.resolve({ invoices: [invoice] });
        else
          pending.resolve(
            new Blob(['late protected resource'], {
              type:
                method === 'getSponsorMediaPreview'
                  ? 'image/png'
                  : 'application/pdf'
            })
          );
        await request;
        if (action === 'change') {
          assert.equal(f.controller.state(), 'ready');
          assert.equal(f.controller.fields(), localContext.fields);
          assert.equal(f.controller.invoice(), null);
          assert.equal(f.controller.processingFailed(), false);
          assert.equal(f.controller.resourceUrl(), null);
        } else assertCleared(f);
        assert.deepEqual(f.created, []);
        assert.equal(f.expired(), 0);
      });
    }
  }
}

test('disposal releases visible previews once, erases local facts and blocks future effects', async (t) => {
  const f = fixture(t);
  await f.controller.load(mediaContext);
  assert.equal(f.controller.resourceUrl(), 'blob:synthetic-1');
  f.controller.dispose();
  f.controller.dispose();
  const calls = f.calls.length;
  f.ports.token = () => {
    throw new Error('session read after disposal');
  };
  await f.controller.load(invoiceContext);
  f.controller.clear();
  assertCleared(f);
  assert.equal(f.calls.length, calls);
  assert.deepEqual(f.revoked, ['blob:synthetic-1']);
  assert.equal(f.expired(), 0);
});

test('URL allocation failure stays retryable and reveals no resource', async (t) => {
  const f = fixture(t);
  t.mock.method(URL, 'createObjectURL', () => {
    throw new Error('synthetic URL allocation failure');
  });
  await f.controller.load(mediaContext);
  assertCleared(f, 'error');
  assert.equal(f.expired(), 0);
});

test('construction and empty destruction need no browser URL APIs during SSR', (t) => {
  const f = fixture(t);
  t.mock.method(URL, 'createObjectURL', () => {
    throw new Error('unexpected URL allocation');
  });
  t.mock.method(URL, 'revokeObjectURL', () => {
    throw new Error('unexpected URL cleanup');
  });
  f.controller.clear();
  f.controller.dispose();
  assertCleared(f);
  assert.deepEqual(f.calls, []);
});
