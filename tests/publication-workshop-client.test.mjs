import assert from 'node:assert/strict';
import test from 'node:test';

import { FundingAdminPublicationWorkshopClient } from '../dist/apps/funding-web/src/app/features/funding/services/funding-admin-publication-workshop.client.js';

const id = '10000000-0000-4000-8000-000000000401';
const state = () => ({
  contributionId: id,
  enabled: false,
  sourceVersion: null,
  sourceSnapshotDigest: null,
  mission: null,
  proposal: null,
  history: [],
  canPrepare: false,
  canAdopt: false
});
function fixture(response = state(), status = 200) {
  const calls = [];
  const client = new FundingAdminPublicationWorkshopClient({
    async requestAdminJson(path, options) {
      calls.push({ path, options });
      return new Response(JSON.stringify(response), {
        status,
        headers: { 'content-type': 'application/json' }
      });
    }
  });
  return { client, calls };
}

test('publication workshop client uses the Funding session and a scoped uncached read', async () => {
  const { client, calls } = fixture();
  assert.deepEqual(await client.read(id), state());
  assert.equal(
    calls[0].path,
    '/admin/sponsorships/publication-workshop?contributionId=' + id
  );
  assert.equal(calls[0].options.auth, 'saved');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(calls[0].options.abortBeforeFetch, true);
});

test('publication workshop client preserves explicit CAS and idempotency inputs without retrying commands', async () => {
  const { client, calls } = fixture();
  const request = {
    contributionId: id,
    expectedSourceVersion: 7,
    requestId: '20000000-0000-4000-8000-000000000001'
  };
  await client.prepare(request);
  await client.adopt({
    ...request,
    proposalId: '30000000-0000-4000-8000-000000000001'
  });
  assert.equal(calls.length, 2);
  assert.equal(
    calls[0].path,
    '/admin/sponsorships/publication-workshop/prepare'
  );
  assert.equal(calls[1].path, '/admin/sponsorships/publication-workshop/adopt');
  assert.deepEqual(calls[0].options.body, request);
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].options.abortBeforeFetch, false);
});

test('publication workshop client rejects a cross-dossier or invalid response', async () => {
  for (const invalid of [
    { ...state(), contributionId: 'other-dossier' },
    { ...state(), history: null },
    { ...state(), canAdopt: 'true' },
    {
      ...state(),
      proposal: { editorialPreparation: { publicationAuthorized: true } }
    }
  ]) {
    const { client } = fixture(invalid);
    await assert.rejects(client.read(id), (error) => error.status === 502);
  }
});

test('publication workshop client exposes conflicts and uncertain failures without automatic retries', async () => {
  for (const status of [403, 409, 503]) {
    const { client, calls } = fixture(
      { code: 'WORKSHOP_DRAFT_CHANGED' },
      status
    );
    await assert.rejects(
      client.prepare({
        contributionId: id,
        expectedSourceVersion: 1,
        requestId: '20000000-0000-4000-8000-000000000001'
      }),
      (error) =>
        error.status === status && error.code === 'WORKSHOP_DRAFT_CHANGED'
    );
    assert.equal(calls.length, 1);
  }
});
