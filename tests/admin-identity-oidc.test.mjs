import assert from 'node:assert/strict';
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign
} from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';

import { identityHash } from '../dist/apps/funding-api/src/admin-identity/contracts.js';
import {
  createAdminOidcHandler,
  loadAdminIdentityConfig
} from '../dist/apps/funding-api/src/admin-identity/oidc.js';

const env = (overrides = {}) => ({
  NODE_ENV: 'test',
  FUNDING_PUBLIC_BASE_URL: 'https://funding.example.test',
  FUNDING_ADMIN_OIDC_ISSUER: 'https://identity.example.test',
  FUNDING_ADMIN_OIDC_CLIENT_ID: 'synthetic-client',
  FUNDING_ADMIN_OIDC_CLIENT_SECRET: 'synthetic-client-secret',
  ...overrides
});

const localPasswordEnv = (overrides = {}) =>
  env({
    NODE_ENV: 'production',
    FUNDING_PLATFORM_ENV: 'development',
    FUNDING_ADMIN_AUTH_MODE: 'oidc',
    FUNDING_KEYCLOAK_ENABLED: 'true',
    FUNDING_KEYCLOAK_HOSTNAME: 'auth.openg7.test',
    FUNDING_PUBLIC_BASE_URL: 'https://localhost',
    FUNDING_ADMIN_OIDC_ISSUER: 'https://auth.openg7.test/realms/openg7',
    FUNDING_ADMIN_OIDC_LOCAL_PASSWORD_ONLY: 'true',
    ...overrides
  });

const response = (events = []) => ({
  headers: new Map(),
  setHeader(name, value) {
    this.headers.set(name.toLowerCase(), value);
    events.push(['header', name]);
  },
  getHeader(name) {
    return this.headers.get(name.toLowerCase());
  },
  writeHead(status, headers) {
    this.status = status;
    for (const [name, value] of Object.entries(headers))
      this.headers.set(name.toLowerCase(), value);
    events.push(['response', status]);
  },
  end() {
    this.ended = true;
  }
});

const unusedPorts = () => ({
  async cleanupChallenges() {},
  async createChallenge() {
    assert.fail('Unexpected challenge creation');
  },
  async consumeChallenge() {
    assert.fail('Unexpected challenge consumption');
  },
  async issueSession() {
    assert.fail('Unexpected session creation');
  },
  async auditSignInDenied() {
    assert.fail('Unexpected denied audit');
  }
});

test('OIDC configuration keeps secure origins and limits HTTP to non-production loopback', () => {
  const configured = loadAdminIdentityConfig(env());
  assert.equal(configured.cookieName, '__Host-og7-admin');
  assert.equal(configured.origin, 'https://funding.example.test');
  assert.equal(configured.secure, true);
  for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
    const local = {
      FUNDING_PUBLIC_BASE_URL: `http://${hostname}:8080`,
      FUNDING_ADMIN_OIDC_ISSUER: `http://${hostname}:8081`
    };
    const config = loadAdminIdentityConfig(env(local));
    assert.equal(config.cookieName, 'og7-admin');
    assert.equal(config.secure, false);
    assert.throws(() =>
      loadAdminIdentityConfig(env({ ...local, NODE_ENV: 'production' }))
    );
    for (const nodeEnv of ['test', undefined])
      assert.throws(() =>
        loadAdminIdentityConfig(
          env({
            ...local,
            NODE_ENV: nodeEnv,
            FUNDING_PLATFORM_ENV: 'production'
          })
        )
      );
  }
  for (const overrides of [
    { FUNDING_PUBLIC_BASE_URL: 'http://funding.example.test' },
    { FUNDING_ADMIN_OIDC_ISSUER: 'http://identity.example.test' },
    {
      FUNDING_PUBLIC_BASE_URL: 'https://synthetic:secret@funding.example.test'
    },
    {
      FUNDING_ADMIN_OIDC_ISSUER:
        'https://synthetic:secret@identity.example.test'
    },
    { FUNDING_ADMIN_OIDC_CLIENT_ID: '' },
    { FUNDING_ADMIN_OIDC_CLIENT_SECRET: '' }
  ])
    assert.throws(
      () => loadAdminIdentityConfig(env(overrides)),
      /^Error: OIDC requires a secure origin, issuer, client ID and client secret\.$/
    );
});

test('OIDC malformed configuration never exposes private URL inputs in errors', () => {
  for (const setting of [
    'FUNDING_PUBLIC_BASE_URL',
    'FUNDING_ADMIN_OIDC_ISSUER'
  ]) {
    assert.throws(
      () =>
        loadAdminIdentityConfig(
          env({ [setting]: 'https://synthetic:private-url-value@[' })
        ),
      (error) => {
        assert.equal(error.input, undefined);
        assert.doesNotMatch(String(error.stack), /private-url-value/);
        return true;
      }
    );
  }
});

test('password-only OIDC is opt-in and confined to the explicit localhost development profile', () => {
  assert.equal(loadAdminIdentityConfig(env()).localPasswordOnly, false);
  assert.equal(
    loadAdminIdentityConfig(
      env({ FUNDING_ADMIN_OIDC_LOCAL_PASSWORD_ONLY: 'false' })
    ).localPasswordOnly,
    false
  );
  for (const origin of ['https://localhost', 'https://localhost:8443']) {
    const config = loadAdminIdentityConfig(
      localPasswordEnv({ FUNDING_PUBLIC_BASE_URL: origin })
    );
    assert.equal(config.localPasswordOnly, true);
    assert.equal(config.secure, true);
    assert.equal(config.cookieName, '__Host-og7-admin');
    assert.equal(config.mfaAcr, '');
  }
  for (const overrides of [
    { FUNDING_PLATFORM_ENV: undefined },
    { FUNDING_PLATFORM_ENV: 'production' },
    { FUNDING_PLATFORM_ENV: 'test' },
    { FUNDING_PLATFORM_ENV: 'Development' },
    { FUNDING_ADMIN_AUTH_MODE: undefined },
    { FUNDING_ADMIN_AUTH_MODE: 'token' },
    { FUNDING_KEYCLOAK_ENABLED: undefined },
    { FUNDING_KEYCLOAK_ENABLED: 'false' },
    { FUNDING_KEYCLOAK_HOSTNAME: 'auth.openg7.org' },
    { FUNDING_ADMIN_OIDC_ISSUER: 'https://auth.openg7.org/realms/openg7' },
    { FUNDING_ADMIN_OIDC_ISSUER: 'https://auth.openg7.test/realms/openg7/' },
    {
      FUNDING_ADMIN_OIDC_ISSUER: 'https://auth.openg7.test:8443/realms/openg7'
    },
    { FUNDING_ADMIN_OIDC_MFA_ACR: 'mfa' },
    { FUNDING_PUBLIC_BASE_URL: 'https://funding.example.test' },
    { FUNDING_PUBLIC_BASE_URL: 'http://localhost' },
    { FUNDING_PUBLIC_BASE_URL: 'https://127.0.0.1' },
    { FUNDING_PUBLIC_BASE_URL: 'https://localhost.example.test' },
    { FUNDING_PUBLIC_BASE_URL: 'https://localhost/' },
    { FUNDING_PUBLIC_BASE_URL: 'https://localhost:0' },
    { FUNDING_PUBLIC_BASE_URL: 'https://localhost/private' },
    { FUNDING_PUBLIC_BASE_URL: 'https://localhost?private=value' },
    { FUNDING_PUBLIC_BASE_URL: 'https://localhost#private' },
    { FUNDING_PUBLIC_BASE_URL: 'https://synthetic:private@localhost' },
    { FUNDING_PUBLIC_BASE_URL: 'https://localhost:65536' },
    { FUNDING_PUBLIC_BASE_URL: 'https://synthetic:private@[' }
  ])
    assert.throws(
      () => loadAdminIdentityConfig(localPasswordEnv(overrides)),
      (error) => {
        assert.match(error.message, /Local password-only OIDC requires/);
        assert.equal(error.input, undefined);
        assert.doesNotMatch(String(error.stack), /synthetic:private/);
        return true;
      }
    );
  for (const value of ['', 'TRUE', '1', 'yes', ' true ', 'invalid'])
    assert.throws(
      () =>
        loadAdminIdentityConfig(
          localPasswordEnv({ FUNDING_ADMIN_OIDC_LOCAL_PASSWORD_ONLY: value })
        ),
      /must be true or false/
    );
});

test('changing environment values after startup cannot enable the local password exception', () => {
  const values = env();
  const config = loadAdminIdentityConfig(values);
  Object.assign(values, localPasswordEnv());
  assert.equal(config.localPasswordOnly, false);
});

test('OIDC configuration preserves late reads for credentials, MFA and bootstrap subjects', () => {
  const values = env();
  const config = loadAdminIdentityConfig(values);
  Object.assign(values, {
    FUNDING_ADMIN_OIDC_CLIENT_ID: 'updated-synthetic-client',
    FUNDING_ADMIN_OIDC_CLIENT_SECRET: 'updated-synthetic-secret',
    FUNDING_ADMIN_OIDC_MFA_ACR: 'urn:synthetic:mfa,urn:synthetic:strong',
    FUNDING_ADMIN_OIDC_OWNER_SUBJECTS: ' fixture-owner , fixture-second ',
    FUNDING_ADMIN_OIDC_ISSUER: 'https://different.example.test',
    FUNDING_PUBLIC_BASE_URL: 'https://different-funding.example.test'
  });
  assert.equal(config.clientId, values.FUNDING_ADMIN_OIDC_CLIENT_ID);
  assert.equal(config.clientSecret, values.FUNDING_ADMIN_OIDC_CLIENT_SECRET);
  assert.equal(config.mfaAcr, values.FUNDING_ADMIN_OIDC_MFA_ACR);
  assert.deepEqual(config.ownerSubjects, ['fixture-owner', 'fixture-second']);
  assert.equal(config.issuer.href, 'https://identity.example.test/');
  assert.equal(config.origin, 'https://funding.example.test');
});

test('OIDC discovery is shared across concurrent starts and retries after a rejection', async (t) => {
  let issuer,
    discoveryRequests = 0,
    available = false;
  const provider = createServer((request, reply) => {
    assert.equal(request.url, '/.well-known/openid-configuration');
    discoveryRequests += 1;
    reply.setHeader('Content-Type', 'application/json');
    if (!available) return reply.writeHead(503).end('{}');
    reply.end(
      JSON.stringify({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256']
      })
    );
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  issuer = `http://127.0.0.1:${provider.address().port}`;
  t.after(
    () =>
      new Promise((resolve, reject) => {
        provider.close((error) => (error ? reject(error) : resolve()));
        provider.closeAllConnections();
      })
  );
  const challenges = [];
  let cleanups = 0;
  const config = loadAdminIdentityConfig(
    env({
      FUNDING_ADMIN_OIDC_ISSUER: issuer,
      FUNDING_ADMIN_OIDC_MFA_ACR: 'urn:synthetic:mfa,urn:synthetic:strong'
    })
  );
  const handler = createAdminOidcHandler(config, {
    ...unusedPorts(),
    async cleanupChallenges() {
      cleanups += 1;
    },
    async createChallenge(input) {
      challenges.push(input);
    }
  });
  const start = async (
    returnPath = '/admin/fundraiser/access?tab=sessions'
  ) => {
    const url = new URL('/api/admin/auth/start', config.origin);
    url.searchParams.set('returnUrl', returnPath);
    const reply = response();
    const handled = await handler(
      { method: 'GET', headers: {} },
      reply,
      url,
      '/admin/auth/start'
    );
    return { handled, reply };
  };
  const unavailable = await Promise.allSettled([start(), start()]);
  assert.deepEqual(
    unavailable.map((result) => result.status),
    ['rejected', 'rejected']
  );
  assert.equal(discoveryRequests, 1);
  assert.equal(cleanups, 0);
  assert.equal(challenges.length, 0);

  available = true;
  const successful = await Promise.all([start(), start()]);
  successful.push(await start('https://outside.example.test'));
  assert.equal(discoveryRequests, 2);
  assert.equal(cleanups, 3);
  assert.equal(challenges.length, 3);
  assert.equal(challenges[2].returnPath, '/admin/fundraiser');
  const states = new Set();
  for (const { handled, reply } of successful) {
    assert.equal(handled, true);
    assert.equal(reply.status, 303);
    assert.equal(reply.getHeader('Cache-Control'), 'no-store');
    assert.equal(reply.getHeader('Referrer-Policy'), 'no-referrer');
    const authorization = new URL(reply.getHeader('Location'));
    const state = authorization.searchParams.get('state');
    states.add(state);
    assert.match(state, /^[\w-]{43}$/);
    const challenge = challenges.find(
      (value) => value.stateHash === identityHash(state)
    );
    assert.ok(challenge);
    const cookie = reply.getHeader('Set-Cookie');
    assert.match(
      cookie,
      /^__Host-og7-admin-login=[\w-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=300; Secure$/
    );
    const browser = cookie.split(';')[0].split('=')[1];
    assert.equal(challenge.browserHash, identityHash(browser));
    assert.equal(authorization.searchParams.get('nonce'), challenge.nonce);
    assert.equal(
      authorization.searchParams.get('redirect_uri'),
      `${config.origin}/api/admin/auth/callback`
    );
    assert.equal(
      authorization.searchParams.get('code_challenge_method'),
      'S256'
    );
    assert.equal(
      authorization.searchParams.get('acr_values'),
      'urn:synthetic:mfa urn:synthetic:strong'
    );
    assert.equal(
      authorization.searchParams.get('code_challenge'),
      createHash('sha256').update(challenge.verifier).digest('base64url')
    );
  }
  assert.equal(states.size, 3);

  const malformed = new URL('/api/admin/auth/start', config.origin);
  malformed.searchParams.set('returnUrl', 'https://[');
  const malformedReply = response();
  await assert.rejects(
    handler(
      { method: 'GET', headers: {} },
      malformedReply,
      malformed,
      '/admin/auth/start'
    ),
    TypeError
  );
  assert.equal(cleanups, 4);
  assert.equal(challenges.length, 3);
  assert.equal(malformedReply.headers.size, 0);
  assert.equal(malformedReply.ended, undefined);
});

test('OIDC rejects a missing browser challenge before contacting the provider and hides denied audit failures', async () => {
  const config = loadAdminIdentityConfig(env());
  const events = [];
  const handler = createAdminOidcHandler(config, {
    ...unusedPorts(),
    async consumeChallenge(stateHash, browserHash) {
      events.push(['consume']);
      assert.equal(stateHash, identityHash('synthetic-state'));
      assert.equal(browserHash, identityHash(''));
      return undefined;
    },
    async auditSignInDenied() {
      events.push(['denied']);
      throw new Error('Synthetic unavailable audit');
    }
  });
  const reply = response(events);
  const handled = await handler(
    { method: 'GET', headers: {} },
    reply,
    new URL(
      '/admin/auth/callback?state=synthetic-state&code=synthetic-code',
      config.origin
    ),
    '/admin/auth/callback'
  );
  assert.equal(handled, true);
  assert.equal(reply.status, 303);
  assert.equal(reply.getHeader('Location'), '/admin/login?identityError=1');
  assert.equal(
    reply.getHeader('Set-Cookie'),
    '__Host-og7-admin-login=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure'
  );
  assert.deepEqual(events, [
    ['header', 'Set-Cookie'],
    ['consume'],
    ['denied'],
    ['response', 303]
  ]);
});

test('OIDC handles only GET start and callback routes', async () => {
  const config = loadAdminIdentityConfig(env());
  const handler = createAdminOidcHandler(config, unusedPorts());
  for (const [method, path] of [
    ['POST', '/admin/auth/start'],
    ['POST', '/admin/auth/callback'],
    ['GET', '/admin/auth/current'],
    ['POST', '/admin/auth/logout']
  ]) {
    const reply = response();
    assert.equal(
      await handler(
        { method, headers: {} },
        reply,
        new URL(path, config.origin),
        path
      ),
      false
    );
    assert.equal(reply.headers.size, 0);
    assert.equal(reply.ended, undefined);
  }
});

test('password-only localhost callbacks still verify signed password claims, PKCE, nonce, audience, expiry and one-time browser state', async (t) => {
  // Only the provider transport is simulated: openid-client verifies real RSA
  // signatures and all OIDC claims with the unmodified HTTPS localhost config.
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048
  });
  const jwk = {
    ...publicKey.export({ format: 'jwk' }),
    kid: 'local-password-fixture',
    alg: 'RS256',
    use: 'sig'
  };
  const issuer = 'https://auth.openg7.test/realms/openg7';
  let claimsOverride = {},
    badSignature = false,
    nonce,
    expectedPkce;
  const json = (value, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://auth.openg7.test');
    if (url.pathname.endsWith('/.well-known/openid-configuration'))
      return json({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256']
      });
    if (url.pathname.endsWith('/jwks')) return json({ keys: [jwk] });
    assert.equal(url.pathname, '/realms/openg7/token');
    const params = new URLSearchParams(options.body);
    assert.equal(params.get('grant_type'), 'authorization_code');
    assert.equal(
      params.get('redirect_uri'),
      'https://localhost/api/admin/auth/callback'
    );
    if (
      createHash('sha256')
        .update(params.get('code_verifier'))
        .digest('base64url') !== expectedPkce
    )
      return json({ error: 'invalid_grant' }, 400);
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(
      JSON.stringify({ alg: 'RS256', kid: jwk.kid })
    ).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        iss: issuer,
        sub: 'synthetic-owner',
        aud: 'synthetic-client',
        iat: now,
        exp: now + 120,
        nonce,
        amr: ['pwd'],
        ...claimsOverride
      })
    ).toString('base64url');
    const data = `${header}.${payload}`;
    const signature = badSignature
      ? randomBytes(256)
      : sign('RSA-SHA256', Buffer.from(data), privateKey);
    return json({
      token_type: 'Bearer',
      access_token: 'synthetic-unused',
      expires_in: 120,
      id_token: `${data}.${signature.toString('base64url')}`
    });
  });

  for (const localPasswordOnly of [false, true]) {
    const config = loadAdminIdentityConfig(
      localPasswordEnv({
        FUNDING_ADMIN_OIDC_LOCAL_PASSWORD_ONLY: String(localPasswordOnly),
        FUNDING_ADMIN_OIDC_OWNER_SUBJECTS: 'synthetic-owner'
      })
    );
    let challenge,
      sessions = 0,
      denials = 0;
    const handler = createAdminOidcHandler(config, {
      async cleanupChallenges() {},
      async createChallenge(input) {
        challenge = input;
        nonce = input.nonce;
      },
      async consumeChallenge(stateHash, browserHash) {
        const saved = challenge;
        challenge = undefined;
        return saved?.stateHash === stateHash &&
          saved.browserHash === browserHash
          ? saved
          : undefined;
      },
      async issueSession(input) {
        assert.equal(input.subject, 'synthetic-owner');
        assert.equal(input.bootstrapOwner, true);
        sessions += 1;
      },
      async auditSignInDenied() {
        denials += 1;
      }
    });
    const login = async ({ wrongBrowser, wrongState, wrongVerifier } = {}) => {
      const begin = response();
      await handler(
        { method: 'GET', headers: {} },
        begin,
        new URL('/api/admin/auth/start', config.origin),
        '/admin/auth/start'
      );
      const authorization = new URL(begin.getHeader('Location'));
      assert.equal(authorization.searchParams.get('acr_values'), null);
      expectedPkce = authorization.searchParams.get('code_challenge');
      if (wrongVerifier) challenge.verifier = 'wrong-synthetic-verifier';
      const callback = new URL('/api/admin/auth/callback', config.origin);
      callback.searchParams.set('code', 'synthetic-code');
      callback.searchParams.set(
        'state',
        wrongState ? 'wrong' : authorization.searchParams.get('state')
      );
      const request = {
        method: 'GET',
        headers: {
          cookie: wrongBrowser
            ? ''
            : begin.getHeader('Set-Cookie').split(';')[0]
        }
      };
      const finish = response();
      const before = sessions;
      await handler(request, finish, callback, '/admin/auth/callback');
      return { finish, before, request, callback };
    };

    const expectDenied = async (options) => {
      const { finish, before } = await login(options);
      assert.equal(
        finish.getHeader('Location'),
        '/admin/login?identityError=1'
      );
      assert.equal(sessions, before);
      assert.match(finish.getHeader('Set-Cookie'), /Max-Age=0; Secure$/);
    };
    claimsOverride = {};
    if (!localPasswordOnly) await expectDenied();
    else {
      const accepted = await login();
      assert.equal(accepted.finish.getHeader('Location'), '/admin/fundraiser');
      assert.equal(sessions, accepted.before + 1);
      assert.match(
        accepted.finish.getHeader('Set-Cookie')[1],
        /^__Host-og7-admin=[\w-]{43};.*HttpOnly;.*Secure$/
      );
      const replay = response();
      await handler(
        accepted.request,
        replay,
        accepted.callback,
        '/admin/auth/callback'
      );
      assert.equal(
        replay.getHeader('Location'),
        '/admin/login?identityError=1'
      );
      assert.equal(sessions, accepted.before + 1);
    }
    claimsOverride = { amr: ['pwd', 'mfa'] };
    const mfa = await login();
    assert.equal(mfa.finish.getHeader('Location'), '/admin/fundraiser');
    assert.equal(sessions, mfa.before + 1);
    if (localPasswordOnly) {
      for (const override of [
        { amr: undefined },
        { amr: [] },
        { amr: 'pwd' },
        { amr: ['mfa'] },
        { nonce: 'wrong' },
        { aud: 'other-client' },
        { iss: 'https://different.example.test' },
        { exp: 1 }
      ]) {
        claimsOverride = override;
        await expectDenied();
      }
      claimsOverride = {};
      badSignature = true;
      await expectDenied();
      badSignature = false;
      await expectDenied({ wrongBrowser: true });
      await expectDenied({ wrongState: true });
      await expectDenied({ wrongVerifier: true });
    }
    assert.ok(denials > 0);
  }
});
