import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  createCheckoutReturnUrlResolver,
  loadApiRuntimeAdminAuthMode,
  loadApiRuntimeConfig as loadStartupConfig,
  loadApiRuntimeContributionNotificationConfig,
  loadApiRuntimeEmailConfig,
  loadApiRuntimeHttpConfig,
  loadApiRuntimeSocialPublicationConfig,
  validateApiRuntimeConfig
} from '../dist/apps/funding-api/src/api-runtime-config.js';

const loadApiRuntimeConfig = (env) => ({
  ...loadStartupConfig(env),
  ...loadApiRuntimeHttpConfig(env)
});

test('startup phases leave media and URL validation until after storage construction', () => {
  const env = {
    FUNDING_SPONSOR_MEDIA_MAX_BYTES: 'invalid',
    FUNDING_PUBLIC_BASE_URL: 'invalid',
    STRIPE_SIMULATED_CHECKOUT_ENABLED: 'invalid'
  };
  assert.doesNotThrow(() => loadStartupConfig(env));
  assert.throws(
    () => loadApiRuntimeHttpConfig(env),
    /FUNDING_SPONSOR_MEDIA_MAX_BYTES/
  );
  assert.throws(() =>
    loadApiRuntimeHttpConfig({
      ...env,
      FUNDING_SPONSOR_MEDIA_MAX_BYTES: undefined
    })
  );
});

test('runtime config preserves absent-setting defaults without requiring providers', () => {
  const config = loadApiRuntimeConfig({});
  assert.equal(config.port, 3333);
  assert.equal(config.projectId, 'openg7');
  assert.equal(config.environment, 'development');
  assert.equal(config.isProduction, false);
  assert.equal(config.businessSponsorshipEnabled, false);
  assert.equal(config.stripeSecretKey, undefined);
  assert.equal(config.stripeWebhookSecret, undefined);
  assert.equal(config.adminToken, '');
  assert.equal(config.adminSessionSecret, '');
  assert.equal(config.adminSessionTtlMinutes, 60);
  assert.equal(config.sponsorshipFollowupTokenTtlDays, 30);
  assert.equal(config.rateLimitWindowMs, 60000);
  assert.equal(config.publicWriteRateLimitMax, 60);
  assert.equal(config.sponsorshipFollowupRateLimitMax, 60);
  assert.equal(config.referenceLookupRateLimitMax, 30);
  assert.equal(config.referenceRecoveryRateLimitMax, 10);
  assert.equal(config.adminRateLimitMax, 120);
  assert.equal(config.emailQueueWorkerEnabled, true);
  assert.equal(config.emailQueuePollIntervalMs, 30000);
  assert.equal(config.emailQueueBatchSize, 10);
  assert.deepEqual(config.adminSponsorshipReviewReminderConfig, {
    enabled: true,
    minAgeDays: 1,
    pollIntervalMs: 3600000,
    maxItems: 5
  });
  assert.equal(config.adminAssistantConfig.enabled, false);
  assert.equal(config.adminAssistantConfig.provider, 'disabled');
  assert.equal(config.sponsorLogoMaxBytes, 512 * 1024);
  assert.equal(
    config.sponsorMediaStorageConfig.localStorageDir,
    path.resolve('var/sponsor-logos')
  );
  assert.equal(config.sponsorMediaMaxBytes, 8 * 1024 * 1024);
  assert.equal(config.sponsorMediaMaxSupportingImages, 3);
  assert.equal(config.trustedProxyHops, 0);
  assert.deepEqual(config.allowedOrigins, []);
  assert.equal(config.publicBaseUrl, null);
  assert.equal(config.publicBaseOrigin, 'https://example.org');
  assert.deepEqual([...config.allowedReturnHostnames], []);
  assert.deepEqual([...config.allowedContributionAmounts], [5, 10, 25, 50]);
  assert.deepEqual(
    [...config.allowedContributionTypes],
    ['personal_support', 'sponsorship_interest']
  );
  assert.equal(config.navigableSimulatedCheckout, false);
  assert.deepEqual(config.stripeOptions, {});
  assert.deepEqual(config.stripeBackfillOptions, {
    timeout: 10000,
    maxNetworkRetries: 0
  });
  assert.doesNotThrow(() => validateApiRuntimeConfig(config));
});

test('runtime config uses its supplied environment and preserves valid values', () => {
  const config = loadApiRuntimeConfig({
    FUNDING_API_PORT: '4444',
    FUNDING_PROJECT_ID: 'test-campaign',
    FUNDING_PLATFORM_ENV: 'test',
    STRIPE_SECRET_KEY: 'sk_test_runtime_fixture',
    STRIPE_WEBHOOK_SECRET: 'whsec_runtime_fixture',
    FUNDING_BUSINESS_SPONSORSHIP_ENABLED: ' yes ',
    FUNDING_ADMIN_TOKEN: ' root-fixture ',
    FUNDING_ADMIN_SESSION_SECRET: ' session-fixture ',
    FUNDING_ADMIN_SESSION_TTL_MINUTES: '45',
    FUNDING_SPONSORSHIP_FOLLOWUP_TOKEN_TTL_DAYS: '14',
    FUNDING_RATE_LIMIT_WINDOW_MS: '5000',
    FUNDING_PUBLIC_WRITE_RATE_LIMIT_MAX: '12',
    FUNDING_SPONSORSHIP_FOLLOWUP_RATE_LIMIT_MAX: '13',
    FUNDING_REFERENCE_LOOKUP_RATE_LIMIT_MAX: '14',
    FUNDING_REFERENCE_RECOVERY_RATE_LIMIT_MAX: '15',
    FUNDING_ADMIN_RATE_LIMIT_MAX: '16',
    FUNDING_EMAIL_WORKER_ENABLED: ' false ',
    FUNDING_EMAIL_QUEUE_POLL_INTERVAL_MS: '6000',
    FUNDING_EMAIL_QUEUE_BATCH_SIZE: '20',
    FUNDING_ADMIN_REVIEW_REMINDER_ENABLED: 'off',
    FUNDING_ADMIN_REVIEW_REMINDER_MIN_AGE_DAYS: '0',
    FUNDING_ADMIN_REVIEW_REMINDER_POLL_INTERVAL_MS: '8000',
    FUNDING_ADMIN_REVIEW_REMINDER_MAX_ITEMS: '9',
    ADMIN_AI_ASSISTANT_ENABLED: 'on',
    ADMIN_AI_PROVIDER: 'mock',
    ADMIN_AI_MAX_TOOL_CALLS: '100',
    FUNDING_SPONSOR_LOGO_MAX_BYTES: '1024',
    FUNDING_SPONSOR_LOGO_STORAGE_DIR: 'var/test-logos',
    FUNDING_SPONSOR_MEDIA_MAX_BYTES: '2048',
    FUNDING_SPONSOR_MEDIA_MAX_SUPPORTING_IMAGES: '4',
    FUNDING_TRUSTED_PROXY_HOPS: '2',
    FUNDING_ALLOWED_AMOUNTS: '7, 7, invalid, 0, -3, Infinity, 12.5'
  });
  assert.equal(config.port, 4444);
  assert.equal(config.projectId, 'test-campaign');
  assert.equal(config.environment, 'test');
  assert.equal(config.stripeSecretKey, 'sk_test_runtime_fixture');
  assert.equal(config.stripeWebhookSecret, 'whsec_runtime_fixture');
  assert.equal(config.businessSponsorshipEnabled, true);
  assert.equal(config.adminToken, 'root-fixture');
  assert.equal(config.adminSessionSecret, 'session-fixture');
  assert.equal(config.adminSessionTtlMinutes, 45);
  assert.equal(config.sponsorshipFollowupTokenTtlDays, 14);
  assert.equal(config.rateLimitWindowMs, 5000);
  assert.equal(config.publicWriteRateLimitMax, 12);
  assert.equal(config.sponsorshipFollowupRateLimitMax, 13);
  assert.equal(config.referenceLookupRateLimitMax, 14);
  assert.equal(config.referenceRecoveryRateLimitMax, 15);
  assert.equal(config.adminRateLimitMax, 16);
  assert.equal(config.emailQueueWorkerEnabled, false);
  assert.equal(config.emailQueuePollIntervalMs, 6000);
  assert.equal(config.emailQueueBatchSize, 20);
  assert.deepEqual(config.adminSponsorshipReviewReminderConfig, {
    enabled: false,
    minAgeDays: 0,
    pollIntervalMs: 8000,
    maxItems: 9
  });
  assert.equal(config.adminAssistantConfig.providerConfigured, true);
  assert.equal(config.adminAssistantConfig.maxToolCalls, 20);
  assert.equal(config.sponsorLogoMaxBytes, 1024);
  assert.equal(
    config.sponsorMediaStorageConfig.localStorageDir,
    path.resolve('var/test-logos')
  );
  assert.equal(config.sponsorMediaMaxBytes, 2048);
  assert.equal(config.sponsorMediaMaxSupportingImages, 4);
  assert.equal(config.trustedProxyHops, 2);
  assert.deepEqual([...config.allowedContributionAmounts], [7, 12.5]);
});

test('optional limits fall back on invalid values while zero and blank quotas are retained', () => {
  const positiveSettings = {
    FUNDING_ADMIN_SESSION_TTL_MINUTES: 'adminSessionTtlMinutes',
    FUNDING_SPONSORSHIP_FOLLOWUP_TOKEN_TTL_DAYS:
      'sponsorshipFollowupTokenTtlDays',
    FUNDING_RATE_LIMIT_WINDOW_MS: 'rateLimitWindowMs',
    FUNDING_EMAIL_QUEUE_POLL_INTERVAL_MS: 'emailQueuePollIntervalMs',
    FUNDING_EMAIL_QUEUE_BATCH_SIZE: 'emailQueueBatchSize',
    FUNDING_SPONSOR_LOGO_MAX_BYTES: 'sponsorLogoMaxBytes'
  };
  const nonNegativeSettings = {
    FUNDING_PUBLIC_WRITE_RATE_LIMIT_MAX: 'publicWriteRateLimitMax',
    FUNDING_SPONSORSHIP_FOLLOWUP_RATE_LIMIT_MAX:
      'sponsorshipFollowupRateLimitMax',
    FUNDING_REFERENCE_LOOKUP_RATE_LIMIT_MAX: 'referenceLookupRateLimitMax',
    FUNDING_REFERENCE_RECOVERY_RATE_LIMIT_MAX: 'referenceRecoveryRateLimitMax',
    FUNDING_ADMIN_RATE_LIMIT_MAX: 'adminRateLimitMax'
  };
  const defaults = loadApiRuntimeConfig({});
  for (const value of ['-1', '1.5', 'invalid', 'Infinity']) {
    const env = Object.fromEntries(
      [
        ...Object.keys(positiveSettings),
        ...Object.keys(nonNegativeSettings)
      ].map((name) => [name, value])
    );
    const config = loadApiRuntimeConfig(env);
    for (const field of [
      ...Object.values(positiveSettings),
      ...Object.values(nonNegativeSettings)
    ])
      assert.equal(config[field], defaults[field], `${field}: ${value}`);
  }
  for (const value of ['0', '', '  ']) {
    const config = loadApiRuntimeConfig(
      Object.fromEntries(
        [
          ...Object.keys(positiveSettings),
          ...Object.keys(nonNegativeSettings)
        ].map((name) => [name, value])
      )
    );
    for (const field of Object.values(positiveSettings))
      assert.equal(config[field], defaults[field]);
    for (const field of Object.values(nonNegativeSettings))
      assert.equal(config[field], 0);
  }
  assert.equal(
    loadApiRuntimeConfig({ FUNDING_BUSINESS_SPONSORSHIP_ENABLED: 'invalid' })
      .businessSponsorshipEnabled,
    false
  );
  assert.equal(loadApiRuntimeConfig({ FUNDING_API_PORT: '' }).port, 0);
  assert.ok(
    Number.isNaN(loadApiRuntimeConfig({ FUNDING_API_PORT: 'invalid' }).port)
  );
  assert.equal(loadApiRuntimeConfig({ FUNDING_PROJECT_ID: '' }).projectId, '');
  assert.deepEqual(
    [
      ...loadApiRuntimeConfig({ FUNDING_ALLOWED_AMOUNTS: '' })
        .allowedContributionAmounts
    ],
    []
  );
});

test('strict proxy and media loaders reject invalid startup values', () => {
  for (const value of ['-1', '9', '1.5', 'invalid'])
    assert.throws(
      () => loadApiRuntimeConfig({ FUNDING_TRUSTED_PROXY_HOPS: value }),
      /FUNDING_TRUSTED_PROXY_HOPS must be an integer between 0 and 8/
    );
  for (const value of ['', '0', '1.5', '8388609', 'invalid'])
    assert.throws(
      () => loadApiRuntimeConfig({ FUNDING_SPONSOR_MEDIA_MAX_BYTES: value }),
      /FUNDING_SPONSOR_MEDIA_MAX_BYTES must be an integer between 1 and 8388608/
    );
  assert.throws(
    () =>
      loadApiRuntimeConfig({
        FUNDING_SPONSOR_MEDIA_MAX_SUPPORTING_IMAGES: '0'
      }),
    /FUNDING_SPONSOR_MEDIA_MAX_SUPPORTING_IMAGES/
  );
});

test('origins and public URL precedence preserve normalization and fallback rules', () => {
  const env = {
    FUNDING_PUBLIC_BASE_URL: 'https://fund.example.org/base?x=1#fragment',
    FUNDING_ALLOWED_ORIGINS:
      ' , https://web.example.org , https://other.example.org:8443, ',
    APP_DOMAIN: 'domain.example.org'
  };
  const config = loadApiRuntimeConfig(env);
  assert.equal(config.publicBaseUrl, env.FUNDING_PUBLIC_BASE_URL);
  assert.equal(config.publicBaseOrigin, 'https://fund.example.org');
  assert.deepEqual(config.allowedOrigins, [
    'https://web.example.org',
    'https://other.example.org:8443'
  ]);
  assert.deepEqual(
    [...config.allowedReturnHostnames],
    ['fund.example.org', 'web.example.org', 'other.example.org']
  );
  assert.equal(
    loadApiRuntimeConfig({ ...env, FUNDING_PUBLIC_BASE_URL: undefined })
      .publicBaseUrl,
    'https://web.example.org'
  );
  assert.equal(
    loadApiRuntimeConfig({ APP_DOMAIN: 'domain.example.org' }).publicBaseUrl,
    'https://domain.example.org'
  );
  const blankBase = loadApiRuntimeConfig({
    FUNDING_PUBLIC_BASE_URL: '',
    APP_DOMAIN: 'domain.example.org'
  });
  assert.equal(blankBase.publicBaseUrl, '');
  assert.equal(blankBase.publicBaseOrigin, 'https://example.org');
  assert.throws(() =>
    loadApiRuntimeConfig({ FUNDING_PUBLIC_BASE_URL: 'invalid' })
  );
  assert.throws(() =>
    loadApiRuntimeConfig({ FUNDING_ALLOWED_ORIGINS: 'invalid' })
  );
});

test('Stripe transport options preserve SDK defaults and the bounded backfill client', () => {
  const config = loadApiRuntimeConfig({
    STRIPE_API_HOST: 'stripe-stub',
    STRIPE_API_PORT: '12111',
    STRIPE_API_PROTOCOL: 'http',
    SPONSOR_MEDIA_STORAGE_DRIVER: 'ovh-s3',
    SPONSOR_MEDIA_REGION: 'test-region',
    SPONSOR_MEDIA_ENDPOINT: 'https://objects.example.org',
    SPONSOR_MEDIA_PUBLIC_BUCKET: 'public-fixture',
    SPONSOR_MEDIA_PUBLIC_BASE_URL: 'https://cdn.example.org',
    SPONSOR_MEDIA_PRIVATE_BUCKET: 'private-fixture',
    SPONSOR_MEDIA_PRIVATE_BASE_URL: 'https://private.example.org',
    OVH_S3_ACCESS_KEY_ID: 'synthetic-access-key',
    OVH_S3_SECRET_ACCESS_KEY: 'synthetic-secret-key'
  });
  assert.deepEqual(config.stripeOptions, {
    host: 'stripe-stub',
    port: '12111',
    protocol: 'http'
  });
  assert.deepEqual(config.stripeBackfillOptions, {
    host: 'stripe-stub',
    port: '12111',
    protocol: 'http',
    timeout: 10000,
    maxNetworkRetries: 0
  });
  assert.deepEqual(config.sponsorMediaStorageConfig.s3, {
    region: 'test-region',
    endpoint: 'https://objects.example.org',
    publicBucket: 'public-fixture',
    publicBaseUrl: 'https://cdn.example.org',
    privateBucket: 'private-fixture',
    privateBaseUrl: 'https://private.example.org',
    accessKeyId: 'synthetic-access-key',
    secretAccessKey: 'synthetic-secret-key'
  });
  assert.deepEqual(
    loadApiRuntimeConfig({
      STRIPE_API_HOST: '',
      STRIPE_API_PORT: '',
      STRIPE_API_PROTOCOL: ''
    }).stripeOptions,
    {}
  );
  assert.notEqual(config.stripeOptions, config.stripeBackfillOptions);
});

test('simulated Checkout keeps the existing strict opt-in and local test restrictions', () => {
  const env = {
    FUNDING_PLATFORM_ENV: 'test',
    STRIPE_SECRET_KEY: 'sk_test_runtime_fixture',
    STRIPE_API_HOST: 'stripe-stub',
    STRIPE_SIMULATED_CHECKOUT_ENABLED: 'true'
  };
  assert.equal(loadApiRuntimeConfig(env).navigableSimulatedCheckout, true);
  for (const overrides of [
    { STRIPE_SIMULATED_CHECKOUT_ENABLED: 'yes' },
    { FUNDING_PLATFORM_ENV: 'production' },
    { STRIPE_API_HOST: 'api.stripe.com' },
    { STRIPE_SECRET_KEY: undefined }
  ])
    assert.throws(
      () => loadApiRuntimeConfig({ ...env, ...overrides }),
      /Checkout|CHECKOUT/
    );
});

test('production validation retains required settings and its error priority', () => {
  const production = loadApiRuntimeConfig({
    FUNDING_PLATFORM_ENV: 'production'
  });
  assert.throws(
    () => validateApiRuntimeConfig(production),
    /STRIPE_SECRET_KEY is required/
  );
  assert.throws(
    () =>
      validateApiRuntimeConfig({
        ...production,
        stripeSecretKey: 'sk_test_fixture'
      }),
    /FUNDING_PUBLIC_BASE_URL or FUNDING_ALLOWED_ORIGINS is required/
  );
  for (const overrides of [
    { FUNDING_PUBLIC_BASE_URL: 'https://fund.example.org' },
    { FUNDING_ALLOWED_ORIGINS: 'https://fund.example.org' },
    { APP_DOMAIN: 'fund.example.org' }
  ])
    assert.doesNotThrow(() =>
      validateApiRuntimeConfig(
        loadApiRuntimeConfig({
          FUNDING_PLATFORM_ENV: 'production',
          STRIPE_SECRET_KEY: 'sk_test_fixture',
          ...overrides
        })
      )
    );
  assert.equal(
    loadApiRuntimeConfig({ FUNDING_PLATFORM_ENV: 'Production' }).isProduction,
    false
  );
});

test('Checkout return URLs allow configured HTTPS origins and fall back safely', () => {
  const resolve = createCheckoutReturnUrlResolver(
    loadApiRuntimeConfig({
      FUNDING_PLATFORM_ENV: 'production',
      FUNDING_PUBLIC_BASE_URL: 'https://fund.example.org/base',
      FUNDING_ALLOWED_ORIGINS: 'https://web.example.org'
    })
  );
  for (const candidate of [
    'https://fund.example.org/success?session_id=fixture#status',
    'https://web.example.org/cancel?reason=fixture',
    'https://web.example.org:443/cancel'
  ])
    assert.equal(
      resolve(candidate, '/fallback'),
      new URL(candidate).toString()
    );
  for (const candidate of [
    'invalid',
    '/relative-success',
    'https://unknown.example.org/success',
    'https://unknown.example.org:8443/success',
    'http://fund.example.org/success',
    'http://localhost:4200/success',
    'ftp://fund.example.org/success',
    'javascript:alert(1)'
  ])
    assert.equal(
      resolve(candidate, '/fallback?state=fixture'),
      'https://fund.example.org/fallback?state=fixture'
    );
});

test('Checkout return URLs on known hosts with explicit ports are rewritten to the public origin', () => {
  const resolve = createCheckoutReturnUrlResolver(
    loadApiRuntimeConfig({
      FUNDING_PUBLIC_BASE_URL: 'https://fund.example.org',
      FUNDING_ALLOWED_ORIGINS: 'https://web.example.org:8443'
    })
  );
  for (const candidate of [
    'https://fund.example.org:9443/success?session_id=fixture#status',
    'https://web.example.org:8443/success?session_id=fixture#status'
  ])
    assert.equal(
      resolve(candidate, '/fallback'),
      'https://fund.example.org/success?session_id=fixture#status'
    );
  assert.equal(
    resolve('https://web.example.org/success', '/fallback'),
    'https://fund.example.org/fallback'
  );
});

test('development Checkout permits HTTP IPv4 loopback only and retains unconfigured HTTPS fallback', () => {
  const resolve = createCheckoutReturnUrlResolver(loadApiRuntimeConfig({}));
  for (const candidate of [
    'http://localhost:4200/success?fixture=1',
    'http://127.0.0.1:9000/cancel'
  ])
    assert.equal(resolve(candidate, '/fallback'), candidate);
  for (const candidate of [
    'http://[::1]:4200/success',
    'http://localhost.example.org/success',
    'https://unknown.example.org/success'
  ])
    assert.equal(
      resolve(candidate, '/fallback'),
      'https://example.org/fallback'
    );
  assert.equal(
    resolve('https://example.org/success', '/fallback'),
    'https://example.org/success'
  );
});

test('email startup loaders retain strict parsing and disabled SMTP needs no secret', () => {
  const disabled = loadApiRuntimeEmailConfig({});
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.password, '');
  assert.equal(disabled.port, 465);
  assert.equal(disabled.secure, true);
  for (const env of [
    { FUNDING_EMAIL_WORKER_ENABLED: 'invalid-fixture' },
    { FUNDING_EMAIL_WORKER_ENABLED: '2' }
  ])
    assert.throws(
      () => loadApiRuntimeConfig(env),
      (error) =>
        error.code === 'EMAIL_CONFIGURATION_ERROR' &&
        !error.message.includes('invalid-fixture')
    );
  assert.equal(
    loadApiRuntimeConfig({ FUNDING_EMAIL_WORKER_ENABLED: '' })
      .emailQueueWorkerEnabled,
    true
  );
  for (const env of [
    { SMTP_ENABLED: 'invalid-fixture' },
    { SMTP_PORT: '-1' },
    { SMTP_SECURE: 'invalid-fixture' },
    { SMTP_CONNECTION_TIMEOUT_MS: '0' },
    { SMTP_GREETING_TIMEOUT_MS: '1.5' },
    { SMTP_SOCKET_TIMEOUT_MS: 'invalid-fixture' },
    { SMTP_ENABLED: 'true' }
  ])
    assert.throws(
      () => loadApiRuntimeEmailConfig(env),
      (error) =>
        error.code === 'EMAIL_CONFIGURATION_ERROR' &&
        !error.message.includes('invalid-fixture')
    );
  const enabled = loadApiRuntimeEmailConfig({
    SMTP_ENABLED: 'yes',
    SMTP_SECURE: 'no',
    SMTP_PORT: '587',
    SMTP_USER: 'sender@example.org',
    SMTP_PASSWORD: 'synthetic-password'
  });
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.secure, false);
  assert.equal(enabled.port, 587);
});

test('late runtime config loaders retain auth, publication and notification contracts', () => {
  assert.equal(loadApiRuntimeAdminAuthMode({}), 'token');
  assert.equal(
    loadApiRuntimeAdminAuthMode({ FUNDING_ADMIN_AUTH_MODE: 'oidc' }),
    'oidc'
  );
  for (const mode of ['', 'OIDC', ' oidc ', 'invalid-fixture'])
    assert.throws(
      () => loadApiRuntimeAdminAuthMode({ FUNDING_ADMIN_AUTH_MODE: mode }),
      /^Error: Invalid admin auth mode\.$/
    );
  assert.equal(loadApiRuntimeSocialPublicationConfig({}).mode, 'disabled');
  assert.equal(
    loadApiRuntimeSocialPublicationConfig({
      SOCIAL_PUBLICATION_MODE: 'invalid'
    }).mode,
    'disabled'
  );
  const social = loadApiRuntimeSocialPublicationConfig({
    FUNDING_PLATFORM_ENV: 'test',
    SOCIAL_PUBLICATION_MODE: 'mock',
    SOCIAL_PUBLICATION_MOCK_URL: 'http://stripe-stub/__test__/social'
  });
  assert.equal(social.mockBaseUrl, 'http://stripe-stub/__test__/social');
  assert.throws(
    () =>
      loadApiRuntimeSocialPublicationConfig({
        SOCIAL_PUBLICATION_MODE: 'mock',
        SOCIAL_PUBLICATION_MOCK_URL:
          'https://external.example.org/__test__/social'
      }),
    /Social simulation requires an isolated local receiver/
  );
  assert.deepEqual(loadApiRuntimeContributionNotificationConfig({}), {
    email: null,
    smsUrl: null,
    publicBaseUrl: 'http://localhost:4200',
    workerDefault: false
  });
  assert.throws(
    () =>
      loadApiRuntimeContributionNotificationConfig({
        FUNDING_CONTRIBUTION_EMAIL_ENABLED: 'yes'
      }),
    /Invalid FUNDING_CONTRIBUTION_EMAIL_ENABLED/
  );
  assert.throws(
    () =>
      loadApiRuntimeContributionNotificationConfig({
        FUNDING_CONTRIBUTION_EMAIL_ENABLED: 'true'
      }),
    /Contribution notifications require an admin email/
  );
});
