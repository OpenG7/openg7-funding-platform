import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:https';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import test from 'node:test';

import {
  validateKeycloakConfig,
  validateKeycloakProvisionUserConfig
} from '../scripts/lib/keycloak-config.mjs';
import { prepareLocalInitialUser } from '../scripts/lib/keycloak-initial-user.mjs';
import {
  provisionKeycloakUser,
  keycloakHttpsRequest,
  restoreKeycloakOwnerSubjects
} from '../scripts/lib/keycloak-provision-user.mjs';
import { createLocalTlsFixture } from './support/local-tls-fixture.mjs';

const subject = 'aaaa1111-2222-4333-8444-555566667777';
const otherSubject = 'bbbb1111-2222-4333-8444-555566667777';
const issuer = 'https://auth.example.org/realms/openg7';
const configured = {
  FUNDING_PLATFORM_ENV: 'production',
  FUNDING_KEYCLOAK_ENABLED: 'true',
  FUNDING_KEYCLOAK_HOSTNAME: 'auth.example.org',
  FUNDING_PUBLIC_BASE_URL: 'https://fund.example.org',
  FUNDING_ADMIN_AUTH_MODE: 'oidc',
  FUNDING_ADMIN_OIDC_ISSUER: issuer,
  FUNDING_ADMIN_OIDC_CLIENT_ID: 'openg7-funding-admin',
  FUNDING_ADMIN_OIDC_CLIENT_SECRET: 'synthetic-client-secret-' + 'c'.repeat(32),
  FUNDING_KEYCLOAK_DB_PASSWORD: 'synthetic-db-secret-' + 'd'.repeat(32),
  FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME: 'synthetic-bootstrap',
  FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD:
    'synthetic-bootstrap-secret-' + 'b'.repeat(32),
  FUNDING_KEYCLOAK_PROVISION_USER: 'true',
  FUNDING_KEYCLOAK_INITIAL_USER_USERNAME: 'synthetic-owner',
  FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD: 'Synthetic-temporary$"\\password-1234'
};
const json = (body) => ({
  status: 200,
  headers: {},
  body: JSON.stringify(body)
});

function fixture(t, { existing, intercept } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'og7-keycloak-provision-'));
  t.after(() => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('og7-keycloak-provision-'));
    rmSync(root, { recursive: true, force: true });
  });
  const env = { ...configured };
  const calls = [];
  let user = existing ?? null;
  const realm = {
    realm: 'openg7',
    id: 'synthetic-realm-id',
    enabled: true,
    sslRequired: 'all',
    browserFlow: 'openg7-password-otp'
  };
  const request = async (options) => {
    calls.push(options);
    const replacement = await intercept?.(options, { user, realm, calls });
    if (replacement) return replacement;
    const url = new URL(options.url);
    if (url.pathname.endsWith('/.well-known/openid-configuration'))
      return json({
        issuer,
        token_endpoint: issuer + '/protocol/openid-connect/token'
      });
    if (url.pathname.endsWith('/protocol/openid-connect/token'))
      return json({ access_token: 'synthetic-provisioning-access-token' });
    if (url.pathname === '/admin/realms/openg7') return json(realm);
    if (
      url.pathname === '/admin/realms/openg7/users' &&
      options.method === 'GET'
    ) {
      assert.equal(
        url.searchParams.get('username'),
        env.FUNDING_KEYCLOAK_INITIAL_USER_USERNAME.toLowerCase()
      );
      assert.equal(url.searchParams.get('exact'), 'true');
      assert.equal(url.searchParams.get('max'), '2');
      return json(user ? [user] : []);
    }
    if (
      url.pathname === '/admin/realms/openg7/users' &&
      options.method === 'POST'
    ) {
      assert.equal(
        user,
        null,
        'A fixture creation cannot edit an existing user.'
      );
      const body = JSON.parse(options.body);
      user = { id: subject, username: body.username, enabled: body.enabled };
      return {
        status: 201,
        headers: {
          location:
            'https://auth.example.org/admin/realms/openg7/users/' + subject
        },
        body: ''
      };
    }
    if (url.pathname === '/admin/realms/openg7/users/' + user?.id)
      return json(user);
    throw new Error('Unexpected fixture request.');
  };
  const directory = join(
    root,
    'var',
    'keycloak-provisioning',
    createHash('sha256')
      .update(issuer + '\n' + env.FUNDING_KEYCLOAK_INITIAL_USER_USERNAME)
      .digest('hex')
  );
  const run = () => provisionKeycloakUser({ root, env, request });
  const creations = () =>
    calls.filter(
      (call) =>
        new URL(call.url).pathname === '/admin/realms/openg7/users' &&
        call.method === 'POST'
    );
  return {
    root,
    env,
    calls,
    realm,
    directory,
    run,
    request,
    creations,
    user: () => user
  };
}

test('provisioning is explicit and validates production targets, credentials and owner UUIDs without echoing inputs', () => {
  assert.equal(validateKeycloakProvisionUserConfig({}), false);
  assert.equal(validateKeycloakConfig(configured), true);
  for (const overrides of [
    { FUNDING_KEYCLOAK_PROVISION_USER: 'private-canary' },
    { FUNDING_KEYCLOAK_ENABLED: 'false' },
    { FUNDING_PLATFORM_ENV: 'test' },
    { COMPOSE_FILE: 'custom.yml' },
    { FUNDING_KEYCLOAK_INITIAL_USER_USERNAME: '' },
    { FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD: '' },
    { FUNDING_ADMIN_OIDC_OWNER_SUBJECTS: 'private-canary' },
    { FUNDING_PUBLIC_BASE_URL: 'https://localhost' },
    { FUNDING_PUBLIC_BASE_URL: 'https://127.0.0.1' },
    {
      FUNDING_KEYCLOAK_HOSTNAME: 'auth.example.test',
      FUNDING_ADMIN_OIDC_ISSUER: 'https://auth.example.test/realms/openg7'
    },
    { FUNDING_KEYCLOAK_PROVISION_CLIENT_ID: 'synthetic-provisioner' },
    { FUNDING_KEYCLOAK_PROVISION_CLIENT_SECRET: 'private-canary' },
    {
      FUNDING_KEYCLOAK_PROVISION_CLIENT_ID: 'synthetic-provisioner',
      FUNDING_KEYCLOAK_PROVISION_CLIENT_SECRET:
        configured.FUNDING_ADMIN_OIDC_CLIENT_SECRET
    }
  ]) {
    assert.throws(
      () => validateKeycloakConfig({ ...configured, ...overrides }),
      (error) => {
        assert.doesNotMatch(
          error.message,
          /private-canary|Synthetic-temporary/
        );
        return true;
      }
    );
  }
  assert.throws(
    () =>
      validateKeycloakConfig({
        ...configured,
        FUNDING_KEYCLOAK_PROVISION_USER: 'false'
      }),
    /managed local/
  );
});

test('disabled preparation and legacy import do not perform provider or Docker mutations', async (t) => {
  const f = fixture(t);
  assert.equal(
    await provisionKeycloakUser({
      root: f.root,
      env: {},
      request: () => assert.fail('Unexpected provider call.')
    }),
    null
  );
  assert.deepEqual(readdirSync(f.root), []);
  assert.equal(
    prepareLocalInitialUser({
      root: f.root,
      env: f.env,
      runDocker: () => assert.fail('Unexpected Docker call.')
    }),
    null
  );
  assert.equal(f.env.FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD_JSON, '');
  assert.equal(f.env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS, undefined);
});

test('rollback restores only a previously verified subject without provider calls or private writes', async (t) => {
  const f = fixture(t);
  await f.run();
  delete f.env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS;
  const before = readdirSync(f.directory).map((name) => ({
    name,
    content: readFileSync(join(f.directory, name), 'utf8'),
    modified: statSync(join(f.directory, name)).mtimeMs
  }));
  const calls = f.calls.length;
  assert.deepEqual(restoreKeycloakOwnerSubjects(f), { subject });
  assert.equal(f.env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS, subject);
  assert.equal(f.calls.length, calls);
  assert.deepEqual(
    readdirSync(f.directory).map((name) => ({
      name,
      content: readFileSync(join(f.directory, name), 'utf8'),
      modified: statSync(join(f.directory, name)).mtimeMs
    })),
    before
  );
});

test('rollback preserves explicit owners and disabled configuration without accessing private state', (t) => {
  const f = fixture(t);
  assert.equal(restoreKeycloakOwnerSubjects({ root: f.root, env: {} }), null);
  f.env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS = ` ${subject},${otherSubject} `;
  assert.equal(restoreKeycloakOwnerSubjects(f), null);
  assert.equal(
    f.env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS,
    ` ${subject},${otherSubject} `
  );
  assert.deepEqual(readdirSync(f.root), []);
});

test('rollback rejects absent, incomplete or invalid state without creating files or deriving owners', async (t) => {
  const empty = fixture(t);
  assert.throws(() => restoreKeycloakOwnerSubjects(empty), /private Keycloak/);
  assert.deepEqual(readdirSync(empty.root), []);
  for (const invalid of [
    'pending',
    'rejected',
    'corrupt',
    'missing',
    'issuer',
    'username',
    'realm',
    'subject',
    'directory'
  ]) {
    const f = fixture(t);
    await f.run();
    delete f.env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS;
    const path = join(f.directory, 'user.json');
    const state = JSON.parse(readFileSync(path, 'utf8'));
    if (invalid === 'missing' || invalid === 'directory') {
      unlinkSync(path);
      if (invalid === 'directory') mkdirSync(path, { mode: 0o700 });
    } else if (invalid === 'corrupt') writeFileSync(path, 'private-canary');
    else {
      if (invalid === 'pending' || invalid === 'rejected') {
        state.phase = invalid;
        state.subject = null;
      } else if (invalid === 'issuer')
        state.issuer = 'https://other.example.org';
      else if (invalid === 'username') state.username = 'another-person';
      else if (invalid === 'realm') state.realmId = '';
      else state.subject = null;
      writeFileSync(path, JSON.stringify(state));
    }
    const files = readdirSync(f.directory);
    const calls = f.calls.length;
    assert.throws(() => restoreKeycloakOwnerSubjects(f), /private Keycloak/);
    assert.equal(f.env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS, undefined);
    assert.equal(f.calls.length, calls);
    assert.deepEqual(readdirSync(f.directory), files);
  }
});

test('rollback refuses a symbolic private state directory', async (t) => {
  const f = fixture(t);
  await f.run();
  delete f.env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS;
  const destination = f.directory + '-real';
  assert.equal(dirname(resolve(destination)), dirname(resolve(f.directory)));
  assert.ok(resolve(f.directory).startsWith(resolve(f.root) + sep));
  renameSync(f.directory, destination);
  symlinkSync(destination, f.directory, 'junction');
  assert.throws(() => restoreKeycloakOwnerSubjects(f), /private Keycloak/);
  assert.equal(f.env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS, undefined);
  assert.deepEqual(readdirSync(destination).sort(), [
    'audit.jsonl',
    'user.json'
  ]);
});

test('new user receives literal temporary credentials and personal actions once; replay preserves UUID, credentials and explicit owner list', async (t) => {
  const f = fixture(t);
  assert.deepEqual(await f.run(), { subject, created: true });
  assert.equal(f.env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS, subject);
  assert.deepEqual(JSON.parse(f.creations()[0].body), {
    username: 'synthetic-owner',
    enabled: true,
    requiredActions: ['UPDATE_PASSWORD', 'CONFIGURE_TOTP'],
    credentials: [
      {
        type: 'password',
        value: configured.FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD,
        temporary: true
      }
    ]
  });
  f.env.FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD =
    'Synthetic-different-temporary-password';
  f.env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS = ` ${subject},${otherSubject} `;
  assert.deepEqual(await f.run(), { subject, created: false });
  assert.equal(
    f.env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS,
    ` ${subject},${otherSubject} `
  );
  assert.equal(f.creations().length, 1);
  assert.ok(f.calls.every(({ method }) => ['GET', 'POST'].includes(method)));
  const state = readFileSync(join(f.directory, 'user.json'), 'utf8');
  const audit = readFileSync(join(f.directory, 'audit.jsonl'), 'utf8');
  for (const privateValue of [
    configured.FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD,
    configured.FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD,
    'synthetic-provisioning-access-token'
  ]) {
    assert.ok(!state.includes(privateValue));
    assert.ok(!audit.includes(privateValue));
  }
  assert.equal(JSON.parse(state).phase, 'verified');
  assert.ok(audit.includes('created'));
  assert.ok(audit.includes('verified-existing'));
  assert.deepEqual(readdirSync(f.directory).sort(), [
    'audit.jsonl',
    'user.json'
  ]);
  if (process.platform !== 'win32') {
    assert.equal(statSync(f.directory).mode & 0o777, 0o700);
    assert.equal(statSync(join(f.directory, 'user.json')).mode & 0o777, 0o600);
  }
});

test('an existing name alone cannot gain owner privileges; an explicitly verified UUID can be adopted without mutations', async (t) => {
  const f = fixture(t, {
    existing: { id: subject, username: 'synthetic-owner', enabled: true }
  });
  await assert.rejects(f.run(), /verified User ID/);
  assert.equal(f.env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS, undefined);
  assert.equal(f.creations().length, 0);
  f.env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS = subject;
  assert.deepEqual(await f.run(), { subject, created: false });
  assert.equal(f.creations().length, 0);
  assert.equal(f.env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS, subject);
});

test('existing disabled, federated, service or differently identified users are preserved and rejected', async (t) => {
  for (const override of [
    { enabled: false },
    { federationLink: 'external-store' },
    { serviceAccountClientId: 'service' },
    { username: 'another-person' },
    { id: otherSubject }
  ]) {
    const f = fixture(t, {
      existing: {
        id: subject,
        username: 'synthetic-owner',
        enabled: true,
        ...override
      }
    });
    f.env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS = subject;
    await assert.rejects(f.run());
    assert.equal(f.creations().length, 0);
    assert.equal(f.env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS, subject);
  }
});

test('a changed realm binding or missing previously verified account cannot create a replacement owner', async (t) => {
  const f = fixture(t);
  await f.run();
  delete f.env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS;
  f.realm.id = 'different-identity-database';
  await assert.rejects(f.run(), /private Keycloak provisioning state/);
  assert.equal(f.creations().length, 1);
  assert.equal(f.env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS, undefined);
});

test('an interrupted creation is never repeated and its secret diagnostics are suppressed', async (t) => {
  const f = fixture(t, {
    intercept: (options) => {
      if (
        options.method === 'POST' &&
        new URL(options.url).pathname === '/admin/realms/openg7/users'
      )
        throw new Error('private-canary');
    }
  });
  await assert.rejects(f.run(), (error) => {
    assert.doesNotMatch(error.message, /private-canary/);
    return true;
  });
  await assert.rejects(f.run(), /uncertain outcome/);
  assert.equal(f.creations().length, 1);
  assert.equal(f.env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS, undefined);
});

test('acknowledged permission refusals can be retried explicitly without losing the realm binding or publishing owners', async (t) => {
  let denied = true;
  const f = fixture(t, {
    intercept: (options) => {
      if (
        denied &&
        options.method === 'POST' &&
        new URL(options.url).pathname === '/admin/realms/openg7/users'
      )
        return { status: 403, headers: {}, body: 'private-canary' };
    }
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(f.run(), (error) => {
      assert.match(error.message, /HTTP 403.*manage-users.*retry/);
      assert.doesNotMatch(error.message, /private-canary/);
      return true;
    });
    assert.equal(f.user(), null);
    assert.equal(f.env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS, undefined);
    assert.deepEqual(
      JSON.parse(readFileSync(join(f.directory, 'user.json'), 'utf8')),
      {
        version: 1,
        issuer,
        username: 'synthetic-owner',
        realmId: f.realm.id,
        phase: 'rejected',
        subject: null
      }
    );
  }
  denied = false;
  assert.deepEqual(await f.run(), { subject, created: true });
  assert.equal(f.creations().length, 3);
  assert.equal(f.env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS, subject);
  assert.equal(
    readFileSync(join(f.directory, 'audit.jsonl'), 'utf8')
      .split('\n')
      .filter((line) => line && JSON.parse(line).result === 'creation-rejected')
      .length,
    2
  );
  assert.ok(f.calls.every(({ method }) => ['GET', 'POST'].includes(method)));
});

test('an uncertain retry after permission rejection becomes pending and cannot repeat creation', async (t) => {
  let rejected = true;
  const f = fixture(t, {
    intercept: (options) => {
      if (
        options.method === 'POST' &&
        new URL(options.url).pathname === '/admin/realms/openg7/users'
      ) {
        if (rejected) return { status: 403, headers: {}, body: '' };
        throw new Error('private-canary');
      }
    }
  });
  await assert.rejects(f.run(), /HTTP 403/);
  rejected = false;
  await assert.rejects(f.run(), /request failed/);
  await assert.rejects(f.run(), /uncertain outcome/);
  assert.equal(f.creations().length, 2);
  assert.equal(f.env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS, undefined);
  assert.equal(
    JSON.parse(readFileSync(join(f.directory, 'user.json'), 'utf8')).phase,
    'pending'
  );
});

test('rejected creation cannot cross a realm replacement or adopt a name without a verified UUID', async (t) => {
  for (const changed of ['realm', 'user', 'invalid-state']) {
    let rejected = false;
    const f = fixture(t, {
      intercept: (options) => {
        const url = new URL(options.url);
        if (
          options.method === 'POST' &&
          url.pathname === '/admin/realms/openg7/users'
        )
          return { status: 403, headers: {}, body: '' };
        if (
          changed === 'user' &&
          rejected &&
          options.method === 'GET' &&
          url.pathname === '/admin/realms/openg7/users'
        )
          return json([
            { id: otherSubject, username: 'synthetic-owner', enabled: true }
          ]);
      }
    });
    await assert.rejects(f.run(), /HTTP 403/);
    rejected = true;
    if (changed === 'realm') f.realm.id = 'replacement-realm';
    else if (changed === 'invalid-state') {
      const path = join(f.directory, 'user.json');
      const state = JSON.parse(readFileSync(path, 'utf8'));
      state.subject = subject;
      writeFileSync(path, JSON.stringify(state));
    }
    const calls = f.calls.length;
    await assert.rejects(
      f.run(),
      changed === 'user' ? /verified User ID/ : /private Keycloak/
    );
    assert.equal(f.creations().length, 1);
    assert.equal(f.env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS, undefined);
    if (changed === 'invalid-state') assert.equal(f.calls.length, calls);
  }
});

test('a saved acknowledged UUID can recover a failed verification without re-creating the user', async (t) => {
  let failVerification = true;
  const f = fixture(t, {
    intercept: (options) => {
      if (
        failVerification &&
        new URL(options.url).pathname ===
          '/admin/realms/openg7/users/' + subject
      )
        return { status: 503, headers: {}, body: 'private-canary' };
    }
  });
  await assert.rejects(f.run(), /acknowledged/);
  assert.equal(f.env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS, undefined);
  assert.equal(
    JSON.parse(readFileSync(join(f.directory, 'user.json'), 'utf8')).subject,
    subject
  );
  failVerification = false;
  assert.deepEqual(await f.run(), { subject, created: false });
  assert.equal(f.creations().length, 1);
});

test('conflicts, redirects and unsafe creation locations cannot publish an owner or retry a POST', async (t) => {
  for (const response of [
    { status: 400, headers: {}, body: 'private-canary' },
    { status: 409, headers: {}, body: 'private-canary' },
    { status: 429, headers: {}, body: 'private-canary' },
    { status: 500, headers: {}, body: 'private-canary' },
    {
      status: 302,
      headers: { location: 'https://untrusted.example.org/' },
      body: ''
    },
    ...[
      'http://auth.example.org',
      'https://untrusted.example.org',
      'https://private-canary@auth.example.org'
    ].map((origin) => ({
      status: 201,
      headers: { location: origin + '/admin/realms/openg7/users/' + subject },
      body: ''
    })),
    {
      status: 201,
      headers: {
        location:
          'https://auth.example.org/admin/realms/openg7/users/private-canary'
      },
      body: ''
    }
  ]) {
    const f = fixture(t, {
      intercept: (options) => {
        if (
          options.method === 'POST' &&
          new URL(options.url).pathname === '/admin/realms/openg7/users'
        )
          return response;
      }
    });
    await assert.rejects(f.run(), (error) => {
      assert.doesNotMatch(error.message, /private-canary/);
      return true;
    });
    await assert.rejects(f.run(), /uncertain outcome/);
    assert.equal(f.creations().length, 1);
    assert.equal(f.env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS, undefined);
  }
});

test('corrupt state, a directory masquerading as state and concurrent lock all stop before provider calls', async (t) => {
  for (const invalid of ['json', 'directory', 'lock']) {
    const f = fixture(t);
    mkdirSync(f.directory, { recursive: true, mode: 0o700 });
    if (invalid === 'directory')
      mkdirSync(join(f.directory, 'user.json'), { mode: 0o700 });
    else
      writeFileSync(
        join(f.directory, invalid === 'lock' ? 'provision.lock' : 'user.json'),
        'private-canary',
        { mode: 0o600 }
      );
    await assert.rejects(f.run(), (error) => {
      assert.doesNotMatch(error.message, /private-canary/);
      return true;
    });
    assert.equal(f.calls.length, 0);
  }
});

test('dedicated scoped service authentication uses the openg7 token endpoint and never forwards bootstrap credentials', async (t) => {
  const f = fixture(t);
  f.env.FUNDING_KEYCLOAK_PROVISION_CLIENT_ID = 'synthetic-provisioner';
  f.env.FUNDING_KEYCLOAK_PROVISION_CLIENT_SECRET =
    'synthetic-provisioning-service-' + 's'.repeat(32);
  await f.run();
  const token = f.calls.find((call) =>
    new URL(call.url).pathname.endsWith('/protocol/openid-connect/token')
  );
  assert.equal(token.url, issuer + '/protocol/openid-connect/token');
  const body = new URLSearchParams(token.body);
  assert.equal(body.get('grant_type'), 'client_credentials');
  assert.equal(body.get('client_id'), 'synthetic-provisioner');
  assert.equal(body.get('username'), null);
  assert.ok(
    !token.body.includes(configured.FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD)
  );
});

test('discovery and authentication failures cannot leak provider diagnostics or create a user', async (t) => {
  for (const stage of ['discovery', 'authentication', 'realm', 'ambiguous']) {
    const f = fixture(t, {
      intercept: (options) => {
        const url = new URL(options.url);
        if (
          stage === 'discovery' &&
          url.pathname.endsWith('/.well-known/openid-configuration')
        )
          return json({ issuer: 'https://private-canary@evil.example.org' });
        if (
          stage === 'authentication' &&
          url.pathname.endsWith('/protocol/openid-connect/token')
        )
          return { status: 401, headers: {}, body: 'private-canary' };
        if (stage === 'realm' && url.pathname === '/admin/realms/openg7')
          return json({ id: 'private-canary', realm: 'master' });
        if (
          stage === 'ambiguous' &&
          url.pathname === '/admin/realms/openg7/users'
        )
          return json([{ id: subject }, { id: otherSubject }]);
      }
    });
    await assert.rejects(f.run(), (error) => {
      assert.doesNotMatch(error.message, /private-canary/);
      return true;
    });
    assert.equal(f.creations().length, 0);
  }
});

test('production application preparation requires personal password and OTP completion without resetting a prepared account', async (t) => {
  let completed = false;
  const f = fixture(t, {
    intercept: (options) => {
      const path = new URL(options.url).pathname;
      if (path.endsWith('/credentials'))
        return json(
          completed
            ? [{ type: 'password' }, { type: 'otp' }]
            : [{ type: 'password' }]
        );
      if (path === '/admin/realms/openg7/users/' + subject)
        return json({
          id: subject,
          username: 'synthetic-owner',
          enabled: true,
          requiredActions: completed
            ? []
            : ['UPDATE_PASSWORD', 'CONFIGURE_TOTP']
        });
    }
  });
  const run = () =>
    provisionKeycloakUser({
      root: f.root,
      env: f.env,
      request: f.request,
      requireEnrollment: true
    });
  await assert.rejects(run(), /personal password change and OTP enrollment/);
  assert.equal(f.env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS, undefined);
  assert.equal(f.creations().length, 1);
  completed = true;
  assert.deepEqual(await run(), { subject, created: false });
  assert.equal(f.creations().length, 1);
  assert.equal(f.env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS, subject);
});

test('a large private audit history remains usable and a deleted verified account cannot become a new owner', async (t) => {
  let absent = false;
  const f = fixture(t, {
    intercept: (options) => {
      const path = new URL(options.url).pathname;
      if (
        absent &&
        path === '/admin/realms/openg7/users' &&
        options.method === 'GET'
      )
        return json([]);
    }
  });
  await f.run();
  writeFileSync(
    join(f.directory, 'audit.jsonl'),
    JSON.stringify({ result: 'synthetic-history-' + 'h'.repeat(20_000) }) +
      '\n',
    { mode: 0o600 }
  );
  await f.run();
  delete f.env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS;
  absent = true;
  await assert.rejects(f.run(), /uncertain outcome/);
  assert.equal(f.creations().length, 1);
  assert.equal(f.env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS, undefined);
});

test('native provisioning HTTPS verifies TLS, sends literal POST bodies, bounds responses and never follows redirects', async (t) => {
  const f = fixture(t);
  const certificates = createLocalTlsFixture(f.root);
  const received = [];
  const server = createServer(
    {
      key: readFileSync(certificates.keyPath),
      cert: readFileSync(certificates.certificatePath)
    },
    (incoming, outgoing) => {
      const chunks = [];
      incoming.on('data', (chunk) => chunks.push(chunk));
      incoming.on('end', () => {
        received.push({
          path: incoming.url,
          method: incoming.method,
          body: Buffer.concat(chunks).toString('utf8')
        });
        if (incoming.url === '/redirect') {
          outgoing.writeHead(302, { Location: '/untrusted-destination' });
          outgoing.end();
        } else if (incoming.url === '/large')
          outgoing.end('h'.repeat(1024 * 1024 + 1));
        else if (incoming.url !== '/slow')
          outgoing.end('{"result":"synthetic"}');
      });
    }
  );
  t.after(async () => {
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = 'https://localhost:' + server.address().port;
  const ca = readFileSync(certificates.caPath);
  const body = JSON.stringify({ password: 'synthetic-literal$"\\password' });
  assert.equal(
    (
      await keycloakHttpsRequest({
        url: origin + '/body',
        method: 'POST',
        body,
        ca
      })
    ).status,
    200
  );
  assert.deepEqual(received[0], { path: '/body', method: 'POST', body });
  const redirect = await keycloakHttpsRequest({
    url: origin + '/redirect',
    ca
  });
  assert.equal(redirect.status, 302);
  assert.ok(!received.some(({ path }) => path === '/untrusted-destination'));
  for (const options of [
    { url: origin + '/untrusted-ca' },
    { url: origin + '/large', ca },
    { url: origin + '/slow', ca, timeoutMs: 50 },
    { url: 'http://private-canary@localhost' }
  ]) {
    await assert.rejects(keycloakHttpsRequest(options), (error) => {
      assert.doesNotMatch(error.message, /private-canary/);
      return true;
    });
  }
});
