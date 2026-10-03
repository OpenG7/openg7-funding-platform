import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';

import { createApiBackgroundWorkers } from '../dist/apps/funding-api/src/api-background-workers.js';

const emptyQueueResult = () => ({ attempted: 0, sent: 0, failed: 0 });
const emptyReminderResult = () => ({
  checked: true,
  skippedReason: 'nothing_due',
  dueCount: 0,
  queued: false,
  duplicate: false,
  attempted: false,
  sent: false,
  messageId: null,
  error: null
});

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
};

const fixture = (overrides = {}) => {
  const calls = [];
  const events = [];
  const timers = [];
  const logs = [];
  const dependencies = {
    hasDatabase: true,
    dbPool: { synthetic: 'database' },
    emailQueueWorkerEnabled: true,
    emailQueueBatchSize: 7,
    emailQueuePollIntervalMs: 12000,
    adminSponsorshipReviewReminderConfig: {
      enabled: true,
      minAgeDays: 2,
      pollIntervalMs: 45000,
      maxItems: 4
    },
    publicBaseUrl: 'https://funding.example.test',
    processQueuedEmailMessages: async (...args) => {
      calls.push(['email', ...args]);
      events.push('email');
      return emptyQueueResult();
    },
    queueDueSponsorshipReviewReminder: async (...args) => {
      calls.push(['reminder', ...args]);
      events.push('reminder');
      return emptyReminderResult();
    },
    buildSponsorshipReviewReminderAdminUrl: (baseUrl) =>
      `${baseUrl}/admin/sponsorships`,
    contributionActivity: {
      tick: async () => {
        calls.push(['activity']);
        events.push('activity');
      }
    },
    publicationAutomation: {
      tick: async () => {
        calls.push(['publication']);
        events.push('publication');
      }
    },
    logger: Object.fromEntries(
      ['info', 'warn', 'error'].map((level) => [
        level,
        (...args) => logs.push([level, ...args])
      ])
    ),
    setInterval: (callback, intervalMs) => {
      events.push(`interval:${intervalMs}`);
      const timer = {
        callback,
        intervalMs,
        unrefCalls: 0,
        unref() {
          this.unrefCalls += 1;
          events.push(`unref:${intervalMs}`);
        }
      };
      timers.push(timer);
      return timer;
    },
    ...overrides
  };
  return {
    workers: createApiBackgroundWorkers(dependencies),
    dependencies,
    calls,
    events,
    timers,
    logs
  };
};

test('startup is gated by hasDatabase even when injected services are present', async () => {
  const { workers, calls, timers, logs } = fixture({ hasDatabase: false });
  workers.start();
  await setImmediate();
  assert.deepEqual(calls, []);
  assert.deepEqual(timers, []);
  assert.deepEqual(logs, []);
});

test('absent PostgreSQL skips email and reminder runners; absent tick services are harmless', async () => {
  const { workers, calls, logs } = fixture({
    dbPool: null,
    contributionActivity: null,
    publicationAutomation: null
  });
  await Promise.all([
    workers.runEmailQueueWorker(),
    workers.runAdminSponsorshipReviewReminderWorker(),
    workers.runContributionActivity(),
    workers.runPublicationWorker()
  ]);
  assert.deepEqual(calls, []);
  assert.deepEqual(logs, []);
});

test('startup runs each worker immediately in order and unreferences all four configured intervals', async () => {
  const { workers, events, calls, timers, dependencies } = fixture();
  assert.equal(workers.start(), undefined);
  assert.deepEqual(events, [
    'email',
    'activity',
    'interval:2000',
    'unref:2000',
    'publication',
    'interval:30000',
    'unref:30000',
    'reminder',
    'interval:12000',
    'unref:12000',
    'interval:45000',
    'unref:45000'
  ]);
  assert.equal(timers.length, 4);
  assert.ok(timers.every((timer) => timer.unrefCalls === 1));
  assert.deepEqual(calls[0], ['email', dependencies.dbPool, { limit: 7 }]);
  assert.deepEqual(calls[3], [
    'reminder',
    dependencies.dbPool,
    {
      config: dependencies.adminSponsorshipReviewReminderConfig,
      adminUrl: 'https://funding.example.test/admin/sponsorships'
    }
  ]);

  await setImmediate();
  calls.length = 0;
  for (const timer of timers) assert.equal(timer.callback(), undefined);
  await setImmediate();
  assert.deepEqual(
    calls.map(([name]) => name),
    ['activity', 'publication', 'email', 'reminder']
  );
});

test('pausing email claims preserves polling, reminders, activity and publication', async () => {
  const { workers, calls, timers } = fixture({
    emailQueueWorkerEnabled: false
  });
  workers.start();
  await setImmediate();
  assert.deepEqual(
    calls.map(([name]) => name),
    ['activity', 'publication', 'reminder']
  );
  assert.equal(timers.length, 4);
  for (const timer of timers) timer.callback();
  await setImmediate();
  await workers.runEmailQueueWorker();
  assert.deepEqual(
    calls.map(([name]) => name),
    [
      'activity',
      'publication',
      'reminder',
      'activity',
      'publication',
      'reminder'
    ]
  );
});

test('reminder enablement and recipient policy remain delegated to the reminder service', async () => {
  const config = {
    enabled: false,
    minAgeDays: 1,
    pollIntervalMs: 8000,
    maxItems: 2
  };
  const { workers, dependencies, calls } = fixture({
    adminSponsorshipReviewReminderConfig: config,
    publicBaseUrl: null,
    buildSponsorshipReviewReminderAdminUrl: (baseUrl) => {
      assert.equal(baseUrl, null);
      return '/admin/sponsorships';
    }
  });
  await workers.runAdminSponsorshipReviewReminderWorker();
  assert.deepEqual(calls, [
    [
      'reminder',
      dependencies.dbPool,
      { config, adminUrl: '/admin/sponsorships' }
    ]
  ]);
});

test('email logs only completed sends or failures with the existing counters', async () => {
  const results = [
    { attempted: 2, sent: 0, failed: 0 },
    { attempted: 3, sent: 2, failed: 1 },
    { attempted: 1, sent: 0, failed: 1 },
    { attempted: 1, sent: 1, failed: 0 }
  ];
  const { workers, logs } = fixture({
    processQueuedEmailMessages: async () => results.shift()
  });
  for (let index = 0; index < 4; index += 1)
    await workers.runEmailQueueWorker();
  assert.deepEqual(logs, [
    ['info', 'Email queue processed 3 message(s): 2 sent, 1 failed.'],
    ['info', 'Email queue processed 1 message(s): 0 sent, 1 failed.'],
    ['info', 'Email queue processed 1 message(s): 1 sent, 0 failed.']
  ]);
});

test('reminder logs preserve checked, duplicate, delivery and error conditions', async () => {
  const patches = [
    { checked: false, queued: true, error: 'unchecked' },
    { duplicate: true, sent: true, error: 'duplicate' },
    {},
    { queued: true, dueCount: 3 },
    { sent: true, dueCount: 4 },
    { error: 'synthetic delivery failure' },
    { queued: true, dueCount: 5, error: 'synthetic queued failure' }
  ];
  const { workers, logs } = fixture({
    queueDueSponsorshipReviewReminder: async () => ({
      ...emptyReminderResult(),
      ...patches.shift()
    })
  });
  for (let index = 0; index < 7; index += 1)
    await workers.runAdminSponsorshipReviewReminderWorker();
  assert.deepEqual(logs, [
    [
      'info',
      'Admin sponsorship review reminder queued for 3 pending sponsorship(s).'
    ],
    [
      'info',
      'Admin sponsorship review reminder queued for 4 pending sponsorship(s).'
    ],
    [
      'warn',
      'Admin sponsorship review reminder could not be delivered.',
      'synthetic delivery failure'
    ],
    [
      'info',
      'Admin sponsorship review reminder queued for 5 pending sponsorship(s).'
    ],
    [
      'warn',
      'Admin sponsorship review reminder could not be delivered.',
      'synthetic queued failure'
    ]
  ]);
});

for (const [runner, dependency, result, errorMessage] of [
  [
    'runEmailQueueWorker',
    'processQueuedEmailMessages',
    emptyQueueResult,
    'Failed to process email queue.'
  ],
  [
    'runAdminSponsorshipReviewReminderWorker',
    'queueDueSponsorshipReviewReminder',
    emptyReminderResult,
    'Failed to queue admin sponsorship review reminder.'
  ]
]) {
  test(`${runner} skips overlap and allows the next pass after completion`, async () => {
    const pending = deferred();
    let attempts = 0;
    const { workers } = fixture({
      [dependency]: () => {
        attempts += 1;
        return attempts === 1 ? pending.promise : Promise.resolve(result());
      }
    });
    const first = workers[runner]();
    await workers[runner]();
    assert.equal(attempts, 1);
    pending.resolve(result());
    await first;
    await workers[runner]();
    assert.equal(attempts, 2);
  });

  test(`${runner} releases its guard after failure without adding an immediate retry`, async () => {
    const pending = deferred();
    const failure = new Error('Synthetic worker failure');
    let attempts = 0;
    const { workers, logs } = fixture({
      [dependency]: () => {
        attempts += 1;
        return attempts === 1 ? pending.promise : Promise.resolve(result());
      }
    });
    const first = workers[runner]();
    pending.reject(failure);
    await first;
    await setImmediate();
    assert.equal(attempts, 1);
    assert.deepEqual(logs, [['error', errorMessage, failure]]);
    await workers[runner]();
    assert.equal(attempts, 2);
  });
}

test('a pending email pass does not block other workers or interval scheduling', async () => {
  const email = deferred();
  const reminder = deferred();
  let emailAttempts = 0;
  let reminderAttempts = 0;
  const { workers, calls, timers } = fixture({
    processQueuedEmailMessages: () => {
      emailAttempts += 1;
      return email.promise;
    },
    queueDueSponsorshipReviewReminder: () => {
      reminderAttempts += 1;
      return reminder.promise;
    }
  });
  workers.start();
  assert.deepEqual(calls, [['activity'], ['publication']]);
  assert.equal(timers.length, 4);
  assert.equal(emailAttempts, 1);
  assert.equal(reminderAttempts, 1);
  timers[2].callback();
  timers[3].callback();
  assert.equal(emailAttempts, 1);
  assert.equal(reminderAttempts, 1);
  email.resolve(emptyQueueResult());
  reminder.resolve(emptyReminderResult());
  await setImmediate();
  timers[2].callback();
  timers[3].callback();
  await setImmediate();
  assert.equal(emailAttempts, 2);
  assert.equal(reminderAttempts, 2);
});

for (const [runner, dependency, timerIndex, errorMessage] of [
  [
    'runContributionActivity',
    'contributionActivity',
    0,
    'Contribution activity worker interrupted; verify migration 027 and database availability.'
  ],
  [
    'runPublicationWorker',
    'publicationAutomation',
    1,
    'Publication worker interrupted; inspect publication exceptions and database availability.'
  ]
]) {
  test(`${runner} keeps safe failure logs and resumes on its next interval`, async () => {
    let attempts = 0;
    const { workers, logs, timers } = fixture({
      [dependency]: {
        tick: async () => {
          attempts += 1;
          if (attempts === 1) throw new Error('Synthetic private diagnostic');
        }
      }
    });
    workers.start();
    await setImmediate();
    assert.equal(attempts, 1);
    assert.deepEqual(logs, [['error', errorMessage]]);
    timers[timerIndex].callback();
    await setImmediate();
    assert.equal(attempts, 2);
  });

  test(`${runner} leaves overlapping tick coordination to its service`, async () => {
    const pending = deferred();
    let attempts = 0;
    const { workers } = fixture({
      [dependency]: {
        tick: () => {
          attempts += 1;
          return pending.promise;
        }
      }
    });
    const first = workers[runner]();
    const second = workers[runner]();
    assert.equal(attempts, 2);
    pending.resolve();
    await Promise.all([first, second]);
  });
}
