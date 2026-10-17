import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { moderationDecision } from './support/moderation-ui-fixture.mjs';

const workspaceHook = registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier === '@openg7/funding-core'
      ? {
          url: new URL(
            '../dist/packages/funding-core/src/index.js',
            import.meta.url
          ).href,
          shortCircuit: true
        }
      : nextResolve(specifier, context);
  }
});
const { AdminSponsorSchedulingController } =
  await import('../dist/apps/funding-web/src/app/features/funding/services/admin-sponsor-scheduling-controller.js');
const { AdminDashboardRequestError } =
  await import('../dist/apps/funding-web/src/app/features/funding/services/funding-admin-session.js');
const { FundingAdminPublicationsClient } =
  await import('../dist/apps/funding-web/src/app/features/funding/services/funding-admin-publications.client.js');
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

const entry = (changes = {}) => ({
  draftId: 'synthetic-draft',
  sponsorshipId: 'synthetic-sponsor',
  feedId: 'openg7:facebook',
  name: 'Synthetic company',
  status: 'deferred',
  reason: 'AWAITING_PREPARATION',
  scheduledAt: null,
  deliveryId: null,
  nextOpportunity: {
    proposedAt: '2026-11-03T15:00:00.000Z',
    action: 'PREPARE_FEED',
    reason: 'AVAILABLE_IN_HORIZON',
    withinHorizon: true
  },
  ...changes
});

const delivery = (changes = {}) => ({
  id: 'synthetic-delivery',
  feedId: 'openg7:facebook',
  kind: 'sponsorship',
  message: 'Full synthetic company recognition.',
  scheduledAt: '2026-11-03T15:00:00.000Z',
  mediaId: null,
  accountId: 'synthetic-account',
  mode: 'mock',
  status: 'draft',
  version: 4,
  sponsors: [
    {
      id: 'synthetic-sponsor',
      name: 'Synthetic company',
      version: 'synthetic-sponsor-v2',
      reviewStatus: 'approved',
      presentationApproved: true
    }
  ],
  ...changes
});

const serverState = (changes = {}) => ({
  workerEnabled: false,
  workerVersion: 1,
  feeds: [],
  deliveries: [],
  queue: { entries: [entry()] },
  summary: {
    awaitingApproval: 0,
    scheduled: 0,
    exceptions: 0,
    publishedToday: 0
  },
  ...changes
});

const fixture = (t, initial = serverState()) => {
  const current = { state: initial };
  const calls = {
    reads: [],
    commands: [],
    moderate: [],
    confirmations: [],
    changed: 0
  };
  const ports = {
    admin: {
      publicationAutomation: async (command, filter) => {
        if (command) {
          calls.commands.push(command);
          return { id: command.id };
        }
        calls.reads.push(filter);
        return current.state;
      },
      publicationMedia: async () => [],
      publicationImagePreview: async () => new Blob(['synthetic image']),
      getSponsorMediaPreview: async () => new Blob(['synthetic source']),
      getSavedAdminToken: () => 'synthetic-admin'
    },
    i18n: { t: (key) => key, currentLanguage: () => 'fr-CA' },
    moderate: async (subject, level) => {
      calls.moderate.push({ subject, level });
      return moderationDecision(subject, level);
    },
    confirm: async (message, title) => {
      calls.confirmations.push({ message, title });
      return true;
    },
    changed: () => calls.changed++
  };
  const controller = new AdminSponsorSchedulingController(ports);
  t.after(() => controller.dispose());
  return { controller, ports, current, calls };
};

test('opening the dossier reads its forecast without preparing or approving anything', async (t) => {
  const f = fixture(t);
  await f.controller.load('synthetic-sponsor');
  assert.deepEqual(f.calls.reads, [{ sponsorshipId: 'synthetic-sponsor' }]);
  assert.equal(
    f.controller.entries()[0].nextOpportunity.proposedAt,
    '2026-11-03T15:00:00.000Z'
  );
  assert.equal(f.controller.delivery.selected(), null);
  assert.equal(f.controller.busy(), false);
  assert.equal(f.controller.loading(), false);
  assert.deepEqual(f.calls.commands, []);
  assert.deepEqual(f.calls.moderate, []);
  assert.equal(f.calls.changed, 0);
});

test('only the exact delivery with the dossier among its participants can be opened', async (t) => {
  const exact = delivery();
  const foreign = delivery({
    id: 'synthetic-foreign',
    sponsors: [{ id: 'synthetic-other' }]
  });
  const f = fixture(
    t,
    serverState({
      deliveries: [exact, foreign],
      queue: {
        entries: [entry(), entry({ sponsorshipId: 'synthetic-other' })]
      }
    })
  );
  await f.controller.load('synthetic-sponsor');
  assert.deepEqual(f.controller.state().deliveries, [exact]);
  assert.equal(f.controller.entries().length, 1);
  await f.controller.open(foreign.id);
  assert.equal(f.controller.delivery.selected(), null);
  assert.equal(
    f.controller.error(),
    'admin.dossier.publicationBridge.schedule.missingDelivery'
  );
  f.controller.open(exact.id);
  assert.equal(f.controller.delivery.selected(), exact);
  assert.equal(f.controller.delivery.editing(), false);
  assert.equal(f.controller.delivery.dirty(), false);
  assert.equal(f.controller.error(), '');
  await f.controller.delivery.approve();
  assert.deepEqual(f.calls.commands, []);
});

test('the proposed date stays unchanged until an explicit reviewed approval is confirmed by the server', async (t) => {
  const exact = delivery();
  const f = fixture(t, serverState({ deliveries: [exact] }));
  await f.controller.load('synthetic-sponsor');
  f.controller.open(exact.id);
  f.controller.delivery.approved = true;
  const confirmingRead = deferred();
  f.ports.admin.publicationAutomation = async (command, filter) => {
    if (command) {
      f.calls.commands.push(command);
      return { id: command.id };
    }
    f.calls.reads.push(filter);
    return confirmingRead.promise;
  };
  const pending = f.controller.delivery.approve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.controller.busy(), true);
  assert.equal(f.calls.changed, 0);
  assert.equal(f.controller.delivery.selected().status, 'draft');
  assert.equal(f.calls.commands.length, 1);
  assert.equal(f.calls.commands[0].action, 'approve');
  assert.equal(f.calls.commands[0].id, exact.id);
  assert.equal(f.calls.commands[0].version, exact.version);
  assert.equal(f.calls.commands[0].confirmation, exact.id);
  const confirmed = delivery({ status: 'approved', version: 5 });
  confirmingRead.resolve(serverState({ deliveries: [confirmed] }));
  await pending;
  assert.equal(f.controller.busy(), false);
  assert.equal(f.controller.delivery.selected(), confirmed);
  assert.equal(f.controller.delivery.selected().scheduledAt, exact.scheduledAt);
  assert.equal(f.controller.delivery.approved, false);
  assert.equal(f.calls.changed, 1);
  assert.deepEqual(f.calls.reads.at(-1), {
    sponsorshipId: 'synthetic-sponsor'
  });
});

test('editing the proposed date saves a new draft without granting approval', async (t) => {
  const exact = delivery();
  const f = fixture(t, serverState({ deliveries: [exact] }));
  await f.controller.load('synthetic-sponsor');
  f.controller.open(exact.id, true);
  assert.equal(f.controller.delivery.editing(), true);
  f.controller.delivery.approved = true;
  f.controller.delivery.changeEdit('scheduledAt', '2026-11-04T11:30');
  const expectedDate = new Date('2026-11-04T11:30').toISOString();
  assert.equal(f.controller.delivery.approved, false);
  f.current.state = serverState({
    deliveries: [delivery({ scheduledAt: expectedDate, version: 5 })]
  });
  await f.controller.delivery.save();
  assert.equal(f.calls.commands.length, 1);
  assert.equal(f.calls.commands[0].action, 'edit');
  assert.equal(f.calls.commands[0].scheduledAt, expectedDate);
  assert.equal(f.controller.delivery.selected().status, 'draft');
  assert.equal(f.controller.delivery.dirty(), false);
  assert.equal(f.calls.changed, 1);
});

test('same-dossier reloads and failures keep the open review and unsaved human edits', async (t) => {
  const exact = delivery();
  const f = fixture(t, serverState({ deliveries: [exact] }));
  await f.controller.load('synthetic-sponsor');
  f.controller.open(exact.id, true);
  f.controller.delivery.changeEdit('message', 'Unsaved synthetic correction');
  f.current.state = serverState({
    deliveries: [delivery({ message: 'New server message', version: 5 })]
  });
  await f.controller.load('synthetic-sponsor');
  assert.equal(f.controller.delivery.selected(), exact);
  assert.equal(
    f.controller.delivery.edit.message,
    'Unsaved synthetic correction'
  );
  assert.equal(f.controller.delivery.editing(), true);
  f.ports.admin.publicationAutomation = async () => {
    throw new Error('Synthetic private diagnostic');
  };
  assert.equal(await f.controller.refresh(), false);
  assert.equal(
    f.controller.delivery.edit.message,
    'Unsaved synthetic correction'
  );
  assert.equal(f.controller.delivery.selected(), exact);
  assert.equal(f.controller.state().deliveries[0].version, 5);
  assert.equal(
    f.controller.error(),
    'admin.dossier.publicationBridge.schedule.loadFailed'
  );
  await f.controller.delivery.save();
  assert.deepEqual(f.calls.commands, []);
  assert.equal(
    f.controller.error(),
    'admin.publicationAutomation.errors.VERSION_CONFLICT'
  );
});

test('a failed mutation refreshes facts but keeps edits and does not report success or retry', async (t) => {
  const exact = delivery();
  const f = fixture(t, serverState({ deliveries: [exact] }));
  await f.controller.load('synthetic-sponsor');
  f.controller.open(exact.id, true);
  f.controller.delivery.changeEdit('message', 'Unsaved synthetic correction');
  f.ports.admin.publicationAutomation = async (command, filter) => {
    if (command) {
      f.calls.commands.push(command);
      throw new Error('VERSION_CONFLICT');
    }
    f.calls.reads.push(filter);
    return serverState({ deliveries: [delivery({ version: 5 })] });
  };
  await f.controller.delivery.save();
  assert.equal(f.calls.commands.length, 1);
  assert.equal(f.controller.delivery.selected(), exact);
  assert.equal(
    f.controller.delivery.edit.message,
    'Unsaved synthetic correction'
  );
  assert.equal(f.controller.delivery.editing(), true);
  assert.equal(f.controller.state().deliveries[0].version, 5);
  assert.equal(f.controller.busy(), false);
  assert.equal(f.controller.notice(), '');
  assert.equal(f.calls.changed, 0);
  assert.equal(
    f.controller.error(),
    'admin.publicationAutomation.errors.VERSION_CONFLICT'
  );
});

test('refreshing a clean review updates the exact server version after moderation', async (t) => {
  const f = fixture(t, serverState({ deliveries: [delivery()] }));
  await f.controller.load('synthetic-sponsor');
  f.controller.open('synthetic-delivery');
  const refreshed = delivery({ status: 'blocked', version: 5 });
  f.current.state = serverState({ deliveries: [refreshed] });
  await f.controller.delivery.refreshModeration();
  assert.equal(f.controller.delivery.selected(), refreshed);
  assert.equal(f.calls.changed, 0);
  assert.deepEqual(f.calls.commands, []);
});

test('a confirmed removal or lost dossier membership closes review and clears its unsaved private content', async (t) => {
  for (const revoked of ['missing', 'membership'])
    await t.test(revoked, async (t) => {
      const f = fixture(t, serverState({ deliveries: [delivery()] }));
      await f.controller.load('synthetic-sponsor');
      f.controller.open('synthetic-delivery', true);
      f.controller.delivery.changeEdit(
        'message',
        'Unsaved synthetic correction'
      );
      f.current.state = serverState({
        deliveries:
          revoked === 'missing'
            ? []
            : [delivery({ sponsors: [{ id: 'synthetic-other' }] })]
      });
      await f.controller.refresh();
      assert.equal(f.controller.delivery.selected(), null);
      assert.equal(f.controller.delivery.editing(), false);
      assert.equal(f.controller.delivery.edit.message, '');
      assert.deepEqual(f.controller.state().deliveries, []);
      assert.equal(
        f.controller.error(),
        'admin.dossier.publicationBridge.schedule.missingDelivery'
      );
      await f.controller.delivery.approve();
      await f.controller.delivery.save();
      assert.deepEqual(f.calls.commands, []);
    });
});

test('late reads from a previous dossier cannot replace the current forecast or reopen its panel', async (t) => {
  const f = fixture(t, serverState({ deliveries: [delivery()] }));
  await f.controller.load('synthetic-sponsor');
  f.controller.open('synthetic-delivery');
  const oldRead = deferred();
  f.ports.admin.publicationAutomation = async (_command, filter) =>
    filter.sponsorshipId === 'synthetic-sponsor'
      ? oldRead.promise
      : serverState({ queue: { entries: [] } });
  const pending = f.controller.refresh();
  await f.controller.load('synthetic-other');
  assert.equal(f.controller.delivery.selected(), null);
  oldRead.resolve(serverState({ deliveries: [delivery()] }));
  assert.equal(await pending, false);
  assert.deepEqual(f.controller.entries(), []);
  assert.deepEqual(f.controller.state().deliveries, []);
  assert.equal(f.controller.loading(), false);
});

test('expired or forbidden reads and commands remove private state and invalidate the open review', async (t) => {
  for (const status of [401, 403])
    for (const phase of ['read', 'command', 'confirmingRead', 'recoveryRead'])
      await t.test(`${status} ${phase}`, async (t) => {
        const f = fixture(t, serverState({ deliveries: [delivery()] }));
        await f.controller.load('synthetic-sponsor');
        f.controller.open('synthetic-delivery', true);
        f.controller.delivery.changeEdit(
          'message',
          'Unsaved private correction'
        );
        f.ports.admin.publicationAutomation = async (command) => {
          if (command) {
            f.calls.commands.push(command);
            if (phase === 'command')
              throw new AdminDashboardRequestError(status);
            if (phase === 'recoveryRead') throw new Error('VERSION_CONFLICT');
            return { id: command.id };
          }
          if (phase !== 'command') throw new AdminDashboardRequestError(status);
          return f.current.state;
        };
        if (phase === 'read') await f.controller.refresh();
        else await f.controller.delivery.save();
        assert.equal(f.controller.state(), null);
        assert.equal(f.controller.delivery.selected(), null);
        assert.equal(f.controller.delivery.edit.message, '');
        assert.equal(f.controller.error(), 'admin.privacy.forbidden');
        assert.equal(f.controller.notice(), '');
        assert.equal(f.controller.loading(), false);
        assert.equal(f.controller.busy(), false);
        assert.equal(f.calls.changed, 0);
      });
});

test('a failed save reconciles facts and releases loading while a concurrent refresh is still pending', async (t) => {
  const f = fixture(t, serverState({ deliveries: [delivery()] }));
  await f.controller.load('synthetic-sponsor');
  await f.controller.open('synthetic-delivery', true);
  f.controller.delivery.changeEdit('message', 'Unsaved synthetic correction');
  const commandResponse = deferred();
  const concurrentRead = deferred();
  let reads = 0;
  const updated = delivery({ version: 5 });
  f.ports.admin.publicationAutomation = async (command) => {
    if (command) {
      f.calls.commands.push(command);
      return commandResponse.promise;
    }
    return ++reads === 1
      ? concurrentRead.promise
      : serverState({ deliveries: [updated] });
  };
  const pendingSave = f.controller.delivery.save();
  const pendingRefresh = f.controller.refresh();
  assert.equal(f.controller.loading(), true);
  assert.equal(f.controller.busy(), true);
  commandResponse.reject(new Error('VERSION_CONFLICT'));
  await pendingSave;
  assert.equal(f.controller.loading(), false);
  assert.equal(f.controller.busy(), false);
  assert.equal(f.controller.state().deliveries[0], updated);
  assert.equal(
    f.controller.delivery.edit.message,
    'Unsaved synthetic correction'
  );
  assert.equal(
    f.controller.error(),
    'admin.publicationAutomation.errors.VERSION_CONFLICT'
  );
  concurrentRead.resolve(serverState({ deliveries: [delivery()] }));
  assert.equal(await pendingRefresh, false);
  assert.equal(f.controller.loading(), false);
  assert.equal(f.controller.state().deliveries[0], updated);
  assert.equal(f.calls.commands.length, 1);
  assert.equal(f.calls.changed, 0);
});

test('a historical delivery is fetched exactly and keeps the dossier forecast and other 200 deliveries through moderation', async (t) => {
  const recent = Array.from({ length: 200 }, (_, index) =>
    delivery({ id: `synthetic-recent-${index}` })
  );
  let historical = delivery({ id: 'synthetic-historical', version: 7 });
  const f = fixture(t, serverState({ deliveries: recent }));
  f.ports.admin.publicationAutomation = async (command, filter) => {
    assert.equal(command, undefined);
    f.calls.reads.push(filter);
    return filter.deliveryId
      ? serverState({ deliveries: [historical], queue: { entries: [] } })
      : f.current.state;
  };
  await f.controller.load('synthetic-sponsor');
  await f.controller.open(historical.id);
  assert.deepEqual(f.calls.reads.at(-1), {
    sponsorshipId: 'synthetic-sponsor',
    deliveryId: 'synthetic-historical'
  });
  assert.equal(f.controller.delivery.selected(), historical);
  assert.equal(f.controller.state().deliveries.length, 201);
  assert.deepEqual(f.controller.entries(), [entry()]);
  historical = delivery({ id: historical.id, version: 8, status: 'blocked' });
  await f.controller.delivery.refreshModeration();
  assert.equal(f.controller.delivery.selected(), historical);
  assert.equal(f.controller.state().deliveries.length, 201);
  assert.equal(f.controller.state().deliveries[0], recent[0]);
  assert.deepEqual(f.controller.entries(), [entry()]);
  assert.deepEqual(f.calls.commands, []);
});

test('a historical draft can be edited and explicitly approved without losing other dossier cards', async (t) => {
  const recent = delivery();
  let historical = delivery({ id: 'synthetic-historical', version: 7 });
  const f = fixture(t, serverState({ deliveries: [recent] }));
  f.ports.admin.publicationAutomation = async (command, filter) => {
    if (command) {
      f.calls.commands.push(command);
      assert.equal(command.id, historical.id);
      assert.equal(command.version, historical.version);
      historical = delivery({
        ...historical,
        version: historical.version + 1,
        message: command.message ?? historical.message,
        status: command.action === 'approve' ? 'approved' : 'draft'
      });
      return { id: command.id };
    }
    f.calls.reads.push(filter);
    return filter.deliveryId
      ? serverState({ deliveries: [historical], queue: { entries: [] } })
      : f.current.state;
  };
  await f.controller.load('synthetic-sponsor');
  await f.controller.open(historical.id, true);
  f.controller.delivery.changeEdit(
    'message',
    'Reviewed synthetic recognition.'
  );
  await f.controller.delivery.save();
  assert.equal(f.controller.delivery.selected(), historical);
  assert.equal(f.controller.delivery.selected().version, 8);
  assert.equal(f.controller.delivery.dirty(), false);
  assert.equal(f.controller.state().deliveries.length, 2);
  assert.equal(f.controller.state().deliveries[0], recent);
  f.controller.delivery.approved = true;
  await f.controller.delivery.approve();
  assert.equal(f.controller.delivery.selected(), historical);
  assert.equal(f.controller.delivery.selected().status, 'approved');
  assert.equal(f.controller.delivery.selected().version, 9);
  assert.deepEqual(
    f.calls.commands.map((command) => command.action),
    ['edit', 'approve']
  );
  assert.equal(f.calls.changed, 2);
  assert.equal(f.controller.state().deliveries[0], recent);
  assert.deepEqual(f.controller.entries(), [entry()]);
});

test('refreshing a historical draft preserves human edits and detects an updated server version', async (t) => {
  let historical = delivery({ id: 'synthetic-historical', version: 7 });
  const f = fixture(t, serverState({ deliveries: [delivery()] }));
  f.ports.admin.publicationAutomation = async (command, filter) => {
    if (command) {
      f.calls.commands.push(command);
      return { id: command.id };
    }
    return filter.deliveryId
      ? serverState({ deliveries: [historical] })
      : f.current.state;
  };
  await f.controller.load('synthetic-sponsor');
  await f.controller.open(historical.id, true);
  f.controller.delivery.changeEdit('message', 'Unsaved historical correction');
  const selected = historical;
  historical = delivery({ id: historical.id, version: 8 });
  await f.controller.refresh();
  assert.equal(f.controller.delivery.selected(), selected);
  assert.equal(
    f.controller.delivery.edit.message,
    'Unsaved historical correction'
  );
  assert.equal(
    f.controller.state().deliveries.find((job) => job.id === historical.id),
    historical
  );
  await f.controller.delivery.save();
  assert.deepEqual(f.calls.commands, []);
  assert.equal(
    f.controller.error(),
    'admin.publicationAutomation.errors.VERSION_CONFLICT'
  );
});

test('targeted opening rejects an unrelated or missing delivery without replacing the dossier state', async (t) => {
  for (const result of ['missing', 'foreign', 'wrong-id'])
    await t.test(result, async (t) => {
      const initial = serverState({ deliveries: [delivery()] });
      const f = fixture(t, initial);
      await f.controller.load('synthetic-sponsor');
      const state = f.controller.state();
      f.ports.admin.publicationAutomation = async (_command, filter) => {
        f.calls.reads.push(filter);
        return serverState({
          deliveries:
            result === 'missing'
              ? []
              : [
                  delivery({
                    id:
                      result === 'wrong-id'
                        ? 'synthetic-wrong'
                        : 'synthetic-historical',
                    sponsors: [
                      {
                        id:
                          result === 'foreign'
                            ? 'synthetic-other'
                            : 'synthetic-sponsor'
                      }
                    ]
                  })
                ]
        });
      };
      await f.controller.open('synthetic-historical');
      assert.equal(f.controller.delivery.selected(), null);
      assert.equal(f.controller.state(), state);
      assert.equal(
        f.controller.error(),
        'admin.dossier.publicationBridge.schedule.missingDelivery'
      );
      assert.deepEqual(f.calls.commands, []);
    });
});

test('a late targeted result cannot reopen a previous selection or another dossier', async (t) => {
  for (const navigation of ['selection', 'dossier'])
    await t.test(navigation, async (t) => {
      const f = fixture(t, serverState({ deliveries: [delivery()] }));
      await f.controller.load('synthetic-sponsor');
      const targeted = deferred();
      f.ports.admin.publicationAutomation = async (_command, filter) => {
        f.calls.reads.push(filter);
        return filter.deliveryId
          ? targeted.promise
          : serverState({
              deliveries: [delivery({ sponsors: [{ id: 'synthetic-other' }] })],
              queue: { entries: [] }
            });
      };
      const pending = f.controller.open('synthetic-historical');
      if (navigation === 'selection')
        await f.controller.open('synthetic-delivery');
      else await f.controller.load('synthetic-other');
      targeted.resolve(
        serverState({ deliveries: [delivery({ id: 'synthetic-historical' })] })
      );
      await pending;
      assert.equal(
        f.controller.delivery.selected()?.id ?? null,
        navigation === 'selection' ? 'synthetic-delivery' : null
      );
      assert.equal(
        f.controller
          .state()
          .deliveries.some((job) => job.id === 'synthetic-historical'),
        false
      );
    });
});

test('a general read from the old dossier cannot start a historical lookup after navigation', async (t) => {
  const f = fixture(t, serverState({ deliveries: [delivery()] }));
  await f.controller.load('synthetic-sponsor');
  await f.controller.open('synthetic-delivery');
  const oldRead = deferred();
  f.ports.admin.publicationAutomation = async (_command, filter) => {
    f.calls.reads.push(filter);
    return filter.sponsorshipId === 'synthetic-sponsor'
      ? oldRead.promise
      : serverState({ queue: { entries: [] } });
  };
  const pending = f.controller.refresh();
  await f.controller.load('synthetic-other');
  oldRead.resolve(serverState({ deliveries: [] }));
  assert.equal(await pending, false);
  assert.equal(
    f.calls.reads.some((filter) => filter.deliveryId),
    false
  );
  assert.equal(f.controller.delivery.selected(), null);
});

test('denied targeted lookups clear all private dossier content, including during recovery', async (t) => {
  for (const status of [401, 403])
    for (const phase of ['open', 'refresh', 'recovery'])
      await t.test(`${status} ${phase}`, async (t) => {
        const f = fixture(t, serverState({ deliveries: [delivery()] }));
        await f.controller.load('synthetic-sponsor');
        await f.controller.open('synthetic-delivery', true);
        f.controller.delivery.changeEdit(
          'message',
          'Private synthetic correction'
        );
        f.ports.admin.publicationAutomation = async (command, filter) => {
          if (command) throw new Error('VERSION_CONFLICT');
          if (filter.deliveryId) throw new AdminDashboardRequestError(status);
          return serverState({ deliveries: [] });
        };
        if (phase === 'open') {
          f.controller.delivery.close();
          await f.controller.open('synthetic-historical');
        } else if (phase === 'refresh') await f.controller.refresh();
        else await f.controller.delivery.save();
        assert.equal(f.controller.state(), null);
        assert.equal(f.controller.delivery.selected(), null);
        assert.equal(f.controller.delivery.edit.message, '');
        assert.equal(f.controller.error(), 'admin.privacy.forbidden');
        assert.equal(f.controller.loading(), false);
        assert.equal(f.controller.busy(), false);
        assert.equal(f.calls.changed, 0);
      });
});

test('a stale denied refresh cannot clear a newer successful dossier review', async (t) => {
  for (const status of [401, 403])
    await t.test(`${status}`, async (t) => {
      const f = fixture(t, serverState({ deliveries: [delivery()] }));
      await f.controller.load('synthetic-sponsor');
      await f.controller.open('synthetic-delivery');
      const staleRead = deferred();
      let reads = 0;
      const current = delivery({ version: 5 });
      f.ports.admin.publicationAutomation = async () =>
        ++reads === 1
          ? staleRead.promise
          : serverState({ deliveries: [current] });
      const pending = f.controller.refresh();
      assert.equal(await f.controller.refresh(), true);
      assert.equal(f.controller.delivery.selected(), current);
      staleRead.reject(new AdminDashboardRequestError(status));
      assert.equal(await pending, false);
      assert.equal(f.controller.delivery.selected(), current);
      assert.equal(f.controller.state().deliveries[0], current);
      assert.equal(f.controller.error(), '');
      assert.equal(f.controller.loading(), false);
    });
});

test('a stale denied targeted opening cannot clear the replacement review', async (t) => {
  const f = fixture(t, serverState({ deliveries: [delivery()] }));
  await f.controller.load('synthetic-sponsor');
  const staleRead = deferred();
  f.ports.admin.publicationAutomation = async () => staleRead.promise;
  const pending = f.controller.open('synthetic-historical');
  await f.controller.open('synthetic-delivery');
  const selected = f.controller.delivery.selected();
  staleRead.reject(new AdminDashboardRequestError(403));
  await pending;
  assert.equal(f.controller.delivery.selected(), selected);
  assert.equal(f.controller.state().deliveries[0], selected);
  assert.equal(f.controller.error(), '');
});

test('fresh dossier candidates are scoped and allow explicit preparation before any draft exists', async (t) => {
  const candidate = {
    obligationId: 'synthetic-obligation',
    sponsorshipId: 'synthetic-sponsor',
    name: 'Synthetic company',
    feedId: 'openg7:facebook',
    publicationFormat: 'collective_text',
    renderedLength: 120,
    budget: 500,
    nextOpportunity: entry().nextOpportunity
  };
  const foreign = {
    ...candidate,
    obligationId: 'synthetic-other-obligation',
    sponsorshipId: 'synthetic-other',
    feedId: 'openg20:facebook'
  };
  const f = fixture(
    t,
    serverState({
      queue: { entries: [] },
      preparationCandidates: [candidate, foreign]
    })
  );
  await f.controller.load('synthetic-sponsor');
  assert.deepEqual(f.controller.entries(), []);
  assert.deepEqual(f.controller.candidates(), [candidate]);
  assert.deepEqual(f.controller.state().preparationCandidates, [candidate]);
  assert.deepEqual(f.calls.commands, []);
  await f.controller.prepare('openg20:facebook');
  assert.deepEqual(f.calls.commands, []);
  f.current.state = serverState({
    deliveries: [delivery()],
    queue: { entries: [entry({ deliveryId: 'synthetic-delivery' })] }
  });
  await f.controller.prepare(candidate.feedId);
  assert.deepEqual(f.calls.commands, [
    { action: 'prepare', feedId: candidate.feedId }
  ]);
  assert.equal(f.controller.delivery.selected()?.id, 'synthetic-delivery');
  assert.equal(f.controller.delivery.approved, false);
});

test('private preview access loss clears the dossier instead of retaining an actionable drawer', async (t) => {
  const f = fixture(t, serverState({ deliveries: [delivery()] }));
  await f.controller.load('synthetic-sponsor');
  f.ports.admin.publicationMedia = async () => {
    throw new AdminDashboardRequestError(403);
  };
  f.controller.open('synthetic-delivery');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.controller.state(), null);
  assert.equal(f.controller.delivery.selected(), null);
  assert.equal(f.controller.error(), 'admin.privacy.forbidden');
});

test('publication transport preserves denial status and existing error codes for reads, edits and previews', async () => {
  for (const status of [401, 403]) {
    const client = new FundingAdminPublicationsClient({
      requestAdminJson: async () =>
        new Response(JSON.stringify({ code: 'SYNTHETIC_DENIED' }), { status })
    });
    for (const request of [
      () => client.publicationAutomation(),
      () =>
        client.publicationAutomation({
          action: 'prepare',
          feedId: 'openg7:facebook'
        }),
      () => client.publicationMedia('synthetic-delivery'),
      () =>
        client.publicationImagePreview('synthetic-delivery', 4, 'a'.repeat(64))
    ])
      await assert.rejects(request, (error) => {
        assert.ok(error instanceof AdminDashboardRequestError);
        assert.equal(error.status, status);
        assert.match(error.message, /SYNTHETIC_DENIED|AUTOMATION_UNAVAILABLE/);
        return true;
      });
  }
});

test('explicit preparation opens only the resulting proposal for this dossier and feed', async (t) => {
  const f = fixture(t);
  await f.controller.load('synthetic-sponsor');
  const exact = delivery();
  const foreign = delivery({
    id: 'synthetic-other-feed',
    feedId: 'openg7:linkedin'
  });
  f.current.state = serverState({
    deliveries: [foreign, exact],
    queue: {
      entries: [
        entry({
          feedId: 'openg7:linkedin',
          deliveryId: foreign.id,
          reason: 'AWAITING_APPROVAL'
        }),
        entry({ deliveryId: exact.id, reason: 'AWAITING_APPROVAL' })
      ]
    }
  });
  await f.controller.prepare('openg20:facebook');
  assert.deepEqual(f.calls.commands, []);
  await f.controller.prepare('openg7:facebook');
  assert.deepEqual(f.calls.commands, [
    { action: 'prepare', feedId: 'openg7:facebook' }
  ]);
  assert.deepEqual(f.calls.confirmations, [
    {
      message: 'admin.dossier.publicationBridge.schedule.prepareConfirm',
      title: 'openg7:facebook'
    }
  ]);
  assert.equal(f.controller.delivery.selected(), exact);
  assert.equal(f.controller.delivery.selected().status, 'draft');
  assert.equal(f.controller.delivery.approved, false);
  assert.deepEqual(f.calls.moderate, []);
  assert.equal(f.calls.changed, 1);
});

test('a preparation that remains deferred never opens another dossier or approves anything', async (t) => {
  const f = fixture(t);
  await f.controller.load('synthetic-sponsor');
  f.current.state = serverState({
    deliveries: [delivery({ sponsors: [{ id: 'synthetic-other' }] })],
    queue: { entries: [entry({ deliveryId: 'synthetic-delivery' })] }
  });
  await f.controller.prepare('openg7:facebook');
  assert.equal(f.calls.commands.length, 1);
  assert.equal(f.controller.delivery.selected(), null);
  assert.deepEqual(f.calls.moderate, []);
});

test('preparation failure grants no approval and is never retried automatically', async (t) => {
  const f = fixture(t);
  await f.controller.load('synthetic-sponsor');
  f.ports.admin.publicationAutomation = async (command, filter) => {
    if (command) {
      f.calls.commands.push(command);
      throw new Error('CONNECTION_REQUIRED');
    }
    f.calls.reads.push(filter);
    return f.current.state;
  };
  await f.controller.prepare('openg7:facebook');
  assert.equal(f.calls.commands.length, 1);
  assert.equal(f.controller.delivery.selected(), null);
  assert.equal(f.controller.notice(), '');
  assert.equal(f.calls.changed, 0);
  assert.deepEqual(f.calls.moderate, []);
  assert.equal(
    f.controller.error(),
    'admin.publicationAutomation.errors.CONNECTION_REQUIRED'
  );
});

test('preparation needs confirmation and rechecks its dossier after the confirmation dialog', async (t) => {
  const f = fixture(t);
  await f.controller.load('synthetic-sponsor');
  f.ports.confirm = async () => false;
  await f.controller.prepare('openg7:facebook');
  assert.deepEqual(f.calls.commands, []);
  const confirmation = deferred();
  f.ports.confirm = async () => confirmation.promise;
  const pending = f.controller.prepare('openg7:facebook');
  await f.controller.load('synthetic-other');
  confirmation.resolve(true);
  await pending;
  assert.deepEqual(f.calls.commands, []);
  assert.equal(f.controller.delivery.selected(), null);
});

test('dossier navigation during a pending mutation discards its late confirmation', async (t) => {
  const f = fixture(t, serverState({ deliveries: [delivery()] }));
  await f.controller.load('synthetic-sponsor');
  f.controller.open('synthetic-delivery', true);
  f.controller.delivery.changeEdit('message', 'Synthetic edit');
  const commandResponse = deferred();
  f.ports.admin.publicationAutomation = async (command, filter) => {
    if (command) {
      f.calls.commands.push(command);
      return commandResponse.promise;
    }
    f.calls.reads.push(filter);
    return serverState({ queue: { entries: [] } });
  };
  const pending = f.controller.delivery.save();
  await f.controller.load('synthetic-other');
  commandResponse.resolve({ id: 'synthetic-delivery' });
  await pending;
  assert.equal(f.controller.delivery.selected(), null);
  assert.deepEqual(f.controller.entries(), []);
  assert.equal(f.controller.busy(), false);
  assert.equal(f.controller.notice(), '');
  assert.equal(f.calls.changed, 0);
});

test('the dossier review cannot compose an unrelated publication', async (t) => {
  const f = fixture(t);
  await f.controller.load('synthetic-sponsor');
  f.controller.delivery.create();
  await f.controller.delivery.save();
  assert.deepEqual(f.calls.commands, []);
  f.controller.dispose();
  await f.controller.load('synthetic-other');
  await f.controller.prepare('openg7:facebook');
  assert.deepEqual(f.calls.commands, []);
});
