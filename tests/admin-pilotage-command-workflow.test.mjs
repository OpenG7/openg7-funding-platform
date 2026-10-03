import assert from 'node:assert/strict';
import test from 'node:test';
import { signal } from '@angular/core';

import { AdminPilotageCommandWorkflow } from '../dist/apps/funding-web/src/app/features/funding/pages/admin-pilotage-page/admin-pilotage-command-workflow.js';

const requestId = '00000000-0000-4000-8000-000000000001';
const draft = {
  action: 'publication.approve',
  targetId: 'synthetic-publication',
  version: 'synthetic-version-2',
  payload: {
    approveSponsors: [{ id: 'synthetic-sponsor', version: 'sponsor-v3' }]
  }
};
const receipt = (status = 'completed', overrides = {}) => ({
  requestId,
  action: draft.action,
  targetId: draft.targetId,
  status,
  code: null,
  ...overrides
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

const fixture = () => {
  const state = {
    busy: signal(false),
    error: signal('prior-error'),
    receipt: signal(null),
    unresolved: signal('')
  };
  const page = {
    actor: 'synthetic-operator',
    panel: 'confirm',
    pending: draft,
    writable: true,
    confirmed: 0
  };
  const calls = {
    commands: [],
    recoveries: [],
    acknowledgements: [],
    uuids: 0,
    resets: 0,
    refreshes: 0,
    order: []
  };
  const storage = new Map();
  const removed = [];
  const ports = {
    state,
    actorId: () => page.actor,
    storage: () => ({
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => {
        removed.push(key);
        storage.delete(key);
      }
    }),
    requestId: () => {
      calls.uuids++;
      return requestId;
    },
    resetInput: () => calls.resets++,
    settleCommand: () => {
      page.panel = '';
      page.pending = null;
    },
    closeIncident: () => {
      page.panel = '';
    },
    confirmed: () => {
      page.confirmed++;
      calls.order.push('confirmed');
    },
    denyWrites: () => {
      page.writable = false;
    },
    refresh: async () => {
      calls.refreshes++;
      calls.order.push('refresh');
      state.error.set('');
    },
    admin: {
      pilotageCommand: async (command) => {
        calls.commands.push(command);
        return receipt();
      },
      pilotageReceipt: async (id) => {
        calls.recoveries.push(id);
        return receipt();
      },
      acknowledgePilotReceipt: async (id, reason) => {
        calls.acknowledgements.push({ id, reason });
        return receipt('uncertain', {
          reviewedAt: '2026-10-03T12:00:00.000Z'
        });
      }
    }
  };
  return {
    workflow: new AdminPilotageCommandWorkflow(ports),
    ports,
    state,
    page,
    calls,
    storage,
    removed
  };
};

test('command keeps target, version, UUID and explicit confirmation while dropping presentation metadata', async () => {
  const f = fixture();
  await f.workflow.send({
    ...draft,
    title: 'Synthetic panel heading',
    confirmation: 'untrusted-other-target',
    requestId: 'untrusted-other-request'
  });

  assert.deepEqual(f.calls.commands, [
    { ...draft, requestId, confirmation: draft.targetId }
  ]);
  assert.equal(f.calls.uuids, 1);
  assert.equal(f.page.confirmed, 1);
  assert.deepEqual(f.calls.order, ['confirmed', 'refresh']);
  assert.equal(f.state.receipt().status, 'completed');
  assert.equal(f.state.unresolved(), '');
  assert.equal(f.state.busy(), false);
  assert.equal(f.page.panel, '');
  assert.equal(f.page.pending, null);
  assert.equal(f.calls.resets, 2);
});

test('delayed server confirmation blocks repeated commands and recovery and counts only the receipt', async () => {
  const f = fixture();
  const response = deferred();
  f.ports.admin.pilotageCommand = (command) => {
    f.calls.commands.push(command);
    return response.promise;
  };
  const sending = f.workflow.send(draft);

  assert.equal(f.state.busy(), true);
  assert.equal(f.state.unresolved(), requestId);
  assert.equal(f.state.error(), '');
  assert.equal(
    f.storage.get('og7-pilot-receipt:synthetic-operator'),
    requestId
  );
  assert.equal(f.page.confirmed, 0);
  await f.workflow.send(draft);
  await f.workflow.recover();
  await f.workflow.acknowledgeIncident('Synthetic investigation completed');
  assert.equal(f.calls.commands.length, 1);
  assert.equal(f.calls.uuids, 1);
  assert.equal(f.calls.recoveries.length, 0);
  assert.equal(f.calls.acknowledgements.length, 0);

  response.resolve(receipt());
  await sending;
  assert.equal(f.page.confirmed, 1);
  assert.equal(f.storage.size, 0);
});

test('confirmed receipt counts once while asynchronous refresh keeps commands and panel coordination locked', async () => {
  const f = fixture();
  const refreshed = deferred();
  f.ports.refresh = () => {
    f.calls.refreshes++;
    return refreshed.promise;
  };
  const sending = f.workflow.send(draft);
  await Promise.resolve();

  assert.equal(f.state.receipt().status, 'completed');
  assert.equal(f.page.confirmed, 1);
  assert.equal(f.state.unresolved(), '');
  assert.equal(f.state.busy(), true);
  assert.equal(f.page.panel, 'confirm');
  await f.workflow.send(draft);
  await f.workflow.recover();
  assert.equal(f.calls.commands.length, 1);
  assert.equal(f.calls.uuids, 1);
  assert.equal(f.page.confirmed, 1);

  refreshed.resolve();
  await sending;
  assert.equal(f.state.busy(), false);
  assert.equal(f.page.panel, '');
  assert.equal(f.page.pending, null);
  assert.equal(f.page.confirmed, 1);
});

for (const status of ['executing', 'uncertain']) {
  test(`${status} receipt retains recovery identifier and never counts a confirmed decision`, async () => {
    const f = fixture();
    f.ports.admin.pilotageCommand = async () => receipt(status);
    await f.workflow.send(draft);

    assert.equal(f.state.receipt().status, status);
    assert.equal(f.state.unresolved(), requestId);
    assert.equal(f.page.confirmed, 0);
    assert.equal(f.calls.refreshes, 0);
    assert.equal(f.state.busy(), false);
    await f.workflow.send(draft);
    assert.equal(f.calls.uuids, 1);
  });
}

test('lost command response is recovered by receipt lookup without sending the command again', async () => {
  const f = fixture();
  f.ports.admin.pilotageCommand = async (command) => {
    f.calls.commands.push(command);
    throw new Error('RESULT_UNKNOWN');
  };
  await f.workflow.send(draft);
  assert.equal(f.state.unresolved(), requestId);
  assert.equal(f.state.error(), 'RESULT_UNKNOWN');
  assert.equal(f.page.confirmed, 0);

  await f.workflow.recover();
  assert.deepEqual(f.calls.recoveries, [requestId]);
  assert.equal(f.calls.commands.length, 1);
  assert.equal(f.calls.uuids, 1);
  assert.equal(f.page.confirmed, 1);
  assert.equal(f.state.receipt().status, 'completed');
  assert.equal(f.state.unresolved(), '');
  await f.workflow.recover();
  assert.equal(f.calls.recoveries.length, 1);
  assert.equal(f.page.confirmed, 1);
});

test('receipt restored after reload is selected through lookup while its result survives refresh', async () => {
  const f = fixture();
  f.state.unresolved.set(requestId);
  await f.workflow.recover();

  assert.deepEqual(f.calls.recoveries, [requestId]);
  assert.equal(f.calls.commands.length, 0);
  assert.equal(f.calls.uuids, 0);
  assert.equal(f.state.receipt().status, 'completed');
  assert.equal(f.calls.refreshes, 1);
  assert.equal(f.page.confirmed, 1);
  assert.equal(f.page.panel, 'confirm');
});

for (const code of ['VERSION_CONFLICT', null]) {
  test(`failed receipt retains ${code ?? 'generic'} explanation after server refresh`, async () => {
    const f = fixture();
    f.state.unresolved.set(requestId);
    f.ports.admin.pilotageReceipt = async () => receipt('failed', { code });
    await f.workflow.recover();

    assert.equal(f.state.receipt().status, 'failed');
    assert.equal(f.state.unresolved(), '');
    assert.equal(f.state.error(), code ?? 'generic');
    assert.equal(f.page.confirmed, 0);
    assert.equal(f.calls.refreshes, 1);
  });
}

test('failed recovery preserves the identifier, releases inputs and reports an unknown result', async () => {
  const f = fixture();
  f.state.unresolved.set(requestId);
  f.ports.admin.pilotageReceipt = async () => {
    throw new Error('PILOTAGE_UNAVAILABLE');
  };
  await f.workflow.recover();

  assert.equal(f.state.unresolved(), requestId);
  assert.equal(f.state.error(), 'RESULT_UNKNOWN');
  assert.equal(f.state.busy(), false);
  assert.equal(f.calls.resets, 2);
  assert.equal(f.page.confirmed, 0);
  assert.equal(f.calls.commands.length, 0);
});

test('incident review requires the uncertain receipt and a substantive reason without replay', async () => {
  const f = fixture();
  f.page.panel = 'incident';
  f.state.unresolved.set(requestId);
  f.state.receipt.set(receipt('executing'));
  await f.workflow.acknowledgeIncident('Synthetic investigation completed');
  f.state.receipt.set(receipt('uncertain'));
  await f.workflow.acknowledgeIncident('  short  ');
  assert.equal(f.calls.acknowledgements.length, 0);

  const reason = '  Synthetic investigation completed  ';
  await f.workflow.acknowledgeIncident(reason);
  assert.deepEqual(f.calls.acknowledgements, [{ id: requestId, reason }]);
  assert.equal(f.state.receipt().status, 'uncertain');
  assert.ok(f.state.receipt().reviewedAt);
  assert.equal(f.state.unresolved(), '');
  assert.equal(f.state.error(), '');
  assert.equal(f.page.confirmed, 0);
  assert.equal(f.calls.refreshes, 1);
  assert.equal(f.page.panel, '');
  assert.equal(f.calls.commands.length, 0);
  assert.equal(f.calls.uuids, 0);
});

test('failed incident acknowledgement preserves the uncertain receipt and its open panel', async () => {
  const f = fixture();
  f.page.panel = 'incident';
  f.state.unresolved.set(requestId);
  f.state.receipt.set(receipt('uncertain'));
  f.ports.admin.acknowledgePilotReceipt = async () => {
    throw new Error('AUDIT_UNAVAILABLE');
  };
  await f.workflow.acknowledgeIncident('Synthetic investigation completed');

  assert.equal(f.state.unresolved(), requestId);
  assert.equal(f.state.receipt().status, 'uncertain');
  assert.equal(f.state.error(), 'AUDIT_UNAVAILABLE');
  assert.equal(f.state.busy(), false);
  assert.equal(f.page.panel, 'incident');
  assert.equal(f.page.confirmed, 0);
  assert.equal(f.calls.resets, 2);
});

for (const status of [400, 401, 403, 409, 500]) {
  test(`HTTP ${status} command failure preserves the appropriate retry and write authority`, async () => {
    const f = fixture();
    f.ports.admin.pilotageCommand = async () => {
      throw Object.assign(new Error('SYNTHETIC_FAILURE'), { status });
    };
    await f.workflow.send(draft);

    const definitive = status !== 500;
    assert.equal(f.state.unresolved(), definitive ? '' : requestId);
    assert.equal(f.storage.size, definitive ? 0 : 1);
    assert.equal(f.page.writable, status !== 401 && status !== 403);
    assert.equal(f.state.error(), 'SYNTHETIC_FAILURE');
    assert.equal(f.state.busy(), false);
    assert.equal(f.page.confirmed, 0);
    assert.equal(f.page.panel, '');
    assert.equal(f.page.pending, null);
  });
}

test('session expiry removes the original actor receipt key even when the client clears identity', async () => {
  const f = fixture();
  f.storage.set('og7-pilot-receipt:token', 'unrelated-token-receipt');
  f.ports.admin.pilotageCommand = async () => {
    f.page.actor = 'token';
    throw Object.assign(new Error('SESSION_EXPIRED'), { status: 401 });
  };
  await f.workflow.send(draft);

  assert.deepEqual(f.removed, ['og7-pilot-receipt:synthetic-operator']);
  assert.equal(
    f.storage.get('og7-pilot-receipt:token'),
    'unrelated-token-receipt'
  );
  assert.equal(f.page.writable, false);
});

test('recovery clears only the actor key captured before the pending response', async () => {
  const f = fixture();
  f.state.unresolved.set(requestId);
  f.storage.set('og7-pilot-receipt:synthetic-operator', requestId);
  f.storage.set('og7-pilot-receipt:other-operator', 'other-receipt');
  const response = deferred();
  f.ports.admin.pilotageReceipt = () => response.promise;
  const recovery = f.workflow.recover();
  f.page.actor = 'other-operator';
  response.resolve(receipt());
  await recovery;

  assert.deepEqual(f.removed, ['og7-pilot-receipt:synthetic-operator']);
  assert.equal(
    f.storage.get('og7-pilot-receipt:other-operator'),
    'other-receipt'
  );
  assert.equal(f.calls.commands.length, 0);
});

test('blocked session storage retains the identifier in memory until receipt recovery', async () => {
  const f = fixture();
  f.ports.storage = () => {
    throw new Error('Synthetic storage access denied');
  };
  f.ports.admin.pilotageCommand = async () => {
    throw new Error('RESULT_UNKNOWN');
  };
  await f.workflow.send(draft);
  assert.equal(f.state.unresolved(), requestId);
  await f.workflow.recover();

  assert.equal(f.state.unresolved(), '');
  assert.equal(f.state.receipt().status, 'completed');
  assert.equal(f.page.confirmed, 1);
  assert.equal(f.state.busy(), false);
});

test('workflow construction and idle recovery do not access browser storage or crypto during SSR', async () => {
  const f = fixture();
  f.ports.storage = () => {
    throw new Error('Browser storage must remain lazy');
  };
  f.ports.requestId = () => {
    throw new Error('Browser crypto must remain lazy');
  };
  const workflow = new AdminPilotageCommandWorkflow(f.ports);
  await workflow.recover();
  await workflow.acknowledgeIncident('Synthetic investigation completed');

  assert.equal(f.calls.commands.length, 0);
  assert.equal(f.calls.recoveries.length, 0);
  assert.equal(f.calls.acknowledgements.length, 0);
});
