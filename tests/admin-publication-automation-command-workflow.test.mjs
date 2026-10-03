import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { signal } from '@angular/core';

import { AdminPublicationAutomationCommandWorkflow } from '../dist/apps/funding-web/src/app/features/funding/pages/admin-publication-automation-page/admin-publication-automation-command-workflow.js';

const approval = {
  action: 'approve',
  id: 'synthetic-delivery',
  version: 7,
  confirmation: 'synthetic-delivery',
  approveSponsors: [
    { id: 'synthetic-sponsor', version: 'synthetic-dossier-v3' }
  ]
};
const filter = {
  sponsorshipId: 'synthetic-sponsor',
  deliveryId: 'synthetic-delivery'
};
const feedSettings = (overrides = {}) => ({
  id: 'openg7:facebook',
  paused: true,
  autoPrepare: true,
  timezone: 'America/Toronto',
  weekdays: [1, 3],
  localTime: '09:30',
  capacity: 2,
  horizonDays: 7,
  ...overrides
});
const feed = (overrides = {}) => ({
  ...feedSettings(),
  mode: 'mock',
  accountId: 'synthetic-account',
  configured: true,
  expiresAt: null,
  connection: 'ready',
  checkedAt: null,
  ...overrides
});
const serverState = (overrides = {}) => ({
  workerEnabled: false,
  workerVersion: 4,
  feeds: [],
  deliveries: [],
  summary: {
    awaitingApproval: 0,
    scheduled: 0,
    exceptions: 0,
    publishedToday: 0
  },
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
    notice: signal('prior-notice')
  };
  const page = { revision: 1, destroyed: false, filter: { ...filter } };
  const calls = {
    commands: [],
    reads: [],
    applied: [],
    confirmed: [],
    errors: [],
    order: []
  };
  const next = serverState();
  const ports = {
    state,
    capture: () => ({ revision: page.revision, filter: { ...page.filter } }),
    isCurrent: (context) =>
      !page.destroyed && context.revision === page.revision,
    applyState: (value) => {
      calls.applied.push(value);
      calls.order.push('apply');
    },
    showError: (error) => {
      calls.errors.push(error);
      state.error.set(error instanceof Error ? error.message : 'generic');
    },
    confirmed: (command, result, value, open) => {
      calls.confirmed.push({ command, result, next: value, open });
      calls.order.push('confirmed');
    },
    api: {
      execute: async (command) => {
        calls.commands.push(command);
        calls.order.push('command');
        return { id: 'synthetic-delivery' };
      },
      read: async (value) => {
        calls.reads.push(value);
        calls.order.push('read');
        return next;
      }
    }
  };
  return {
    workflow: new AdminPublicationAutomationCommandWorkflow(ports),
    ports,
    state,
    page,
    calls,
    next
  };
};

test('approval preserves exact delivery and sponsor versions and waits for the filtered server read before feedback', async () => {
  const f = fixture();
  const read = deferred();
  f.ports.api.read = async (value) => {
    f.calls.reads.push(value);
    return read.promise;
  };
  const pending = f.workflow.run(approval, true);
  await Promise.resolve();

  assert.equal(f.state.busy(), true);
  assert.equal(f.state.error(), '');
  assert.equal(f.state.notice(), '');
  assert.deepEqual(f.calls.commands, [approval]);
  assert.deepEqual(f.calls.reads, [filter]);
  assert.deepEqual(f.calls.applied, []);
  assert.deepEqual(f.calls.confirmed, []);

  read.resolve(f.next);
  await pending;
  assert.equal(f.state.busy(), false);
  assert.deepEqual(f.calls.applied, [f.next]);
  assert.deepEqual(f.calls.confirmed, [
    {
      command: approval,
      result: { id: 'synthetic-delivery' },
      next: f.next,
      open: true
    }
  ]);
  assert.equal(f.state.notice(), 'admin.publicationAutomation.saved');
});

test('prepare, connection check and ordinary mutations retain their distinct confirmed feedback', async () => {
  for (const [command, notice] of [
    [
      { action: 'prepare', feedId: 'openg7:facebook' },
      'admin.publicationAutomation.settingsPanel.prepared'
    ],
    [
      { action: 'check', feedId: 'openg20:linkedin' },
      'admin.publicationAutomation.settingsPanel.checked'
    ],
    [approval, 'admin.publicationAutomation.saved']
  ]) {
    const f = fixture();
    await f.workflow.run(command);
    assert.deepEqual(f.calls.order, ['command', 'read', 'apply', 'confirmed']);
    assert.equal(f.state.notice(), notice);
    assert.equal(f.calls.confirmed[0].open, false);
  }
});

test('the busy lock rejects concurrent commands through both execution and the confirming read', async () => {
  const f = fixture();
  const command = deferred();
  const read = deferred();
  f.ports.api.execute = async (value) => {
    f.calls.commands.push(value);
    return command.promise;
  };
  f.ports.api.read = async (value) => {
    f.calls.reads.push(value);
    return read.promise;
  };
  const pending = f.workflow.run(approval);
  await f.workflow.run({ action: 'pause-all' });
  assert.deepEqual(f.calls.commands, [approval]);
  command.resolve({ id: approval.id });
  await Promise.resolve();
  await f.workflow.run({ action: 'pause-all' });
  assert.deepEqual(f.calls.commands, [approval]);
  assert.equal(f.state.busy(), true);
  read.resolve(f.next);
  await pending;
  await f.workflow.run({ action: 'pause-all' });
  assert.deepEqual(f.calls.commands, [approval, { action: 'pause-all' }]);
  assert.equal(f.state.busy(), false);
});

test('an already locked workflow leaves feedback intact and performs no request', async () => {
  const f = fixture();
  f.state.busy.set(true);
  await f.workflow.run(approval);
  assert.deepEqual(f.calls.commands, []);
  assert.deepEqual(f.calls.reads, []);
  assert.equal(f.state.error(), 'prior-error');
  assert.equal(f.state.notice(), 'prior-notice');
  assert.equal(f.state.busy(), true);
});

test('a failed command refreshes authoritative state while retaining the command error and never confirming success or replaying it', async () => {
  const f = fixture();
  const failure = new Error('VERSION_CONFLICT');
  f.ports.api.execute = async (command) => {
    f.calls.commands.push(command);
    throw failure;
  };
  f.ports.applyState = (value) => {
    f.calls.applied.push(value);
    f.state.error.set('');
  };
  await f.workflow.run(approval, true);

  assert.deepEqual(f.calls.commands, [approval]);
  assert.deepEqual(f.calls.reads, [filter]);
  assert.deepEqual(f.calls.applied, [f.next]);
  assert.deepEqual(f.calls.errors, [failure]);
  assert.equal(f.state.error(), 'VERSION_CONFLICT');
  assert.equal(f.state.notice(), '');
  assert.deepEqual(f.calls.confirmed, []);
  assert.equal(f.state.busy(), false);
});

test('a failed recovery read cannot mask the original uncertain command error', async () => {
  const f = fixture();
  const failure = new Error('RESULT_UNKNOWN');
  f.ports.api.execute = async (command) => {
    f.calls.commands.push(command);
    throw failure;
  };
  f.ports.api.read = async (value) => {
    f.calls.reads.push(value);
    throw new Error('READ_UNAVAILABLE');
  };
  await f.workflow.run(approval);

  assert.deepEqual(f.calls.commands, [approval]);
  assert.deepEqual(f.calls.reads, [filter]);
  assert.deepEqual(f.calls.errors, [failure]);
  assert.deepEqual(f.calls.applied, []);
  assert.deepEqual(f.calls.confirmed, []);
  assert.equal(f.state.error(), 'RESULT_UNKNOWN');
  assert.equal(f.state.notice(), '');
  assert.equal(f.state.busy(), false);
});

test('a successful POST followed by a failed confirming read remains an error without optimistic success or retry', async () => {
  const f = fixture();
  const failure = new Error('AUTOMATION_UNAVAILABLE');
  f.ports.api.read = async (value) => {
    f.calls.reads.push(value);
    throw failure;
  };
  await f.workflow.run(approval, true);

  assert.deepEqual(f.calls.commands, [approval]);
  assert.deepEqual(f.calls.reads, [filter]);
  assert.deepEqual(f.calls.errors, [failure]);
  assert.deepEqual(f.calls.applied, []);
  assert.deepEqual(f.calls.confirmed, []);
  assert.equal(f.state.error(), 'AUTOMATION_UNAVAILABLE');
  assert.equal(f.state.notice(), '');
  assert.equal(f.state.busy(), false);
});

test('a rejected worker command retains its version and exact confirmation and does not turn refreshed worker state into success', async () => {
  const f = fixture();
  const worker = {
    action: 'worker',
    enabled: true,
    version: 4,
    confirmation: 'enable-worker'
  };
  f.ports.api.execute = async (command) => {
    f.calls.commands.push(command);
    throw new Error('WORKER_VERSION_CONFLICT');
  };
  await f.workflow.run(worker);
  assert.deepEqual(f.calls.commands, [worker]);
  assert.deepEqual(f.calls.applied, [f.next]);
  assert.equal(f.state.error(), 'WORKER_VERSION_CONFLICT');
  assert.equal(f.state.notice(), '');
  assert.deepEqual(f.calls.confirmed, []);
});

test('settings drafts are committed through their owner only after the server read confirms the command', async () => {
  const f = fixture();
  const settings = feedSettings();
  const confirmedFeed = feed({ capacity: 3 });
  const next = serverState({ feeds: [confirmedFeed] });
  const read = deferred();
  let settingsDraft = settings;
  f.ports.api.read = async () => read.promise;
  f.ports.confirmed = (command, result, value, open) => {
    f.calls.confirmed.push({ command, result, next: value, open });
    settingsDraft = value.feeds.find((feed) => feed.id === command.settings.id);
  };
  const pending = f.workflow.run({ action: 'settings', settings });
  await Promise.resolve();
  assert.equal(settingsDraft, settings);
  assert.deepEqual(f.calls.confirmed, []);
  read.resolve(next);
  await pending;
  assert.equal(settingsDraft, confirmedFeed);
});

test('recovery after settings failure does not replace an editable draft through the confirmation callback', async () => {
  const f = fixture();
  const settings = feedSettings({ capacity: 7 });
  f.ports.api.execute = async () => {
    throw new Error('SETTINGS_UNAVAILABLE');
  };
  f.ports.api.read = async () => serverState({ feeds: [feed()] });
  await f.workflow.run({ action: 'settings', settings });
  assert.equal(f.calls.applied[0].feeds[0].capacity, 2);
  assert.deepEqual(f.calls.confirmed, []);
  assert.equal(f.state.notice(), '');
});

test('navigation or destruction before the POST response suppresses the stale confirming read and feedback', async () => {
  for (const stale of ['navigate', 'destroy']) {
    const f = fixture();
    const command = deferred();
    f.ports.api.execute = async (value) => {
      f.calls.commands.push(value);
      return command.promise;
    };
    const pending = f.workflow.run(approval, true);
    if (stale === 'navigate') f.page.revision++;
    else f.page.destroyed = true;
    f.state.error.set('current-page-error');
    f.state.notice.set('current-page-notice');
    command.resolve({ id: approval.id });
    await pending;

    assert.deepEqual(f.calls.commands, [approval]);
    assert.deepEqual(f.calls.reads, []);
    assert.deepEqual(f.calls.applied, []);
    assert.deepEqual(f.calls.confirmed, []);
    assert.equal(f.state.error(), 'current-page-error');
    assert.equal(f.state.notice(), 'current-page-notice');
    assert.equal(f.state.busy(), false);
  }
});

test('navigation or destruction during the confirming GET suppresses state, drawer and success updates', async () => {
  for (const stale of ['navigate', 'destroy']) {
    const f = fixture();
    const read = deferred();
    f.ports.api.read = async (value) => {
      f.calls.reads.push(value);
      return read.promise;
    };
    const pending = f.workflow.run(approval, true);
    await Promise.resolve();
    if (stale === 'navigate') f.page.revision++;
    else f.page.destroyed = true;
    f.state.notice.set('current-page-notice');
    read.resolve(f.next);
    await pending;

    assert.deepEqual(f.calls.reads, [filter]);
    assert.deepEqual(f.calls.applied, []);
    assert.deepEqual(f.calls.confirmed, []);
    assert.equal(f.state.notice(), 'current-page-notice');
    assert.equal(f.state.busy(), false);
  }
});

test('late command errors after navigation do not launch recovery or overwrite the new page error', async () => {
  const f = fixture();
  const command = deferred();
  f.ports.api.execute = async () => command.promise;
  const pending = f.workflow.run(approval);
  f.page.revision++;
  f.state.error.set('current-page-error');
  command.reject(new Error('RESULT_UNKNOWN'));
  await pending;
  assert.deepEqual(f.calls.reads, []);
  assert.deepEqual(f.calls.errors, []);
  assert.equal(f.state.error(), 'current-page-error');
  assert.equal(f.state.busy(), false);
});

test('late confirming read errors after navigation do not overwrite the new page error', async () => {
  const f = fixture();
  const read = deferred();
  f.ports.api.read = async () => read.promise;
  const pending = f.workflow.run(approval);
  await Promise.resolve();
  f.page.revision++;
  f.state.error.set('current-page-error');
  read.reject(new Error('READ_UNAVAILABLE'));
  await pending;
  assert.deepEqual(f.calls.errors, []);
  assert.deepEqual(f.calls.confirmed, []);
  assert.equal(f.state.error(), 'current-page-error');
  assert.equal(f.state.busy(), false);
});

test('a recovery response arriving after navigation cannot update state or feedback', async () => {
  const f = fixture();
  const read = deferred();
  f.ports.api.execute = async () => {
    throw new Error('RESULT_UNKNOWN');
  };
  f.ports.api.read = async (value) => {
    f.calls.reads.push(value);
    return read.promise;
  };
  const pending = f.workflow.run(approval);
  await Promise.resolve();
  f.page.revision++;
  f.state.error.set('current-page-error');
  f.state.notice.set('current-page-notice');
  read.resolve(f.next);
  await pending;
  assert.deepEqual(f.calls.reads, [filter]);
  assert.deepEqual(f.calls.applied, []);
  assert.deepEqual(f.calls.errors, []);
  assert.deepEqual(f.calls.confirmed, []);
  assert.equal(f.state.error(), 'current-page-error');
  assert.equal(f.state.notice(), 'current-page-notice');
  assert.equal(f.state.busy(), false);
});

test('a destroyed page cannot start a new command or clear its existing feedback', async () => {
  const f = fixture();
  f.page.destroyed = true;
  await f.workflow.run(approval);
  assert.deepEqual(f.calls.commands, []);
  assert.equal(f.state.error(), 'prior-error');
  assert.equal(f.state.notice(), 'prior-notice');
  assert.equal(f.state.busy(), false);
});

test('composition passes the returned delivery ID and confirmed filtered state to the drawer owner without fabricating a missing delivery', async () => {
  const f = fixture();
  const command = {
    action: 'compose',
    feedId: 'openg20:linkedin',
    kind: 'campaign',
    message: 'Synthetic publication text',
    scheduledAt: '2026-10-03T16:00:00.000Z',
    mediaId: 'synthetic-private-media'
  };
  await f.workflow.run(command, true);
  assert.deepEqual(f.calls.commands, [command]);
  assert.deepEqual(f.calls.reads, [filter]);
  assert.equal(f.calls.confirmed[0].result.id, 'synthetic-delivery');
  assert.equal(f.calls.confirmed[0].next.deliveries.length, 0);
  assert.equal(f.calls.confirmed[0].open, true);
});

test('the automation workflow uses its local typed ports without pilotage receipt or storage contracts', () => {
  const source = readFileSync(
    'apps/funding-web/src/app/features/funding/pages/admin-publication-automation-page/admin-publication-automation-command-workflow.ts',
    'utf8'
  );
  assert.match(source, /PublicationAutomationCommandPorts/);
  assert.match(source, /implements PublicationAutomationCommandRunner/);
  assert.doesNotMatch(
    source,
    /admin-pilotage|PilotCommand|PilotReceipt|localStorage|sessionStorage|receiptStorageKey/
  );
});
