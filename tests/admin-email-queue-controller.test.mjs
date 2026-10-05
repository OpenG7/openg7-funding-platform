import assert from 'node:assert/strict';
import test from 'node:test';

import { AdminEmailQueueController } from '../dist/apps/funding-web/src/app/features/funding/pages/admin-email-queue-page/admin-email-queue-controller.js';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

const date = '2026-09-23T12:00:00Z';
const message = (changes = {}) => ({
  id: 'synthetic-email-a',
  template_key: 'sponsorship_access_recovery',
  recipient_email: 'company@example.test',
  from_email: 'sender@example.test',
  reply_to_email: null,
  subject: 'Synthetic private access',
  status: 'failed',
  attempts: 1,
  max_attempts: 5,
  next_attempt_at: date,
  sent_at: null,
  last_error: 'EMAIL_CONNECTION_ERROR',
  metadata: {},
  created_at: date,
  updated_at: date,
  ...changes
});

const snapshot = (row = message(), changes = {}) => ({
  data_source: 'database',
  messages: [row],
  last_updated_at: date,
  summary: {
    queued_count: 11,
    sending_count: 3,
    sent_count: 40,
    failed_count: 7,
    retryable_count: 21,
    last_failed_at: date,
    last_error: null
  },
  ...changes
});

const retryResult = (row = message({ status: 'sent' }), changes = {}) => ({
  attempted: 1,
  sent: 1,
  failed: 0,
  messageIds: [row.id],
  sentMessageIds: [row.id],
  failedMessageIds: [],
  message: row,
  ...changes
});

const fixture = (t) => {
  const calls = { reads: [], retries: [], confirmations: [] };
  const ports = {
    admin: {
      getEmailQueue: async (token, target) => {
        calls.reads.push({ token, target });
        return snapshot();
      },
      retryEmailQueueMessage: async (token, payload) => {
        calls.retries.push({ token, payload });
        return retryResult();
      }
    },
    token: () => 'synthetic-session',
    t: (key) => key,
    confirm: async (text, detail) => {
      calls.confirmations.push({ text, detail });
      return true;
    }
  };
  const controller = new AdminEmailQueueController(ports);
  t.after(() => controller.dispose());
  return { controller, ports, calls };
};

test('target consultation resets local filters and only the newest response owns the snapshot', async (t) => {
  const { controller: c, ports, calls } = fixture(t);
  const old = deferred();
  const next = deferred();
  ports.admin.getEmailQueue = (token, target) => {
    calls.reads.push({ token, target });
    return target === 'synthetic-email-a' ? old.promise : next.promise;
  };
  c.setTarget('synthetic-email-a');
  c.search.set('old search');
  c.statusFilter.set('failed');
  const previous = c.loadEmailQueue();
  c.setTarget('synthetic-email-b');
  assert.equal(c.search(), '');
  assert.equal(c.statusFilter(), 'all');
  assert.equal(c.queue(), null);
  const current = c.loadEmailQueue();
  const expected = snapshot(message({ id: 'synthetic-email-b' }));
  next.resolve(expected);
  await current;
  old.reject(new Error('Synthetic old target failure'));
  await previous;
  assert.equal(c.queue(), expected);
  assert.equal(c.state(), 'ready');
  assert.equal(c.errorMessage(), '');
  assert.deepEqual(
    calls.reads.map((read) => read.target),
    ['synthetic-email-a', 'synthetic-email-b']
  );
});

test('refresh generation rejects older successful and failed consultations', async (t) => {
  const { controller: c, ports } = fixture(t);
  const pending = [deferred(), deferred(), deferred()];
  let ordinal = 0;
  ports.admin.getEmailQueue = () => pending[ordinal++].promise;
  const reads = pending.map(() => c.loadEmailQueue());
  const expected = snapshot(message({ status: 'queued' }));
  pending[2].resolve(expected);
  await reads[2];
  pending[0].resolve(snapshot());
  pending[1].reject(new Error('Synthetic stale failure'));
  await Promise.all(reads);
  assert.equal(c.queue(), expected);
  assert.equal(c.errorMessage(), '');
  assert.equal(c.state(), 'ready');
});

for (const outcome of ['resolve', 'reject'])
  test(`disposing ignores a consultation that later ${outcome}s and prevents new requests`, async (t) => {
    const { controller: c, ports, calls } = fixture(t);
    const pending = deferred();
    ports.admin.getEmailQueue = () => pending.promise;
    const read = c.loadEmailQueue();
    c.dispose();
    if (outcome === 'resolve') pending.resolve(snapshot());
    else pending.reject(new Error('Synthetic late failure'));
    await read;
    c.setTarget('synthetic-email-b');
    await c.loadEmailQueue();
    await c.retryMessage(message());
    assert.equal(c.queue(), null);
    assert.equal(c.targetId(), undefined);
    assert.equal(c.state(), 'loading');
    assert.deepEqual(calls.retries, []);
    assert.deepEqual(calls.confirmations, []);
  });

test('cancelled confirmation creates no recovery request and duplicate clicks are locked', async (t) => {
  const { controller: c, ports, calls } = fixture(t);
  const confirmation = deferred();
  ports.confirm = (text, detail) => {
    calls.confirmations.push({ text, detail });
    return confirmation.promise;
  };
  const retry = c.retryMessage(message());
  await c.retryMessage(message());
  assert.equal(c.retryStateFor(message().id), 'confirming');
  assert.deepEqual(calls.confirmations, [
    {
      text: 'admin.confirmation.retryEmail',
      detail: 'company@example.test'
    }
  ]);
  confirmation.resolve(false);
  await retry;
  assert.equal(c.retryStateFor(message().id), 'idle');
  assert.deepEqual(calls.retries, []);
  assert.deepEqual(calls.reads, []);
});

test('an in-flight recovery locks its message while another message remains independent', async (t) => {
  const { controller: c, ports, calls } = fixture(t);
  const response = deferred();
  ports.admin.retryEmailQueueMessage = (token, payload) => {
    calls.retries.push({ token, payload });
    return payload.messageId === message().id
      ? response.promise
      : Promise.resolve(retryResult(message({ id: payload.messageId })));
  };
  const retry = c.retryMessage(message());
  await Promise.resolve();
  assert.equal(c.retryStateFor(message().id), 'sending');
  await c.retryMessage(message());
  await c.retryMessage(message({ id: 'synthetic-email-b' }));
  assert.equal(calls.retries.length, 2);
  response.resolve(retryResult());
  await retry;
  assert.equal(c.retryStateFor(message().id), 'sent');
});

for (const action of ['target change', 'dispose'])
  test(`${action} during confirmation prevents POST and ignores the late decision`, async (t) => {
    const { controller: c, ports, calls } = fixture(t);
    const confirmation = deferred();
    ports.confirm = () => confirmation.promise;
    const retry = c.retryMessage(message());
    if (action === 'dispose') c.dispose();
    else c.setTarget('synthetic-email-b');
    const states = c.retryStates();
    const messages = c.retryMessages();
    confirmation.resolve(true);
    await retry;
    assert.equal(c.retryStates(), states);
    assert.equal(c.retryMessages(), messages);
    assert.deepEqual(calls.retries, []);
    assert.deepEqual(calls.reads, []);
  });

test('a refreshed sent message is rechecked after confirmation and cannot be retried from a stale row', async (t) => {
  const { controller: c, ports, calls } = fixture(t);
  const confirmation = deferred();
  ports.confirm = () => confirmation.promise;
  const retry = c.retryMessage(message());
  c.queue.set(snapshot(message({ status: 'sent' })));
  confirmation.resolve(true);
  await retry;
  await c.retryMessage(message());
  await c.retryMessage(message({ status: 'sent' }));
  assert.deepEqual(calls.retries, []);
});

for (const outcome of ['resolve', 'reject'])
  test(`old recovery ${outcome} after target change leaves the new queue and feedback intact`, async (t) => {
    const { controller: c, ports } = fixture(t);
    const response = deferred();
    ports.admin.retryEmailQueueMessage = () => response.promise;
    const retry = c.retryMessage(message());
    await Promise.resolve();
    c.setTarget('synthetic-email-b');
    const expected = snapshot(message({ id: 'synthetic-email-b' }));
    ports.admin.getEmailQueue = async () => expected;
    await c.loadEmailQueue();
    if (outcome === 'resolve') response.resolve(retryResult());
    else response.reject(new Error('Synthetic old POST uncertainty'));
    await retry;
    assert.equal(c.queue(), expected);
    assert.deepEqual(c.retryStates(), {});
    assert.deepEqual(c.retryMessages(), {});
  });

for (const outcome of ['resolve', 'reject'])
  test(`dispose during recovery ignores its late ${outcome} and starts no reconciliation`, async (t) => {
    const { controller: c, ports, calls } = fixture(t);
    const response = deferred();
    ports.admin.retryEmailQueueMessage = () => response.promise;
    c.queue.set(snapshot());
    const retry = c.retryMessage(message());
    await Promise.resolve();
    c.dispose();
    const queue = c.queue();
    const states = c.retryStates();
    const messages = c.retryMessages();
    if (outcome === 'resolve') response.resolve(retryResult());
    else response.reject(new Error('Synthetic late recovery failure'));
    await retry;
    assert.equal(c.queue(), queue);
    assert.equal(c.retryStates(), states);
    assert.equal(c.retryMessages(), messages);
    assert.deepEqual(calls.reads, []);
  });

test('returning to the same target keeps its old in-flight operation locked until completion', async (t) => {
  const { controller: c, ports, calls } = fixture(t);
  const response = deferred();
  ports.admin.retryEmailQueueMessage = (token, payload) => {
    calls.retries.push({ token, payload });
    return response.promise;
  };
  c.setTarget(message().id);
  const retry = c.retryMessage(message());
  await Promise.resolve();
  c.setTarget('synthetic-email-b');
  c.setTarget(message().id);
  await c.retryMessage(message());
  assert.equal(calls.retries.length, 1);
  response.resolve(retryResult());
  await retry;
  assert.deepEqual(c.retryStates(), {});
  assert.deepEqual(c.retryMessages(), {});
  ports.admin.getEmailQueue = async (token, target) => {
    calls.reads.push({ token, target });
    return snapshot(message({ status: 'sent' }));
  };
  await c.retryMessage(message());
  assert.equal(calls.retries.length, 1);
  assert.equal(calls.reads.length, 1);
  assert.equal(c.retryStateFor(message().id), 'sent');
});

test('accepted recovery refreshes authoritative totals and retains messageId, filters and feedback', async (t) => {
  const { controller: c, ports, calls } = fixture(t);
  c.setTarget(message().id);
  const initial = snapshot();
  const sent = message({ status: 'sent', attempts: 2, last_error: null });
  const expected = snapshot(sent, {
    summary: { ...initial.summary, sent_count: 41, failed_count: 6 },
    last_updated_at: '2026-09-24T12:00:00Z'
  });
  c.queue.set(initial);
  c.statusFilter.set('failed');
  c.search.set(' COMPANY@EXAMPLE.TEST ');
  ports.admin.getEmailQueue = async (token, target) => {
    calls.reads.push({ token, target });
    return expected;
  };
  ports.admin.retryEmailQueueMessage = async (token, payload) => {
    calls.retries.push({ token, payload });
    return retryResult(sent);
  };
  await c.retryMessage(message());
  assert.equal(c.queue(), expected);
  assert.equal(c.queue().summary.sent_count, 41);
  assert.equal(c.search(), ' COMPANY@EXAMPLE.TEST ');
  assert.equal(c.statusFilter(), 'failed');
  assert.deepEqual(c.filteredMessages(), []);
  c.statusFilter.set('all');
  assert.deepEqual(c.filteredMessages(), [sent]);
  assert.equal(c.retryStateFor(sent.id), 'sent');
  assert.equal(c.retryMessageFor(sent.id), 'admin.messages.message_envoye');
  assert.deepEqual(calls.reads, [
    { token: 'synthetic-session', target: message().id }
  ]);
  assert.deepEqual(calls.retries, [
    { token: 'synthetic-session', payload: { messageId: message().id } }
  ]);
});

test('a failed summary refresh preserves the accepted row and retry result, invalidating older reads', async (t) => {
  const { controller: c, ports } = fixture(t);
  c.queue.set(snapshot());
  const oldRead = deferred();
  let reads = 0;
  ports.admin.getEmailQueue = () => {
    if (++reads === 1) return oldRead.promise;
    throw new Error('Synthetic reconciliation failure');
  };
  const old = c.loadEmailQueue();
  await c.retryMessage(message());
  assert.equal(c.messages()[0].status, 'sent');
  assert.equal(c.state(), 'error');
  assert.equal(c.errorMessage(), 'Synthetic reconciliation failure');
  assert.equal(c.retryStateFor(message().id), 'sent');
  assert.equal(
    c.retryMessageFor(message().id),
    'admin.messages.message_envoye'
  );
  assert.equal(c.queue().summary.sent_count, 40);
  oldRead.resolve(snapshot());
  await old;
  assert.equal(c.messages()[0].status, 'sent');
  assert.equal(c.errorMessage(), 'Synthetic reconciliation failure');
});

for (const [status, attempted, expectedState, expectedMessage] of [
  ['sending', 0, 'idle', 'courriel_deja_en_cours'],
  ['failed', 1, 'error', 'relance_tentee_le_message_reste_en_echec'],
  ['queued', 0, 'error', 'aucune_tentative_effectuee'],
  ['sent', 0, 'sent', 'message_envoye']
])
  test(`server ${status} result controls recovery feedback without inventing a send`, async (t) => {
    const { controller: c, ports, calls } = fixture(t);
    const row = message({ status });
    ports.admin.retryEmailQueueMessage = async () =>
      retryResult(row, { attempted, sent: 0 });
    ports.admin.getEmailQueue = async () => snapshot(row);
    await c.retryMessage(message());
    assert.equal(c.retryStateFor(row.id), expectedState);
    assert.equal(
      c.retryMessageFor(row.id),
      `admin.messages.${expectedMessage}`
    );
    assert.equal(c.messages()[0], row);
    assert.equal(calls.confirmations.length, 1);
  });

for (const status of [401, 403])
  test(`existing ${status} refusal messages remain visible for reads and recovery without automatic replay`, async (t) => {
    const { controller: c, ports, calls } = fixture(t);
    const refusal = new Error(`Synthetic ${status} access refusal`);
    ports.admin.getEmailQueue = async () => {
      throw refusal;
    };
    await c.loadEmailQueue();
    assert.equal(c.state(), 'error');
    assert.equal(c.errorMessage(), refusal.message);
    ports.admin.retryEmailQueueMessage = async (token, payload) => {
      calls.retries.push({ token, payload });
      throw refusal;
    };
    await c.retryMessage(message());
    assert.equal(c.retryStateFor(message().id), 'error');
    assert.equal(c.retryMessageFor(message().id), refusal.message);
    await c.retryMessage(message());
    assert.equal(calls.retries.length, 1);
    assert.equal(calls.confirmations.length, 1);
  });

for (const status of ['sent', 'sending', 'failed', 'queued'])
  test(`uncertain POST must consult ${status} before another confirmed recovery`, async (t) => {
    const { controller: c, ports, calls } = fixture(t);
    const row = message({ status });
    c.setTarget(row.id);
    let retries = 0;
    ports.admin.retryEmailQueueMessage = async (token, payload) => {
      calls.retries.push({ token, payload });
      if (++retries === 1) throw new Error('Synthetic response lost');
      return retryResult();
    };
    ports.admin.getEmailQueue = async (token, target) => {
      calls.reads.push({ token, target });
      return snapshot(row);
    };
    await c.retryMessage(message());
    assert.equal(calls.retries.length, 1);
    assert.deepEqual(calls.reads, []);
    const beforeConfirmation = calls.confirmations.length;
    await c.retryMessage(message());
    const terminal = status === 'sent' || status === 'sending';
    assert.equal(calls.retries.length, terminal ? 1 : 2);
    assert.equal(
      calls.confirmations.length,
      beforeConfirmation + (terminal ? 0 : 1)
    );
    assert.equal(calls.reads[0].target, row.id);
    assert.equal(
      c.retryMessageFor(row.id),
      status === 'sending'
        ? 'admin.messages.courriel_deja_en_cours'
        : 'admin.messages.message_envoye'
    );
  });

test('a missing message cannot resolve an uncertain POST and no retry is sent', async (t) => {
  const { controller: c, ports, calls } = fixture(t);
  ports.admin.retryEmailQueueMessage = async (token, payload) => {
    calls.retries.push({ token, payload });
    throw new Error('Synthetic response lost');
  };
  await c.retryMessage(message());
  ports.admin.getEmailQueue = async () => snapshot(message(), { messages: [] });
  await c.retryMessage(message());
  assert.equal(calls.retries.length, 1);
  assert.equal(calls.confirmations.length, 1);
  assert.equal(c.retryMessageFor(message().id), 'Synthetic response lost');
});

test('unscoped uncertainty consults the exact message without dropping other rows or client filters', async (t) => {
  const { controller: c, ports, calls } = fixture(t);
  const other = message({
    id: 'synthetic-email-b',
    recipient_email: 'other@example.test'
  });
  c.queue.set(snapshot(message(), { messages: [message(), other] }));
  c.search.set('COMPANY');
  c.statusFilter.set('failed');
  ports.admin.retryEmailQueueMessage = async () => {
    throw new Error('Synthetic response lost');
  };
  await c.retryMessage(message());
  const sent = message({ status: 'sent' });
  const expected = snapshot(sent, {
    summary: { ...snapshot().summary, sent_count: 41, failed_count: 6 }
  });
  ports.admin.getEmailQueue = async (token, target) => {
    calls.reads.push({ token, target });
    return expected;
  };
  await c.retryMessage(message());
  assert.equal(c.targetId(), undefined);
  assert.deepEqual(c.messages(), [sent, other]);
  assert.equal(c.queue().summary, expected.summary);
  assert.equal(c.search(), 'COMPANY');
  assert.equal(c.statusFilter(), 'failed');
  assert.deepEqual(c.filteredMessages(), []);
  assert.equal(calls.reads[0].target, sent.id);
});

for (const action of ['target change', 'dispose'])
  for (const outcome of ['resolve', 'reject'])
    test(`uncertain status ${outcome} after ${action} cannot change feedback or start a POST`, async (t) => {
      const { controller: c, ports, calls } = fixture(t);
      c.setTarget(message().id);
      ports.admin.retryEmailQueueMessage = async (token, payload) => {
        calls.retries.push({ token, payload });
        throw new Error('Synthetic response lost');
      };
      await c.retryMessage(message());
      const response = deferred();
      ports.admin.getEmailQueue = () => response.promise;
      const retry = c.retryMessage(message());
      if (action === 'dispose') c.dispose();
      else c.setTarget('synthetic-email-b');
      const queue = c.queue();
      const state = c.state();
      const states = c.retryStates();
      const messages = c.retryMessages();
      if (outcome === 'resolve')
        response.resolve(snapshot(message({ status: 'sent' })));
      else response.reject(new Error('Synthetic late uncertain read failure'));
      await retry;
      assert.equal(c.queue(), queue);
      assert.equal(c.state(), state);
      assert.equal(c.retryStates(), states);
      assert.equal(c.retryMessages(), messages);
      assert.equal(calls.retries.length, 1);
      assert.equal(calls.confirmations.length, 1);
    });

test('uncertain SMTP requires confirmed versioned reconciliation instead of retry', async (t) => {
  const { controller: c, ports, calls } = fixture(t);
  const row = message({ status: 'uncertain' });
  c.queue.set(snapshot(row));
  await c.retryMessage(row);
  assert.equal(calls.retries.length, 0);
  assert.equal(calls.confirmations.length, 0);
  let sent;
  ports.admin.reconcileEmailDelivery = async (token, payload) => {
    sent = { token, payload };
    return { updated: true, message: message({ status: 'sent' }) };
  };
  ports.admin.getEmailQueue = async () => snapshot(message({ status: 'sent' }));
  await c.reconcileMessage(row, 'sent', 'synthetic-case:123');
  assert.deepEqual(sent, {
    token: 'synthetic-session',
    payload: {
      messageId: row.id,
      expectedUpdatedAt: row.updated_at,
      confirmation: row.id,
      outcome: 'sent',
      evidenceReference: 'synthetic-case:123'
    }
  });
  assert.equal(c.queue().messages[0].status, 'sent');
  assert.equal(calls.retries.length, 0);
});
test('reconciliation requires a non-secret reference and respects cancellation', async (t) => {
  const { controller: c, ports, calls } = fixture(t);
  const row = message({ status: 'uncertain' });
  ports.admin.reconcileEmailDelivery = async () =>
    assert.fail('Cancelled/invalid reconciliation must not mutate');
  await c.reconcileMessage(row, 'not_sent', 'a body with private details');
  assert.equal(calls.confirmations.length, 0);
  ports.confirm = async () => false;
  await c.reconcileMessage(row, 'not_sent', 'synthetic-case');
  assert.equal(c.retryStateFor(row.id), 'idle');
});
