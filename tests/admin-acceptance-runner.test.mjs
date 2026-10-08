import assert from 'node:assert/strict';
import test from 'node:test';

import {
  acceptanceEnvironment,
  acceptanceStages,
  assertLocalDockerEndpoint
} from '../scripts/lib/admin-acceptance.mjs';

test('acceptance ignores inherited application credentials, Compose targets and external URLs', () => {
  const env = acceptanceEnvironment({
    parent: {
      PATH: '/toolchain',
      DATABASE_URL: 'forbidden-database',
      COMPOSE_FILE: 'forbidden.yml',
      COMPOSE_PROJECT_NAME: 'production',
      FUNDING_ADMIN_TOKEN: 'forbidden-token',
      STRIPE_SECRET_KEY: 'forbidden-key',
      SMTP_PASSWORD: 'forbidden-password',
      PLAYWRIGHT_BASE_URL: 'https://example.invalid',
      STRIPE_STUB_BASE_URL: 'https://example.invalid',
      MIGRATIONS_DIR: 'forbidden'
    },
    root: '/repo',
    project: 'og7-acceptance-a1b2',
    envFile: '/temporary/empty.env',
    webPort: 48080,
    stripePort: 44242
  });
  assert.equal(env.PATH, '/toolchain');
  assert.equal(env.FUNDING_PLATFORM_ENV, 'test');
  assert.equal(env.FUNDING_ADMIN_AUTH_MODE, 'token');
  assert.ok(env.FUNDING_ADMIN_TOKEN.length >= 32);
  assert.ok(env.FUNDING_ADMIN_SESSION_SECRET.length >= 32);
  assert.notEqual(env.FUNDING_ADMIN_SESSION_SECRET, env.FUNDING_ADMIN_TOKEN);
  assert.equal(env.DATABASE_URL, undefined);
  assert.equal(env.SMTP_PASSWORD, undefined);
  assert.equal(env.MIGRATIONS_DIR, undefined);
  assert.equal(env.OPENG7_E2E_ENV_FILE, '/temporary/empty.env');
  assert.equal(env.COMPOSE_PROJECT_NAME, 'og7-acceptance-a1b2');
  assert.match(env.COMPOSE_FILE, /docker-compose.acceptance.yml$/);
  assert.equal(env.PLAYWRIGHT_BASE_URL, 'http://127.0.0.1:48080');
  assert.equal(env.STRIPE_STUB_BASE_URL, 'http://127.0.0.1:44242');
  assert.equal(
    Object.values(env).some((value) => value.includes('forbidden')),
    false
  );
});

test('acceptance refuses remote Docker daemons', () => {
  for (const endpoint of [
    'unix:///var/run/docker.sock',
    'npipe:////./pipe/docker_engine',
    'tcp://127.0.0.1:2375'
  ])
    assert.doesNotThrow(() => assertLocalDockerEndpoint(endpoint));
  for (const endpoint of [
    'ssh://example.invalid',
    'tcp://example.invalid:2375',
    'tcp://127.0.0.1.example.invalid:2375'
  ])
    assert.throws(() => assertLocalDockerEndpoint(endpoint));
});

test('acceptance preserves browser filters and project while forcing one worker', async () => {
  const calls = [];
  const args = [
    'tests/playwright/webhook-recovery-acceptance.spec.ts',
    '--grep',
    'invoice_insert',
    '--project=chromium',
    '--workers=2'
  ];
  await acceptanceStages({
    node: 'node',
    cli: 'playwright',
    args,
    diagnostics: async () => {},
    run: async (command, stageArgs) => {
      calls.push([command, ...stageArgs]);
    }
  });
  const browserCalls = calls.filter(
    ([command, cli]) => command === 'node' && cli === 'playwright'
  );
  assert.deepEqual(browserCalls, [
    ['node', 'playwright', 'test', ...args, '--workers=1']
  ]);
});

test('acceptance places its worker override before the option terminator without changing source arguments', async () => {
  const calls = [];
  const args = Object.freeze([
    '--project=chromium',
    '--grep',
    'invoice_insert',
    '--workers=2',
    'tests/playwright/webhook-recovery-acceptance.spec.ts',
    '--',
    '--workers=3'
  ]);
  await acceptanceStages({
    node: 'node',
    cli: 'playwright',
    args,
    diagnostics: async () => {},
    run: async (command, stageArgs) => {
      calls.push([command, ...stageArgs]);
    }
  });
  const browserCalls = calls.filter(
    ([command, cli]) => command === 'node' && cli === 'playwright'
  );
  assert.deepEqual(browserCalls, [
    [
      'node',
      'playwright',
      'test',
      '--project=chromium',
      '--grep',
      'invoice_insert',
      '--workers=2',
      'tests/playwright/webhook-recovery-acceptance.spec.ts',
      '--workers=1',
      '--',
      '--workers=3'
    ]
  ]);
});

test('acceptance stops at every failed stage and always tears down its stack', async () => {
  for (let failure = 0; failure < 7; failure++) {
    const calls = [];
    let diagnostics = 0;
    await assert.rejects(
      acceptanceStages({
        node: 'node',
        cli: 'playwright',
        run: async (command, args) => {
          calls.push([command, ...args]);
          if (calls.length - 1 === failure) throw new Error('stage failed');
        },
        diagnostics: async () => {
          diagnostics++;
        }
      }),
      /stage failed/
    );
    assert.equal(calls.length, failure + 2);
    assert.equal(diagnostics, 1);
    assert.deepEqual(calls.at(-1), [
      'docker',
      'compose',
      'down',
      '--remove-orphans'
    ]);
  }
});

test('acceptance reports cleanup failure after successful browser tests', async () => {
  await assert.rejects(
    acceptanceStages({
      node: 'node',
      cli: 'playwright',
      diagnostics: async () => {},
      run: async (_command, args) => {
        if (args.includes('down')) throw new Error('cleanup failed');
      }
    }),
    /cleanup failed/
  );
});
