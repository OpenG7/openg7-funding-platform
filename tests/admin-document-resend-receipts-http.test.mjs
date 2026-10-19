import assert from 'node:assert/strict';
import test from 'node:test';

import { createAdminDocumentsHttpHandler } from '../dist/apps/funding-api/src/admin-documents.http.js';
import { adminRoleAllows } from '../dist/apps/funding-api/src/admin-identity/policy.js';

const path = '/admin/sponsorship-documents/resend-receipt';
const input = {
  requestId: '00000000-0000-4000-8000-00000000000a',
  documentId: '00000000-0000-4000-8000-00000000000b',
  documentKind: 'invoice'
};
const actor = 'admin:synthetic-operator';
const validUuid = (value) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

function fixture({
  role = 'operator',
  denied,
  database = true,
  failure = false
} = {}) {
  const calls = [];
  const forbidden = (name) => () => {
    calls.push(name);
    throw new Error('Unexpected business effect');
  };
  const writeJson = (_request, response, status, payload) =>
    Object.assign(response, { status, payload });
  const handler = createAdminDocumentsHttpHandler({
    publicBaseOrigin: 'https://funding.example.test',
    ensureAdminAccess(request, response) {
      calls.push('access');
      const status =
        denied ??
        (adminRoleAllows(
          role,
          request.method,
          new URL(request.url, 'https://funding.example.test').pathname
        )
          ? undefined
          : 403);
      if (!status) return true;
      writeJson(request, response, status, { code: 'ACCESS_DENIED' });
      return false;
    },
    getAdminAuditActor: () => {
      calls.push('actor');
      return actor;
    },
    databaseAvailable: () => database,
    isValidUuid: validUuid,
    writeJson,
    async readAdminDocumentResendReceipt(request, authenticatedActor) {
      calls.push({ request, actor: authenticatedActor });
      if (failure) throw new Error('Synthetic database outage');
      return { ...request, found: false };
    },
    getTransactionalEmailConfigStatus: forbidden('smtp-config'),
    queueAdminDocumentResend: forbidden('resend'),
    readBody: forbidden('body'),
    getSponsorshipInvoiceById: forbidden('document-snapshot'),
    getAdminSponsorshipInvoiceById: forbidden('document-projection'),
    reportFailure: () => calls.push('safe-report')
  });
  return {
    calls,
    async run(
      query = new URLSearchParams(input).toString(),
      method = 'GET',
      prefix = ''
    ) {
      const response = {
        headers: {},
        setHeader(name, value) {
          this.headers[name] = value;
        }
      };
      const handled = await handler(
        { url: prefix + path + '?' + query, method, headers: {} },
        response
      );
      return { handled, ...response };
    }
  };
}

for (const role of ['operator', 'owner']) {
  for (const prefix of ['', '/api']) {
    test(`${role} reads only its exact document receipt through ${prefix || 'root'} alias`, async () => {
      const f = fixture({ role });
      const response = await f.run(undefined, 'GET', prefix);
      assert.equal(response.status, 200);
      assert.equal(response.headers['Cache-Control'], 'private, no-store');
      assert.deepEqual(response.payload, { ...input, found: false });
      assert.deepEqual(f.calls, ['access', 'actor', { request: input, actor }]);
    });
  }
}

for (const [role, denied, status] of [
  ['reader', undefined, 403],
  ['operator', 401, 401],
  ['owner', 403, 403]
]) {
  test(`receipt access refusal ${role}/${status} precedes query parsing and data access`, async () => {
    const f = fixture({ role, denied });
    const response = await f.run('private=not-allowed');
    assert.equal(response.status, status);
    assert.deepEqual(f.calls, ['access']);
    assert.equal(response.headers['Cache-Control'], 'private, no-store');
  });
}

for (const patch of [
  (params) => params.delete('requestId'),
  (params) => params.set('documentId', 'not-a-uuid'),
  (params) => params.set('requestId', 'not-a-uuid'),
  (params) => params.set('documentKind', 'expense'),
  (params) => params.append('requestId', input.requestId),
  (params) => params.append('documentKind', 'invoice'),
  (params) => params.set('recipient', 'private@example.test')
]) {
  test('receipt query rejects missing, duplicate, unsupported or private fields before reading', async () => {
    const f = fixture();
    const params = new URLSearchParams(input);
    patch(params);
    const response = await f.run(params.toString());
    assert.equal(response.status, 400);
    assert.deepEqual(response.payload, { code: 'INVALID_DOCUMENT_RECEIPT' });
    assert.deepEqual(f.calls, ['access']);
  });
}

test('credit-note receipts preserve the explicit document type', async () => {
  const f = fixture();
  const request = { ...input, documentKind: 'credit_note' };
  await f.run(new URLSearchParams(request).toString());
  assert.deepEqual(f.calls.at(-1), { request, actor });
});

for (const method of ['POST', 'PUT', 'DELETE']) {
  test(`${method} cannot turn receipt lookup into a mutation`, async () => {
    const f = fixture({ role: 'owner' });
    const response = await f.run(undefined, method);
    assert.equal(response.status, 405);
    assert.equal(response.headers.Allow, 'GET');
    assert.deepEqual(f.calls, ['access']);
  });
}

for (const options of [{ database: false }, { failure: true }]) {
  test('receipt outages remain unavailable rather than inventing a missing or successful command', async () => {
    const f = fixture(options);
    const response = await f.run();
    assert.equal(response.status, 503);
    assert.deepEqual(response.payload, {
      code: 'DOCUMENT_RECEIPT_UNAVAILABLE'
    });
    assert.ok(!f.calls.includes('smtp-config'));
    assert.ok(!f.calls.includes('resend'));
  });
}
