import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { signal } from '@angular/core';

import { AdminDashboardRequestError } from '../dist/apps/funding-web/src/app/features/funding/services/funding-admin-session.js';

const workspaceHook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@openg7/funding-core')
      return {
        url: new URL(
          '../dist/packages/funding-core/src/index.js',
          import.meta.url
        ).href,
        shortCircuit: true
      };
    return nextResolve(specifier, context);
  }
});
const { AdminSponsorEditController } =
  await import('../dist/apps/funding-web/src/app/features/funding/components/admin-sponsors/admin-sponsor-edit-controller.js');
workspaceHook.deregister();

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const sponsor = (changes = {}) => ({
  id: 'synthetic-sponsor-a',
  version: 'synthetic-v1',
  sponsor_company_name: 'Synthetic company',
  public_name: 'Synthetic public name',
  sponsor_contact_name: 'Synthetic contact',
  sponsor_contact_email: 'contact@example.test',
  sponsor_website_url: 'https://example.test',
  ...changes
});

function fixture() {
  const selected = signal(sponsor());
  const state = { disabled: false, readonly: false, destroyed: false };
  const requests = [];
  const confirmations = [];
  const events = [];
  let requestIds = 0;
  let controller;
  const ports = {
    sponsorship: selected,
    disabled: () => state.disabled,
    readonlyAccess: () => state.readonly,
    token: () => 'synthetic-token',
    isDestroyed: () => state.destroyed,
    newRequestId: () => `synthetic-request-${++requestIds}`,
    async confirm(target) {
      confirmations.push(target);
      return true;
    },
    async updateSponsorshipDetails(token, request) {
      requests.push({ token, request });
      return { updated: true, version: 'synthetic-v2' };
    },
    saved() {
      events.push({
        event: 'saved',
        opened: controller.opened(),
        success: controller.success()
      });
    },
    conflicted: () => events.push({ event: 'conflicted' }),
    async onUnauthorized() {
      events.push({
        event: 'unauthorized',
        opened: controller.opened(),
        draft: controller.draft(),
        error: controller.error()
      });
    }
  };
  controller = new AdminSponsorEditController(ports);
  return {
    controller,
    ports,
    selected,
    state,
    requests,
    confirmations,
    events,
    requestIds: () => requestIds,
    changeTarget(record = sponsor({ id: 'synthetic-sponsor-b' })) {
      selected.set(record);
      controller.targetChanged();
    },
    edit() {
      controller.open();
      controller.setField('companyName', 'Synthetic correction');
    }
  };
}

test('opening initializes an independent draft, normalized unchanged fields do not save, and validation blocks invalid inputs', async () => {
  const f = fixture();
  const c = f.controller;
  c.open();
  assert.equal(c.opened(), true);
  assert.equal(c.draft().companyName, 'Synthetic company');
  c.setField('companyName', ' Synthetic company ');
  assert.equal(c.changed(), false);
  await c.save();
  c.setField('companyName', '');
  c.setField('contactEmail', 'invalid');
  c.setField('websiteUrl', 'javascript:alert(1)');
  await c.save();
  assert.deepEqual(Object.keys(c.errors()).sort(), [
    'companyName',
    'contactEmail',
    'websiteUrl'
  ]);
  assert.deepEqual(f.confirmations, []);
  assert.deepEqual(f.requests, []);
  assert.equal(f.requestIds(), 0);
  assert.equal(fixture().controller.draft().companyName, '');
});

for (const permission of ['disabled', 'readonly', 'destroyed'])
  test(`${permission} blocks opening and submitting a correction`, async () => {
    const f = fixture();
    f.state[permission] = true;
    f.controller.open();
    assert.equal(f.controller.opened(), false);
    f.state[permission] = false;
    f.edit();
    f.state[permission] = true;
    await f.controller.save();
    assert.deepEqual(f.confirmations, []);
    assert.deepEqual(f.requests, []);
  });

test('cancelling confirmation preserves the complete draft and creates no request', async () => {
  const f = fixture();
  f.edit();
  f.controller.setReason('contact_update');
  f.ports.confirm = async () => false;
  const before = f.controller.draft();
  await f.controller.save();
  assert.equal(f.controller.opened(), true);
  assert.deepEqual(f.controller.draft(), before);
  assert.equal(f.controller.reason(), 'contact_update');
  assert.equal(f.controller.busy(), false);
  assert.equal(f.controller.saving(), false);
  assert.deepEqual(f.requests, []);
  assert.equal(f.requestIds(), 0);
});

test('confirmation captures target, version and payload before waiting, then emits success after closing', async () => {
  const f = fixture();
  const confirmation = deferred();
  f.edit();
  f.controller.setReason('organization_update');
  f.controller.setReason('unsupported');
  f.ports.confirm = (target) => {
    f.confirmations.push(target);
    return confirmation.promise;
  };
  const save = f.controller.save();
  assert.equal(f.controller.busy(), true);
  assert.equal(f.controller.saving(), false);
  assert.deepEqual(f.confirmations, [
    'Synthetic correction · contact@example.test'
  ]);
  f.selected.set(sponsor({ version: 'synthetic-v2' }));
  f.controller.setField('companyName', 'Changed while confirming');
  confirmation.resolve(true);
  await save;
  assert.deepEqual(f.requests, [
    {
      token: 'synthetic-token',
      request: {
        companyName: 'Synthetic correction',
        publicName: 'Synthetic public name',
        contactName: 'Synthetic contact',
        contactEmail: 'contact@example.test',
        websiteUrl: 'https://example.test',
        contributionId: 'synthetic-sponsor-a',
        expectedVersion: 'synthetic-v1',
        reason: 'organization_update',
        confirmed: true,
        requestId: 'synthetic-request-1'
      }
    }
  ]);
  assert.deepEqual(f.events, [
    { event: 'saved', opened: false, success: true }
  ]);
  assert.equal(f.controller.busy(), false);
  assert.equal(f.controller.saving(), false);
});

test('double submission is blocked during both confirmation and server response', async () => {
  const f = fixture();
  const confirmation = deferred();
  const mutation = deferred();
  f.edit();
  f.ports.confirm = (target) => {
    f.confirmations.push(target);
    return confirmation.promise;
  };
  f.ports.updateSponsorshipDetails = (token, request) => {
    f.requests.push({ token, request });
    return mutation.promise;
  };
  const save = f.controller.save();
  await f.controller.save();
  assert.equal(f.confirmations.length, 1);
  confirmation.resolve(true);
  await Promise.resolve();
  assert.equal(f.controller.saving(), true);
  assert.equal(f.controller.success(), false);
  await f.controller.save();
  assert.equal(f.requests.length, 1);
  mutation.resolve({ updated: true, version: 'synthetic-v2' });
  await save;
  assert.equal(f.events.length, 1);
});

test('an uncertain failure preserves inputs and retries the same exact request; a changed payload gets a new UUID', async () => {
  const f = fixture();
  f.edit();
  f.ports.updateSponsorshipDetails = async (token, request) => {
    f.requests.push({ token, request });
    throw new Error('Synthetic lost response');
  };
  await f.controller.save();
  assert.equal(f.controller.error(), 'saveError');
  assert.equal(f.controller.draft().companyName, 'Synthetic correction');
  assert.equal(f.controller.opened(), true);
  await f.controller.save();
  assert.deepEqual(f.requests[1], f.requests[0]);
  assert.equal(f.requestIds(), 1);
  f.controller.setReason('contact_update');
  await f.controller.save();
  assert.equal(f.requests[2].request.requestId, 'synthetic-request-2');
  f.controller.setField('contactEmail', 'updated@example.test');
  await f.controller.save();
  assert.equal(f.requests[3].request.requestId, 'synthetic-request-3');
  assert.deepEqual(f.events, []);
});

test('a conflict keeps the draft and blocks retries until the dossier is reread and reopened', async () => {
  const f = fixture();
  f.edit();
  f.ports.updateSponsorshipDetails = async (token, request) => {
    f.requests.push({ token, request });
    throw new AdminDashboardRequestError(409);
  };
  await f.controller.save();
  await f.controller.save();
  assert.equal(f.controller.error(), 'conflict');
  assert.equal(f.controller.opened(), true);
  assert.equal(f.controller.draft().companyName, 'Synthetic correction');
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.events, [{ event: 'conflicted' }]);
  f.controller.close();
  f.selected.set(sponsor({ version: 'synthetic-v2' }));
  f.edit();
  f.ports.updateSponsorshipDetails = async (token, request) => {
    f.requests.push({ token, request });
    return { updated: true, version: 'synthetic-v2' };
  };
  await f.controller.save();
  assert.equal(f.requests[1].request.expectedVersion, 'synthetic-v2');
  assert.equal(f.requests[1].request.requestId, 'synthetic-request-2');
});

for (const status of [401, 403])
  test(`authorization failure ${status} clears private inputs before handling the session`, async () => {
    const f = fixture();
    f.edit();
    f.ports.updateSponsorshipDetails = async () => {
      throw new AdminDashboardRequestError(status);
    };
    await f.controller.save();
    assert.equal(f.controller.opened(), false);
    assert.equal(f.controller.draft().companyName, '');
    assert.equal(f.controller.draft().contactEmail, '');
    assert.equal(f.controller.error(), 'forbidden');
    assert.equal(f.controller.success(), false);
    assert.equal(f.controller.busy(), false);
    assert.equal(f.events.length, status === 401 ? 1 : 0);
    if (status === 401) {
      assert.equal(f.events[0].event, 'unauthorized');
      assert.equal(f.events[0].opened, false);
      assert.equal(f.events[0].draft.contactEmail, '');
      assert.equal(f.events[0].error, 'forbidden');
    }
  });

for (const status of [404, 500])
  test(`server failure ${status} retains the draft with its existing error category`, async () => {
    const f = fixture();
    f.edit();
    f.ports.updateSponsorshipDetails = async () => {
      throw new AdminDashboardRequestError(status);
    };
    await f.controller.save();
    assert.equal(
      f.controller.error(),
      status === 404 ? 'notFound' : 'saveError'
    );
    assert.equal(f.controller.opened(), true);
    assert.equal(f.controller.draft().companyName, 'Synthetic correction');
  });

test('a target changed while confirming never submits the captured dossier', async () => {
  const f = fixture();
  const confirmation = deferred();
  f.edit();
  f.ports.confirm = () => confirmation.promise;
  const save = f.controller.save();
  f.changeTarget();
  f.edit();
  confirmation.resolve(true);
  await save;
  assert.deepEqual(f.requests, []);
  assert.equal(f.controller.opened(), true);
  assert.equal(f.controller.success(), false);
  assert.equal(f.controller.error(), '');
});

for (const status of [200, 401, 409])
  test(`late correction response ${status} cannot affect another dossier or a leave-and-return generation`, async () => {
    const f = fixture();
    const mutation = deferred();
    f.edit();
    f.ports.updateSponsorshipDetails = () => mutation.promise;
    const save = f.controller.save();
    await Promise.resolve();
    f.changeTarget();
    f.changeTarget(sponsor());
    f.edit();
    status === 200
      ? mutation.resolve({ updated: true, version: 'synthetic-v2' })
      : mutation.reject(new AdminDashboardRequestError(status));
    await save;
    assert.equal(f.controller.opened(), true);
    assert.equal(f.controller.error(), '');
    assert.equal(f.controller.success(), false);
    assert.equal(f.controller.busy(), false);
    assert.deepEqual(f.events, []);
  });

test('destruction during confirmation prevents requests and late server failures cannot trigger session navigation', async () => {
  const first = fixture();
  const confirmation = deferred();
  first.edit();
  first.ports.confirm = () => confirmation.promise;
  const pendingConfirmation = first.controller.save();
  first.state.destroyed = true;
  confirmation.resolve(true);
  await pendingConfirmation;
  assert.deepEqual(first.requests, []);
  const second = fixture();
  const mutation = deferred();
  second.edit();
  second.ports.updateSponsorshipDetails = () => mutation.promise;
  const pendingMutation = second.controller.save();
  await Promise.resolve();
  second.state.destroyed = true;
  mutation.reject(new AdminDashboardRequestError(401));
  await pendingMutation;
  assert.deepEqual(second.events, []);
  assert.equal(second.controller.error(), '');
});
