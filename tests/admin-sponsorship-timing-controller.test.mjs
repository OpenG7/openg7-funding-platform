import assert from 'node:assert/strict';
import test from 'node:test';
import { AdminSponsorshipTimingController } from '../dist/apps/funding-web/src/app/features/funding/components/admin-sponsors/admin-sponsorship-timing-controller.js';
import { AdminDashboardRequestError } from '../dist/apps/funding-web/src/app/features/funding/services/funding-admin-session.js';
const id = '10000000-0000-4000-8000-000000000901';
const observationId = '10000000-0000-4000-8000-000000000902';
function fixture() {
  const state = {
    owner: true,
    destroyed: false,
    changed: 0,
    requests: 0,
    error: null,
    result: null,
    wait: null
  };
  const sent = [];
  const obligation = {
    id,
    commitmentId: 'synthetic-commitment',
    contributionId: 'synthetic-dossier',
    benefitId: 'website_mention',
    channel: 'website',
    target: 'openg7',
    ordinal: 1,
    state: 'pending',
    blockedReason: null,
    version: 4,
    fulfilmentEvidenceId: null,
    timing: {
      version: 1,
      deadlineDays: 7,
      durationDays: 30,
      originAt: null,
      originProvenance: null,
      dueAt: null,
      overdue: false,
      durationState: 'awaiting_review',
      startObservation: {
        id: observationId,
        observedAt: '2026-01-01T00:00:00.000Z',
        earliestCompletionAt: '2026-01-31T00:00:00.000Z'
      }
    }
  };
  const c = new AdminSponsorshipTimingController({
    canOwn: () => state.owner,
    isDestroyed: () => state.destroyed,
    newRequestId: () =>
      `20000000-0000-4000-8000-${String(++state.requests).padStart(12, '0')}`,
    changed: () => state.changed++,
    send: async (request) => {
      sent.push(structuredClone(request));
      if (state.wait) return state.wait;
      if (state.error) throw state.error;
      return (
        state.result ?? {
          obligationId: request.obligationId,
          timing: {
            ...obligation.timing,
            version: request.expectedVersion + 1,
            durationState:
              request.kind === 'duration' ? 'attested' : 'awaiting_review'
          }
        }
      );
    }
  });
  c.select(obligation);
  const fill = () => {
    c.reason.set('Synthetic justified statement');
    c.evidence.set('synthetic://continuity-record');
    c.confirmation.set(id);
    c.continuity.set(true);
    c.origin.set('2026-01-01T00:00');
  };
  return { c, state, obligation, sent, fill };
}
test('timing captures exact owner confirmation and timing version separately from commercial version', async () => {
  const f = fixture();
  f.fill();
  await f.c.submit('duration');
  assert.equal(f.sent[0].expectedVersion, 1);
  assert.equal(f.sent[0].confirmation, id);
  assert.equal(f.sent[0].startObservationId, observationId);
  assert.equal(f.sent[0].continuityConfirmed, true);
  assert.equal(f.c.obligation().version, 4);
  assert.equal(f.c.obligation().timing.version, 2);
  assert.equal(f.state.changed, 1);
  assert.equal(f.c.pending(), null);
});
test('invalid owner statements send no command and do not silently replace a contractual origin', async () => {
  for (const modify of [
    (f) => (f.state.owner = false),
    (f) => f.c.reason.set(''),
    (f) => f.c.confirmation.set('foreign'),
    (f) => f.c.continuity.set(false),
    (f) => f.c.evidence.set(''),
    (f) => f.c.select({ ...f.obligation, state: 'fulfilled' }),
    (f) => f.c.select({ ...f.obligation, channel: 'facebook' })
  ]) {
    const f = fixture();
    f.fill();
    modify(f);
    await f.c.submit('duration');
    assert.equal(f.sent.length, 0);
    assert.equal(f.state.requests, 0);
  }
  const f = fixture();
  f.fill();
  f.c.origin.set('2026-02-30T10:00');
  await f.c.submit('origin');
  assert.equal(f.sent.length, 0);
  f.c.origin.set('2026-01-01T10:30');
  await f.c.submit('origin');
  assert.equal(f.sent[0].originAt, '2026-01-01T10:30:00.000Z');
});
test('lost timing result retains UUID, origin and statement despite edited fields or a newer read', async () => {
  const f = fixture();
  f.fill();
  f.state.error = new TypeError('Synthetic response lost');
  await f.c.submit('duration');
  const captured = structuredClone(f.c.pending());
  f.c.reason.set('Changed field');
  f.c.evidence.set('synthetic://new');
  f.c.select({
    ...f.obligation,
    timing: { ...f.obligation.timing, version: 2 }
  });
  await f.c.submit('observe');
  assert.equal(f.sent.length, 1);
  f.state.error = null;
  await f.c.retry();
  assert.deepEqual(f.sent[1], captured);
  assert.equal(f.state.requests, 1);
  assert.equal(f.c.pending(), null);
});
test('a definite refusal releases the failed request while ambiguous receipt conflicts preserve it', async () => {
  for (const [code, release, notice] of [
    ['TIMING_VERSION_CONFLICT', true, 'conflict'],
    ['DURATION_NOT_ELAPSED', true, 'tooEarly'],
    ['DURATION_OBSERVATION_IN_PROGRESS', true, 'sampling'],
    ['DURATION_SOURCE_CHANGED', true, 'sourceChanged'],
    ['COMMITMENT_REQUEST_CONFLICT', false, 'uncertain'],
    ['UNRECOGNIZED', false, 'uncertain']
  ]) {
    const f = fixture();
    f.fill();
    f.state.error = new AdminDashboardRequestError(
      409,
      'Synthetic refusal',
      code
    );
    await f.c.submit('duration');
    assert.equal(f.c.pending() === null, release);
    assert.equal(f.c.error(), notice);
    if (release) {
      f.state.error = null;
      f.c.select({
        ...f.obligation,
        timing: { ...f.obligation.timing, version: 2 }
      });
      await f.c.submit('duration');
      assert.equal(f.sent[1].expectedVersion, 2);
      assert.notEqual(f.sent[0].requestId, f.sent[1].requestId);
    }
  }
});
test('late timing responses cannot replace another selected obligation or survive component destruction', async () => {
  for (const destroyed of [false, true]) {
    const f = fixture();
    f.fill();
    let finish;
    f.state.wait = new Promise((resolve) => (finish = resolve));
    const writing = f.c.submit('observe');
    if (destroyed) f.state.destroyed = true;
    else
      f.c.select({
        ...f.obligation,
        id: '10000000-0000-4000-8000-000000000903'
      });
    finish({
      obligationId: id,
      timing: { ...f.obligation.timing, version: 2 }
    });
    await writing;
    assert.equal(f.state.changed, 0);
    assert.equal(f.c.saved(), false);
  }
});
test('an unconfirmed timing response does not manufacture completion or free its command', async () => {
  const f = fixture();
  f.fill();
  f.state.result = {
    obligationId: 'foreign',
    timing: { ...f.obligation.timing, version: 2 }
  };
  await f.c.submit('duration');
  assert.ok(f.c.pending());
  assert.equal(f.c.obligation().timing.version, 1);
  assert.equal(f.c.saved(), false);
});

test('malformed timing receipts stay uncertain and retain the original command', async () => {
  for (const alter of [
    (t) => ({ ...t, version: undefined }),
    (t) => ({ ...t, version: NaN }),
    (t) => ({ ...t, version: '2' }),
    (t) => ({ ...t, version: 1.5 }),
    (t) => ({ ...t, version: 1 }),
    (t) => ({ ...t, deadlineDays: 0 }),
    (t) => ({ ...t, durationState: 'fulfilled' }),
    (t) => ({
      ...t,
      startObservation: { ...t.startObservation, observedAt: 'unknown' }
    })
  ]) {
    const f = fixture();
    f.fill();
    f.state.result = {
      obligationId: id,
      timing: alter({ ...f.obligation.timing, version: 2 })
    };
    await f.c.submit('duration');
    assert.ok(f.c.pending());
    assert.equal(f.c.saved(), false);
    assert.equal(f.c.obligation().timing.version, 1);
  }
});
test('a delayed confirmed timing receipt cannot downgrade a newer read or an independently adjusted obligation', async () => {
  const f = fixture();
  f.fill();
  let finish;
  f.state.wait = new Promise((resolve) => (finish = resolve));
  const writing = f.c.submit('observe');
  f.c.select({
    ...f.obligation,
    version: 5,
    state: 'adjusted',
    timing: { ...f.obligation.timing, version: 3 }
  });
  finish({ obligationId: id, timing: { ...f.obligation.timing, version: 2 } });
  await writing;
  assert.equal(f.c.obligation().timing.version, 3);
  assert.equal(f.c.obligation().version, 5);
  assert.equal(f.c.obligation().state, 'adjusted');
  assert.equal(f.c.pending(), null);
  f.c.select({
    ...f.obligation,
    timing: { ...f.obligation.timing, version: 3 }
  });
  assert.equal(f.c.obligation().version, 5);
  assert.equal(f.c.obligation().state, 'adjusted');
});
test('a replay may return a later current timing version and an attested local receipt closes further commands before refresh', async () => {
  const f = fixture();
  f.fill();
  f.state.result = {
    obligationId: id,
    timing: {
      ...f.obligation.timing,
      version: 4,
      durationState: 'attested',
      startObservation: null
    }
  };
  await f.c.submit('duration');
  assert.equal(f.c.obligation().timing.version, 4);
  assert.equal(f.c.pending(), null);
  assert.equal(f.c.saved(), true);
  assert.equal(f.c.obligation().state, 'pending');
  f.fill();
  await f.c.submit('observe');
  await f.c.submit('origin');
  assert.equal(f.sent.length, 1);
});

test('a known interruption preserves its old observation, forbids duration attestation, and permits a fresh observation', async () => {
  const f = fixture();
  f.fill();
  f.c.select({
    ...f.obligation,
    timing: { ...f.obligation.timing, durationState: 'restart_required' }
  });
  await f.c.submit('duration');
  assert.equal(f.sent.length, 0);
  assert.equal(f.state.requests, 0);
  assert.equal(f.c.error(), 'sourceChanged');
  assert.equal(f.c.obligation().timing.startObservation.id, observationId);
  await f.c.submit('observe');
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].kind, 'observe');
  assert.equal(f.c.obligation().timing.durationState, 'awaiting_review');
});

test('a confirmed restart-required receipt retains the pending benefit and requires a fresh observation before attestation', async () => {
  const f = fixture();
  f.fill();
  f.state.result = {
    obligationId: id,
    timing: {
      ...f.obligation.timing,
      version: 2,
      durationState: 'restart_required'
    }
  };
  await f.c.submit('observe');
  assert.equal(f.c.saved(), true);
  assert.equal(f.c.pending(), null);
  assert.equal(f.c.obligation().timing.version, 2);
  assert.equal(f.c.obligation().timing.durationState, 'restart_required');
  assert.equal(f.c.obligation().state, 'pending');
  assert.equal(f.c.obligation().fulfilmentEvidenceId, null);
  f.fill();
  await f.c.submit('duration');
  assert.equal(f.c.error(), 'sourceChanged');
  assert.equal(f.sent.length, 1);
  assert.equal(f.state.requests, 1);
});

test('a visible HTTP sample is accepted as dated information while the benefit remains pending', async () => {
  const f = fixture();
  f.fill();
  f.state.result = {
    obligationId: id,
    timing: {
      ...f.obligation.timing,
      version: 2,
      latestPublicObservation: {
        checkedAt: '2026-10-12T00:00:00.000Z',
        status: 'visible',
        reason: 'MATCH',
        httpStatus: 200
      }
    }
  };
  await f.c.submit('observe');
  assert.equal(f.c.saved(), true);
  assert.equal(f.c.obligation().state, 'pending');
  assert.equal(f.c.obligation().fulfilmentEvidenceId, null);
});

test('an invalid HTTP sample receipt preserves the exact captured timing command for reconciliation', async () => {
  for (const invalid of [
    {
      checkedAt: 'not-a-date',
      status: 'visible',
      reason: 'MATCH',
      httpStatus: 200
    },
    {
      checkedAt: '2026-10-12T00:00:00.000Z',
      status: 'fulfilled',
      reason: 'MATCH',
      httpStatus: 200
    },
    {
      checkedAt: '2026-10-12T00:00:00.000Z',
      status: 'unknown',
      reason: 'arbitrary-private-detail',
      httpStatus: 200
    },
    {
      checkedAt: '2026-10-12T00:00:00.000Z',
      status: 'unknown',
      reason: 'HTTP_ERROR',
      httpStatus: 0
    }
  ]) {
    const f = fixture();
    f.fill();
    f.state.result = {
      obligationId: id,
      timing: {
        ...f.obligation.timing,
        version: 2,
        latestPublicObservation: invalid
      }
    };
    await f.c.submit('observe');
    assert.equal(f.c.saved(), false);
    assert.equal(f.c.obligation().state, 'pending');
    assert.deepEqual(f.c.pending(), f.sent[0]);
  }
});
