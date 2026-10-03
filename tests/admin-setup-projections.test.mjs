import assert from 'node:assert/strict';
import test from 'node:test';

import {
  projectReadiness,
  projectChecklist,
  projectOperationalCount,
  projectRecommendation
} from '../dist/apps/funding-web/src/app/features/funding/pages/admin-setup-page/setup-projections.js';

const now = Date.parse('2026-10-03T12:00:00Z');
const setupFixture = () => ({
  stripe: { secret_key_configured: true, webhook_secret_configured: true },
  email: {
    smtp_configured: true,
    from: 'sender@example.invalid',
    admin_notification_email: 'admin@example.invalid',
    queue_available: true,
    queued_count: 2,
    sending_count: 1,
    sent_count: 3,
    failed_count: 0,
    last_error: null,
    last_failed_at: null
  },
  invoice: { ready: true },
  database: { configured: true, reachable: true }
});
const checkFixture = (state = 'operational', evidence = 'smtp_verify') => ({
  state,
  evidence,
  checkedAt: '2026-10-03T12:00:00Z',
  observedAt: '2026-10-03T12:00:00Z',
  validUntil: '2026-10-03T12:01:00Z'
});
const systemsFixture = () => [
  {
    id: 'stripe',
    ...checkFixture('unknown', 'no_recent_activity'),
    connection: checkFixture('operational', 'stripe_api_read')
  },
  { id: 'email', ...checkFixture() },
  { id: 'storage', ...checkFixture('operational', 'storage_read') },
  { id: 'database', ...checkFixture('operational', 'database_read') }
];
const inputFixture = () => ({
  setup: setupFixture(),
  systems: systemsFixture(),
  systemsState: 'ready',
  now,
  failed: false
});

test('email configuration alone does not make an unreadable queue eligible for a test', () => {
  for (const change of [
    (setup) => {
      setup.email.queue_available = false;
    },
    (setup) => {
      setup.database.reachable = false;
    },
    (setup) => {
      setup.email.last_error = 'Queue inspection unavailable';
      setup.email.queued_count = 0;
      setup.email.failed_count = 0;
    }
  ]) {
    const setup = setupFixture();
    change(setup);
    assert.deepEqual(projectReadiness(setup), {
      stripe: true,
      email: true,
      queueReadable: false,
      queue: false,
      canSendEmailTest: false
    });
  }
});

test('a confirmed message failure remains visible and does not masquerade as failed queue inspection', () => {
  const setup = setupFixture();
  setup.email.failed_count = 1;
  setup.email.last_error = 'Synthetic delivery failure';
  setup.email.last_failed_at = '2026-10-03T11:00:00Z';
  assert.deepEqual(projectReadiness(setup), {
    stripe: true,
    email: true,
    queueReadable: true,
    queue: false,
    canSendEmailTest: true
  });
});

test('readiness keeps configuration distinct from observations and checklist order', () => {
  const setup = setupFixture();
  setup.stripe.webhook_secret_configured = false;
  setup.email.from = null;
  setup.database.configured = false;
  setup.invoice.ready = false;
  assert.equal(projectReadiness(setup).stripe, false);
  assert.equal(projectReadiness(setup).email, false);
  assert.equal(projectReadiness(setup).canSendEmailTest, false);
  assert.deepEqual(projectChecklist(setup), [
    { id: 'stripe', ready: false },
    { id: 'email', ready: false },
    { id: 'queue', ready: true },
    { id: 'database', ready: false },
    { id: 'invoice', ready: false }
  ]);
  assert.deepEqual(projectChecklist(null), []);
});

test('the recommendation prioritizes database, queue readability, then delivery failures', () => {
  const input = inputFixture();
  input.setup.database.reachable = false;
  input.setup.email.queue_available = false;
  input.setup.email.failed_count = 1;
  input.systems[2].state = 'unavailable';
  assert.equal(projectRecommendation(input).key, 'database');
  input.setup.database.reachable = true;
  assert.equal(projectRecommendation(input).key, 'queue');
  input.setup.email.queue_available = true;
  assert.deepEqual(projectRecommendation(input), {
    key: 'emailFailures',
    section: 'queue',
    tone: 'warning',
    url: '/admin/fundraiser/email-queue'
  });
});

test('service diagnostics preserve local destinations and the email queue link', () => {
  for (const id of ['database', 'storage', 'email']) {
    const input = inputFixture();
    input.systems.find((system) => system.id === id).state = 'unavailable';
    assert.deepEqual(projectRecommendation(input), {
      key: 'service',
      section: id,
      tone: 'warning',
      ...(id === 'email'
        ? {
            url: '/admin/fundraiser/email-queue',
            urlAction: 'openQueue'
          }
        : {})
    });
  }
});

test('Stripe connection and webhook problems remain independently actionable', () => {
  const input = inputFixture();
  input.systems[0].state = 'degraded';
  assert.deepEqual(projectRecommendation(input), {
    key: 'service',
    section: 'stripe',
    tone: 'warning',
    url: '/admin/fundraiser/attention?type=stripe_event_failed',
    urlAction: 'openStripeEvents'
  });
  input.systems[0].state = 'unknown';
  input.systems[0].connection.state = 'unavailable';
  assert.deepEqual(projectRecommendation(input), {
    key: 'service',
    section: 'stripe',
    tone: 'warning'
  });
});

test('configuration recommendations precede missing observations in their existing order', () => {
  const input = inputFixture();
  input.systems = [];
  input.setup.stripe.secret_key_configured = false;
  input.setup.email.smtp_configured = false;
  input.setup.invoice.ready = false;
  assert.equal(projectRecommendation(input).key, 'stripe');
  input.setup.stripe.secret_key_configured = true;
  assert.equal(projectRecommendation(input).key, 'email');
  input.setup.email.smtp_configured = true;
  assert.equal(projectRecommendation(input).key, 'invoice');
  input.setup.invoice.ready = true;
  assert.equal(projectRecommendation(input).key, 'verification');
});

test('fresh confirmed connections allow readiness without recent Stripe webhook activity', () => {
  const input = inputFixture();
  assert.equal(projectOperationalCount(input.systems, now, false), 4);
  assert.deepEqual(projectRecommendation(input), {
    key: 'ready',
    section: 'activity',
    tone: 'success'
  });
});

test('expired observations and failed-refresh retries cannot retain operational readiness', () => {
  for (const change of [
    (input) => {
      input.now = Date.parse('2026-10-03T12:01:00Z');
    },
    (input) => {
      input.systems[0].connection.validUntil = 'invalid';
    },
    (input) => {
      input.failed = true;
    },
    (input) => {
      input.failed = true;
      input.systemsState = 'loading';
    }
  ]) {
    const input = inputFixture();
    change(input);
    assert.equal(projectRecommendation(input).key, 'verification');
    assert.ok(
      projectOperationalCount(input.systems, input.now, input.failed) < 4
    );
  }
});

test('legacy Stripe responses and missing or failed webhook checks do not prove readiness', () => {
  for (const change of [
    (input) => {
      delete input.systems[0].connection;
    },
    (input) => {
      input.systems[0].validUntil = '2026-10-03T11:00:00Z';
    },
    (input) => {
      input.systems[0].evidence = 'check_failed';
    },
    (input) => {
      input.systems[0].evidence = 'not_configured';
    },
    (input) => {
      input.systems.pop();
    },
    (input) => {
      input.systemsState = 'loading';
    }
  ]) {
    const input = inputFixture();
    change(input);
    assert.deepEqual(projectRecommendation(input), {
      key: 'verification',
      section: 'readiness',
      tone: 'neutral'
    });
  }
});

test('projections preserve input snapshots and return consultation-only recommendations', () => {
  const input = inputFixture();
  const before = structuredClone(input);
  for (const system of input.systems) {
    if (system.connection) Object.freeze(system.connection);
    Object.freeze(system);
  }
  Object.freeze(input.systems);
  for (const section of Object.values(input.setup)) Object.freeze(section);
  Object.freeze(input.setup);
  Object.freeze(input);
  projectReadiness(input.setup);
  projectChecklist(input.setup);
  projectRecommendation(input);
  projectOperationalCount(input.systems, now, false);
  assert.deepEqual(input, before);
  assert.deepEqual(projectRecommendation({ ...input, setup: null }), {
    key: 'verification',
    section: 'readiness',
    tone: 'neutral'
  });
});
