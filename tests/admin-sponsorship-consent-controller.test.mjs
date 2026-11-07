import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const hook = registerHooks({
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
const {
  AdminSponsorshipConsentController,
  consentAgreementDateIsValid,
  consentBusinessDate
} =
  await import('../dist/apps/funding-web/src/app/features/funding/services/admin-sponsorship-consent-controller.js');
const { FundingAdminSponsorshipConsentClient } =
  await import('../dist/apps/funding-web/src/app/features/funding/services/funding-admin-sponsorship-consent.client.js');
const { AdminDashboardRequestError } =
  await import('../dist/apps/funding-web/src/app/features/funding/services/funding-admin-session.js');
hook.deregister();

const contributionId = '10000000-0000-4000-8000-000000000001';
const otherId = '10000000-0000-4000-8000-000000000002';
const actor = 'admin:synthetic-operator';
const intent = {
  agreementReceived: true,
  agreedOn: '2025-02-28',
  evidenceReference: 'Synthetic private agreement reference'
};
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function summary(overrides = {}) {
  return {
    contributionId,
    version: 'opaque-v1',
    effectiveConsent: false,
    source: 'none',
    scope: 'public_profile_name_and_presentation',
    canRecord: true,
    recordBlockers: [],
    recordingActor: actor,
    history: [],
    ...overrides
  };
}
function recorded(request, overrides = {}) {
  return {
    requestId: request.requestId,
    contributionId: request.contributionId,
    recordId: 'synthetic-record',
    outcome: 'recorded',
    version: 'opaque-v2',
    effectiveConsent: true,
    publicVisibilityHeld: true,
    invalidatedDeliveryCount: 2,
    recordedAt: '2026-11-04T14:00:00Z',
    actor,
    ...overrides
  };
}
function fixture(storage = new Map()) {
  const calls = [];
  const state = {
    summary: summary(),
    confirm: true,
    recordError: null,
    receipt: null,
    refreshError: null
  };
  const ports = {
    client: {
      read: async (id) => {
        calls.push(['read', id]);
        return state.summary;
      },
      record: async (request) => {
        calls.push(['record', request]);
        if (state.recordError) throw state.recordError;
        return recorded(request);
      },
      receipt: async (id, requestId) => {
        calls.push(['receipt', id, requestId]);
        return (
          state.receipt ?? {
            state: 'recorded',
            receipt: recorded({ contributionId: id, requestId })
          }
        );
      }
    },
    permitted: () => true,
    confirm: async () => {
      calls.push(['confirm']);
      return state.confirm;
    },
    refreshPreparation: async () => {
      calls.push(['refresh']);
      if (state.refreshError) throw state.refreshError;
      state.summary = summary({
        effectiveConsent: true,
        canRecord: false,
        source: 'documented_agreement',
        version: 'opaque-v2',
        recordBlockers: ['already_granted']
      });
    },
    accessLost: (status) => calls.push(['accessLost', status]),
    storage: () => ({
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key)
    })
  };
  const controller = new AdminSponsorshipConsentController(ports);
  controller.setScope(contributionId, 'synthetic-session');
  return { controller, calls, state, ports, storage };
}

test('documented consent validates civil calendar dates in Toronto without inventing an instant', () => {
  assert.equal(
    consentBusinessDate(new Date('2026-11-07T02:30:00Z')),
    '2026-11-06'
  );
  for (const value of [
    '2025-02-29',
    '2024-02-30',
    '0000-01-01',
    '2026-13-01',
    '2026-11-08',
    '2026-11-07T00:00:00Z'
  ])
    assert.equal(
      consentAgreementDateIsValid(value, '2026-11-07'),
      false,
      value
    );
  assert.equal(consentAgreementDateIsValid('2024-02-29', '2026-11-07'), true);
});

test('consent needs a recorded source, actual agreement, date, evidence and explicit confirmation', async () => {
  const f = fixture();
  await f.controller.record(intent);
  await f.controller.read();
  await f.controller.record({ ...intent, agreementReceived: false });
  await f.controller.record({ ...intent, agreedOn: '2099-01-01' });
  await f.controller.record({ ...intent, evidenceReference: '   ' });
  f.state.confirm = false;
  await f.controller.record(intent);
  assert.equal(f.calls.filter(([type]) => type === 'record').length, 0);
  assert.equal(f.storage.size, 0);
});

test('double activation records once and verifies exact receipt before refreshing preparation', async () => {
  const f = fixture(),
    gate = deferred();
  f.ports.confirm = () => gate.promise;
  await f.controller.read();
  const command = f.controller.record(intent);
  await f.controller.record(intent);
  assert.equal(f.controller.busy(), true);
  assert.equal(f.calls.filter(([type]) => type === 'record').length, 0);
  gate.resolve(true);
  await command;
  assert.deepEqual(
    f.calls.map(([type]) => type),
    ['read', 'record', 'receipt', 'refresh', 'read']
  );
  const request = f.calls.find(([type]) => type === 'record')[1];
  assert.equal(request.expectedVersion, 'opaque-v1');
  assert.equal(request.scope, 'public_profile_name_and_presentation');
  assert.equal(request.confirmed, true);
  assert.equal(f.controller.result().actor, actor);
  assert.equal(f.controller.notice(), 'recorded');
  assert.equal(f.storage.size, 0);
});

test('503 after application retains only references and reconciles without replaying POST', async () => {
  const f = fixture();
  await f.controller.read();
  f.state.recordError = new AdminDashboardRequestError(503);
  await f.controller.record(intent);
  assert.equal(f.controller.uncertain(), true);
  assert.deepEqual(
    f.calls.map(([type]) => type),
    ['read', 'confirm', 'record']
  );
  const persisted = [...f.storage.values()][0];
  assert.deepEqual(Object.keys(JSON.parse(persisted)).sort(), [
    'actor',
    'contributionId',
    'requestId'
  ]);
  assert.equal(persisted.includes(intent.evidenceReference), false);
  await f.controller.reconcile();
  assert.equal(f.calls.filter(([type]) => type === 'record').length, 1);
  assert.equal(f.controller.result().outcome, 'recorded');
});

test('not-found reconciliation permits only an explicit retry of the same in-memory command', async () => {
  const f = fixture();
  await f.controller.read();
  f.state.recordError = new AdminDashboardRequestError(503);
  await f.controller.record(intent);
  await f.controller.retry();
  assert.equal(f.calls.filter(([type]) => type === 'record').length, 1);
  f.state.receipt = { state: 'not_found' };
  await f.controller.reconcile();
  assert.equal(f.controller.retryAllowed(), true);
  f.state.recordError = null;
  f.state.receipt = null;
  await f.controller.retry();
  const commands = f.calls.filter(([type]) => type === 'record');
  assert.equal(commands.length, 2);
  assert.deepEqual(commands[0][1], commands[1][1]);
  assert.equal(f.calls.filter(([type]) => type === 'confirm').length, 2);
});

test('reload keeps an unresolved reference read-only even when the receipt is not found', async () => {
  const before = fixture();
  await before.controller.read();
  before.state.recordError = new AdminDashboardRequestError(503);
  await before.controller.record(intent);
  const after = fixture(before.storage);
  after.state.receipt = { state: 'not_found' };
  await after.controller.read();
  assert.equal(after.controller.uncertain(), true);
  await after.controller.reconcile();
  await after.controller.read(true);
  await after.controller.retry();
  await after.controller.record(intent);
  assert.equal(after.controller.uncertain(), true);
  assert.equal(after.controller.retryAllowed(), false);
  assert.equal(after.storage.size, 1);
  assert.equal(
    after.calls.some(([type]) => type === 'record'),
    false
  );
});

test('conflict requires explicit refresh and another confirmed new version', async () => {
  const f = fixture();
  await f.controller.read();
  f.state.recordError = new AdminDashboardRequestError(409);
  await f.controller.record(intent);
  assert.equal(f.controller.needsRefresh(), true);
  assert.equal(f.calls.filter(([type]) => type === 'read').length, 1);
  await f.controller.record(intent);
  assert.equal(f.calls.filter(([type]) => type === 'record').length, 1);
  f.state.summary = summary({ version: 'opaque-conflict-v2' });
  f.state.recordError = null;
  await f.controller.read(true);
  await f.controller.record(intent);
  const commands = f.calls.filter(([type]) => type === 'record');
  assert.equal(commands.length, 2);
  assert.equal(commands[1][1].expectedVersion, 'opaque-conflict-v2');
  assert.notEqual(commands[1][1].requestId, commands[0][1].requestId);
});

test('a receipt for another actor or acknowledged record cannot imply success', async () => {
  for (const mismatch of [
    { actor: 'admin:another-synthetic-actor' },
    { recordId: 'different-record' }
  ]) {
    const f = fixture();
    await f.controller.read();
    f.ports.client.receipt = async (id, requestId) => ({
      state: 'recorded',
      receipt: recorded({ contributionId: id, requestId }, mismatch)
    });
    await f.controller.record(intent);
    assert.equal(f.controller.result(), null);
    assert.equal(f.controller.uncertain(), true);
    assert.equal(f.controller.notice(), 'receiptMismatch');
    assert.equal(
      f.calls.some(([type]) => type === 'refresh'),
      false
    );
  }
});

test('late private reads and commands cannot replace a newly selected dossier or actor', async () => {
  for (const phase of ['read', 'record']) {
    const f = fixture(),
      gate = deferred();
    let pending;
    if (phase === 'read') {
      f.ports.client.read = () => gate.promise;
      pending = f.controller.read();
    } else {
      await f.controller.read();
      f.ports.client.record = () => gate.promise;
      pending = f.controller.record(intent);
      await Promise.resolve();
    }
    f.controller.setScope(otherId, 'another-session');
    gate.resolve(
      phase === 'read'
        ? summary()
        : recorded({ contributionId, requestId: 'synthetic' })
    );
    await pending;
    assert.equal(f.controller.summary(), null);
    assert.equal(f.controller.result(), null);
    assert.equal(f.controller.busy(), false);
    assert.equal(
      f.calls.some(([type]) => type === 'refresh'),
      false
    );
  }
});

for (const status of [401, 403])
  test(`consent ${status} purges private evidence, result and pending references`, async () => {
    const f = fixture();
    await f.controller.read();
    f.state.recordError = new AdminDashboardRequestError(status);
    await f.controller.record(intent);
    assert.equal(f.controller.summary(), null);
    assert.equal(f.controller.result(), null);
    assert.equal(f.storage.size, 0);
    assert.equal(f.controller.busy(), false);
    assert.ok(
      f.calls.some(([type, value]) => type === 'accessLost' && value === status)
    );
  });

test('a verified consent remains distinct from an unavailable preparation refresh', async () => {
  const f = fixture();
  await f.controller.read();
  f.state.refreshError = new Error('synthetic-unavailable');
  await f.controller.record(intent);
  assert.equal(f.controller.result().outcome, 'recorded');
  assert.equal(f.controller.notice(), 'refreshRequired');
  assert.equal(f.controller.canRecord(), false);
});

test('consent transport rejects a private body parsed after identity changes without clearing the new session', async () => {
  const gate = deferred();
  let identity = { id: 'synthetic-a', sessionId: 'session-a', role: 'owner' },
    clears = 0;
  const session = {
    identity: () => identity,
    sessionGeneration: () => 0,
    requestAdminJson: async () => ({
      ok: true,
      status: 200,
      json: () => gate.promise
    })
  };
  const client = new FundingAdminSponsorshipConsentClient(
    session,
    () => clears++
  );
  const read = client.read(contributionId);
  await Promise.resolve();
  identity = { id: 'synthetic-b', sessionId: 'session-b', role: 'owner' };
  gate.resolve(summary());
  await assert.rejects(
    read,
    (error) => error.status === 401 && error.code === 'SESSION_CHANGED'
  );
  assert.equal(clears, 0);
});

test('consent transport rejects mismatched contribution and never automatically retries a command', async () => {
  let calls = 0;
  const session = {
    identity: () => ({
      id: actor,
      sessionId: 'synthetic-session',
      role: 'owner'
    }),
    sessionGeneration: () => 0,
    requestAdminJson: async () => {
      calls++;
      return {
        ok: true,
        status: 200,
        json: async () => summary({ contributionId: otherId })
      };
    }
  };
  const client = new FundingAdminSponsorshipConsentClient(session, () => {});
  await assert.rejects(
    client.read(contributionId),
    (error) => error.status === 502
  );
  assert.equal(calls, 1);
});
