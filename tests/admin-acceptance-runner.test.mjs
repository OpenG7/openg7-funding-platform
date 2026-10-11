import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { promisify } from 'node:util';
import { dockerModerationConfiguration } from './identity/docker-moderation-server.mjs';

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
      MODERATION_WEB_BASE_URL: 'https://forbidden.example.invalid',
      ACCEPTANCE_OIDC_PROVIDER_PORT: '443',
      ACCEPTANCE_OIDC_NGINX_FILE: '/forbidden/nginx.conf',
      FUNDING_ADMIN_OIDC_ISSUER: 'https://forbidden.example.invalid',
      MIGRATIONS_DIR: 'forbidden'
    },
    root: '/repo',
    project: 'og7-acceptance-a1b2',
    envFile: '/temporary/empty.env',
    webPort: 48080,
    stripePort: 44242,
    moderationWebPort: 48081,
    oidcProviderPort: 48082,
    moderationNginxFile: '/temporary/nginx-oidc.conf'
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
  assert.equal(env.MODERATION_WEB_BASE_URL, 'http://127.0.0.1:48081');
  assert.equal(env.ACCEPTANCE_OIDC_PROVIDER_PORT, '48082');
  assert.equal(env.ACCEPTANCE_OIDC_NGINX_FILE, '/temporary/nginx-oidc.conf');
  assert.equal(env.FUNDING_ADMIN_OIDC_ISSUER, undefined);
  assert.equal(
    Object.values(env).some((value) => value.includes('forbidden')),
    false
  );
});

test('acceptance rejects missing, duplicate and internal API ports', () => {
  const options = {
    parent: {},
    root: '/repo',
    project: 'og7-acceptance-a1b2',
    envFile: '/temporary/empty.env',
    moderationNginxFile: '/temporary/nginx-oidc.conf',
    webPort: 48080,
    stripePort: 44242,
    moderationWebPort: 48081,
    oidcProviderPort: 48082
  };
  for (const changes of [
    { moderationWebPort: undefined },
    { oidcProviderPort: 443 },
    { moderationWebPort: 48080 },
    { oidcProviderPort: 44242 },
    { oidcProviderPort: 3333 },
    { moderationWebPort: 3334 }
  ])
    assert.throws(
      () => acceptanceEnvironment({ ...options, ...changes }),
      /port/i
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

test('moderation identity preflight confines the API and providers to the disposable stack', () => {
  const env = {
    OPENG7_E2E_ISOLATED: '1',
    COMPOSE_PROJECT_NAME: 'og7-acceptance-a1b2',
    FUNDING_PLATFORM_ENV: 'development',
    MODERATION_WEB_BASE_URL: 'http://127.0.0.1:48081',
    ACCEPTANCE_OIDC_PROVIDER_PORT: '48082',
    DATABASE_URL:
      'postgres://acceptance:local-acceptance-only@postgres:5432/acceptance',
    STRIPE_API_HOST: 'stripe-stub',
    STRIPE_API_PROTOCOL: 'http',
    STRIPE_API_PORT: '4242',
    SOCIAL_PUBLICATION_MODE: 'mock'
  };
  const configuration = dockerModerationConfiguration(env);
  assert.equal(configuration.apiPort, 3334);
  assert.equal(configuration.webOrigin, env.MODERATION_WEB_BASE_URL);
  assert.equal(configuration.issuer, 'http://127.0.0.1:48082');
  for (const changes of [
    { OPENG7_E2E_ISOLATED: undefined },
    { COMPOSE_PROJECT_NAME: 'production' },
    { FUNDING_PLATFORM_ENV: 'production' },
    { MODERATION_WEB_BASE_URL: 'https://example.invalid' },
    { MODERATION_WEB_BASE_URL: 'http://127.0.0.1:48081/private' },
    { ACCEPTANCE_OIDC_PROVIDER_PORT: '48081' },
    { ACCEPTANCE_OIDC_PROVIDER_PORT: '3334' },
    {
      DATABASE_URL:
        'postgres://acceptance:synthetic@external.invalid:5432/acceptance'
    },
    {
      DATABASE_URL: 'postgres://acceptance:synthetic@postgres:5432/production'
    },
    { STRIPE_API_HOST: 'api.stripe.com' },
    { SOCIAL_PUBLICATION_MODE: 'live' }
  ])
    assert.throws(() => dockerModerationConfiguration({ ...env, ...changes }));
});

test(
  'acceptance readiness waits for HTTP recovery and the OIDC mode using real fetch responses',
  { timeout: 10000 },
  async (t) => {
    const calls = [];
    await acceptanceStages({
      node: process.execPath,
      cli: 'playwright',
      diagnostics: async () => {},
      run: async (command, args) => {
        calls.push({ command, args });
      }
    });
    const readiness = calls.find(
      ({ command, args }) =>
        command === process.execPath && args.includes('--input-type=module')
    );
    assert.ok(readiness, 'The recipe must execute its real readiness program.');

    const modes = [];
    let providerRequests = 0;
    let issuer;
    const config = createServer((req, res) => {
      assert.equal(req.url, '/api/admin/auth/config');
      const mode = modes.length < 2 ? 'token' : 'oidc';
      const status = modes.length === 0 ? 502 : 200;
      modes.push({ status, mode });
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ mode }));
    });
    const provider = createServer((req, res) => {
      assert.equal(req.url, '/.well-known/openid-configuration');
      providerRequests++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ issuer }));
    });
    for (const server of [config, provider]) {
      t.after(async () => {
        if (!server.listening) return;
        await new Promise((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        });
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
    }
    issuer = `http://127.0.0.1:${provider.address().port}`;
    const { stdout, stderr } = await promisify(execFile)(
      process.execPath,
      readiness.args,
      {
        // Do not inherit application credentials or unrelated provider targets.
        env: {
          MODERATION_WEB_BASE_URL: `http://127.0.0.1:${config.address().port}`,
          ACCEPTANCE_OIDC_PROVIDER_PORT: String(provider.address().port)
        },
        timeout: 8000,
        windowsHide: true
      }
    );
    assert.equal(stdout, '');
    assert.equal(stderr, '');
    assert.deepEqual(modes, [
      { status: 502, mode: 'token' },
      { status: 200, mode: 'token' },
      { status: 200, mode: 'oidc' }
    ]);
    assert.equal(providerRequests, modes.length);
  }
);

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
  for (let failure = 0; failure < 9; failure++) {
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
