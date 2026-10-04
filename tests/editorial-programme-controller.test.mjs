import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { signal } from '@angular/core';

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
const { EditorialProgrammeController } =
  await import('../dist/apps/funding-web/src/app/features/funding/components/admin-pilotage/editorial-programme-controller.js');
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
const feed = (id = 'openg7:facebook', timezone = 'America/Toronto') => ({
  id,
  timezone,
  paused: true,
  autoPrepare: false,
  weekdays: [1],
  localTime: '12:00',
  capacity: 1,
  horizonDays: 7,
  mode: 'mock',
  accountId: 'synthetic-account',
  configured: true,
  expiresAt: null,
  connection: 'unchecked',
  checkedAt: null
});
const delivery = (id = 'synthetic-draft', overrides = {}) => ({
  id,
  feedId: 'openg7:facebook',
  kind: 'news',
  batchId: null,
  message: 'Synthetic message for ' + id,
  scheduledAt: '2026-10-04T16:00:00.000Z',
  mediaId: null,
  mediaUrl: null,
  mediaAlt: null,
  accountId: 'synthetic-account',
  mode: 'mock',
  autoManaged: false,
  sponsors: [],
  version: 3,
  status: 'draft',
  attempts: 0,
  nextAttemptAt: null,
  externalPostId: null,
  externalPostUrl: null,
  errorCode: null,
  approvedAt: null,
  publishedAt: null,
  ...overrides
});
const snapshot = (deliveries = [delivery()], overrides = {}) => ({
  generatedAt: '2026-10-04T02:00:00.000Z',
  version: 'synthetic-programme-v1',
  complete: true,
  writable: true,
  feeds: [feed(), feed('openg20:linkedin', 'Pacific/Honolulu')],
  profiles: [
    {
      feedId: 'openg7:facebook',
      version: 2,
      preferences: ['concise'],
      observations: { concise: 3 }
    },
    {
      feedId: 'openg20:linkedin',
      version: 4,
      preferences: ['linkedin'],
      observations: {}
    }
  ],
  deliveries,
  issues: [],
  briefing: { ready: 1, scheduled: 0, blocked: 0, coveredUntil: null },
  ...overrides
});
const proposal = (moves = [], overrides = {}) => ({
  version: 'synthetic-programme-v1',
  plan: { moves, emptySlots: [], warnings: [] },
  ...overrides
});
const fixture = () => {
  const working = signal(false);
  const disabled = signal(false);
  const pending = signal(null);
  const comparison = signal(null);
  const preferences = signal([]);
  const events = [];
  const calls = { reads: 0, proposals: [] };
  const ports = {
    working,
    disabled,
    setPending: (command) => {
      pending.set(command);
      events.push('pending');
    },
    clearComparison: () => {
      comparison.set(null);
      events.push('comparison');
    },
    syncPreferences: () => {
      preferences.set([...(controller.profile()?.preferences ?? [])]);
      events.push('preferences');
    },
    contextChanged: () => events.push('context'),
    api: {
      pilotageProgramme: async () => {
        calls.reads++;
        return snapshot();
      },
      proposeProgramme: async (...args) => {
        calls.proposals.push(args);
        return proposal();
      }
    }
  };
  const controller = new EditorialProgrammeController(ports);
  return {
    controller,
    ports,
    working,
    disabled,
    pending,
    comparison,
    preferences,
    events,
    calls
  };
};
const seed = (f, state = snapshot()) => {
  f.controller.state.set(state);
  f.controller.loading.set(false);
  f.events.length = 0;
};

test('construction is inert and has one parent-owned interaction state', () => {
  const f = fixture();
  assert.equal(f.controller.state(), null);
  assert.equal(f.controller.loading(), true);
  assert.equal(f.controller.readonly(), true);
  assert.deepEqual(f.controller.days(), []);
  assert.deepEqual(f.calls, { reads: 0, proposals: [] });
  assert.deepEqual(f.events, []);
  assert.equal('pending' in f.controller, false);
  assert.equal('working' in f.controller, false);
});

test('refresh withdraws the old calendar and intention before reading, then synchronizes preferences', async () => {
  const f = fixture();
  seed(f);
  f.controller.shift(30);
  f.controller.stagePlan();
  f.comparison.set({ after: 'Synthetic comparison' });
  const next = deferred();
  f.ports.api.pilotageProgramme = () => next.promise;
  f.events.length = 0;
  const loading = f.controller.load();
  assert.equal(f.controller.state(), null);
  assert.equal(f.controller.readonly(), true);
  assert.deepEqual(f.controller.moves(), []);
  assert.equal(f.controller.planVersion(), '');
  assert.equal(f.controller.planned(), false);
  assert.equal(f.pending(), null);
  assert.equal(f.comparison(), null);
  assert.deepEqual(f.events, ['pending', 'context', 'comparison']);
  const current = snapshot();
  next.resolve(current);
  assert.equal(await loading, true);
  assert.equal(f.controller.state(), current);
  assert.equal(f.controller.loading(), false);
  assert.deepEqual(f.preferences(), ['concise']);
  assert.deepEqual(f.events, [
    'pending',
    'context',
    'comparison',
    'pending',
    'context',
    'preferences'
  ]);
});

test('a failed refresh leaves no old calendar or confirmation, with an explicit error', async () => {
  const f = fixture();
  seed(f);
  f.controller.shift(30);
  f.controller.stagePlan();
  f.ports.api.pilotageProgramme = async () => {
    throw new Error('SYNTHETIC_READ_UNAVAILABLE');
  };
  assert.equal(await f.controller.load(), false);
  assert.equal(f.controller.error(), 'SYNTHETIC_READ_UNAVAILABLE');
  assert.equal(f.controller.loading(), false);
  assert.equal(f.controller.readonly(), true);
  assert.equal(f.controller.selected(), null);
  assert.equal(f.pending(), null);
  assert.deepEqual(f.controller.moves(), []);
  f.ports.api.pilotageProgramme = async () => {
    throw null;
  };
  assert.equal(await f.controller.load(), false);
  assert.equal(f.controller.error(), 'PROGRAMME_UNAVAILABLE');
});

for (const outcome of ['success', 'failure']) {
  test(`the latest read wins over an older ${outcome}`, async () => {
    const f = fixture();
    const older = deferred();
    const newer = deferred();
    let calls = 0;
    f.ports.api.pilotageProgramme = () =>
      ++calls === 1 ? older.promise : newer.promise;
    const oldLoad = f.controller.load();
    const newLoad = f.controller.load();
    const current = snapshot([delivery('current')]);
    newer.resolve(current);
    assert.equal(await newLoad, true);
    const events = [...f.events];
    if (outcome === 'success') older.resolve(snapshot([delivery('obsolete')]));
    else older.reject(new Error('OBSOLETE_FAILURE'));
    assert.equal(await oldLoad, false);
    assert.equal(f.controller.state(), current);
    assert.equal(f.controller.error(), '');
    assert.equal(f.controller.loading(), false);
    assert.deepEqual(f.events, events);
  });
}

test('calendar groups projected deliveries by the feed timezone and preserves the server facts', () => {
  const f = fixture();
  const first = delivery('first', {
    scheduledAt: '2026-10-03T13:00:00.000Z',
    message: 'S'.repeat(120)
  });
  const second = delivery('second', {
    scheduledAt: '2026-10-04T02:00:00.000Z'
  });
  const outside = delivery('outside', {
    scheduledAt: '2026-10-10T16:00:00.000Z'
  });
  const other = delivery('other', {
    feedId: 'openg20:linkedin',
    scheduledAt: '2026-10-04T08:00:00.000Z'
  });
  seed(f, snapshot([second, other, outside, first]));
  assert.equal(f.controller.dayKey(second.scheduledAt), '2026-10-03');
  assert.deepEqual(f.controller.days(), [
    '2026-10-03',
    '2026-10-04',
    '2026-10-05',
    '2026-10-06',
    '2026-10-07',
    '2026-10-08',
    '2026-10-09'
  ]);
  assert.deepEqual(
    f.controller.entries('2026-10-03').map((d) => d.id),
    ['first', 'second']
  );
  assert.deepEqual(
    f.controller.outsideWeek().map((d) => d.id),
    ['outside']
  );
  assert.equal(f.controller.delivery('first'), first);
  assert.equal(f.controller.title('first'), 'S'.repeat(100));
  assert.equal(f.controller.title('missing'), 'missing');
  assert.equal(f.controller.originalDate('missing'), '');
  f.controller.select('first');
  f.controller.shift(1440);
  assert.equal(f.controller.originalDate('first'), first.scheduledAt);
  assert.equal(first.scheduledAt, '2026-10-03T13:00:00.000Z');
  f.controller.changeFeed('openg20:linkedin');
  assert.equal(f.controller.dayKey(other.scheduledAt), '2026-10-03');
  assert.deepEqual(f.controller.deliveries(), [other]);
  assert.equal(f.controller.selected().id, 'other');
});

test('feed and selection changes invalidate comparison and the sole intention in the original order', () => {
  const f = fixture();
  seed(
    f,
    snapshot([
      delivery('first'),
      delivery('second', { scheduledAt: '2026-10-05T16:00:00.000Z' }),
      delivery('other', { feedId: 'openg20:linkedin' })
    ])
  );
  f.controller.select('second');
  f.pending.set({ action: 'publication.edit', targetId: 'second' });
  f.comparison.set({ deliveryId: 'second' });
  const selectedAtComparison = [];
  const clearComparison = f.ports.clearComparison;
  f.ports.clearComparison = () => {
    selectedAtComparison.push(f.controller.selectedId());
    clearComparison();
  };
  f.events.length = 0;
  f.controller.select('first');
  assert.deepEqual(f.events, ['comparison', 'pending', 'context']);
  assert.deepEqual(selectedAtComparison, ['first']);
  assert.equal(f.pending(), null);
  f.controller.select('second');
  f.events.length = 0;
  f.controller.changeFeed('openg20:linkedin');
  assert.deepEqual(f.events, [
    'pending',
    'context',
    'preferences',
    'comparison',
    'pending',
    'context'
  ]);
  assert.deepEqual(f.preferences(), ['linkedin']);
  assert.equal(selectedAtComparison.at(-1), 'second');
  assert.equal(f.controller.selectedId(), '');
  assert.deepEqual(f.controller.moves(), []);
});

test('previous and next follow projected chronological order and wrap around', () => {
  const f = fixture();
  const first = delivery('first');
  const second = delivery('second', {
    scheduledAt: '2026-10-05T16:00:00.000Z'
  });
  seed(f, snapshot([second, first]));
  assert.equal(f.controller.selected().id, 'first');
  f.controller.next(-1);
  assert.equal(f.controller.selected().id, 'second');
  f.controller.next(1);
  assert.equal(f.controller.selected().id, 'first');
  f.controller.shift(2880);
  f.controller.next(-1);
  assert.equal(f.controller.selected().id, 'second');
  seed(f, snapshot([]));
  f.controller.next(1);
  assert.equal(f.controller.selected(), null);
});

test('manual moves preserve absolute durations and require explicit inclusion of approved deliveries', () => {
  const f = fixture();
  const approved = delivery('approved', {
    status: 'approved',
    scheduledAt: '2026-11-01T05:30:00.000Z'
  });
  seed(f, snapshot([approved]));
  f.controller.shift(30);
  assert.deepEqual(f.controller.moves(), []);
  f.controller.includeApproved = true;
  f.controller.shift(1440);
  assert.deepEqual(f.controller.moves(), [
    { id: approved.id, version: 3, scheduledAt: '2026-11-02T05:30:00.000Z' }
  ]);
  f.controller.shift(-30);
  assert.equal(f.controller.moves().length, 1);
  assert.equal(f.controller.moves()[0].scheduledAt, '2026-11-02T05:00:00.000Z');
  assert.equal(f.controller.planVersion(), 'synthetic-programme-v1');
  f.controller.stagePlan();
  assert.equal(f.pending().action, 'programme.apply');
  f.controller.shift(30);
  assert.equal(f.pending(), null);
});

for (const status of [
  'publishing',
  'published',
  'blocked',
  'uncertain',
  'rejected',
  'cancelled'
]) {
  test(`manual moves leave ${status} deliveries fixed`, () => {
    const f = fixture();
    seed(f, snapshot([delivery('fixed', { status })]));
    f.controller.includeApproved = true;
    f.controller.shift(30);
    assert.deepEqual(f.controller.moves(), []);
  });
}

test('an incident blocks manual moves and remains scoped to its feed', () => {
  const f = fixture();
  const issue = {
    deliveryId: 'blocked-draft',
    codes: ['SYNTHETIC_SOURCE_EXCLUDED'],
    excludedSponsorIds: [],
    repair: null
  };
  seed(
    f,
    snapshot(
      [
        delivery('blocked-draft'),
        delivery('other', { feedId: 'openg20:linkedin' })
      ],
      { issues: [issue, { ...issue, deliveryId: 'other' }] }
    )
  );
  assert.equal(f.controller.issue('blocked-draft'), issue);
  assert.equal(f.controller.issue('other'), undefined);
  f.controller.shift(30);
  assert.deepEqual(f.controller.moves(), []);
});

for (const guard of ['loading', 'disabled', 'working', 'unwritable']) {
  test(`${guard} blocks proposing, moving and preparing a calendar intention`, async () => {
    const f = fixture();
    seed(f);
    f.controller.shift(30);
    const moves = f.controller.moves();
    if (guard === 'loading') f.controller.loading.set(true);
    else if (guard === 'disabled') f.disabled.set(true);
    else if (guard === 'working') f.working.set(true);
    else f.controller.state.set(snapshot(undefined, { writable: false }));
    assert.equal(f.controller.readonly(), true);
    f.controller.shift(30);
    f.controller.stagePlan();
    await f.controller.propose();
    assert.equal(f.controller.moves(), moves);
    assert.equal(f.pending(), null);
    assert.deepEqual(f.calls.proposals, []);
  });
}

test('a server proposal carries cadence, approved inclusion, version, empty slots and unplaced identifiers', async () => {
  const f = fixture();
  const unchanged = delivery('unchanged');
  const changed = delivery('changed', {
    scheduledAt: '2026-10-05T16:00:00.000Z'
  });
  seed(f, snapshot([unchanged, changed]));
  f.controller.cadence = '5';
  f.controller.includeApproved = true;
  const moves = [
    { id: unchanged.id, version: 3, scheduledAt: unchanged.scheduledAt },
    { id: changed.id, version: 3, scheduledAt: '2026-10-06T16:00:00.000Z' }
  ];
  f.ports.api.proposeProgramme = async (...args) => {
    f.calls.proposals.push(args);
    return proposal(moves, {
      plan: {
        moves,
        emptySlots: ['2026-10-07T16:00:00.000Z'],
        warnings: [
          { code: 'unplaced', ids: ['synthetic-unplaced'] },
          { code: 'repetition', ids: ['unchanged', 'changed'] }
        ]
      }
    });
  };
  await f.controller.propose();
  assert.deepEqual(f.calls.proposals, [['openg7:facebook', 5, true]]);
  assert.equal(f.working(), false);
  assert.equal(f.controller.planned(), true);
  assert.deepEqual(f.controller.emptySlots(), ['2026-10-07T16:00:00.000Z']);
  assert.deepEqual(f.controller.unplaced(), ['synthetic-unplaced']);
  assert.equal(f.pending(), null);
  f.controller.stagePlan();
  assert.deepEqual(f.pending(), {
    action: 'programme.apply',
    targetId: 'openg7:facebook',
    version: 'synthetic-programme-v1',
    payload: { moves: [moves[1]] }
  });
  assert.equal(
    f.controller.state().deliveries[1].scheduledAt,
    changed.scheduledAt
  );
});

for (const failure of ['version', 'error', 'unknown']) {
  test(`a new proposal removes the preceding plan and confirmation after ${failure} failure`, async () => {
    const f = fixture();
    seed(f);
    f.controller.shift(30);
    f.controller.stagePlan();
    const result = deferred();
    f.ports.api.proposeProgramme = () => result.promise;
    const proposing = f.controller.propose();
    assert.equal(f.working(), true);
    assert.equal(f.pending(), null);
    assert.deepEqual(f.controller.moves(), []);
    if (failure === 'version')
      result.resolve(
        proposal(
          [{ id: 'synthetic-draft', version: 3, scheduledAt: '2030-01-01' }],
          {
            version: 'different-server-version'
          }
        )
      );
    else
      result.reject(
        failure === 'error' ? new Error('SYNTHETIC_FAILURE') : null
      );
    await proposing;
    assert.equal(f.working(), false);
    assert.deepEqual(f.controller.moves(), []);
    assert.equal(f.controller.planned(), false);
    assert.equal(f.controller.planVersion(), '');
    assert.equal(f.pending(), null);
    assert.equal(
      f.controller.error(),
      failure === 'version'
        ? 'VERSION_CONFLICT'
        : failure === 'error'
          ? 'SYNTHETIC_FAILURE'
          : 'PROGRAMME_UNAVAILABLE'
    );
  });
}

test('collisions touching changed deliveries block staging while an exact thirty-minute gap remains allowed', () => {
  const f = fixture();
  seed(
    f,
    snapshot([
      delivery('moving'),
      delivery('fixed', { scheduledAt: '2026-10-04T17:00:00.000Z' })
    ])
  );
  f.controller.select('moving');
  f.controller.shift(31);
  assert.equal(
    f.controller.warnings().some((w) => w.code === 'collision'),
    true
  );
  f.controller.stagePlan();
  assert.equal(f.pending(), null);
  f.controller.shift(-1);
  assert.equal(
    f.controller.warnings().some((w) => w.code === 'collision'),
    false
  );
  f.controller.stagePlan();
  assert.equal(
    f.pending().payload.moves[0].scheduledAt,
    '2026-10-04T16:30:00.000Z'
  );
});

test('an unrelated existing collision does not block another changed delivery', () => {
  const f = fixture();
  seed(
    f,
    snapshot([
      delivery('first'),
      delivery('collision', { scheduledAt: '2026-10-04T16:10:00.000Z' }),
      delivery('moving', { scheduledAt: '2026-10-05T16:00:00.000Z' })
    ])
  );
  f.controller.select('moving');
  f.controller.shift(30);
  assert.equal(
    f.controller.warnings().some((w) => w.code === 'collision'),
    true
  );
  f.controller.stagePlan();
  assert.equal(f.pending().payload.moves[0].id, 'moving');
  f.controller.resetPlan();
  f.controller.stagePlan();
  assert.equal(f.pending(), null);
});

for (const change of ['reset', 'feed', 'refresh']) {
  for (const outcome of ['success', 'failure']) {
    test(`a proposal ${outcome} after ${change} cannot recreate an invalidated plan`, async () => {
      const f = fixture();
      seed(f);
      const result = deferred();
      f.ports.api.proposeProgramme = () => result.promise;
      const proposing = f.controller.propose();
      if (change === 'reset') f.controller.resetPlan();
      else if (change === 'feed') f.controller.changeFeed('openg20:linkedin');
      else assert.equal(await f.controller.load(), true);
      if (outcome === 'success')
        result.resolve(
          proposal([
            {
              id: 'synthetic-draft',
              version: 3,
              scheduledAt: '2026-10-05T16:00:00.000Z'
            }
          ])
        );
      else result.reject(new Error('OBSOLETE_PROPOSAL'));
      await proposing;
      assert.deepEqual(f.controller.moves(), []);
      assert.equal(f.controller.planned(), false);
      assert.equal(f.controller.error(), '');
      assert.equal(f.working(), false);
      assert.equal(f.pending(), null);
    });
  }
}

for (const operation of ['load', 'propose']) {
  for (const outcome of ['success', 'failure']) {
    test(`disposed ${operation} ignores a late ${outcome}, including completion callbacks`, async () => {
      const f = fixture();
      seed(f);
      const result = deferred();
      f.ports.api.pilotageProgramme = () => result.promise;
      f.ports.api.proposeProgramme = () => result.promise;
      const request = f.controller[operation]();
      f.controller.dispose();
      const events = [...f.events];
      const before = {
        state: f.controller.state(),
        loading: f.controller.loading(),
        working: f.working()
      };
      if (outcome === 'success')
        result.resolve(operation === 'load' ? snapshot() : proposal());
      else result.reject(new Error('DISPOSED_FAILURE'));
      assert.equal(await request, operation === 'load' ? false : undefined);
      assert.equal(f.controller.state(), before.state);
      assert.equal(f.controller.loading(), before.loading);
      assert.equal(f.working(), before.working);
      assert.equal(f.controller.error(), '');
      assert.deepEqual(f.events, events);
      assert.equal(await f.controller.load(), false);
      await f.controller.propose();
      f.controller.resetPlan();
      f.controller.changeFeed('openg20:linkedin');
      f.controller.select('another');
      f.controller.shift(30);
      f.controller.stagePlan();
      f.controller.next(1);
      assert.deepEqual(f.events, events);
      assert.equal(f.controller.feedId(), 'openg7:facebook');
    });
  }
}
