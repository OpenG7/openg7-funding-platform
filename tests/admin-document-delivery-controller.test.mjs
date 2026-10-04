import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { signal } from '@angular/core';

import { adminDocumentDeliveryBrowser } from '../dist/apps/funding-web/src/app/features/funding/services/admin-document-delivery-browser.js';

// The root TypeScript build emits the workspace under dist/.
const workspaceHook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@openg7/funding-core') {
      return {
        url: new URL(
          '../dist/packages/funding-core/src/index.js',
          import.meta.url
        ).href,
        shortCircuit: true
      };
    }
    return nextResolve(specifier, context);
  }
});
const { AdminDocumentDeliveryController } =
  await import('../dist/apps/funding-web/src/app/features/funding/services/admin-document-delivery-controller.js');
workspaceHook.deregister();

const invoice = (id = 'synthetic-invoice-a') => ({
  id,
  invoice_number: `INV-${id}`,
  sponsor_contact_email: `${id}@example.test`,
  credit_notes: [
    {
      id: `credit-${id}`,
      invoice_id: id,
      credit_note_number: `CN-${id}`,
      sponsor_contact_email: `credit-${id}@example.test`
    }
  ]
});

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

const until = async (predicate) => {
  const deadline = Date.now() + 5000;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(predicate(), 'the requested async boundary should be reached');
};

const queued = { sent: false, queued: true, messageId: 'synthetic-message' };
const backfill = (changes = {}) => ({
  eligible_count: 3,
  missing_count: 2,
  created_count: 1,
  skipped_count: 1,
  failed_count: 0,
  remaining_count: 1,
  ...changes
});

function fixture(t, storage = new Map()) {
  const a = invoice();
  const b = invoice('synthetic-invoice-b');
  const selected = signal(a);
  const state = { manage: true, token: 'synthetic-token', target: undefined };
  const calls = [];
  const confirmations = [];
  const downloads = [];
  const refreshes = [];
  const browser = {
    crypto: webcrypto,
    storage: () => ({
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key)
    }),
    saveBlob: (blob, filename) => downloads.push({ blob, filename })
  };
  const ports = {
    admin: {
      async resendSponsorshipInvoice(token, payload) {
        calls.push({ kind: 'invoice', token, payload });
        return queued;
      },
      async resendSponsorshipCreditNote(token, payload) {
        calls.push({ kind: 'credit-note', token, payload });
        return queued;
      },
      async getSponsorshipInvoicePdf(token, id) {
        calls.push({ kind: 'invoice-pdf', token, id });
        return new Blob([id]);
      },
      async getSponsorshipCreditNotePdf(token, id) {
        calls.push({ kind: 'credit-note-pdf', token, id });
        return new Blob([id]);
      },
      async backfillSponsorshipInvoices(token, payload) {
        calls.push({ kind: 'backfill', token, payload });
        return backfill();
      }
    },
    adminToken: () => state.token,
    canManage: () => state.manage,
    invoices: () => [a, b],
    selectedInvoice: selected,
    contributionId: () => state.target,
    async refreshInvoices() {
      refreshes.push(selected()?.id);
    },
    async confirm(message, detail) {
      confirmations.push({ message, detail });
      return true;
    },
    t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
    browser: () => browser
  };
  const controller = new AdminDocumentDeliveryController(ports);
  t.after(() => controller.dispose());
  return {
    controller,
    ports,
    state,
    selected,
    a,
    b,
    calls,
    confirmations,
    downloads,
    refreshes,
    browser,
    storage
  };
}

test('SSR actions do not touch browser resources, requests or confirmations', async (t) => {
  const f = fixture(t);
  assert.equal(adminDocumentDeliveryBrowser(), null);
  f.ports.browser = adminDocumentDeliveryBrowser;
  await f.controller.resendInvoice(f.a);
  await f.controller.resendCreditNote(f.a.credit_notes[0]);
  await f.controller.downloadInvoicePdf(f.a);
  await f.controller.downloadCreditNotePdf(f.a.credit_notes[0]);
  await f.controller.backfillInvoices();
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.confirmations, []);
  assert.equal(f.controller.resendState(), 'idle');
  assert.equal(f.controller.invoicePdfState(), 'idle');
});

test('mutations require permission and session, and recheck both after confirmation', async (t) => {
  const f = fixture(t);
  f.state.manage = false;
  await f.controller.resendInvoice(f.a);
  await f.controller.backfillInvoices();
  assert.deepEqual(f.confirmations, []);
  f.state.manage = true;
  f.state.token = '';
  await f.controller.resendCreditNote(f.a.credit_notes[0]);
  await f.controller.downloadInvoicePdf(f.a);
  assert.deepEqual(f.calls, []);
  f.state.token = 'synthetic-token';
  f.ports.confirm = async () => {
    f.state.manage = false;
    return true;
  };
  await f.controller.resendInvoice(f.a);
  assert.equal(f.controller.resendState(), 'idle');
  assert.equal(f.storage.size, 0);
  assert.deepEqual(f.calls, []);
});

test('cancelled confirmation leaves drafts and creates no request or persisted UUID', async (t) => {
  const f = fixture(t);
  f.controller.setResendEmail({ id: f.a.id, email: 'corrected@example.test' });
  f.ports.confirm = async () => false;
  await f.controller.resendInvoice(f.a);
  await f.controller.resendCreditNote(f.a.credit_notes[0]);
  await f.controller.backfillInvoices();
  assert.equal(f.controller.resendEmail(), 'corrected@example.test');
  assert.equal(f.controller.resendState(), 'idle');
  assert.equal(
    f.controller.creditNoteResendStateFor(f.a.credit_notes[0].id),
    'idle'
  );
  assert.deepEqual(f.calls, []);
  assert.equal(f.storage.size, 0);
});

for (const kind of ['invoice', 'credit-note']) {
  test(`${kind} captures recipient before confirmation and keeps feedback with its document across selection`, async (t) => {
    const f = fixture(t);
    const confirmation = deferred();
    const response = deferred();
    const document = kind === 'invoice' ? f.a : f.a.credit_notes[0];
    const setEmail = (email) =>
      kind === 'invoice'
        ? f.controller.setResendEmail({ id: document.id, email })
        : f.controller.setCreditNoteResendEmail({ id: document.id, email });
    f.ports.confirm = (message, detail) => {
      f.confirmations.push({ message, detail });
      return confirmation.promise;
    };
    const method =
      kind === 'invoice'
        ? 'resendSponsorshipInvoice'
        : 'resendSponsorshipCreditNote';
    f.ports.admin[method] = (token, payload) => {
      f.calls.push({ token, payload });
      return response.promise;
    };
    setEmail(' captured@example.test ');
    const pending =
      kind === 'invoice'
        ? f.controller.resendInvoice(document)
        : f.controller.resendCreditNote(document);
    assert.match(f.confirmations[0].detail, /→ captured@example\.test$/);
    setEmail('edited@example.test');
    f.selected.set(f.b);
    confirmation.resolve(true);
    await until(() => f.calls.length === 1);
    assert.equal(f.calls[0].payload.to, 'captured@example.test');
    assert.equal(f.calls[0].payload.confirmation, document.id);
    assert.equal(f.controller.resendState(), 'idle');
    assert.equal(f.controller.resendMessage(), '');
    response.resolve(queued);
    await pending;
    assert.equal(f.controller.resendMessage(), '');
    assert.equal(f.refreshes.length, 1);
    f.selected.set(f.a);
    assert.equal(
      kind === 'invoice'
        ? f.controller.resendEmail()
        : f.controller.creditNoteResendEmail(document),
      'edited@example.test'
    );
    assert.equal(
      kind === 'invoice'
        ? f.controller.resendState()
        : f.controller.creditNoteResendStateFor(document.id),
      'sent'
    );
    assert.equal(
      f.controller.resendMessageIds()[document.id],
      queued.messageId
    );
    assert.match(
      kind === 'invoice'
        ? f.controller.resendMessage()
        : f.controller.creditNoteResendMessageFor(document.id),
      /remis.*file/
    );
    assert.equal(f.storage.size, 0);
  });
}

test('an uncertain resend survives destruction and reuses the opaque SHA-256 UUID in a new instance', async (t) => {
  const first = fixture(t);
  const email = 'synthetic-correction@example.test';
  first.controller.setResendEmail({ id: first.a.id, email });
  first.ports.admin.resendSponsorshipInvoice = async (token, payload) => {
    first.calls.push({ token, payload });
    throw new Error('Synthetic disconnected response');
  };
  await first.controller.resendInvoice(first.a);
  const key =
    'openg7-admin-document-resend:' +
    createHash('sha256').update(`${first.a.id}:${email}`).digest('hex');
  const requestId = first.calls[0].payload.requestId;
  assert.match(requestId, /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/);
  assert.deepEqual([...first.storage], [[key, requestId]]);
  assert.equal(JSON.stringify([...first.storage]).includes('@'), false);
  assert.equal(first.controller.resendState(), 'error');
  assert.deepEqual(first.refreshes, []);
  first.controller.dispose();
  const next = fixture(t, first.storage);
  next.controller.setResendEmail({ id: next.a.id, email });
  await next.controller.resendInvoice(next.a);
  assert.equal(next.calls[0].payload.requestId, requestId);
  assert.equal(next.storage.size, 0);
  assert.equal(
    next.controller.resendMessage(),
    'admin.messages.facture_remise_en_file'
  );
  assert.equal(next.refreshes.length, 1);
});

test('a changed recipient creates a separate request and completion only removes its own fingerprint', async (t) => {
  const f = fixture(t);
  let fail = true;
  f.ports.admin.resendSponsorshipInvoice = async (token, payload) => {
    f.calls.push({ token, payload });
    if (fail) throw new Error('Synthetic uncertainty');
    return { ...queued, queued: false, sent: true };
  };
  f.controller.setResendEmail({ id: f.a.id, email: 'first@example.test' });
  await f.controller.resendInvoice(f.a);
  f.controller.setResendEmail({ id: f.a.id, email: 'second@example.test' });
  fail = false;
  await f.controller.resendInvoice(f.a);
  assert.notEqual(f.calls[0].payload.requestId, f.calls[1].payload.requestId);
  assert.equal(f.storage.size, 1);
  assert.equal([...f.storage.values()][0], f.calls[0].payload.requestId);
  assert.equal(f.controller.resendMessage(), 'admin.messages.facture_envoyee');
});

test('unavailable browser storage falls back to an in-memory idempotent retry', async (t) => {
  const f = fixture(t);
  f.browser.storage = () => {
    throw new Error('Synthetic storage denial');
  };
  let fail = true;
  f.ports.admin.resendSponsorshipInvoice = async (token, payload) => {
    f.calls.push({ token, payload });
    if (fail) throw new Error('Synthetic uncertainty');
    return queued;
  };
  await f.controller.resendInvoice(f.a);
  fail = false;
  await f.controller.resendInvoice(f.a);
  assert.equal(f.calls[0].payload.requestId, f.calls[1].payload.requestId);
  assert.equal(f.storage.size, 0);
});

test('duplicate clicks are blocked during confirmation and send while independent documents remain available', async (t) => {
  const f = fixture(t);
  const confirmation = deferred();
  const response = deferred();
  f.ports.confirm = (message, detail) => {
    f.confirmations.push({ message, detail });
    return f.confirmations.length === 1
      ? confirmation.promise
      : Promise.resolve(true);
  };
  f.ports.admin.resendSponsorshipInvoice = (token, payload) => {
    f.calls.push({ token, payload });
    return response.promise;
  };
  const pending = f.controller.resendInvoice(f.a);
  await f.controller.resendInvoice(f.a);
  assert.equal(f.confirmations.length, 1);
  confirmation.resolve(true);
  await until(() => f.calls.length === 1);
  await f.controller.resendInvoice(f.a);
  assert.equal(f.calls.length, 1);
  await f.controller.resendCreditNote(f.a.credit_notes[0]);
  assert.equal(f.calls.length, 2);
  response.resolve(queued);
  await pending;
  assert.equal(f.refreshes.length, 2);
});

test('destruction during confirmation prevents the resend and late confirmation cannot change state', async (t) => {
  const f = fixture(t);
  const confirmation = deferred();
  f.ports.confirm = () => confirmation.promise;
  const pending = f.controller.resendInvoice(f.a);
  f.controller.dispose();
  const state = f.controller.resendState();
  confirmation.resolve(true);
  await pending;
  assert.equal(f.controller.resendState(), state);
  assert.deepEqual(f.calls, []);
  assert.equal(f.storage.size, 0);
});

test('destruction while hashing creates no late persisted request or API call', async (t) => {
  const f = fixture(t);
  const digest = deferred();
  f.browser.crypto = {
    subtle: { digest: () => digest.promise },
    randomUUID: () => webcrypto.randomUUID()
  };
  const pending = f.controller.resendInvoice(f.a);
  await until(() => f.controller.resendState() === 'sending');
  f.controller.dispose();
  digest.resolve(new Uint8Array(32).buffer);
  await pending;
  assert.deepEqual(f.calls, []);
  assert.equal(f.storage.size, 0);
});

for (const outcome of ['success', 'failure']) {
  test(`late ${outcome} after destruction never changes UI or refreshes and reconciles stored request safely`, async (t) => {
    const f = fixture(t);
    const response = deferred();
    f.ports.admin.resendSponsorshipInvoice = (token, payload) => {
      f.calls.push({ token, payload });
      return response.promise;
    };
    const pending = f.controller.resendInvoice(f.a);
    await until(() => f.calls.length === 1);
    f.controller.dispose();
    const state = f.controller.resendState();
    if (outcome === 'success') response.resolve(queued);
    else response.reject(new Error('Synthetic late failure'));
    await pending;
    assert.equal(f.controller.resendState(), state);
    assert.equal(f.controller.resendMessage(), '');
    assert.deepEqual(f.controller.resendMessageIds(), {});
    assert.deepEqual(f.refreshes, []);
    assert.equal(f.storage.size, 1);
  });
}

test('route scope reset keeps the document locked until completion and preserves its uncertain retry UUID', async (t) => {
  const f = fixture(t);
  const response = deferred();
  f.ports.admin.resendSponsorshipInvoice = (token, payload) => {
    f.calls.push({ token, payload });
    return response.promise;
  };
  const pending = f.controller.resendInvoice(f.a);
  await until(() => f.calls.length === 1);
  const requestId = f.calls[0].payload.requestId;
  f.controller.resetScope();
  await f.controller.resendInvoice(f.a);
  assert.equal(f.calls.length, 1);
  assert.equal(f.confirmations.length, 1);
  response.resolve(queued);
  await pending;
  assert.equal([...f.storage.values()][0], requestId);
  f.ports.admin.resendSponsorshipInvoice = async (token, payload) => {
    f.calls.push({ token, payload });
    throw new Error('Synthetic uncertain retry after route reset');
  };
  await f.controller.resendInvoice(f.a);
  assert.equal(f.calls[1].payload.requestId, requestId);
  assert.equal([...f.storage.values()][0], requestId);
  f.ports.admin.resendSponsorshipInvoice = async (token, payload) => {
    f.calls.push({ token, payload });
    return queued;
  };
  await f.controller.resendInvoice(f.a);
  assert.equal(f.calls[2].payload.requestId, requestId);
  assert.equal(f.storage.size, 0);
});

test('a disposed instance cannot remove a UUID reused by the next instance during an uncertain retry', async (t) => {
  const first = fixture(t);
  const firstResponse = deferred();
  first.ports.admin.resendSponsorshipInvoice = (token, payload) => {
    first.calls.push({ token, payload });
    return firstResponse.promise;
  };
  const pendingFirst = first.controller.resendInvoice(first.a);
  await until(() => first.calls.length === 1);
  const requestId = first.calls[0].payload.requestId;
  first.controller.dispose();
  const next = fixture(t, first.storage);
  const nextResponse = deferred();
  next.ports.admin.resendSponsorshipInvoice = (token, payload) => {
    next.calls.push({ token, payload });
    return nextResponse.promise;
  };
  const pendingNext = next.controller.resendInvoice(next.a);
  await until(() => next.calls.length === 1);
  assert.equal(next.calls[0].payload.requestId, requestId);
  firstResponse.resolve(queued);
  await pendingFirst;
  assert.equal([...next.storage.values()][0], requestId);
  nextResponse.reject(new Error('Synthetic uncertain new-instance retry'));
  await pendingNext;
  assert.equal([...next.storage.values()][0], requestId);
  next.ports.admin.resendSponsorshipInvoice = async (token, payload) => {
    next.calls.push({ token, payload });
    return queued;
  };
  await next.controller.resendInvoice(next.a);
  assert.equal(next.calls[1].payload.requestId, requestId);
  assert.equal(next.storage.size, 0);
});

test('a changed route scope cancels pending confirmation and rejects late mutation feedback', async (t) => {
  const f = fixture(t);
  const confirmation = deferred();
  f.ports.confirm = () => confirmation.promise;
  const cancelled = f.controller.resendInvoice(f.a);
  f.controller.resetScope();
  confirmation.resolve(true);
  await cancelled;
  assert.deepEqual(f.calls, []);
  const response = deferred();
  f.ports.confirm = async () => true;
  f.ports.admin.resendSponsorshipInvoice = (token, payload) => {
    f.calls.push({ token, payload });
    return response.promise;
  };
  const pending = f.controller.resendInvoice(f.a);
  await until(() => f.calls.length === 1);
  f.controller.resetScope();
  response.reject(new Error('Synthetic old-route error'));
  await pending;
  assert.equal(f.controller.resendState(), 'idle');
  assert.equal(f.controller.resendMessage(), '');
  assert.deepEqual(f.refreshes, []);
  assert.equal(f.storage.size, 1);
});

test('PDF requests, errors and filenames stay with their invoice or credit note across selection', async (t) => {
  const f = fixture(t);
  const response = deferred();
  f.a.invoice_number = '../ Synthetic / facture ?';
  f.ports.admin.getSponsorshipInvoicePdf = (token, id) => {
    f.calls.push({ token, id });
    return response.promise;
  };
  const pending = f.controller.downloadInvoicePdf(f.a);
  await f.controller.downloadInvoicePdf(f.a);
  assert.equal(f.calls.length, 1);
  assert.equal(f.controller.invoicePdfState(), 'loading');
  f.selected.set(f.b);
  assert.equal(f.controller.invoicePdfState(), 'idle');
  await f.controller.downloadCreditNotePdf(f.a.credit_notes[0]);
  assert.equal(await f.downloads[0].blob.text(), f.a.credit_notes[0].id);
  response.reject(new Error('Synthetic PDF failure A'));
  await pending;
  assert.equal(f.controller.invoicePdfMessage(), '');
  f.selected.set(f.a);
  assert.equal(f.controller.invoicePdfMessage(), 'Synthetic PDF failure A');
  f.ports.admin.getSponsorshipInvoicePdf = async () =>
    new Blob(['synthetic PDF']);
  await f.controller.downloadInvoicePdf(f.a);
  assert.equal(f.downloads[1].filename, 'openg7-..-Synthetic-facture.pdf');
  assert.equal(f.controller.invoicePdfState(), 'idle');
  assert.equal(f.controller.invoicePdfMessage(), '');
});

test('late PDF responses after destruction or route scope changes create no download', async (t) => {
  for (const end of ['dispose', 'resetScope']) {
    const f = fixture(t);
    const response = deferred();
    f.ports.admin.getSponsorshipInvoicePdf = () => response.promise;
    const pending = f.controller.downloadInvoicePdf(f.a);
    f.controller[end]();
    const state = f.controller.invoicePdfState();
    response.resolve(new Blob(['synthetic late PDF']));
    await pending;
    assert.equal(f.controller.invoicePdfState(), state);
    assert.deepEqual(f.downloads, []);
  }
});

test('browser PDF resource is revoked even when activating the download throws', (t) => {
  const savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const savedDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const revoked = [];
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      crypto: webcrypto,
      get sessionStorage() {
        throw new Error('Synthetic storage denial');
      },
      URL: {
        createObjectURL: () => 'blob:synthetic-document',
        revokeObjectURL: (url) => revoked.push(url)
      }
    }
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement: () => ({
        click() {
          throw new Error('Synthetic download failure');
        }
      })
    }
  });
  t.after(() => {
    if (savedWindow) Object.defineProperty(globalThis, 'window', savedWindow);
    else delete globalThis.window;
    if (savedDocument)
      Object.defineProperty(globalThis, 'document', savedDocument);
    else delete globalThis.document;
  });
  const browser = adminDocumentDeliveryBrowser();
  assert.equal(browser.storage(), null);
  assert.throws(
    () => browser.saveBlob(new Blob(['synthetic PDF']), 'openg7-document.pdf'),
    /Synthetic download failure/
  );
  assert.deepEqual(revoked, ['blob:synthetic-document']);
});

test('backfill captures its confirmed target and bounds, blocks duplicates and reloads server facts', async (t) => {
  const f = fixture(t);
  f.state.target = 'synthetic-contribution-a';
  const confirmation = deferred();
  f.ports.confirm = (message) => {
    f.confirmations.push({ message });
    return confirmation.promise;
  };
  const pending = f.controller.backfillInvoices();
  await f.controller.backfillInvoices();
  f.state.target = undefined;
  confirmation.resolve(true);
  await pending;
  assert.equal(f.confirmations.length, 1);
  assert.deepEqual(f.calls[0].payload, {
    limit: 1,
    contributionId: 'synthetic-contribution-a',
    confirmation: 'synthetic-contribution-a'
  });
  assert.equal(f.controller.backfillState(), 'done');
  assert.match(
    f.controller.backfillMessage(),
    /restante_s_relancez_le_backfill/
  );
  assert.equal(f.refreshes.length, 1);
  f.ports.confirm = async () => true;
  f.ports.admin.backfillSponsorshipInvoices = async (token, payload) => {
    f.calls.push({ token, payload });
    return backfill({ failed_count: 1 });
  };
  await f.controller.backfillInvoices();
  assert.equal(f.calls[1].payload.limit, 250);
  assert.ok(f.calls[1].payload.confirmation);
  assert.equal(f.controller.backfillState(), 'error');
  assert.equal(f.refreshes.length, 2);
});

test('backfill empty, complete and failure outcomes remain explicit and route changes suppress old results', async (t) => {
  const f = fixture(t);
  f.ports.admin.backfillSponsorshipInvoices = async () =>
    backfill({ eligible_count: 0 });
  await f.controller.backfillInvoices();
  assert.equal(
    f.controller.backfillMessage(),
    'admin.messages.aucune_commandite_payee_admissible_a_facturer'
  );
  f.ports.admin.backfillSponsorshipInvoices = async () =>
    backfill({ missing_count: 0 });
  await f.controller.backfillInvoices();
  assert.match(f.controller.backfillMessage(), /aucune_facture_manquante/);
  f.ports.admin.backfillSponsorshipInvoices = async () => {
    throw new Error('Synthetic backfill failure');
  };
  await f.controller.backfillInvoices();
  assert.equal(f.controller.backfillState(), 'error');
  assert.equal(f.controller.backfillMessage(), 'Synthetic backfill failure');
  const response = deferred();
  f.ports.admin.backfillSponsorshipInvoices = () => response.promise;
  const pending = f.controller.backfillInvoices();
  await until(() => f.controller.backfillState() === 'sending');
  f.controller.resetScope();
  const refreshes = f.refreshes.length;
  response.resolve(backfill());
  await pending;
  assert.equal(f.controller.backfillState(), 'idle');
  assert.equal(f.controller.backfillMessage(), '');
  assert.equal(f.refreshes.length, refreshes);
});
