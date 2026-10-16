import assert from 'node:assert/strict';
import test from 'node:test';

import { AdminAutomaticPortfolioRun } from '../dist/apps/funding-web/src/app/features/funding/components/admin-automatic/admin-automatic-portfolio-run.js';

const runId = '10000000-0000-4000-8000-000000000901';
const payment = '10000000-0000-4000-8000-000000000902';
const now = '2026-10-15T12:00:00Z';

function entry(seq, balanceStatus = 'action_required') {
  return {
    seq,
    runId,
    pass: 1,
    contributionId: payment,
    reference: `DEMO-${seq}`,
    balanceStatus,
    reasonCodes: ['publication_pending'],
    actions: [],
    beforeBalance: null,
    balance: {
      contributionId: payment,
      reference: `DEMO-${seq}`,
      contributionType: 'sponsorship_interest',
      amountMinor: 5000,
      currency: 'CAD',
      paymentStatus: 'paid',
      version: 'observed-version',
      status: balanceStatus,
      expected: 1,
      fulfilled: balanceStatus === 'balanced' ? 1 : 0,
      waived: 0,
      outstanding: balanceStatus === 'balanced' ? 0 : 1,
      unknown: 0,
      reasons: ['publication_pending'],
      promisedBenefits: [],
      obligations: [],
      next: null
    },
    createdAt: now,
    actor: 'synthetic-operator',
    requestId: `synthetic-request-${seq}`,
    auditReference: `synthetic-audit-${seq}`
  };
}

function state(processed = 0, status = 'running', latestEntry = null) {
  return {
    run: {
      id: runId,
      version: processed + 1,
      status,
      startedAt: now,
      updatedAt: now,
      observedAt: processed ? now : null,
      pass: 1,
      cursor: processed,
      dossierCount: 3,
      processedCount: processed,
      balancedCount: 0,
      outstandingCount: processed,
      unknownCount: 0,
      uncoveredCount: 3 - processed,
      newPaymentCount: 0,
      currencyTotals: [{ currency: 'CAD', amountMinor: 15000 }],
      latestEntry,
      nextContributionId: status === 'completed' ? null : payment,
      globalBalanced: false
    },
    balance: latestEntry?.balance ?? null
  };
}

function gate() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function fixture() {
  const f = {
    state: state(),
    calls: [],
    entries: [],
    snapshot: null,
    current: true,
    barrier: false,
    advanceGate: null,
    explainGate: null,
    advanceError: null,
    reportCursor: null,
    reportTail: []
  };
  const ports = {
    read: async (id) => {
      f.calls.push(['read', id]);
      return f.state;
    },
    start: async () => {
      f.calls.push(['start']);
      return f.state;
    },
    advance: async (run) => {
      f.calls.push(['advance', run.version]);
      if (f.advanceGate) await f.advanceGate.promise;
      if (f.advanceError) throw f.advanceError;
      const next = entry(
        run.processedCount + 1,
        run.processedCount === 1 ? 'waiting' : 'action_required'
      );
      f.entries.push(next);
      f.state = state(
        run.processedCount + 1,
        run.processedCount === 2 ? 'completed' : 'running',
        next
      );
      return f.state;
    },
    control: async (run, action) => {
      f.calls.push(['control', action, run.version]);
      f.state = {
        ...f.state,
        run: {
          ...f.state.run,
          version: run.version + 1,
          status: ['pause', 'reconcile'].includes(action)
            ? 'paused'
            : 'running',
          ...(action === 'recheck'
            ? { pass: run.pass + 1, cursor: 0, processedCount: 0 }
            : {})
        }
      };
      return f.state;
    },
    report: async (id, after) => {
      f.calls.push(['report', id, after]);
      return {
        entries: after ? f.reportTail : [...f.entries],
        nextCursor: after ? null : f.reportCursor
      };
    },
    current: () => f.current,
    canContinue: () => f.current && !f.barrier,
    explain: async () => {
      f.calls.push(['explain']);
      if (f.explainGate) await f.explainGate.promise;
    },
    changed: (snapshot) => {
      f.snapshot = snapshot;
    }
  };
  f.run = new AdminAutomaticPortfolioRun(ports);
  f.ports = ports;
  return f;
}

async function reached(f, operation) {
  for (let i = 0; i < 20; ++i) {
    if (f.calls.some(([name]) => name === operation)) return;
    await Promise.resolve();
  }
  assert.fail(`The ${operation} operation was not reached.`);
}

test('loading a durable running passage reads its report without resuming or preparing anything', async () => {
  const f = fixture();
  f.entries = [entry(1)];
  await f.run.load();
  assert.equal(f.snapshot.phase, 'review');
  assert.deepEqual(
    f.calls.map(([name]) => name),
    ['read', 'report']
  );
  assert.equal(f.run.active, false);
  assert.equal(f.snapshot.entries[0].balance.fulfilled, 0);
});

test('a voluntary passage checks every dossier sequentially and continues past waiting and outstanding work', async () => {
  const f = fixture();
  await f.run.start();
  assert.deepEqual(
    f.calls.filter(([name]) => name === 'advance'),
    [
      ['advance', 1],
      ['advance', 2],
      ['advance', 3]
    ]
  );
  assert.equal(f.snapshot.phase, 'completed');
  assert.equal(f.snapshot.state.run.globalBalanced, false);
  assert.equal(f.snapshot.entries.length, 3);
  assert.equal(f.snapshot.entries[1].balanceStatus, 'waiting');
  assert.ok(f.snapshot.entries.every((item) => item.balance.fulfilled === 0));
});

test('pause during an in-flight dossier preserves its server result and pauses with the returned version without advancing again', async () => {
  const f = fixture();
  f.advanceGate = gate();
  const pending = f.run.start();
  await reached(f, 'advance');
  f.run.pause();
  assert.equal(f.snapshot.phase, 'paused');
  f.advanceGate.resolve();
  await pending;
  assert.equal(f.calls.filter(([name]) => name === 'advance').length, 1);
  assert.deepEqual(
    f.calls.find(([name]) => name === 'control'),
    ['control', 'pause', 2]
  );
  assert.equal(f.snapshot.phase, 'paused');
  assert.equal(f.snapshot.entries.length, 1);
});

test('a dialogue or editing barrier during the visible explanation prevents the next server action', async () => {
  const f = fixture();
  f.explainGate = gate();
  const pending = f.run.start();
  await reached(f, 'explain');
  f.barrier = true;
  f.explainGate.resolve();
  await pending;
  assert.equal(f.calls.filter(([name]) => name === 'advance').length, 0);
  assert.equal(f.snapshot.phase, 'paused');
  assert.deepEqual(
    f.calls.find(([name]) => name === 'control'),
    ['control', 'pause', 1]
  );
});

test('an uncertain mutation is never replayed and requires an explicit read before any resume', async () => {
  const f = fixture();
  f.advanceError = new TypeError('Synthetic lost response');
  await f.run.start();
  assert.equal(f.snapshot.phase, 'uncertain');
  assert.equal(f.snapshot.error, 'uncertain');
  const calls = f.calls.length;
  await f.run.resume();
  assert.equal(f.calls.length, calls);
  assert.equal(f.calls.filter(([name]) => name === 'advance').length, 1);
  f.state = state(1, 'uncertain', entry(1));
  await f.run.load();
  assert.equal(f.snapshot.phase, 'uncertain');
  await f.run.resume();
  assert.equal(f.calls.filter(([name]) => name === 'advance').length, 1);
});

test('a stale version stops without retry and a fresh read does not restart work', async () => {
  const f = fixture();
  f.advanceError = Object.assign(new Error('Synthetic conflict'), {
    status: 409
  });
  await f.run.start();
  assert.equal(f.snapshot.phase, 'error');
  assert.equal(f.snapshot.error, 'stale');
  await f.run.load();
  assert.equal(f.snapshot.phase, 'review');
  assert.equal(f.calls.filter(([name]) => name === 'advance').length, 1);
});

for (const shape of ['direct', 'http-error-body']) {
  test(`known invalid payment facts (${shape}) reject starting without uncertainty and preserve the previous report`, async () => {
    const f = fixture();
    f.state = state(3, 'completed', entry(3));
    f.entries = [entry(1), entry(2), entry(3)];
    await f.run.load();
    const before = f.snapshot;
    f.ports.start = async () => {
      f.calls.push(['start']);
      throw Object.assign(new Error('Synthetic invalid payment'), {
        status: 503,
        ...(shape === 'direct'
          ? { code: 'RUN_INVALID_PAYMENT_FACTS' }
          : { error: { code: 'RUN_INVALID_PAYMENT_FACTS' } })
      });
    };
    await f.run.start();
    assert.equal(f.snapshot.phase, 'error');
    assert.equal(f.snapshot.error, 'invalid_payment_facts');
    assert.equal(f.snapshot.state, before.state);
    assert.equal(f.snapshot.entries, before.entries);
    assert.equal(f.run.active, false);
    assert.equal(f.calls.filter(([name]) => name === 'start').length, 1);
    assert.equal(
      f.calls.filter(([name]) => ['advance', 'control'].includes(name)).length,
      0
    );
  });
}

test('an unrelated 503 while starting remains uncertain and is never automatically replayed', async () => {
  const f = fixture();
  f.ports.start = async () => {
    f.calls.push(['start']);
    throw Object.assign(new Error('Synthetic unknown failure'), {
      status: 503,
      code: 'SYNTHETIC_OTHER_FAILURE'
    });
  };
  await f.run.start();
  assert.equal(f.snapshot.phase, 'uncertain');
  assert.equal(f.snapshot.error, 'uncertain');
  assert.equal(f.run.active, false);
  assert.deepEqual(f.calls, [['start']]);
});

test('explicit reconciliation checks the durable server result and leaves resuming as a separate gesture', async () => {
  const f = fixture();
  f.state = state(1, 'uncertain', entry(1));
  f.entries = [entry(1)];
  await f.run.load();
  await f.run.reconcile();
  assert.deepEqual(
    f.calls.find(([name]) => name === 'control'),
    ['control', 'reconcile', 2]
  );
  assert.equal(f.snapshot.phase, 'paused');
  assert.equal(f.calls.filter(([name]) => name === 'advance').length, 0);
  assert.equal(f.calls.filter(([name]) => name === 'start').length, 0);
  assert.equal(f.run.active, false);
});

test('a session change discards an old dossier result and cannot launch a pause or next action for it', async () => {
  const f = fixture();
  f.advanceGate = gate();
  const pending = f.run.start();
  await reached(f, 'advance');
  f.current = false;
  f.run.clear();
  const empty = f.snapshot;
  f.advanceGate.resolve();
  await pending;
  assert.equal(f.snapshot, empty);
  assert.equal(f.snapshot.state, null);
  assert.deepEqual(f.snapshot.entries, []);
  assert.equal(f.calls.filter(([name]) => name === 'control').length, 0);
});

test('loading another report page neither resumes the passage nor fabricates fulfilment', async () => {
  const f = fixture();
  f.entries = [entry(1)];
  f.reportCursor = 1;
  f.reportTail = [entry(2, 'unknown')];
  await f.run.load();
  await f.run.more();
  assert.deepEqual(
    f.snapshot.entries.map((item) => item.seq),
    [1, 2]
  );
  assert.equal(f.snapshot.nextCursor, null);
  assert.deepEqual(
    f.calls.map(([name]) => name),
    ['read', 'report', 'report']
  );
});

test('rechecking uses the same run and an explicit control, not a new payment manifest', async () => {
  const f = fixture();
  f.state = state(3, 'completed', entry(3));
  await f.run.load();
  const latestVersion = f.state.run.version;
  await f.run.resume(true);
  assert.deepEqual(
    f.calls.find(([name]) => name === 'control'),
    ['control', 'recheck', latestVersion]
  );
  assert.equal(f.calls.filter(([name]) => name === 'start').length, 0);
});

test('duplicate start, resume and report input cannot overlap a pending advance', async () => {
  const f = fixture();
  f.advanceGate = gate();
  const pending = f.run.start();
  await reached(f, 'advance');
  await f.run.start();
  await f.run.resume();
  await f.run.more();
  assert.equal(f.calls.filter(([name]) => name === 'start').length, 1);
  assert.equal(f.calls.filter(([name]) => name === 'advance').length, 1);
  f.run.pause();
  f.advanceGate.resolve();
  await pending;
});

test('forbidden durable reads remove private report contents and a previous balanced claim', async () => {
  const f = fixture();
  f.state = state(3, 'completed', entry(3, 'balanced'));
  f.entries = [entry(3, 'balanced')];
  await f.run.load();
  f.ports.read = async () => {
    throw Object.assign(new Error('Synthetic denied read'), { status: 403 });
  };
  await f.run.load();
  assert.equal(f.snapshot.error, 'forbidden');
  assert.equal(f.snapshot.state, null);
  assert.deepEqual(f.snapshot.entries, []);
});
