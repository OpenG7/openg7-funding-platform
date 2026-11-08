import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileKeycloakSso } from '../scripts/lib/keycloak-sso.mjs';

function fixture() {
  const realm = {
    id: 'realm-id',
    realm: 'openg7',
    enabled: true,
    sslRequired: 'all',
    browserFlow: 'openg7-password-otp',
    ssoSessionMaxLifespan: 3600
  };
  const flows = [
    {
      id: 'strict-id',
      alias: 'openg7-password-otp',
      providerId: 'basic-flow',
      topLevel: true,
      builtIn: false
    }
  ];
  const strict = [
    {
      id: 'password-id',
      providerId: 'auth-username-password-form',
      requirement: 'REQUIRED',
      priority: 10,
      level: 0,
      authenticationConfig: 'pwd-reference'
    },
    {
      id: 'otp-id',
      providerId: 'auth-otp-form',
      requirement: 'REQUIRED',
      priority: 20,
      level: 0,
      authenticationConfig: 'mfa-reference'
    }
  ];
  const references = {
    'pwd-reference': {
      config: {
        'default.reference.value': 'pwd',
        'default.reference.maxAge': '3600'
      }
    },
    'mfa-reference': {
      config: {
        'default.reference.value': 'mfa',
        'default.reference.maxAge': '3600'
      }
    }
  };
  const credentials = [],
    sso = [],
    calls = [],
    audit = [];
  let loseResponse = false,
    rejectWrite = false;
  const json = (value) => ({ status: 200, body: JSON.stringify(value) });
  const request = async (options) => {
    calls.push(options);
    const path = new URL(options.url).pathname;
    const { method } = options;
    const body = options.body ? JSON.parse(options.body) : undefined;
    assert.equal(
      options.headers.Authorization,
      'Bearer synthetic-private-token'
    );
    assert.equal(options.timeoutMs, 10_000);
    if (method === 'GET') {
      if (path === '/admin/realms/openg7') return json(realm);
      if (path.endsWith('/authentication/flows')) return json(flows);
      if (path.endsWith('/openg7-password-otp/executions')) return json(strict);
      if (path.endsWith('/openg7-sso-password-otp/executions'))
        return json(credentials);
      if (path.endsWith('/openg7-browser-sso/executions')) return json(sso);
      if (path.includes('/config/'))
        return json(references[path.split('/').at(-1)]);
    }
    if (rejectWrite)
      return { status: 403, body: 'private-provider-diagnostics' };
    if (method === 'POST' && path.endsWith('/authentication/flows'))
      flows.push({
        ...body,
        id: body.alias === 'openg7-browser-sso' ? 'sso-id' : 'credentials-id'
      });
    else if (method === 'POST' && path.endsWith('/authentication/executions')) {
      assert.ok(['sso-id', 'credentials-id'].includes(body.parentFlow));
      const target = body.parentFlow === 'sso-id' ? sso : credentials;
      target.push({
        id: body.parentFlow + '-execution-' + target.length,
        providerId: body.authenticator,
        authenticationFlow: body.authenticatorFlow,
        flowId: body.flowId,
        requirement: body.requirement,
        priority: body.priority,
        level: 0
      });
    } else if (method === 'POST' && path.endsWith('/config')) {
      const step = credentials.find(
        (candidate) => candidate.id === path.split('/').at(-2)
      );
      assert.ok(step);
      const id = body.alias + '-id';
      references[id] = { ...body, id };
      step.authenticationConfig = id;
    } else if (method === 'PUT' && path === '/admin/realms/openg7') {
      assert.deepEqual(body, { browserFlow: 'openg7-browser-sso' });
      realm.browserFlow = body.browserFlow;
    } else assert.fail('Unexpected Keycloak request.');
    if (loseResponse) {
      loseResponse = false;
      throw new Error('private-provider-diagnostics');
    }
    return { status: method === 'POST' ? 201 : 204, body: '' };
  };
  const run = (overrides = {}) =>
    reconcileKeycloakSso({
      issuer: 'https://identity.example.test/realms/openg7',
      accessToken: 'synthetic-private-token',
      request,
      audit: (event) => audit.push(event),
      ...overrides
    });
  return {
    realm,
    flows,
    strict,
    references,
    credentials,
    sso,
    calls,
    audit,
    run,
    loseResponse() {
      loseResponse = true;
    },
    rejectWrite() {
      rejectWrite = true;
    }
  };
}

test('SSO preparation inspects the exact realm and plans a controlled MFA path without mutations', async () => {
  const f = fixture();
  const result = await f.run();
  assert.deepEqual(result, {
    mode: 'plan',
    changes: [
      'create_sso_credentials_flow',
      'add_required_password',
      'configure_password_reference',
      'add_required_otp',
      'configure_otp_reference',
      'create_sso_flow',
      'add_session_cookie',
      'add_required_mfa_path',
      'bind_sso_browser_flow'
    ],
    assurance: 'signed_mfa_login_test_required'
  });
  assert.ok(f.calls.every((call) => call.method === 'GET'));
  assert.equal(f.audit.length, 0);
  assert.equal(f.realm.browserFlow, 'openg7-password-otp');
});

test('SSO apply preserves strict MFA and audits each reconciled change; replay does not mutate', async () => {
  const f = fixture(),
    strict = structuredClone(f.strict),
    references = structuredClone(f.references);
  await f.run({ apply: true });
  assert.equal(f.realm.browserFlow, 'openg7-browser-sso');
  assert.deepEqual(f.strict, strict);
  for (const [id, config] of Object.entries(references))
    assert.deepEqual(f.references[id], config);
  const writes = f.calls.filter((call) => call.method !== 'GET').length;
  assert.equal(writes, 9);
  assert.equal(
    f.audit.filter((event) => event.result === 'verified' && event.step).length,
    9
  );
  assert.doesNotMatch(
    JSON.stringify(f.audit),
    /synthetic-private-token|identity.example.test/
  );
  assert.deepEqual(await f.run({ apply: true }), {
    mode: 'apply',
    changes: [],
    assurance: 'signed_mfa_login_test_required'
  });
  assert.equal(f.calls.filter((call) => call.method !== 'GET').length, writes);
});

test('an accepted mutation with an uncertain response is reconciled once, without replaying its POST', async () => {
  const f = fixture();
  f.loseResponse();
  await f.run({ apply: true });
  assert.equal(
    f.flows.filter((flow) => flow.alias === 'openg7-browser-sso').length,
    1
  );
  assert.equal(
    f.calls.filter(
      (call) => call.method === 'POST' && call.url.endsWith('/flows')
    ).length,
    2
  );
});

test('source drift, missing OTP and excessive SSO lifetime stop before mutations', async () => {
  for (const change of [
    (f) => {
      f.realm.browserFlow = 'foreign-flow';
    },
    (f) => {
      f.strict[1].requirement = 'DISABLED';
    },
    (f) => {
      f.strict[0].providerId = 'auth-cookie';
    },
    (f) => {
      f.realm.ssoSessionMaxLifespan = 7200;
    }
  ]) {
    const f = fixture();
    change(f);
    await assert.rejects(
      f.run({ apply: true }),
      /Cannot reconcile Keycloak SSO safely/
    );
    assert.ok(f.calls.every((call) => call.method === 'GET'));
  }
});

test('an unmanaged SSO execution is preserved and rejected instead of overwritten', async () => {
  const f = fixture();
  f.flows.push({ ...f.flows[0], id: 'sso-id', alias: 'openg7-browser-sso' });
  f.sso.push({
    id: 'foreign-execution',
    providerId: 'identity-provider-redirector',
    requirement: 'ALTERNATIVE',
    priority: 10,
    level: 0
  });
  await assert.rejects(f.run({ apply: true }));
  assert.ok(f.calls.every((call) => call.method === 'GET'));
  assert.equal(f.sso.length, 1);
});

test('a verified partial wrapper can resume while the strict browser binding remains active', async () => {
  const f = fixture();
  await f.run({ apply: true });
  f.realm.browserFlow = 'openg7-password-otp';
  f.sso.pop();
  const writes = f.calls.filter((call) => call.method === 'POST').length;
  assert.deepEqual((await f.run()).changes, [
    'add_required_mfa_path',
    'bind_sso_browser_flow'
  ]);
  await f.run({ apply: true });
  assert.equal(f.realm.browserFlow, 'openg7-browser-sso');
  assert.equal(
    f.calls.filter((call) => call.method === 'POST').length,
    writes + 1
  );
});

test('masked native AMR values retain known managed identities without claiming a successful MFA login', async () => {
  const f = fixture();
  await f.run({ apply: true });
  const writes = f.calls.filter((call) => call.method !== 'GET').length;
  for (const step of f.credentials) {
    const config = f.references[step.authenticationConfig];
    config.config['default.reference.value'] = '**********';
    config.config['default.reference.maxAge'] = '**********';
  }
  const result = await f.run({ apply: true });
  assert.deepEqual(result.changes, []);
  assert.equal(result.assurance, 'signed_mfa_login_test_required');
  assert.equal(f.calls.filter((call) => call.method !== 'GET').length, writes);
});

test('foreign managed references or visible contradictory AMR values fail without overwriting configurations', async () => {
  for (const change of [
    (config) => {
      config.alias = 'foreign-config';
    },
    (config) => {
      config.config['default.reference.value'] = 'pwd';
    },
    (config) => {
      config.config['default.reference.maxAge'] = '30';
    }
  ]) {
    const f = fixture();
    await f.run({ apply: true });
    const writes = f.calls.filter((call) => call.method !== 'GET').length;
    change(f.references[f.credentials[1].authenticationConfig]);
    await assert.rejects(f.run({ apply: true }));
    assert.equal(
      f.calls.filter((call) => call.method !== 'GET').length,
      writes
    );
  }
});

test('an unavailable audit stops apply before provider mutations and withholds its diagnostics', async () => {
  const f = fixture();
  await assert.rejects(
    f.run({
      apply: true,
      audit() {
        throw new Error('private-audit-path');
      }
    }),
    (error) => {
      assert.doesNotMatch(String(error.stack), /private-audit-path/);
      return true;
    }
  );
  assert.ok(f.calls.every((call) => call.method === 'GET'));
});

test('permission failures and private provider diagnostics cannot bind an incomplete SSO flow', async () => {
  const f = fixture();
  f.rejectWrite();
  await assert.rejects(f.run({ apply: true }), (error) => {
    assert.doesNotMatch(String(error.stack), /private-provider-diagnostics/);
    return true;
  });
  assert.equal(f.realm.browserFlow, 'openg7-password-otp');
  assert.equal(f.calls.filter((call) => call.method !== 'GET').length, 1);
});

test('unsafe target URLs and header-injecting tokens fail before provider contact', async () => {
  for (const override of [
    { issuer: 'http://identity.example.test/realms/openg7' },
    { issuer: 'https://identity.example.test/realms/other' },
    { issuer: 'https://identity.example.test/realms/openg7?secret=value' },
    { issuer: 'https://private:secret@identity.example.test/realms/openg7' },
    { accessToken: 'private\nvalue' }
  ]) {
    const f = fixture();
    await assert.rejects(f.run(override));
    assert.equal(f.calls.length, 0);
  }
});
