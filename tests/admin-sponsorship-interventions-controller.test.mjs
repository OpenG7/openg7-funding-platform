import assert from 'node:assert/strict';
import test from 'node:test';

import { AdminSponsorshipInterventionsController } from '../dist/apps/funding-web/src/app/features/funding/components/admin-sponsors/admin-sponsorship-interventions-controller.js';
import { AdminDashboardRequestError } from '../dist/apps/funding-web/src/app/features/funding/services/funding-admin-session.js';

const entry = (id, note = 'Synthetic private note') => ({
  id,
  actor: 'Synthetic operator',
  recordedAt: '2026-10-04T12:00:00Z',
  kind: 'internal',
  note,
  nextReviewOn: null
});
const response = (entries = [], nextCursor = null) => ({
  entries,
  nextCursor,
  followup: {
    state: 'waiting',
    ageDays: 4,
    nextReviewOn: null,
    lastEmail: null
  }
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

function fixture() {
  const state = {
    id: 'synthetic-dossier-a',
    manage: true,
    disabled: false,
    destroyed: false,
    token: 'synthetic-token'
  };
  const reads = [],
    writes = [],
    effects = [];
  let requests = 0;
  const ports = {
    contributionId: () => state.id,
    canManage: () => state.manage,
    disabled: () => state.disabled,
    isDestroyed: () => state.destroyed,
    token: () => state.token,
    newRequestId: () => `synthetic-request-${++requests}`,
    async getSponsorshipInterventions(token, id, before) {
      reads.push({ token, id, before });
      return response();
    },
    async recordSponsorshipIntervention(token, payload) {
      writes.push({ token, payload });
      return entry('synthetic-saved-entry', payload.note);
    },
    saved: () => effects.push('saved'),
    onUnauthorized: async () => effects.push('unauthorized')
  };
  const controller = new AdminSponsorshipInterventionsController(ports);
  return { controller, ports, state, reads, writes, effects };
}

test('cursor pagination preserves older entries, removes overlaps and keeps history after a failed page', async () => {
  const f = fixture();
  const initial = entry('synthetic-newest');
  const older = entry(
    'synthetic-older',
    '<script>Synthetic note text</script>'
  );
  f.ports.getSponsorshipInterventions = async (token, id, before) => {
    f.reads.push({ token, id, before });
    return before
      ? response([initial, older])
      : response([initial], 'synthetic-cursor');
  };
  await f.controller.load();
  await f.controller.load(true);
  assert.deepEqual(f.reads, [
    { token: f.state.token, id: f.state.id, before: undefined },
    { token: f.state.token, id: f.state.id, before: 'synthetic-cursor' }
  ]);
  assert.deepEqual(f.controller.data().entries, [initial, older]);
  f.ports.getSponsorshipInterventions = async () => {
    throw new Error('Synthetic page unavailable');
  };
  await f.controller.load(true);
  assert.deepEqual(f.controller.data().entries, [initial, older]);
  assert.equal(f.controller.error(), 'loadError');
  assert.equal(f.controller.loading(), false);
  assert.deepEqual(f.writes, []);
});

test('malformed journal response keeps the last valid history and offers a read retry', async () => {
  const f = fixture();
  const journal = response([entry('synthetic-existing')]);
  f.ports.getSponsorshipInterventions = async () => journal;
  await f.controller.load();
  for (const invalid of [
    null,
    { entries: [] },
    { followup: {}, entries: {} }
  ]) {
    f.ports.getSponsorshipInterventions = async () => invalid;
    await f.controller.load();
    assert.deepEqual(f.controller.data(), journal);
    assert.equal(f.controller.error(), 'loadError');
    assert.equal(f.controller.loading(), false);
  }
  f.ports.getSponsorshipInterventions = async () => response();
  await f.controller.load();
  assert.equal(f.controller.error(), '');
});

for (const oldFailure of [false, true]) {
  test(`a newer journal read owns data and loading while an older ${oldFailure ? '401 failure' : 'response'} arrives`, async () => {
    const f = fixture();
    const old = deferred(),
      current = deferred();
    let calls = 0;
    f.ports.getSponsorshipInterventions = () =>
      ++calls === 1 ? old.promise : current.promise;
    const first = f.controller.load();
    const second = f.controller.load();
    if (oldFailure) old.reject(new AdminDashboardRequestError(401));
    else old.resolve(response([entry('synthetic-stale')]));
    await first;
    assert.equal(f.controller.loading(), true);
    assert.equal(f.controller.data(), null);
    assert.equal(f.controller.error(), '');
    assert.deepEqual(f.effects, []);
    current.resolve(response([entry('synthetic-current')]));
    await second;
    assert.equal(f.controller.loading(), false);
    assert.equal(f.controller.data().entries[0].id, 'synthetic-current');
  });
}

test('permissions, disabled state, loading and missing data block journal mutations', async () => {
  const f = fixture();
  f.controller.note.set('Synthetic note');
  await f.controller.save();
  await f.controller.load();
  f.state.manage = false;
  await f.controller.save();
  f.state.manage = true;
  f.state.disabled = true;
  await f.controller.save();
  f.state.disabled = false;
  const reading = deferred();
  f.ports.getSponsorshipInterventions = () => reading.promise;
  const pending = f.controller.load();
  await f.controller.save();
  assert.deepEqual(f.writes, []);
  reading.resolve(response());
  await pending;
});

test('validation preserves the draft and creates no request until an extension has its date', async () => {
  const f = fixture();
  await f.controller.load();
  for (const note of ['  ', 'x'.repeat(2001)]) {
    f.controller.note.set(note);
    await f.controller.save();
    assert.equal(f.controller.note(), note);
    assert.equal(f.controller.error(), 'invalid');
  }
  f.controller.note.set('  Synthetic extension  ');
  f.controller.setKind('extension');
  f.controller.setKind('unsupported');
  assert.equal(f.controller.kind(), 'extension');
  await f.controller.save();
  assert.deepEqual(f.writes, []);
  f.controller.nextReviewOn.set('2099-01-01');
  await f.controller.save();
  assert.deepEqual(f.writes[0].payload, {
    contributionId: f.state.id,
    requestId: 'synthetic-request-1',
    kind: 'extension',
    note: 'Synthetic extension',
    nextReviewOn: '2099-01-01'
  });
  assert.equal(f.controller.note(), '');
  assert.equal(f.controller.kind(), 'internal');
  assert.equal(f.controller.nextReviewOn(), '');
  assert.equal(f.controller.success(), true);
  assert.deepEqual(f.effects, ['saved']);
});

test('uncertain save retains the exact payload and UUID, blocks duplicates and emits saved after server reread', async () => {
  const f = fixture();
  await f.controller.load();
  f.controller.note.set(' Synthetic call ');
  f.controller.setKind('phone');
  f.controller.nextReviewOn.set('2099-01-01');
  f.ports.recordSponsorshipIntervention = async (token, payload) => {
    f.writes.push({ token, payload });
    throw new Error('Synthetic disconnected response');
  };
  await f.controller.save();
  assert.equal(f.controller.error(), 'saveError');
  assert.equal(f.controller.note(), ' Synthetic call ');
  assert.equal(f.controller.success(), false);
  assert.deepEqual(f.effects, []);
  const saving = deferred(),
    reading = deferred();
  f.ports.recordSponsorshipIntervention = (token, payload) => {
    f.writes.push({ token, payload });
    return saving.promise;
  };
  f.ports.getSponsorshipInterventions = () => reading.promise;
  f.controller.note.set('Synthetic call');
  const retry = f.controller.save();
  await f.controller.save();
  assert.equal(f.writes.length, 2);
  assert.strictEqual(f.writes[1].payload, f.writes[0].payload);
  assert.equal(f.writes[1].payload.nextReviewOn, null);
  assert.equal(f.controller.saving(), true);
  saving.resolve(entry('synthetic-confirmed'));
  await flush();
  assert.equal(f.controller.loading(), true);
  assert.equal(f.controller.success(), true);
  assert.deepEqual(f.effects, []);
  await f.controller.save();
  assert.equal(f.writes.length, 2);
  reading.resolve(response([entry('synthetic-confirmed')]));
  await retry;
  assert.equal(f.controller.loading(), false);
  assert.deepEqual(f.effects, ['saved']);
});

test('each changed journal payload receives a new retry UUID', async () => {
  const f = fixture();
  await f.controller.load();
  f.ports.recordSponsorshipIntervention = async (token, payload) => {
    f.writes.push({ token, payload });
    throw new Error('Synthetic uncertain response');
  };
  f.controller.note.set('Synthetic note');
  await f.controller.save();
  f.controller.note.set('Synthetic changed note');
  await f.controller.save();
  f.controller.setKind('extension');
  f.controller.nextReviewOn.set('2099-01-01');
  await f.controller.save();
  f.controller.nextReviewOn.set('2099-01-02');
  await f.controller.save();
  assert.equal(new Set(f.writes.map((call) => call.payload.requestId)).size, 4);
});

for (const status of [400, 401, 403, 409, 503]) {
  test(`journal save maps ${status}, preserves retry or clears private data as before`, async () => {
    const f = fixture();
    await f.controller.load();
    f.controller.note.set('Synthetic private draft');
    f.ports.recordSponsorshipIntervention = async (token, payload) => {
      f.writes.push({ token, payload });
      throw new AdminDashboardRequestError(status);
    };
    await f.controller.save();
    assert.equal(
      f.controller.error(),
      {
        400: 'invalid',
        401: 'saveError',
        403: 'forbidden',
        409: 'conflict',
        503: 'saveError'
      }[status]
    );
    assert.equal(f.controller.saving(), false);
    const denied = status === 401 || status === 403;
    assert.equal(f.controller.note(), denied ? '' : 'Synthetic private draft');
    assert.equal(f.controller.data() === null, denied);
    assert.deepEqual(f.effects, status === 401 ? ['unauthorized'] : []);
    await f.controller.load();
    f.controller.note.set('Synthetic private draft');
    await f.controller.save();
    assert.equal(
      f.writes[1].payload.requestId === f.writes[0].payload.requestId,
      !denied
    );
  });
}

for (const status of [401, 403]) {
  test(`journal read removes private data on ${status} and redirects only for an expired session`, async () => {
    const f = fixture();
    await f.controller.load();
    f.controller.note.set('Synthetic private draft');
    f.ports.getSponsorshipInterventions = async () => {
      throw new AdminDashboardRequestError(status);
    };
    await f.controller.load();
    assert.equal(f.controller.data(), null);
    assert.equal(f.controller.note(), '');
    assert.equal(f.controller.loading(), false);
    assert.equal(
      f.controller.error(),
      status === 403 ? 'forbidden' : 'loadError'
    );
    assert.deepEqual(f.effects, status === 401 ? ['unauthorized'] : []);
  });
}

for (const operation of ['read', 'save']) {
  for (const lateFailure of [false, true]) {
    test(`dossier reset suppresses a late ${operation} ${lateFailure ? '401 failure' : 'response'} and clears its retry`, async () => {
      const f = fixture();
      await f.controller.load();
      f.controller.note.set('Synthetic old draft');
      f.controller.setKind('extension');
      f.controller.nextReviewOn.set('2099-01-01');
      const old = deferred();
      if (operation === 'read')
        f.ports.getSponsorshipInterventions = () => old.promise;
      else
        f.ports.recordSponsorshipIntervention = (token, payload) => {
          f.writes.push({ token, payload });
          return old.promise;
        };
      const pending =
        operation === 'read' ? f.controller.load() : f.controller.save();
      f.state.id = 'synthetic-dossier-b';
      f.controller.resetDossier();
      assert.equal(f.controller.note(), '');
      assert.equal(f.controller.kind(), 'internal');
      assert.equal(f.controller.nextReviewOn(), '');
      assert.equal(f.controller.saving(), false);
      f.ports.getSponsorshipInterventions = async () =>
        response([entry('synthetic-new-dossier')]);
      await f.controller.load();
      f.controller.note.set('Synthetic new draft');
      if (lateFailure) old.reject(new AdminDashboardRequestError(401));
      else
        old.resolve(
          operation === 'read'
            ? response([entry('synthetic-old')])
            : entry('synthetic-old')
        );
      await pending;
      assert.equal(f.controller.data().entries[0].id, 'synthetic-new-dossier');
      assert.equal(f.controller.note(), 'Synthetic new draft');
      assert.equal(f.controller.error(), '');
      assert.equal(f.controller.success(), false);
      assert.deepEqual(f.effects, []);
      f.ports.recordSponsorshipIntervention = async (token, payload) => {
        f.writes.push({ token, payload });
        return entry('synthetic-new');
      };
      await f.controller.save();
      assert.equal(
        f.writes.at(-1).payload.contributionId,
        'synthetic-dossier-b'
      );
      if (operation === 'save')
        assert.notEqual(
          f.writes[1].payload.requestId,
          f.writes[0].payload.requestId
        );
    });
  }
}

for (const operation of ['read', 'save']) {
  for (const lateFailure of [false, true]) {
    test(`destruction ignores a late ${operation} ${lateFailure ? '401 failure' : 'response'}`, async () => {
      const f = fixture();
      await f.controller.load();
      f.controller.note.set('Synthetic draft');
      const late = deferred();
      if (operation === 'read')
        f.ports.getSponsorshipInterventions = () => late.promise;
      else f.ports.recordSponsorshipIntervention = () => late.promise;
      const pending =
        operation === 'read' ? f.controller.load() : f.controller.save();
      const snapshot = {
        data: f.controller.data(),
        saving: f.controller.saving(),
        loading: f.controller.loading()
      };
      f.state.destroyed = true;
      if (lateFailure) late.reject(new AdminDashboardRequestError(401));
      else
        late.resolve(
          operation === 'read'
            ? response([entry('synthetic-late')])
            : entry('synthetic-late')
        );
      await pending;
      assert.strictEqual(f.controller.data(), snapshot.data);
      assert.equal(f.controller.saving(), snapshot.saving);
      assert.equal(f.controller.loading(), snapshot.loading);
      assert.equal(f.controller.note(), 'Synthetic draft');
      assert.equal(f.controller.success(), false);
      assert.deepEqual(f.effects, []);
    });
  }
}

test('confirmed save still emits saved after a failed reread, while reporting the read error', async () => {
  const f = fixture();
  await f.controller.load();
  f.controller.note.set('Synthetic confirmed note');
  f.ports.getSponsorshipInterventions = async () => {
    throw new Error('Synthetic reread failure');
  };
  await f.controller.save();
  assert.equal(f.controller.success(), true);
  assert.equal(f.controller.error(), 'loadError');
  assert.deepEqual(f.effects, ['saved']);
});

test('changing dossier or destroying during the confirmed save reread suppresses saved emission', async () => {
  for (const ending of ['dossier', 'destroy']) {
    const f = fixture();
    await f.controller.load();
    f.controller.note.set('Synthetic note');
    const reading = deferred();
    f.ports.getSponsorshipInterventions = () => reading.promise;
    const pending = f.controller.save();
    await flush();
    assert.equal(f.controller.loading(), true);
    if (ending === 'dossier') {
      f.state.id = 'synthetic-dossier-b';
      f.controller.resetDossier();
    } else f.state.destroyed = true;
    reading.resolve(response([entry('synthetic-old-dossier')]));
    await pending;
    assert.deepEqual(f.effects, []);
  }
});
