import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateServicesReadiness } from '../scripts/lib/services-readiness.mjs';
import { formatServicesReadinessReport } from '../scripts/lib/services-check-report.mjs';
import {
  completeConfig,
  oidcConfig,
  alertsConfig
} from './support/services-check-fixtures.mjs';

const observations = {
  envFile: 'synthetic.env',
  envFileExists: true,
  nodeVersion: '22.23.3',
  toolStatuses: { docker: 0, stripe: 0 }
};
const evaluate = (changes = {}, observed = {}) =>
  evaluateServicesReadiness(
    { ...completeConfig, ...changes },
    { ...observations, ...observed }
  );
const blockingFields = (checks) =>
  checks
    .filter((check) => check.status === 'missing')
    .map((check) => check.label);

test('readiness is repeatable with isolated records and never mutates supplied configuration', () => {
  const config = Object.freeze({
    ...completeConfig,
    ...oidcConfig,
    ...alertsConfig
  });
  const first = evaluateServicesReadiness(config, observations);
  const second = evaluateServicesReadiness(config, observations);
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  first[0].detail = 'changed by this caller';
  assert.equal(second[0].detail, 'env file found');
  assert.equal(config.FUNDING_ADMIN_AUTH_MODE, 'oidc');
  assert.equal(blockingFields(second).length, 0);
  assert.ok(
    blockingFields(evaluate({ FUNDING_ADMIN_TOKEN: '' })).includes(
      'FUNDING_ADMIN_TOKEN'
    )
  );
  assert.equal(blockingFields(evaluate()).length, 0);
  const rendered = formatServicesReadinessReport(second, observations.envFile);
  for (const name of [
    'DATABASE_URL',
    'FUNDING_ADMIN_OIDC_CLIENT_SECRET',
    'FUNDING_ADMIN_OIDC_OWNER_SUBJECTS',
    'FUNDING_OPERATIONS_WEBHOOK_URL',
    'FUNDING_OPERATIONS_WEBHOOK_SECRET',
    'SMTP_PASSWORD',
    'OVH_S3_ACCESS_KEY_ID',
    'OVH_S3_SECRET_ACCESS_KEY',
    'SOCIAL_PUBLICATION_FACEBOOK_PAGE_ACCESS_TOKEN',
    'SOCIAL_PUBLICATION_LINKEDIN_ACCESS_TOKEN'
  ]) {
    assert.ok(
      !rendered.includes(config[name]),
      `${name} must not expose its synthetic canary`
    );
  }
  assert.ok(!rendered.includes('private-canary'));
});

test('observed local failures produce warnings while configuration alone determines blocking readiness', () => {
  const checks = evaluate(
    {},
    {
      envFileExists: false,
      nodeVersion: '24.0.0',
      toolStatuses: { docker: null, stripe: 7 }
    }
  );
  assert.deepEqual(checks.slice(0, 4), [
    {
      status: 'warn',
      section: 'Configuration',
      label: 'synthetic.env',
      detail: 'env file not found; using shell environment only'
    },
    {
      status: 'warn',
      section: 'Configuration',
      label: 'Node.js',
      detail: 'repository expects Node.js 22.x'
    },
    {
      status: 'warn',
      section: 'Configuration',
      label: 'Docker CLI',
      detail: 'docker command not found'
    },
    {
      status: 'warn',
      section: 'Stripe',
      label: 'Stripe CLI',
      detail: 'stripe command not found'
    }
  ]);
  assert.equal(blockingFields(checks).length, 0);
  assert.match(
    formatServicesReadinessReport(checks, observations.envFile),
    /No blocking configuration issue found/
  );
});

test('media storage validates the selected driver and its byte envelope without requiring unused credentials', async (t) => {
  for (const [name, changes, missing] of [
    [
      'local storage',
      {
        SPONSOR_MEDIA_STORAGE_DRIVER: 'local',
        FUNDING_SPONSOR_LOGO_STORAGE_DIR: 'synthetic/logos',
        OVH_S3_ACCESS_KEY_ID: '',
        OVH_S3_SECRET_ACCESS_KEY: ''
      },
      []
    ],
    [
      'missing local directory',
      { SPONSOR_MEDIA_STORAGE_DRIVER: 'local' },
      ['FUNDING_SPONSOR_LOGO_STORAGE_DIR']
    ],
    [
      'unknown driver',
      { SPONSOR_MEDIA_STORAGE_DRIVER: 'invalid' },
      ['SPONSOR_MEDIA_STORAGE_DRIVER']
    ],
    ['maximum bytes', { FUNDING_SPONSOR_MEDIA_MAX_BYTES: '8388608' }, []],
    [
      'above maximum',
      { FUNDING_SPONSOR_MEDIA_MAX_BYTES: '8388609' },
      ['FUNDING_SPONSOR_MEDIA_MAX_BYTES']
    ],
    [
      'fractional bytes',
      { FUNDING_SPONSOR_MEDIA_MAX_BYTES: '1.5' },
      ['FUNDING_SPONSOR_MEDIA_MAX_BYTES']
    ],
    [
      'zero images',
      { FUNDING_SPONSOR_MEDIA_MAX_SUPPORTING_IMAGES: '0' },
      ['FUNDING_SPONSOR_MEDIA_MAX_SUPPORTING_IMAGES']
    ],
    [
      'bad endpoint',
      { SPONSOR_MEDIA_ENDPOINT: 'http://synthetic.invalid' },
      ['SPONSOR_MEDIA_ENDPOINT']
    ]
  ])
    await t.test(name, () =>
      assert.deepEqual(blockingFields(evaluate(changes)), missing)
    );
});

test('disabled and mock social publication do not demand live provider credentials', async (t) => {
  const missingCredentials = {
    SOCIAL_PUBLICATION_FACEBOOK_PAGE_ACCESS_TOKEN: '',
    SOCIAL_PUBLICATION_LINKEDIN_ACCESS_TOKEN: ''
  };
  for (const mode of ['disabled', 'mock'])
    await t.test(mode, () => {
      const checks = evaluate({
        ...missingCredentials,
        SOCIAL_PUBLICATION_MODE: mode
      });
      assert.deepEqual(blockingFields(checks), []);
      assert.ok(!checks.some((check) => check.label.endsWith('ACCESS_TOKEN')));
    });
  assert.deepEqual(
    blockingFields(
      evaluate({ ...missingCredentials, SOCIAL_PUBLICATION_MODE: 'live' })
    ),
    [
      'SOCIAL_PUBLICATION_FACEBOOK_PAGE_ACCESS_TOKEN',
      'SOCIAL_PUBLICATION_LINKEDIN_ACCESS_TOKEN'
    ]
  );
  assert.deepEqual(
    blockingFields(evaluate({ SOCIAL_PUBLICATION_MODE: 'unknown' })),
    ['SOCIAL_PUBLICATION_MODE']
  );
});

test('mail and reminder failures remain blocking and report summaries match actual records', async (t) => {
  for (const [field, value] of [
    ['SMTP_ENABLED', 'false'],
    ['SMTP_PORT', '0'],
    ['SMTP_SECURE', 'invalid'],
    ['SMTP_USER', 'not-an-email'],
    ['FUNDING_ADMIN_REVIEW_REMINDER_ENABLED', 'invalid'],
    ['FUNDING_ADMIN_REVIEW_REMINDER_MIN_AGE_DAYS', '-1'],
    ['FUNDING_ADMIN_REVIEW_REMINDER_POLL_INTERVAL_MS', '0'],
    ['FUNDING_ADMIN_REVIEW_REMINDER_MAX_ITEMS', '1.5']
  ])
    await t.test(field, () => {
      const checks = evaluate({ [field]: value });
      assert.deepEqual(blockingFields(checks), [field]);
      const report = formatServicesReadinessReport(
        checks,
        observations.envFile
      );
      const count = (status) =>
        checks.filter((check) => check.status === status).length;
      assert.ok(
        report.includes(
          `Summary: ${count('ok')} ok, ${count('warn')} warning, 1 missing`
        )
      );
      assert.ok(report.includes(`- Mail / ${field}:`));
      assert.ok(
        report.endsWith('\nNext: fill .env, then rerun yarn services:check.\n')
      );
      assert.ok(!report.includes('No blocking configuration issue found'));
    });
});
