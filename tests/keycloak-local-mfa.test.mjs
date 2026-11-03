import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';

import {
  configureLocalKeycloakMfa,
  localPasswordFlowAlias
} from '../scripts/lib/keycloak-local-mfa.mjs';
import { createLocalTlsFixture } from './support/local-tls-fixture.mjs';

const subject = '11111111-2222-4333-8444-555555555555';
const clientUuid = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const issuer = 'https://auth.openg7.test/realms/openg7';
const json = (body) => ({ status: 200, body: JSON.stringify(body) });
const clone = (value) => structuredClone(value);

function fixture(t, { intercept, realCertificates = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'og7-local-mfa-'));
  t.after(() => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('og7-local-mfa-'));
    rmSync(root, { recursive: true, force: true });
  });
  if (realCertificates) createLocalTlsFixture(root);
  else {
    mkdirSync(join(root, 'traefik', 'certs'), { recursive: true });
    writeFileSync(
      join(root, 'traefik', 'certs', 'rootCA.pem'),
      'synthetic-public-ca'
    );
  }
  const env = {
    NODE_ENV: 'production',
    FUNDING_PLATFORM_ENV: 'development',
    FUNDING_ADMIN_OIDC_LOCAL_PASSWORD_ONLY: 'true',
    FUNDING_ADMIN_AUTH_MODE: 'oidc',
    FUNDING_KEYCLOAK_ENABLED: 'true',
    FUNDING_KEYCLOAK_HOSTNAME: 'auth.openg7.test',
    FUNDING_ADMIN_OIDC_ISSUER: issuer,
    FUNDING_PUBLIC_BASE_URL: 'https://localhost',
    FUNDING_ADMIN_OIDC_CLIENT_ID: 'synthetic-local-client',
    FUNDING_ADMIN_OIDC_CLIENT_SECRET: 'synthetic-client-' + 'c'.repeat(32),
    FUNDING_KEYCLOAK_DB_PASSWORD: 'synthetic-db-' + 'd'.repeat(32),
    FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME: 'synthetic-bootstrap',
    FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD:
      'synthetic-bootstrap-' + 'b'.repeat(32),
    FUNDING_ADMIN_OIDC_OWNER_SUBJECTS: subject
  };
  const target = {
    project: 'synthetic-local',
    daemonId: 'synthetic-daemon-id'
  };
  const client = {
    id: clientUuid,
    clientId: env.FUNDING_ADMIN_OIDC_CLIENT_ID,
    enabled: true,
    protocol: 'openid-connect',
    publicClient: false,
    clientAuthenticatorType: 'client-secret',
    standardFlowEnabled: true,
    implicitFlowEnabled: false,
    directAccessGrantsEnabled: false,
    serviceAccountsEnabled: false,
    redirectUris: ['https://localhost/api/admin/auth/callback'],
    attributes: { 'pkce.code.challenge.method': 'S256' },
    protocolMappers: [
      {
        protocolMapper: 'oidc-amr-mapper',
        config: { 'id.token.claim': 'true' }
      }
    ],
    authenticationFlowBindingOverrides: {
      direct_grant: 'synthetic-existing-direct-grant'
    }
  };
  const realm = {
    id: 'synthetic-realm',
    realm: 'openg7',
    enabled: true,
    sslRequired: 'all',
    browserFlow: 'openg7-password-otp'
  };
  const canonicalExecutions = [
    {
      id: 'original-password',
      providerId: 'auth-username-password-form',
      requirement: 'REQUIRED',
      priority: 10,
      authenticationConfig: 'original-password-reference'
    },
    {
      id: 'original-otp',
      providerId: 'auth-otp-form',
      requirement: 'REQUIRED',
      priority: 20
    }
  ];
  const flows = [
    {
      id: 'canonical-flow-id',
      alias: realm.browserFlow,
      providerId: 'basic-flow',
      topLevel: true,
      builtIn: false
    }
  ];
  const executions = new Map([[realm.browserFlow, clone(canonicalExecutions)]]);
  const user = {
    id: subject,
    username: 'synthetic-owner',
    enabled: true,
    requiredActions: ['UPDATE_PASSWORD', 'CONFIGURE_TOTP', 'VERIFY_EMAIL'],
    credentials: [{ id: 'kept-otp', type: 'otp' }]
  };
  const calls = [];
  const request = async (options) => {
    calls.push(options);
    const replacement = await intercept?.(options, {
      client,
      realm,
      flows,
      executions,
      user,
      calls
    });
    if (replacement) return replacement;
    const url = new URL(options.url);
    assert.equal(url.origin, 'https://auth.openg7.test');
    assert.equal(options.timeoutMs, 10_000);
    assert.ok(options.ca);
    const method = options.method;
    if (url.pathname.endsWith('/protocol/openid-connect/token'))
      return json({ access_token: 'synthetic-private-access-token' });
    assert.equal(
      options.headers.Authorization,
      'Bearer synthetic-private-access-token'
    );
    if (url.pathname === '/admin/realms/openg7') return json(realm);
    if (url.pathname === '/admin/realms/openg7/clients') {
      assert.equal(url.searchParams.get('clientId'), client.clientId);
      return json([{ id: client.id, clientId: client.clientId }]);
    }
    if (url.pathname === '/admin/realms/openg7/clients/' + client.id) {
      if (method === 'PUT') {
        const body = JSON.parse(options.body);
        assert.deepEqual(Object.keys(body), [
          'authenticationFlowBindingOverrides'
        ]);
        assert.deepEqual(Object.keys(body.authenticationFlowBindingOverrides), [
          'browser'
        ]);
        const next = body.authenticationFlowBindingOverrides.browser;
        if (next === null)
          delete client.authenticationFlowBindingOverrides.browser;
        else client.authenticationFlowBindingOverrides.browser = next;
        return { status: 204, body: '' };
      }
      return json(client);
    }
    if (url.pathname === '/admin/realms/openg7/authentication/flows')
      return json(flows);
    if (url.pathname.endsWith('/openg7-password-otp/copy')) {
      assert.equal(method, 'POST');
      const { newName } = JSON.parse(options.body);
      flows.push({
        id: 'local-flow-id',
        alias: newName,
        providerId: 'basic-flow',
        topLevel: true,
        builtIn: false
      });
      executions.set(
        newName,
        canonicalExecutions.map((item) => ({ ...item, id: 'local-' + item.id }))
      );
      return { status: 201, body: '' };
    }
    if (url.pathname === '/admin/realms/openg7/authentication/executions') {
      assert.equal(method, 'POST');
      const body = JSON.parse(options.body);
      assert.deepEqual(body, {
        parentFlow: 'local-flow-id',
        authenticator: 'auth-cookie',
        authenticatorFlow: false,
        requirement: 'ALTERNATIVE',
        priority: 0
      });
      executions.get(localPasswordFlowAlias(client.clientId)).push({
        id: 'local-cookie',
        providerId: body.authenticator,
        authenticationFlow: false,
        requirement: body.requirement,
        priority: body.priority
      });
      return { status: 201, body: '' };
    }
    if (url.pathname.endsWith('/executions')) {
      const alias = decodeURIComponent(url.pathname.split('/').at(-2));
      const items = executions.get(alias);
      assert.ok(items);
      if (method === 'PUT') {
        assert.notEqual(alias, realm.browserFlow);
        const body = JSON.parse(options.body);
        const item = items.find((execution) => execution.id === body.id);
        assert.ok(
          ['auth-otp-form', 'auth-username-password-form'].includes(
            item.providerId
          )
        );
        if (item.providerId === 'auth-username-password-form') {
          assert.equal(body.requirement, 'ALTERNATIVE');
          assert.equal(body.priority, 10);
          assert.ok(
            items.some(
              (execution) =>
                execution.providerId === 'auth-cookie' &&
                execution.requirement === 'ALTERNATIVE' &&
                execution.priority === 0
            )
          );
        }
        item.requirement = body.requirement;
        item.priority = body.priority;
        return { status: 204, body: '' };
      }
      return json(items);
    }
    if (url.pathname === '/admin/realms/openg7/users/' + user.id) {
      if (method === 'PUT') {
        const body = JSON.parse(options.body);
        assert.deepEqual(Object.keys(body), ['requiredActions']);
        user.requiredActions = body.requiredActions;
        return { status: 204, body: '' };
      }
      return json(user);
    }
    assert.fail('Unexpected synthetic Keycloak request.');
  };
  const run = (overrides = {}) =>
    configureLocalKeycloakMfa({
      root,
      env,
      request,
      inspectTarget: () => clone(target),
      ...(realCertificates ? {} : { validateCertificates() {} }),
      ...overrides
    });
  const writes = () =>
    calls.filter(
      (call) =>
        call.method !== 'GET' && !new URL(call.url).pathname.endsWith('/token')
    );
  const directory = () => {
    const base = join(root, 'var', 'keycloak-local-auth');
    return join(base, readdirSync(base)[0]);
  };
  return {
    root,
    env,
    target,
    client,
    realm,
    flows,
    executions,
    user,
    calls,
    run,
    writes,
    directory
  };
}

test('local MFA profile is opt-in with no filesystem, Docker or provider work by default', async (t) => {
  const f = fixture(t);
  delete f.env.FUNDING_ADMIN_OIDC_LOCAL_PASSWORD_ONLY;
  assert.equal(
    await f.run({
      inspectTarget() {
        assert.fail('No Docker inspection expected.');
      }
    }),
    null
  );
  assert.equal(f.calls.length, 0);
  assert.deepEqual(readdirSync(f.root), ['traefik']);
});

test('local password-only flow preserves canonical MFA, real AMR mapper, user OTP and unrelated required actions', async (t) => {
  const f = fixture(t);
  const originalFlow = clone(f.executions.get('openg7-password-otp'));
  const mapper = clone(f.client.protocolMappers);
  const result = await f.run();
  assert.deepEqual(result, { passwordOnly: true, changed: true });
  assert.equal(
    f.client.authenticationFlowBindingOverrides.browser,
    'local-flow-id'
  );
  assert.equal(
    f.client.authenticationFlowBindingOverrides.direct_grant,
    'synthetic-existing-direct-grant'
  );
  assert.deepEqual(f.executions.get('openg7-password-otp'), originalFlow);
  assert.deepEqual(f.client.protocolMappers, mapper);
  assert.deepEqual(f.user.credentials, [{ id: 'kept-otp', type: 'otp' }]);
  assert.deepEqual(f.user.requiredActions, ['UPDATE_PASSWORD', 'VERIFY_EMAIL']);
  assert.deepEqual(
    f.executions
      .get(localPasswordFlowAlias(f.client.clientId))
      .map((item) => item.requirement),
    ['ALTERNATIVE', 'DISABLED', 'ALTERNATIVE']
  );
  const audit = readFileSync(join(f.directory(), 'audit.jsonl'), 'utf8');
  for (const value of [
    'synthetic-private-access-token',
    f.env.FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD,
    subject,
    'synthetic-owner',
    'kept-otp'
  ])
    assert.ok(!audit.includes(value));
  assert.match(audit, /"result":"verified"/);
});

test('repeated configuration does not duplicate flows or write users/client again', async (t) => {
  const f = fixture(t);
  await f.run();
  const writes = f.writes().length;
  assert.deepEqual(await f.run(), { passwordOnly: true, changed: false });
  assert.equal(f.writes().length, writes);
  assert.equal(f.flows.length, 2);
});

test('existing local password flows migrate to SSO without changing the password reference or source MFA', async (t) => {
  for (const keepDisabledOtp of [true, false]) {
    const f = fixture(t);
    await f.run();
    const alias = localPasswordFlowAlias(f.client.clientId);
    const legacy = f.executions
      .get(alias)
      .filter(
        (step) =>
          step.providerId !== 'auth-cookie' &&
          (keepDisabledOtp || step.providerId !== 'auth-otp-form')
      );
    legacy.find(
      (step) => step.providerId === 'auth-username-password-form'
    ).requirement = 'REQUIRED';
    f.executions.set(alias, legacy);
    const reference = legacy[0].authenticationConfig;
    const canonical = clone(f.executions.get('openg7-password-otp'));
    const writes = f.writes().length;
    assert.deepEqual(await f.run(), { passwordOnly: true, changed: true });
    const migrated = f.executions.get(alias);
    assert.equal(
      migrated.find((step) => step.providerId === 'auth-cookie').priority,
      0
    );
    const password = migrated.find(
      (step) => step.providerId === 'auth-username-password-form'
    );
    assert.equal(password.requirement, 'ALTERNATIVE');
    assert.equal(password.priority, 10);
    assert.equal(password.authenticationConfig, reference);
    assert.deepEqual(f.executions.get('openg7-password-otp'), canonical);
    assert.equal(f.writes().length, writes + 2);
    assert.deepEqual(await f.run(), { passwordOnly: true, changed: false });
    assert.equal(f.writes().length, writes + 2);
  }
});

test('uncertain Cookie creation is reread once and never repeated before enabling local SSO', async (t) => {
  let interrupted = false;
  const f = fixture(t, {
    intercept(options, state) {
      if (
        options.method === 'POST' &&
        options.url.endsWith('/authentication/executions') &&
        !interrupted
      ) {
        interrupted = true;
        state.executions
          .get(localPasswordFlowAlias(state.client.clientId))
          .push({
            id: 'accepted-cookie',
            providerId: 'auth-cookie',
            requirement: 'ALTERNATIVE',
            priority: 0
          });
        throw new Error(
          'Synthetic private transport failure after acceptance.'
        );
      }
    }
  });
  await f.run();
  assert.equal(
    f.calls.filter(
      (call) =>
        call.method === 'POST' &&
        call.url.endsWith('/authentication/executions')
    ).length,
    1
  );
  assert.equal(
    f.executions
      .get(localPasswordFlowAlias(f.client.clientId))
      .find((step) => step.providerId === 'auth-username-password-form')
      .requirement,
    'ALTERNATIVE'
  );
});

test('a refused Cookie mutation preserves REQUIRED password and does not bind a partial SSO flow', async (t) => {
  const f = fixture(t, {
    intercept(options) {
      if (
        options.method === 'POST' &&
        options.url.endsWith('/authentication/executions')
      )
        return { status: 403, body: 'Synthetic private refusal.' };
    }
  });
  await assert.rejects(f.run());
  const local = f.executions.get(localPasswordFlowAlias(f.client.clientId));
  assert.equal(
    local.find((step) => step.providerId === 'auth-username-password-form')
      .requirement,
    'REQUIRED'
  );
  assert.equal(
    local.some((step) => step.providerId === 'auth-cookie'),
    false
  );
  assert.equal(f.client.authenticationFlowBindingOverrides.browser, undefined);
});

test('Cookie cannot attest a factor and a password alternative cannot stand alone', async (t) => {
  for (const corrupt of [
    (steps) => {
      steps.find(
        (step) => step.providerId === 'auth-cookie'
      ).authenticationConfig = 'forged-factor-reference';
    },
    (steps) => {
      steps.splice(
        steps.findIndex((step) => step.providerId === 'auth-cookie'),
        1
      );
    },
    (steps) => {
      steps.find((step) => step.providerId === 'auth-otp-form').requirement =
        'REQUIRED';
    }
  ]) {
    const f = fixture(t);
    await f.run();
    corrupt(f.executions.get(localPasswordFlowAlias(f.client.clientId)));
    const writes = f.writes().length;
    await assert.rejects(f.run());
    assert.equal(f.writes().length, writes);
  }
});

test('the local exception copies the strict flow while preserving the shared realm SSO flow', async (t) => {
  const f = fixture(t);
  f.realm.browserFlow = 'openg7-browser-sso';
  const strict = clone(f.executions.get('openg7-password-otp'));
  await f.run();
  assert.equal(f.realm.browserFlow, 'openg7-browser-sso');
  assert.deepEqual(f.executions.get('openg7-password-otp'), strict);
  f.env.FUNDING_ADMIN_OIDC_LOCAL_PASSWORD_ONLY = 'false';
  await f.run();
  assert.equal(f.client.authenticationFlowBindingOverrides.browser, undefined);
  assert.equal(f.realm.browserFlow, 'openg7-browser-sso');
});

test('false restores the client MFA binding without deleting flow or OTP and supports reactivation', async (t) => {
  const f = fixture(t);
  await f.run();
  f.env.FUNDING_ADMIN_OIDC_LOCAL_PASSWORD_ONLY = 'false';
  assert.deepEqual(await f.run(), { passwordOnly: false, changed: true });
  assert.equal(f.client.authenticationFlowBindingOverrides.browser, undefined);
  assert.equal(
    f.client.authenticationFlowBindingOverrides.direct_grant,
    'synthetic-existing-direct-grant'
  );
  assert.deepEqual(f.user.credentials, [{ id: 'kept-otp', type: 'otp' }]);
  assert.equal(f.flows.length, 2);
  assert.deepEqual(await f.run(), { passwordOnly: false, changed: false });
  f.env.FUNDING_ADMIN_OIDC_LOCAL_PASSWORD_ONLY = 'true';
  await f.run();
  assert.equal(
    f.client.authenticationFlowBindingOverrides.browser,
    'local-flow-id'
  );
});

test('removing the option restores MFA on a previously configured local client', async (t) => {
  const f = fixture(t);
  await f.run();
  delete f.env.FUNDING_ADMIN_OIDC_LOCAL_PASSWORD_ONLY;
  await f.run();
  assert.equal(f.client.authenticationFlowBindingOverrides.browser, undefined);
});

test('a production or foreign target is rejected before Docker, provider or writes', async (t) => {
  for (const overrides of [
    { FUNDING_PLATFORM_ENV: 'production' },
    { FUNDING_PUBLIC_BASE_URL: 'https://funding.example.org' },
    { FUNDING_PUBLIC_BASE_URL: 'https://localhost.evil.example' },
    { FUNDING_ADMIN_OIDC_ISSUER: 'https://identity.example.org/realms/openg7' },
    { FUNDING_ADMIN_AUTH_MODE: 'token' },
    { FUNDING_ADMIN_OIDC_LOCAL_PASSWORD_ONLY: '1' }
  ]) {
    const f = fixture(t);
    Object.assign(f.env, overrides);
    await assert.rejects(
      f.run({
        inspectTarget() {
          assert.fail('No Docker inspection expected.');
        }
      })
    );
    assert.equal(f.calls.length, 0);
    assert.deepEqual(readdirSync(f.root), ['traefik']);
  }
});

test('invalid local certificates fail before contacting the provider', async (t) => {
  const f = fixture(t);
  await assert.rejects(f.run({ validateCertificates: undefined }));
  assert.equal(f.calls.length, 0);
});

test('default certificate validation accepts a synthetic valid local certificate and retains TLS verification', async (t) => {
  const f = fixture(t, { realCertificates: true });
  await f.run();
  assert.ok(
    f.calls.every((call) => call.ca && call.rejectUnauthorized !== false)
  );
});

test('Docker target inspection failure aborts before provider and profile state', async (t) => {
  const f = fixture(t);
  await assert.rejects(
    f.run({
      inspectTarget() {
        throw new Error('Synthetic Docker failure.');
      }
    })
  );
  assert.equal(f.calls.length, 0);
  assert.deepEqual(readdirSync(f.root), ['traefik']);
});

test('changed daemon or project cannot reuse profile state', async (t) => {
  for (const key of ['daemonId', 'project']) {
    const f = fixture(t);
    await f.run();
    f.target[key] = 'changed-target';
    const count = f.writes().length;
    await assert.rejects(f.run());
    assert.equal(f.writes().length, count);
  }
});

test('unsafe client configurations fail before any mutation', async (t) => {
  for (const overrides of [
    { publicClient: true },
    { redirectUris: ['https://localhost/*'] },
    { attributes: { 'pkce.code.challenge.method': 'plain' } },
    { directAccessGrantsEnabled: true },
    {
      protocolMappers: [
        {
          protocolMapper: 'oidc-amr-mapper',
          config: { 'id.token.claim': 'true' }
        },
        {
          protocolMapper: 'oidc-hardcoded-claim-mapper',
          config: { 'claim.name': 'amr', 'claim.value': 'mfa' }
        }
      ]
    },
    { authenticationFlowBindingOverrides: { browser: 'unmanaged-flow' } }
  ]) {
    const f = fixture(t);
    Object.assign(f.client, overrides);
    await assert.rejects(f.run());
    assert.equal(f.writes().length, 0);
  }
});

test('an unmanaged override introduced later is preserved instead of overwritten or restored', async (t) => {
  const f = fixture(t);
  await f.run();
  f.client.authenticationFlowBindingOverrides.browser = 'new-unmanaged-flow';
  f.env.FUNDING_ADMIN_OIDC_LOCAL_PASSWORD_ONLY = 'false';
  const count = f.writes().length;
  await assert.rejects(f.run());
  assert.equal(f.writes().length, count);
  assert.equal(
    f.client.authenticationFlowBindingOverrides.browser,
    'new-unmanaged-flow'
  );
});

test('only explicit owner subjects are queried and no user listing or credential endpoint is used', async (t) => {
  const f = fixture(t);
  delete f.env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS;
  await f.run();
  assert.deepEqual(f.user.requiredActions, [
    'UPDATE_PASSWORD',
    'CONFIGURE_TOTP',
    'VERIFY_EMAIL'
  ]);
  assert.ok(
    f.calls.every((call) => !new URL(call.url).pathname.includes('/users'))
  );
});

test('owner operations refuse service accounts', async (t) => {
  const f = fixture(t);
  f.user.serviceAccountClientId = 'some-service';
  await assert.rejects(f.run());
  assert.deepEqual(f.user.requiredActions, [
    'UPDATE_PASSWORD',
    'CONFIGURE_TOTP',
    'VERIFY_EMAIL'
  ]);
  assert.equal(f.client.authenticationFlowBindingOverrides.browser, undefined);
});

test('owner operations reject excessive subject sets without touching users or binding the client', async (t) => {
  const f = fixture(t);
  f.env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS = Array.from(
    { length: 17 },
    (_, index) =>
      `${String(index).padStart(8, '0')}-2222-4333-8444-555555555555`
  ).join(',');
  await assert.rejects(f.run());
  assert.ok(
    f.calls.every((call) => !new URL(call.url).pathname.includes('/users'))
  );
  assert.equal(f.client.authenticationFlowBindingOverrides.browser, undefined);
});

test('uncertain flow creation is reconciled without replaying the POST', async (t) => {
  let interrupted = false;
  const f = fixture(t, {
    intercept(options, state) {
      if (options.url.endsWith('/openg7-password-otp/copy') && !interrupted) {
        interrupted = true;
        const { newName } = JSON.parse(options.body);
        state.flows.push({
          id: 'local-flow-id',
          alias: newName,
          providerId: 'basic-flow',
          topLevel: true,
          builtIn: false
        });
        state.executions.set(
          newName,
          clone(state.executions.get('openg7-password-otp')).map((item) => ({
            ...item,
            id: 'local-' + item.id
          }))
        );
        throw new Error(
          'Synthetic lost POST acknowledgement with private detail.'
        );
      }
    }
  });
  await f.run();
  assert.equal(f.calls.filter((call) => call.url.endsWith('/copy')).length, 1);
  assert.equal(
    f.client.authenticationFlowBindingOverrides.browser,
    'local-flow-id'
  );
});

test('uncertain client binding is reconciled without replaying the PUT', async (t) => {
  let interrupted = false;
  const f = fixture(t, {
    intercept(options, state) {
      if (
        options.url.endsWith('/clients/' + clientUuid) &&
        options.method === 'PUT' &&
        !interrupted
      ) {
        interrupted = true;
        state.client.authenticationFlowBindingOverrides.browser = JSON.parse(
          options.body
        ).authenticationFlowBindingOverrides.browser;
        throw new Error(
          'Synthetic lost PUT acknowledgement with private detail.'
        );
      }
    }
  });
  await f.run();
  assert.equal(
    f.calls.filter(
      (call) =>
        call.url.endsWith('/clients/' + clientUuid) && call.method === 'PUT'
    ).length,
    1
  );
  await f.run();
  assert.equal(
    f.calls.filter(
      (call) =>
        call.url.endsWith('/clients/' + clientUuid) && call.method === 'PUT'
    ).length,
    1
  );
});

test('failed mutations stop activation, hide provider diagnostics and allow verified later retry', async (t) => {
  let fail = true;
  const f = fixture(t, {
    intercept(options) {
      if (options.url.endsWith('/copy') && fail)
        throw new Error('Synthetic-sensitive-provider-body');
    }
  });
  await assert.rejects(f.run(), (error) => {
    assert.doesNotMatch(error.stack, /Synthetic-sensitive-provider-body/);
    return true;
  });
  assert.equal(f.client.authenticationFlowBindingOverrides.browser, undefined);
  assert.equal(f.calls.filter((call) => call.url.endsWith('/copy')).length, 1);
  fail = false;
  await f.run();
  assert.equal(
    f.client.authenticationFlowBindingOverrides.browser,
    'local-flow-id'
  );
});

test('a malformed dedicated flow cannot be bound to the client', async (t) => {
  const f = fixture(t);
  const alias = localPasswordFlowAlias(f.client.clientId);
  f.flows.push({
    id: 'local-flow-id',
    alias,
    topLevel: true,
    builtIn: false,
    providerId: 'basic-flow'
  });
  f.executions.set(alias, [
    {
      id: 'password-execution',
      providerId: 'auth-username-password-form',
      requirement: 'ALTERNATIVE'
    }
  ]);
  await assert.rejects(f.run());
  assert.equal(f.client.authenticationFlowBindingOverrides.browser, undefined);
});

test('service authentication uses its own credentials without bootstrap fallback', async (t) => {
  const f = fixture(t);
  f.env.FUNDING_KEYCLOAK_PROVISION_CLIENT_ID = 'synthetic-service';
  f.env.FUNDING_KEYCLOAK_PROVISION_CLIENT_SECRET = 'synthetic-service-secret';
  await f.run();
  const token = f.calls.find((call) => call.url.endsWith('/token'));
  assert.equal(token.url, issuer + '/protocol/openid-connect/token');
  assert.equal(
    new URLSearchParams(token.body).get('grant_type'),
    'client_credentials'
  );
  assert.equal(new URLSearchParams(token.body).has('password'), false);
});

test('private state corruption and an existing lock fail closed', async (t) => {
  const f = fixture(t);
  await f.run();
  const path = join(f.directory(), 'profile.json');
  const contents = readFileSync(path, 'utf8');
  writeFileSync(path, '{broken', { mode: 0o600 });
  const count = f.calls.length;
  await assert.rejects(f.run());
  assert.equal(f.calls.length, count);
  writeFileSync(path, contents, { mode: 0o600 });
  writeFileSync(join(f.directory(), 'profile.lock'), 'synthetic-pending', {
    mode: 0o600
  });
  await assert.rejects(f.run(), /already in progress/);
  assert.equal(f.calls.length, count);
});
