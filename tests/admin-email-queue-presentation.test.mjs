import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filterEmailQueueMessages,
  normalizeEmailQueueStatusFilter
} from '../dist/apps/funding-web/src/app/features/funding/pages/admin-email-queue-page/admin-email-queue-presentation.js';

const date = '2026-09-23T12:00:00Z';
const message = (id, status, overrides = {}) =>
  Object.freeze({
    id,
    template_key: 'sponsorship_access_recovery',
    recipient_email: 'company@example.test',
    from_email: 'sender@example.test',
    reply_to_email: null,
    subject: 'Private access',
    status,
    attempts: 1,
    max_attempts: 5,
    next_attempt_at: date,
    sent_at: status === 'sent' ? date : null,
    last_error: status === 'failed' ? 'EMAIL_CONNECTION_ERROR' : null,
    metadata: Object.freeze({}),
    created_at: date,
    updated_at: date,
    ...overrides
  });

test('email queue filters preserve distinct server delivery states and message identities', () => {
  const messages = Object.freeze(
    ['queued', 'sending', 'sent', 'failed'].map((status, index) =>
      message(`synthetic-email-${index}`, status)
    )
  );

  for (const status of ['queued', 'sending', 'sent', 'failed']) {
    assert.equal(normalizeEmailQueueStatusFilter(status), status);
    const filtered = filterEmailQueueMessages(messages, status, '');
    assert.equal(filtered.length, 1);
    assert.equal(
      filtered[0],
      messages.find((item) => item.status === status)
    );
  }
  for (const value of ['all', '', 'SENT', 'delivered', 'untrusted']) {
    assert.equal(normalizeEmailQueueStatusFilter(value), 'all');
  }
  assert.deepEqual(filterEmailQueueMessages(messages, 'all', '  '), messages);
});

test('email queue combines status with case-insensitive recipient, subject, template and safe-error searches', () => {
  const failed = message('synthetic-failed', 'failed');
  const sent = message('synthetic-sent', 'sent', {
    recipient_email: 'other@example.test',
    subject: 'Receipt',
    template_key: 'contribution_receipt'
  });
  const messages = Object.freeze([failed, sent]);

  for (const query of [
    '  COMPANY@EXAMPLE.TEST  ',
    'Private Access',
    'SPONSORSHIP_ACCESS',
    'connection_error',
    'FAILED'
  ]) {
    assert.deepEqual(filterEmailQueueMessages(messages, 'all', query), [
      failed
    ]);
  }
  assert.deepEqual(
    filterEmailQueueMessages(messages, 'sent', 'company@example.test'),
    []
  );
  assert.deepEqual(filterEmailQueueMessages(messages, 'all', 'absent'), []);
  assert.deepEqual(filterEmailQueueMessages(messages, 'sent', 'RECEIPT'), [
    sent
  ]);
});

test('hiding an accepted message leaves the server snapshot and per-message outcomes available on return', () => {
  const sent = message('synthetic-accepted', 'sent', { attempts: 2 });
  const messages = Object.freeze([sent]);
  const summary = Object.freeze({ queued_count: 11, sent_count: 41 });
  const snapshot = Object.freeze({ messages, summary });
  const outcomes = Object.freeze({ [sent.id]: 'Message sent.' });

  assert.deepEqual(
    filterEmailQueueMessages(snapshot.messages, 'failed', ''),
    []
  );
  assert.deepEqual(
    filterEmailQueueMessages(snapshot.messages, 'all', 'absent'),
    []
  );
  const restored = filterEmailQueueMessages(
    snapshot.messages,
    'all',
    ' COMPANY@EXAMPLE.TEST '
  );
  assert.equal(restored[0], sent);
  assert.equal(restored[0].status, 'sent');
  assert.equal(outcomes[restored[0].id], 'Message sent.');
  assert.equal(snapshot.summary, summary);
  assert.equal(snapshot.summary.sent_count, 41);
});
