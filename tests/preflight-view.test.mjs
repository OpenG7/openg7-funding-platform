import '@angular/compiler';
import assert from 'node:assert/strict';
import test from 'node:test';
import { AdminPreflightPreparationsController } from '../dist/apps/funding-web/src/app/features/funding/components/admin-sponsors/admin-preflight-preparations.controller.js';
import { FundingAdminPreflightClient } from '../dist/apps/funding-web/src/app/features/funding/services/funding-admin-preflight.client.js';

const disabled = { enabled: false, connectionState: 'disabled', items: [] };
const empty = { enabled: true, connectionState: 'not_verified', items: [] };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const defer = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test('dossier switching and identity revocation fence late private preparation reads', async () => {
  let identity = 'person-one';
  let permitted = true;
  const first = defer(),
    second = defer();
  const calls = [];
  const controller = new AdminPreflightPreparationsController({
    identity: () => identity,
    permitted: () => permitted,
    read: (id) => {
      calls.push(id);
      return id === 'first' ? first.promise : second.promise;
    }
  });
  controller.select('first', identity);
  controller.select('second', identity);
  second.resolve(empty);
  await tick();
  assert.equal(controller.data(), empty);
  first.resolve(disabled);
  await tick();
  assert.equal(controller.data(), empty);
  identity = 'person-two';
  permitted = false;
  controller.select('second', identity);
  assert.equal(controller.data(), null);
  assert.equal(controller.error(), 'forbidden');
  assert.deepEqual(calls, ['first', 'second']);
});

test('disabled, empty and retryable failure states remain distinct without any mutation port', async () => {
  let reads = 0;
  const controller = new AdminPreflightPreparationsController({
    identity: () => 'person',
    permitted: () => true,
    read: async () => {
      reads++;
      if (reads === 1) throw { status: 503 };
      if (reads === 2) return disabled;
      return empty;
    }
  });
  controller.select('dossier', 'person');
  await tick();
  assert.equal(controller.error(), 'unavailable');
  assert.equal(controller.loading(), false);
  await controller.load();
  assert.equal(controller.data().enabled, false);
  await controller.load();
  assert.equal(controller.data().enabled, true);
  assert.deepEqual(controller.data().items, []);
  controller.dispose();
  assert.equal(controller.data(), null);
  await controller.load();
  assert.equal(reads, 3);
});

test('browser client uses the existing Funding human session and rejects an executable approval response', async () => {
  const calls = [];
  const client = new FundingAdminPreflightClient({
    requestAdminJson: async (path, options) => {
      calls.push({ path, options });
      return new Response(JSON.stringify(disabled), {
        headers: { 'content-type': 'application/json' }
      });
    }
  });
  assert.deepEqual(await client.read('synthetic-dossier'), disabled);
  assert.deepEqual(calls[0].options, { auth: 'saved', cache: 'no-store' });
  assert.equal(
    calls[0].path.includes(
      '/admin/preflight/preparations?sponsorshipId=synthetic-dossier'
    ),
    true
  );
  const malformed = new FundingAdminPreflightClient({
    requestAdminJson: async () =>
      new Response(
        JSON.stringify({
          ...empty,
          items: [{ status: 'approved', businessDecisionExecuted: true }]
        })
      )
  });
  await assert.rejects(
    malformed.read('synthetic-dossier'),
    (error) => error.status === 502
  );
  const forbidden = new FundingAdminPreflightClient({
    requestAdminJson: async () => new Response('{}', { status: 403 })
  });
  await assert.rejects(
    forbidden.read('synthetic-dossier'),
    (error) => error.status === 403
  );
});
