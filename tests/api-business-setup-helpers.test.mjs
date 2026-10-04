import assert from 'node:assert/strict';
import test from 'node:test';

import { createAdminSetupHelpers } from '../dist/apps/funding-api/src/business-helpers/admin-setup.js';
import { createAssistantAuditRecorder } from '../dist/apps/funding-api/src/business-helpers/assistant-audit.js';
import {
  createDevelopmentCheckoutResult,
  createDevelopmentRefundResult
} from '../dist/apps/funding-api/src/business-helpers/development-results.js';

const emptyQueue = {
  queuedCount: 0,
  sendingCount: 0,
  sentCount: 0,
  failedCount: 0,
  lastFailedAt: null,
  lastError: null
};

const setupFixture = (overrides = {}) => {
  const calls = [];
  const dependencies = {
    checkDatabaseConnection: null,
    getEmailQueueStatus: async () => {
      calls.push('queue');
      return emptyQueue;
    },
    getTransactionalEmailConfigStatus: () => {
      calls.push('email-config');
      return {
        enabled: false,
        configured: false,
        host: null,
        port: 587,
        secure: false,
        userConfigured: false,
        passwordConfigured: false,
        from: '',
        replyTo: ''
      };
    },
    hasDatabase: false,
    stripeConfigured: false,
    stripeSecretKeyConfigured: false,
    stripeWebhookSecretConfigured: false,
    stripeLiveMode: false,
    businessSponsorshipEnabled: false,
    publicBaseUrl: null,
    publicBaseOrigin: 'https://funding.example.test',
    allowedOrigins: ['https://funding.example.test'],
    adminSponsorshipReviewReminderConfig: {
      enabled: true,
      minAgeDays: 1,
      pollIntervalMs: 3600000,
      maxItems: 5
    },
    emailQueuePollIntervalMs: 30000,
    emailQueueBatchSize: 10,
    sponsorshipInvoiceConfig: {
      invoicePrefix: 'OG7-CMD',
      issuerName: '',
      issuerEmail: '',
      issuerAddressConfigured: false,
      issuerTaxIdConfigured: false,
      taxLabel: 'Synthetic tax label'
    },
    readEnvironment: (key) => {
      calls.push(['environment', key]);
      return undefined;
    },
    reportFailure: (...args) => calls.push(['report', ...args]),
    ...overrides
  };
  return { calls, dependencies, ...createAdminSetupHelpers(dependencies) };
};

test('setup without PostgreSQL still inspects email configuration and uses the public origin fallback', async () => {
  const f = setupFixture();
  assert.equal(await f.getDatabaseConnectionStatus(), false);
  assert.deepEqual(f.calls, []);

  const status = await f.buildAdminSetupStatus();
  assert.equal(status.data_source, 'empty');
  assert.equal(status.environment, 'development');
  assert.equal(status.public_base_url, null);
  assert.equal(status.allowed_origins, f.dependencies.allowedOrigins);
  assert.deepEqual(status.database, { configured: false, reachable: false });
  assert.equal(status.email.queue_available, false);
  assert.equal(status.email.admin_notification_email, null);
  assert.equal(status.email.last_error, null);
  assert.equal(status.email.from, '');
  assert.equal(status.email.reply_to, '');
  assert.deepEqual(status.stripe, {
    secret_key_configured: false,
    webhook_secret_configured: false,
    business_sponsorship_enabled: false,
    dashboard_url: 'https://dashboard.stripe.com/test/webhooks',
    webhook_endpoint: 'https://funding.example.test/api/stripe/webhook'
  });
  assert.deepEqual(status.invoice, {
    prefix: 'OG7-CMD',
    issuer_name: null,
    issuer_email: null,
    issuer_address_configured: false,
    issuer_tax_id_configured: false,
    tax_label: 'Synthetic tax label',
    ready: false
  });
  assert.deepEqual(f.calls, [
    'email-config',
    'queue',
    ['environment', 'FUNDING_PLATFORM_ENV'],
    ['environment', 'FUNDING_ADMIN_NOTIFICATION_EMAIL']
  ]);
});

test('unreachable PostgreSQL retains database provenance and the queue delivery error without reporting a new failure', async () => {
  const f = setupFixture({
    hasDatabase: true,
    stripeConfigured: true,
    checkDatabaseConnection: async () => {
      throw new Error('synthetic database outage');
    },
    getEmailQueueStatus: async () => ({
      queuedCount: 2,
      sendingCount: 1,
      sentCount: 8,
      failedCount: 3,
      lastFailedAt: '2026-10-04T12:00:00.000Z',
      lastError: 'Synthetic delivery failure'
    })
  });
  const status = await f.buildAdminSetupStatus();
  assert.equal(status.data_source, 'database');
  assert.deepEqual(status.database, { configured: true, reachable: false });
  assert.equal(status.email.queue_available, false);
  assert.equal(status.email.queued_count, 2);
  assert.equal(status.email.sending_count, 1);
  assert.equal(status.email.sent_count, 8);
  assert.equal(status.email.failed_count, 3);
  assert.equal(status.email.last_failed_at, '2026-10-04T12:00:00.000Z');
  assert.equal(status.email.last_error, 'Synthetic delivery failure');
  assert.equal(
    f.calls.some((call) => call[0] === 'report'),
    false
  );
});

test('queue inspection failure is reported independently of reachable PostgreSQL', async () => {
  const failure = new Error('synthetic queue schema failure');
  const f = setupFixture({
    hasDatabase: true,
    checkDatabaseConnection: async () => undefined,
    getEmailQueueStatus: async () => {
      throw failure;
    }
  });
  const status = await f.buildAdminSetupStatus();
  assert.deepEqual(status.database, { configured: true, reachable: true });
  assert.equal(status.email.queue_available, true);
  assert.equal(status.email.queued_count, 0);
  assert.equal(status.email.failed_count, 0);
  assert.equal(status.email.last_failed_at, null);
  assert.equal(
    status.email.last_error,
    'Email queue status could not be loaded. Apply migration 010.'
  );
  assert.deepEqual(
    f.calls.filter((call) => call[0] === 'report'),
    [['report', 'Failed to inspect email queue status.', failure]]
  );
});

test('Stripe-direct diagnostics expose configuration indicators and retain the configured public URL', async () => {
  const f = setupFixture({
    stripeConfigured: true,
    stripeSecretKeyConfigured: true,
    stripeWebhookSecretConfigured: true,
    stripeLiveMode: true,
    businessSponsorshipEnabled: true,
    publicBaseUrl: 'https://public.example.test',
    sponsorshipInvoiceConfig: {
      invoicePrefix: 'SYNTHETIC',
      issuerName: 'Synthetic issuer',
      issuerEmail: 'issuer@example.test',
      issuerAddressConfigured: true,
      issuerTaxIdConfigured: true,
      taxLabel: 'Synthetic taxes'
    }
  });
  const status = await f.buildAdminSetupStatus();
  assert.equal(status.data_source, 'stripe_direct');
  assert.equal(status.public_base_url, 'https://public.example.test');
  assert.deepEqual(status.stripe, {
    secret_key_configured: true,
    webhook_secret_configured: true,
    business_sponsorship_enabled: true,
    dashboard_url: 'https://dashboard.stripe.com/webhooks',
    webhook_endpoint: 'https://public.example.test/api/stripe/webhook'
  });
  assert.equal(status.invoice.ready, true);
  assert.equal(status.invoice.issuer_address_configured, true);
  assert.equal(status.invoice.issuer_tax_id_configured, true);
  assert.equal('issuer_address' in status.invoice, false);
  assert.equal('issuer_tax_id' in status.invoice, false);
  assert.equal('secret_key' in status.stripe, false);
  assert.equal('webhook_secret' in status.stripe, false);
});

test('setup reads live environment values and its timestamp after the asynchronous queue inspection', async (t) => {
  const start = Date.parse('2026-10-04T12:00:00.000Z');
  const finish = start + 5000;
  t.mock.timers.enable({ apis: ['Date'], now: start });
  const calls = [];
  const environment = {
    FUNDING_PLATFORM_ENV: 'before-queue',
    FUNDING_ADMIN_NOTIFICATION_EMAIL: 'before@example.test'
  };
  const f = setupFixture({
    hasDatabase: true,
    checkDatabaseConnection: async () => calls.push('database'),
    getTransactionalEmailConfigStatus: () => {
      calls.push('email-config');
      return setupFixture().dependencies.getTransactionalEmailConfigStatus();
    },
    getEmailQueueStatus: async () => {
      calls.push('queue');
      await Promise.resolve();
      environment.FUNDING_PLATFORM_ENV = '';
      environment.FUNDING_ADMIN_NOTIFICATION_EMAIL = '  after@example.test  ';
      t.mock.timers.setTime(finish);
      return emptyQueue;
    },
    readEnvironment: (key) => {
      calls.push(['environment', key]);
      return environment[key];
    }
  });
  assert.deepEqual(calls, []);
  const status = await f.buildAdminSetupStatus();
  assert.equal(status.environment, '');
  assert.equal(status.email.admin_notification_email, 'after@example.test');
  assert.equal(status.last_updated_at, '2026-10-04T12:00:05.000Z');
  assert.deepEqual(calls, [
    'database',
    'email-config',
    'queue',
    ['environment', 'FUNDING_PLATFORM_ENV'],
    ['environment', 'FUNDING_ADMIN_NOTIFICATION_EMAIL']
  ]);
});

test('email configuration failures remain fatal before queue inspection', async () => {
  const failure = new Error('synthetic invalid SMTP configuration');
  const f = setupFixture({
    getTransactionalEmailConfigStatus: () => {
      throw failure;
    }
  });
  await assert.rejects(f.buildAdminSetupStatus(), (error) => error === failure);
  assert.deepEqual(f.calls, []);
});

test('assistant audit without persistence does not resolve the actor or write a log', async () => {
  const calls = [];
  const recordAdminAssistantAudit = createAssistantAuditRecorder({
    auditAvailable: false,
    getAdminAuditActor: () => calls.push('actor'),
    insertAdminAuditLog: async () => calls.push('insert'),
    reportFailure: (...args) => calls.push(['report', ...args])
  });
  await recordAdminAssistantAudit({}, 'admin_assistant.query', {
    outcome: 'ok'
  });
  assert.deepEqual(calls, []);
});

test('assistant audit records only the supplied consultation metadata and ignores a false persistence result', async () => {
  const request = { body: 'Synthetic private question' };
  const metadata = { tool: 'sponsorships', outcome: 'ok', durationMs: 12 };
  const calls = [];
  const recordAdminAssistantAudit = createAssistantAuditRecorder({
    auditAvailable: true,
    getAdminAuditActor: (received) => {
      assert.equal(received, request);
      return 'synthetic-admin';
    },
    insertAdminAuditLog: async (input) => {
      calls.push(input);
      return false;
    },
    reportFailure: (...args) => calls.push(['report', ...args])
  });
  await recordAdminAssistantAudit(request, 'admin_assistant.query', metadata);
  assert.deepEqual(calls, [
    {
      actor: 'synthetic-admin',
      action: 'admin_assistant.query',
      entityType: 'admin_assistant',
      entityId: null,
      summary: null,
      metadata
    }
  ]);
  assert.equal(calls[0].metadata, metadata);
  assert.equal(JSON.stringify(calls).includes(request.body), false);
});

test('assistant actor and persistence failures are best effort and retain the original reporting message', async () => {
  for (const failingPort of ['actor', 'insert']) {
    const failure = new Error(`synthetic ${failingPort} failure`);
    const reports = [];
    const recordAdminAssistantAudit = createAssistantAuditRecorder({
      auditAvailable: true,
      getAdminAuditActor: () => {
        if (failingPort === 'actor') throw failure;
        return 'synthetic-admin';
      },
      insertAdminAuditLog: async () => {
        throw failure;
      },
      reportFailure: (...args) => reports.push(args)
    });
    await assert.doesNotReject(
      recordAdminAssistantAudit({}, 'admin_assistant.summary', {
        outcome: 'ok'
      })
    );
    assert.deepEqual(reports, [
      ['Failed to record admin assistant audit.', failure]
    ]);
  }
});

test('development Checkout returns only a mocked redirect result without a payment confirmation', () => {
  assert.deepEqual(
    createDevelopmentCheckoutResult({
      projectId: 'synthetic-project',
      amount: 2500,
      successUrl: 'https://funding.example.test/thanks',
      cancelUrl: 'https://funding.example.test/cancel'
    }),
    {
      checkoutId: 'stripe-dev-fallback-synthetic-project-2500',
      redirectUrl: 'https://funding.example.test/thanks',
      status: 'mocked'
    }
  );
});

test('development refunds retain their minor-unit amount and payment intent with fresh 12-byte identifiers', () => {
  const input = {
    amountCents: 2500,
    currency: 'cad',
    paymentIntentId: 'pi_synthetic'
  };
  const first = createDevelopmentRefundResult(input);
  const second = createDevelopmentRefundResult(input);
  assert.match(first.id, /^re_dev_[a-f0-9]{24}$/);
  assert.match(second.id, /^re_dev_[a-f0-9]{24}$/);
  assert.notEqual(first.id, second.id);
  assert.deepEqual(first, {
    id: first.id,
    amount: 2500,
    currency: 'cad',
    status: 'succeeded',
    payment_intent: 'pi_synthetic'
  });
});
