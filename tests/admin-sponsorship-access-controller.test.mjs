import assert from 'node:assert/strict';
import test from 'node:test';

import { AdminSponsorshipAccessController } from '../dist/apps/funding-web/src/app/features/funding/components/admin-sponsors/admin-sponsorship-access-controller.js';
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

function fixture() {
  const state = {
    id: 'synthetic-sponsor-a',
    token: 'synthetic-token',
    disabled: false,
    allowed: true,
    destroyed: false,
    language: 'fr-CA'
  };
  const reads = [];
  const confirmations = [];
  const requests = [];
  const events = [];
  let requestIds = 0;
  let controller;
  const ports = {
    contributionId: () => state.id,
    token: () => state.token,
    disabled: () => state.disabled,
    allowed: () => state.allowed,
    isDestroyed: () => state.destroyed,
    language: () => state.language,
    newRequestId: () => `synthetic-request-${++requestIds}`,
    async getSponsorshipAccessRecipient(token, contributionId) {
      reads.push({ token, contributionId });
      return { recipient: 'contact@example.test' };
    },
    async confirm(recipient) {
      confirmations.push(recipient);
      return true;
    },
    async resendSponsorshipAccess(token, request) {
      requests.push({ token, request });
      return { status: 'queued' };
    },
    queued: () => events.push(controller.state())
  };
  controller = new AdminSponsorshipAccessController(ports);
  controller.targetChanged();
  return {
    controller,
    ports,
    state,
    reads,
    confirmations,
    requests,
    events,
    requestIds: () => requestIds,
    changeTarget() {
      state.id = 'synthetic-sponsor-b';
      controller.targetChanged();
    }
  };
}

for (const language of ['fr-CA', 'en'])
  test(`access resend ${language} loads the protected recipient before confirming, then emits the server status`, async () => {
    const f = fixture();
    f.state.language = language;
    f.ports.confirm = async (recipient) => {
      assert.deepEqual(f.reads, [
        { token: 'synthetic-token', contributionId: 'synthetic-sponsor-a' }
      ]);
      assert.equal(f.requests.length, 0);
      assert.equal(f.requestIds(), 0);
      f.confirmations.push(recipient);
      return true;
    };
    await f.controller.resend();
    assert.deepEqual(f.confirmations, ['contact@example.test']);
    assert.deepEqual(f.requests, [
      {
        token: 'synthetic-token',
        request: {
          contributionId: 'synthetic-sponsor-a',
          recipient: 'contact@example.test',
          confirmed: true,
          requestId: 'synthetic-request-1',
          locale: language
        }
      }
    ]);
    assert.equal(f.controller.busy(), false);
    assert.equal(f.controller.state(), 'queued');
    assert.deepEqual(f.events, ['queued']);
  });

for (const condition of ['disabled', 'not-allowed', 'destroyed'])
  test(`${condition} prevents recipient reads, confirmations and access requests`, async () => {
    const f = fixture();
    if (condition === 'not-allowed') f.state.allowed = false;
    else f.state[condition] = true;
    await f.controller.resend();
    assert.deepEqual(f.reads, []);
    assert.deepEqual(f.confirmations, []);
    assert.deepEqual(f.requests, []);
    assert.equal(f.controller.busy(), false);
  });

test('missing recipient and cancelled confirmation create no request and can recover', async () => {
  const f = fixture();
  const getRecipient = f.ports.getSponsorshipAccessRecipient;
  f.ports.getSponsorshipAccessRecipient = async () => ({ recipient: null });
  await f.controller.resend();
  assert.equal(f.controller.state(), 'missing');
  assert.deepEqual(f.confirmations, []);
  f.ports.getSponsorshipAccessRecipient = getRecipient;
  f.ports.confirm = async () => false;
  await f.controller.resend();
  assert.equal(f.controller.state(), 'idle');
  assert.deepEqual(f.requests, []);
  assert.equal(f.requestIds(), 0);
  assert.equal(f.controller.busy(), false);
  f.ports.confirm = async () => true;
  await f.controller.resend();
  assert.equal(f.controller.state(), 'queued');
});

test('double submission is blocked throughout recipient loading, confirmation and sending', async () => {
  const f = fixture();
  const recipient = deferred();
  const confirmation = deferred();
  const mutation = deferred();
  f.ports.getSponsorshipAccessRecipient = (token, contributionId) => {
    f.reads.push({ token, contributionId });
    return recipient.promise;
  };
  f.ports.confirm = (value) => {
    f.confirmations.push(value);
    return confirmation.promise;
  };
  f.ports.resendSponsorshipAccess = (token, request) => {
    f.requests.push({ token, request });
    return mutation.promise;
  };
  const resend = f.controller.resend();
  await f.controller.resend();
  assert.equal(f.reads.length, 1);
  recipient.resolve({ recipient: 'contact@example.test' });
  await Promise.resolve();
  await f.controller.resend();
  assert.equal(f.confirmations.length, 1);
  confirmation.resolve(true);
  await Promise.resolve();
  await f.controller.resend();
  assert.equal(f.requests.length, 1);
  assert.equal(f.controller.state(), 'idle');
  assert.deepEqual(f.events, []);
  mutation.resolve({ status: 'queued' });
  await resend;
  assert.deepEqual(f.events, ['queued']);
});

test('an uncertain failure retains its UUID; an identical retry reuses the exact payload and success releases it', async () => {
  const f = fixture();
  f.ports.resendSponsorshipAccess = async (token, request) => {
    f.requests.push({ token, request });
    throw new Error('Synthetic lost response');
  };
  await f.controller.resend();
  assert.equal(f.controller.state(), 'error');
  assert.equal(f.controller.busy(), false);
  assert.deepEqual(f.events, []);
  f.ports.resendSponsorshipAccess = async (token, request) => {
    f.requests.push({ token, request });
    return { status: 'already_queued' };
  };
  await f.controller.resend();
  assert.deepEqual(f.requests[1], f.requests[0]);
  assert.equal(f.requestIds(), 1);
  assert.equal(f.reads.length, 2);
  assert.equal(f.confirmations.length, 2);
  assert.deepEqual(f.events, ['already_queued']);
  await f.controller.resend();
  assert.equal(f.requests[2].request.requestId, 'synthetic-request-2');
});

test('changing dossiers invalidates an uncertain request and clears its feedback', async () => {
  const f = fixture();
  f.ports.resendSponsorshipAccess = async (token, request) => {
    f.requests.push({ token, request });
    throw new Error('Synthetic failure');
  };
  await f.controller.resend();
  f.changeTarget();
  assert.equal(f.controller.state(), 'idle');
  assert.equal(f.controller.busy(), false);
  await f.controller.resend();
  assert.equal(f.requests[1].request.contributionId, 'synthetic-sponsor-b');
  assert.equal(f.requests[1].request.requestId, 'synthetic-request-2');
});

for (const status of [
  'queued',
  'already_queued',
  'already_sent',
  'delivery_failed'
])
  test(`server result ${status} is preserved without inventing a delivery success`, async () => {
    const f = fixture();
    f.ports.resendSponsorshipAccess = async () => ({ status });
    await f.controller.resend();
    assert.equal(f.controller.state(), status);
    assert.deepEqual(f.events, [status]);
  });

for (const stage of ['recipient', 'sending'])
  for (const status of [401, 403, 404, 503])
    test(`${stage} failure ${status} preserves the existing access error category and emits no success`, async () => {
      const f = fixture();
      const method =
        stage === 'recipient'
          ? 'getSponsorshipAccessRecipient'
          : 'resendSponsorshipAccess';
      f.ports[method] = async () => {
        throw new AdminDashboardRequestError(status);
      };
      await f.controller.resend();
      assert.equal(
        f.controller.state(),
        status === 401 || status === 403 ? 'unauthorized' : 'error'
      );
      assert.equal(f.controller.busy(), false);
      assert.deepEqual(f.events, []);
    });

for (const stage of ['recipient', 'confirmation', 'sending'])
  for (const failure of [false, true])
    test(`late ${stage} ${failure ? 'failure' : 'success'} does not affect the next dossier`, async () => {
      const f = fixture();
      const pending = deferred();
      const method = {
        recipient: 'getSponsorshipAccessRecipient',
        confirmation: 'confirm',
        sending: 'resendSponsorshipAccess'
      }[stage];
      f.ports[method] = () => pending.promise;
      const resend = f.controller.resend();
      await Promise.resolve();
      await Promise.resolve();
      f.changeTarget();
      failure
        ? pending.reject(new AdminDashboardRequestError(401))
        : pending.resolve(
            {
              recipient: { recipient: 'contact@example.test' },
              confirmation: true,
              sending: { status: 'queued' }
            }[stage]
          );
      await resend;
      assert.equal(f.controller.state(), 'idle');
      assert.equal(f.controller.busy(), false);
      assert.deepEqual(f.events, []);
      if (stage !== 'sending') assert.deepEqual(f.requests, []);
    });

test('loss of owner rights during confirmation prevents the resend', async () => {
  const f = fixture();
  const confirmation = deferred();
  f.ports.confirm = () => confirmation.promise;
  const resend = f.controller.resend();
  await Promise.resolve();
  f.state.allowed = false;
  confirmation.resolve(true);
  await resend;
  assert.deepEqual(f.requests, []);
  assert.deepEqual(f.events, []);
});

test('destruction ignores late recipient data and never opens confirmation', async () => {
  const f = fixture();
  const recipient = deferred();
  f.ports.getSponsorshipAccessRecipient = () => recipient.promise;
  const resend = f.controller.resend();
  f.state.destroyed = true;
  recipient.resolve({ recipient: 'contact@example.test' });
  await resend;
  assert.deepEqual(f.confirmations, []);
  assert.deepEqual(f.requests, []);
  assert.deepEqual(f.events, []);
});
