import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { AdminSetupEmailTestWorkflow } from '../dist/apps/funding-web/src/app/features/funding/pages/admin-setup-page/admin-setup-email-test-workflow.js';
import { AdminDashboardRequestError } from '../dist/apps/funding-web/src/app/features/funding/services/funding-admin-session.js';

const firstId = '10000000-0000-4000-8000-000000000701';
const secondId = '10000000-0000-4000-8000-000000000702';
const storageKey = 'openg7-email-test:synthetic-owner';
const setupFixture = () => ({
  stripe: { secret_key_configured: true, webhook_secret_configured: true },
  email: {
    smtp_configured: true,
    from: 'sender@example.test',
    admin_notification_email: 'admin@example.test',
    queue_available: true,
    failed_count: 0,
    last_error: null,
    last_failed_at: null
  },
  database: { reachable: true }
});
const resultFixture = (status = 'queued', requestId = firstId) => ({
  requestId,
  messageId: 'synthetic-message',
  to: 'admin@example.test',
  status,
  queued: status !== 'sent',
  attempted: status !== 'queued',
  sent: status === 'sent',
  error: status === 'failed' ? 'EMAIL_CONNECTION_ERROR' : null,
  deliveryMode: 'smtp'
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
const fixture = (values = new Map(), locale = 'fr-CA') => {
  const writes = [];
  const reads = [];
  const denied = [];
  const catalog = JSON.parse(
    readFileSync(`apps/funding-web/src/assets/i18n/${locale}.json`, 'utf8')
  );
  let uuidCalls = 0;
  const ports = {
    admin: {
      sendEmailTest: async (token, payload) => {
        assert.equal(values.get(storageKey), payload.requestId);
        writes.push({ token, payload });
        return resultFixture('queued', payload.requestId);
      },
      getEmailTest: async (token, id) => {
        reads.push({ token, id });
        return resultFixture('queued', id);
      }
    },
    scope: 'synthetic-owner',
    token: () => 'synthetic-admin-session',
    t: (key) => {
      const text = key
        .split('.')
        .reduce((value, part) => value?.[part], catalog);
      assert.equal(typeof text, 'string', `Missing ${locale}: ${key}`);
      return text;
    },
    storage: () => ({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key)
    }),
    requestId: () => (++uuidCalls === 1 ? firstId : secondId),
    onAccessDenied: (status) => denied.push(status)
  };
  return {
    workflow: new AdminSetupEmailTestWorkflow(ports),
    ports,
    writes,
    reads,
    denied,
    values,
    uuidCalls: () => uuidCalls
  };
};

test('email construction is SSR-safe and lazily resolves storage and UUID', () => {
  const f = fixture();
  const throwing = () => {
    throw new Error('Browser port accessed during construction');
  };
  const workflow = new AdminSetupEmailTestWorkflow({
    ...f.ports,
    storage: throwing,
    requestId: throwing
  });
  assert.equal(workflow.state(), 'idle');
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.reads, []);
});

test('an email UUID is persisted before submission and restored after reload without another send', async () => {
  const f = fixture();
  f.workflow.defaultRecipient(setupFixture());
  assert.equal(await f.workflow.send(setupFixture()), true);
  assert.equal(f.values.get(storageKey), firstId);
  assert.deepEqual(f.writes, [
    {
      token: 'synthetic-admin-session',
      payload: { to: 'admin@example.test', requestId: firstId }
    }
  ]);
  f.workflow.dispose();
  const reloaded = fixture(f.values);
  await reloaded.workflow.restore();
  assert.equal(reloaded.workflow.requestId(), firstId);
  assert.equal(reloaded.workflow.state(), 'queued');
  assert.deepEqual(reloaded.reads, [
    { token: 'synthetic-admin-session', id: firstId }
  ]);
  assert.equal(reloaded.uuidCalls(), 0);
  assert.deepEqual(reloaded.writes, []);
});

for (const locale of ['fr-CA', 'en']) {
  test(`server outcomes queued/sending/failed/sent stay distinct in ${locale}`, async () => {
    const f = fixture(new Map([[storageKey, firstId]]), locale);
    for (const status of ['queued', 'sending', 'failed', 'sent']) {
      const result = resultFixture(status);
      f.ports.admin.getEmailTest = async () => result;
      if (status === 'queued') await f.workflow.restore();
      else await f.workflow.check();
      assert.equal(f.workflow.result(), result);
      assert.equal(f.workflow.state(), status);
      assert.equal(f.workflow.view().result.sent, status === 'sent');
      assert.equal(
        f.workflow.message(),
        status === 'failed' ? f.ports.t('admin.setupEmail.failedHelp') : ''
      );
    }
    assert.deepEqual(f.writes, []);
  });
}

for (const unavailable of ['null', 'getter throws', 'write throws']) {
  test(`unavailable storage (${unavailable}) blocks an untrackable send and preserves consultation`, async () => {
    const f = fixture();
    f.ports.storage = () => {
      if (unavailable === 'getter throws') throw new Error('Storage denied');
      if (unavailable === 'null') return null;
      return {
        getItem: () => null,
        setItem: () => {
          throw new Error('Storage quota exceeded');
        },
        removeItem: () => {}
      };
    };
    f.workflow.defaultRecipient(setupFixture());
    await f.workflow.restore();
    assert.equal(await f.workflow.send(setupFixture()), false);
    assert.equal(f.workflow.email(), 'admin@example.test');
    assert.equal(f.workflow.state(), 'idle');
    assert.equal(f.workflow.message(), f.ports.t('admin.setupEmail.storage'));
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.reads, []);
  });
}

test('a malformed or another actor UUID is never restored', async () => {
  for (const stored of ['not-a-uuid', null]) {
    const values = new Map([['openg7-email-test:another-owner', firstId]]);
    if (stored) values.set(storageKey, stored);
    const f = fixture(values);
    await f.workflow.restore();
    assert.equal(f.workflow.requestId(), null);
    assert.deepEqual(f.reads, []);
    assert.deepEqual(f.writes, []);
  }
});

for (const error of [
  new Error('Synthetic network failure'),
  new AdminDashboardRequestError(409),
  new AdminDashboardRequestError(503)
]) {
  test(`uncertain ${error.name}/${error.status ?? 'network'} send is recovered by consultation`, async () => {
    const f = fixture();
    let sends = 0;
    f.ports.admin.sendEmailTest = async () => {
      sends++;
      throw error;
    };
    await f.workflow.send(setupFixture());
    assert.equal(f.workflow.state(), 'unknown');
    assert.equal(f.workflow.requestId(), firstId);
    f.workflow.setEmail('changed@example.test');
    await f.workflow.send(setupFixture());
    assert.equal(sends, 1);
    assert.equal(f.uuidCalls(), 1);
    assert.equal(f.workflow.email(), '');
    await f.workflow.check();
    assert.equal(f.workflow.state(), 'queued');
    assert.equal(f.workflow.requestId(), firstId);
    assert.equal(sends, 1);
    assert.deepEqual(f.reads, [
      { token: 'synthetic-admin-session', id: firstId }
    ]);
  });
}

test('a confirmed 404 keeps the same UUID for a later explicit submission', async () => {
  const f = fixture(new Map([[storageKey, firstId]]));
  f.ports.admin.getEmailTest = async () => {
    throw new AdminDashboardRequestError(404);
  };
  await f.workflow.restore();
  assert.equal(f.workflow.state(), 'idle');
  assert.equal(f.workflow.message(), f.ports.t('admin.setupEmail.notFound'));
  assert.equal(f.workflow.requestId(), firstId);
  assert.deepEqual(f.writes, []);
  await f.workflow.send(setupFixture());
  assert.equal(f.writes[0].payload.requestId, firstId);
  assert.equal(f.uuidCalls(), 0);
});

test('validation failure remains editable while an uncertain consultation cannot enable sending', async () => {
  const f = fixture();
  f.ports.admin.sendEmailTest = async () => {
    throw new AdminDashboardRequestError(400);
  };
  await f.workflow.send(setupFixture());
  assert.equal(f.workflow.state(), 'error');
  assert.equal(f.workflow.message(), f.ports.t('admin.setupEmail.invalid'));
  f.workflow.setEmail('corrected@example.test');
  assert.equal(f.workflow.state(), 'idle');
  f.ports.admin.getEmailTest = async () => {
    throw new AdminDashboardRequestError(503);
  };
  await f.workflow.check();
  assert.equal(f.workflow.state(), 'unknown');
  assert.equal(f.workflow.requestId(), firstId);
  f.workflow.setEmail('untracked@example.test');
  assert.equal(f.workflow.email(), 'corrected@example.test');
});

test('submitting and checking prevent double clicks and recipient changes', async () => {
  const f = fixture();
  const pendingSend = deferred();
  let sends = 0;
  f.ports.admin.sendEmailTest = () => {
    sends++;
    return pendingSend.promise;
  };
  f.workflow.setEmail(' chosen@example.test ');
  const sending = f.workflow.send(setupFixture());
  assert.equal(f.workflow.state(), 'submitting');
  assert.equal(f.workflow.busy(), true);
  await f.workflow.send(setupFixture());
  await f.workflow.check();
  f.workflow.setEmail('changed@example.test');
  assert.equal(sends, 1);
  assert.equal(f.workflow.email(), ' chosen@example.test ');
  pendingSend.resolve(resultFixture());
  await sending;
  const pendingRead = deferred();
  let reads = 0;
  f.ports.admin.getEmailTest = () => {
    reads++;
    return pendingRead.promise;
  };
  const checking = f.workflow.check();
  await f.workflow.check();
  await f.workflow.send(setupFixture());
  f.workflow.setEmail('changed@example.test');
  assert.equal(f.workflow.state(), 'checking');
  assert.equal(reads, 1);
  assert.equal(sends, 1);
  pendingRead.resolve(resultFixture('sent'));
  await checking;
  assert.equal(f.workflow.busy(), false);
});

test('readiness blocks sending when configuration or authoritative queue inspection is unavailable', async () => {
  for (const modify of [
    (setup) => {
      setup.email.smtp_configured = false;
    },
    (setup) => {
      setup.email.queue_available = false;
    },
    (setup) => {
      setup.database.reachable = false;
    }
  ]) {
    const f = fixture();
    const setup = setupFixture();
    modify(setup);
    assert.equal(await f.workflow.send(setup), false);
    assert.equal(f.uuidCalls(), 0);
    assert.deepEqual(f.writes, []);
  }
});

test('new confirmed tests allocate a fresh UUID and recipient edits clear a completed recovery', async () => {
  const f = fixture();
  await f.workflow.send(setupFixture());
  await f.workflow.send(setupFixture());
  assert.deepEqual(
    f.writes.map(({ payload }) => payload.requestId),
    [firstId, secondId]
  );
  f.workflow.setEmail('next@example.test');
  assert.equal(f.workflow.result(), null);
  assert.equal(f.workflow.requestId(), null);
  assert.equal(f.workflow.state(), 'idle');
  assert.equal(f.values.has(storageKey), false);
});

for (const status of [401, 403]) {
  for (const action of ['send', 'check']) {
    test(`${action} ${status} clears private email state while retaining its recovery UUID`, async () => {
      const f = fixture(new Map([[storageKey, firstId]]));
      await f.workflow.restore();
      f.ports.admin[action === 'send' ? 'sendEmailTest' : 'getEmailTest'] =
        async () => {
          throw new AdminDashboardRequestError(status);
        };
      if (action === 'send') await f.workflow.send(setupFixture());
      else await f.workflow.check();
      assert.equal(f.workflow.result(), null);
      assert.equal(f.workflow.email(), '');
      assert.equal(f.workflow.message(), '');
      assert.equal(f.workflow.state(), 'error');
      assert.equal(f.workflow.requestId(), f.values.get(storageKey));
      assert.deepEqual(f.denied, [status]);
    });
  }
}

for (const action of ['send', 'check']) {
  for (const ending of ['dispose', 'resetAccess']) {
    for (const outcome of ['resolve', 'reject']) {
      test(`${action} ${outcome} after ${ending} is ignored without replay`, async () => {
        const f = fixture(new Map([[storageKey, firstId]]));
        await f.workflow.restore();
        const pending = deferred();
        f.ports.admin[action === 'send' ? 'sendEmailTest' : 'getEmailTest'] =
          () => pending.promise;
        const running =
          action === 'send'
            ? f.workflow.send(setupFixture())
            : f.workflow.check();
        f.workflow[ending]();
        const snapshot = f.workflow.view();
        if (outcome === 'resolve') pending.resolve(resultFixture('sent'));
        else pending.reject(new AdminDashboardRequestError(401));
        await running;
        assert.equal(f.workflow.view(), snapshot);
        assert.deepEqual(f.denied, []);
        assert.deepEqual(f.writes, []);
      });
    }
  }
}
