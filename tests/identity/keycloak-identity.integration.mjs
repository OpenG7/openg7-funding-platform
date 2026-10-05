import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { promisify } from 'node:util';

import * as oidc from 'openid-client';

import {
  createAdminOidcHandler,
  loadAdminIdentityConfig
} from '../../dist/apps/funding-api/src/admin-identity/oidc.js';
import { satisfiesMfa } from '../../dist/apps/funding-api/src/admin-identity/policy.js';

const exec = promisify(execFile);
const image = 'openg7-keycloak:26.8.0-local';
const postgresImage = 'postgres:16-alpine';
const realmUrl = new URL(
  '../../docker/keycloak/openg7-realm.json',
  import.meta.url
);

// Local-only provider rehearsal, outside the generic integration glob and selected
// explicitly. No .env, persistent
// volumes, live users or production targets are accepted by this test.
const dockerRunner = async () => {
  const run = async (args, env = process.env) =>
    (
      await exec('docker', args, {
        env,
        windowsHide: true,
        timeout: 30_000,
        maxBuffer: 1024 * 1024
      })
    ).stdout.trim();
  const context = await run(['context', 'show']);
  const endpoint = await run([
    'context',
    'inspect',
    context,
    '--format',
    '{{.Endpoints.docker.Host}}'
  ]);
  if (!/^(?:npipe|unix):\/\//.test(endpoint))
    throw new Error('Keycloak rehearsal requires a local Docker socket.');
  const docker = (args, env) => run(['--context', context, ...args], env);
  if ((await docker(['info', '--format', '{{.OSType}}'])) !== 'linux')
    throw new Error('Keycloak rehearsal requires Linux containers.');
  for (const fixtureImage of [image, postgresImage]) {
    try {
      await docker(['image', 'inspect', fixtureImage, '--format', '{{.Id}}']);
    } catch {
      throw new Error(
        `Build/pull the disposable test image first: ${fixtureImage}`
      );
    }
  }
  return docker;
};

const eventually = async (operation, timeout = 120_000) => {
  const deadline = Date.now() + timeout;
  while (true) {
    try {
      return await operation();
    } catch {
      if (Date.now() >= deadline)
        throw new Error('Disposable Keycloak did not become ready.');
      await setTimeout(500);
    }
  }
};

const totp = (secret) => {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', secret).update(counter).digest();
  const offset = digest.at(-1) & 15;
  return String(
    (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000
  ).padStart(6, '0');
};

const browser = () => {
  const cookies = new Map();
  return async (url, options = {}) => {
    const response = await fetch(url, {
      ...options,
      redirect: 'manual',
      headers: { ...options.headers, cookie: [...cookies.values()].join('; ') }
    });
    for (const header of response.headers.getSetCookie()) {
      const pair = header.split(';')[0];
      cookies.set(pair.split('=')[0], pair);
    }
    return response;
  };
};

const formAction = (html, id) => {
  const form = html.match(new RegExp(`<form[^>]*id="${id}"[^>]*>`));
  assert.ok(form, `Expected the ${id} authentication form.`);
  const action = form[0].match(/action="([^"]+)"/);
  assert.ok(action, 'Authentication form must have an action.');
  return action[1].replaceAll('&amp;', '&');
};

const submit = (exchange, html, id, fields) =>
  exchange(formAction(html, id), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields)
  });

const followProviderRedirects = async (exchange, initialResponse, issuer) => {
  let response = initialResponse;
  for (let hops = 0; hops < 5 && [302, 303].includes(response.status); hops++) {
    const location = response.headers.get('location');
    if (new URL(location).origin !== new URL(issuer).origin) break;
    response = await exchange(location);
  }
  return response;
};

const authorize = async (client, exchange, callback, fields = {}) => {
  const verifier = oidc.randomPKCECodeVerifier();
  const state = randomUUID();
  const nonce = randomUUID();
  const url = oidc.buildAuthorizationUrl(client, {
    redirect_uri: callback,
    scope: 'openid profile',
    response_type: 'code',
    state,
    nonce,
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
    code_challenge_method: 'S256',
    ...fields
  });
  const response = await exchange(url);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.equal(/id="kc-form-login"/.test(html), true);
  return { verifier, state, nonce, response, html };
};

const grant = async (client, response, challenge) => {
  assert.equal(response.status, 302);
  const callback = new URL(response.headers.get('location'));
  assert.ok(callback.searchParams.has('code'));
  // Non-repudiation checks validate the ID token against the real Keycloak JWKS.
  const tokens = await oidc.authorizationCodeGrant(client, callback, {
    pkceCodeVerifier: challenge.verifier,
    expectedState: challenge.state,
    expectedNonce: challenge.nonce,
    idTokenExpected: true
  });
  return tokens.claims();
};

test(
  'real Keycloak import requires password plus OTP and emits MFA only for a completed second factor',
  { timeout: 240_000 },
  async (t) => {
    const docker = await dockerRunner();
    const suffix = randomUUID();
    const network = `og7-keycloak-test-${suffix}`;
    const edgeNetwork = `og7-keycloak-edge-test-${suffix}`;
    const directory = await mkdtemp(join(tmpdir(), 'og7-keycloak-test-'));
    const clientId = 'synthetic-funding-client';
    const clientSecret = randomBytes(32).toString('hex');
    const password = randomBytes(24).toString('hex');
    const otpSecret = Buffer.from(randomBytes(20).toString('hex'));
    const apiOtpSecret = Buffer.from(randomBytes(20).toString('hex'));
    const databasePassword = randomBytes(32).toString('hex');
    let keycloakId, databaseId;
    t.after(async () => {
      for (const id of [keycloakId, databaseId].filter(Boolean))
        await docker(['rm', '--force', id]);
      await docker(['network', 'rm', network]);
      await docker(['network', 'rm', edgeNetwork]);
      const target = resolve(directory);
      assert.ok(
        target.startsWith(resolve(tmpdir()) + sep + 'og7-keycloak-test-')
      );
      await rm(target, { recursive: true, force: true });
    });
    await docker(['network', 'create', '--internal', network]);
    await docker(['network', 'create', edgeNetwork]);

    const realm = JSON.parse(await readFile(realmUrl, 'utf8'));
    // The only transport exception is restricted to this disposable loopback realm.
    realm.sslRequired = 'none';
    const syntheticUser = (username, secondFactor) => ({
      username,
      enabled: true,
      email: `${username}@example.test`,
      emailVerified: true,
      firstName: 'Synthetic',
      lastName: 'Administrator',
      credentials: [
        { type: 'password', value: password, temporary: false },
        ...(secondFactor
          ? [
              {
                type: 'otp',
                secretData: JSON.stringify({
                  value: secondFactor.toString('utf8')
                }),
                credentialData: JSON.stringify({
                  digits: 6,
                  counter: 0,
                  period: 30,
                  algorithm: 'HmacSHA1',
                  subType: 'totp'
                })
              }
            ]
          : [])
      ]
    });
    realm.users = [
      syntheticUser('synthetic-mfa-user', otpSecret),
      syntheticUser('synthetic-api-user', apiOtpSecret),
      syntheticUser('synthetic-enrollment-user'),
      syntheticUser('synthetic-api-enrollment-user')
    ];
    const server = createServer((request, response) => {
      response.writeHead(404).end();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const callback = `${origin}/api/admin/auth/callback`;
    await writeFile(
      join(directory, 'openg7-realm.json'),
      JSON.stringify(realm)
    );

    databaseId = await docker(
      [
        'run',
        '--detach',
        '--pull',
        'never',
        '--name',
        `og7-keycloak-db-test-${suffix}`,
        '--label',
        'org.openg7.disposable-test=true',
        '--network',
        network,
        '--network-alias',
        'identity-db',
        '--mount',
        'type=tmpfs,destination=/var/lib/postgresql/data',
        '--env',
        'POSTGRES_DB=keycloak',
        '--env',
        'POSTGRES_USER=keycloak',
        '--env',
        'POSTGRES_PASSWORD',
        postgresImage
      ],
      { ...process.env, POSTGRES_PASSWORD: databasePassword }
    );
    await eventually(
      () =>
        docker([
          'exec',
          databaseId,
          'pg_isready',
          '-U',
          'keycloak',
          '-d',
          'keycloak'
        ]),
      30_000
    );
    keycloakId = await docker(
      [
        'run',
        '--detach',
        '--pull',
        'never',
        '--name',
        `og7-keycloak-server-test-${suffix}`,
        '--label',
        'org.openg7.disposable-test=true',
        '--network',
        network,
        '--network',
        edgeNetwork,
        '--publish',
        '127.0.0.1::8080',
        '--publish',
        '127.0.0.1::9000',
        '--memory',
        '1536m',
        '--health-cmd',
        '/opt/keycloak/bin/container-healthcheck.sh',
        '--health-interval',
        '2s',
        '--health-retries',
        '15',
        '--health-start-period',
        '120s',
        '--mount',
        `type=bind,source=${directory},destination=/opt/keycloak/data/import,readonly`,
        '--env',
        'KC_DB_URL=jdbc:postgresql://identity-db:5432/keycloak',
        '--env',
        'KC_DB_USERNAME=keycloak',
        '--env',
        'KC_DB_PASSWORD',
        '--env',
        'KC_HTTP_ENABLED=true',
        '--env',
        'KC_HOSTNAME_STRICT=false',
        '--env',
        'FUNDING_PUBLIC_BASE_URL',
        '--env',
        'FUNDING_ADMIN_OIDC_CLIENT_ID',
        '--env',
        'FUNDING_ADMIN_OIDC_CLIENT_SECRET',
        image,
        'start',
        '--optimized',
        '--import-realm'
      ],
      {
        ...process.env,
        KC_DB_PASSWORD: databasePassword,
        FUNDING_PUBLIC_BASE_URL: origin,
        FUNDING_ADMIN_OIDC_CLIENT_ID: clientId,
        FUNDING_ADMIN_OIDC_CLIENT_SECRET: clientSecret
      }
    );
    const binding = async (port) => {
      const running = await docker([
        'inspect',
        keycloakId,
        '--format',
        '{{.State.Running}}'
      ]);
      if (running !== 'true') {
        const logs = await docker(['logs', '--tail', '35', keycloakId]);
        const safeLogs = logs
          .replaceAll(clientSecret, '[redacted]')
          .replaceAll(databasePassword, '[redacted]')
          .replaceAll(password, '[redacted]')
          .replaceAll(otpSecret.toString('utf8'), '[redacted]')
          .replaceAll(apiOtpSecret.toString('utf8'), '[redacted]');
        throw new Error(
          `Disposable Keycloak stopped before port binding: ${safeLogs}`
        );
      }
      const match = /^127\.0\.0\.1:(\d+)$/.exec(
        await docker(['port', keycloakId, `${port}/tcp`])
      );
      assert.ok(match, 'Keycloak test ports must bind only to loopback.');
      return Number(match[1]);
    };
    const issuer = `http://127.0.0.1:${await binding(8080)}/realms/openg7`;
    const management = `http://127.0.0.1:${await binding(9000)}`;
    await eventually(async () =>
      assert.equal((await fetch(`${management}/health/ready`)).status, 200)
    );
    const client = await oidc.discovery(
      new URL(issuer),
      clientId,
      clientSecret,
      undefined,
      {
        execute: [oidc.allowInsecureRequests, oidc.enableNonRepudiationChecks]
      }
    );

    await t.test(
      'imported optimized image reports readiness through its production healthcheck',
      async () => {
        await eventually(async () =>
          assert.equal(
            await docker([
              'inspect',
              keycloakId,
              '--format',
              '{{.State.Health.Status}}'
            ]),
            'healthy'
          )
        );
      }
    );

    await t.test(
      'password alone and incorrect OTP never return an authorization code',
      async () => {
        const exchange = browser();
        const challenge = await authorize(client, exchange, callback);
        const firstFactor = await submit(
          exchange,
          challenge.html,
          'kc-form-login',
          {
            username: 'synthetic-mfa-user',
            password
          }
        );
        assert.equal(firstFactor.status, 200);
        assert.equal(firstFactor.headers.get('location'), null);
        const otpForm = await firstFactor.text();
        assert.equal(/id="kc-otp-login-form"/.test(otpForm), true);
        const invalidOtp = String(
          (Number(totp(otpSecret)) + 1) % 1_000_000
        ).padStart(6, '0');
        const rejected = await submit(exchange, otpForm, 'kc-otp-login-form', {
          otp: invalidOtp
        });
        assert.equal(rejected.status, 200);
        assert.equal(rejected.headers.get('location'), null);
        const rejectedForm = await rejected.text();
        assert.equal(/id="kc-otp-login-form"/.test(rejectedForm), true);
        const success = await submit(
          exchange,
          rejectedForm,
          'kc-otp-login-form',
          { otp: totp(otpSecret) }
        );
        const claims = await grant(client, success, challenge);
        assert.deepEqual([...claims.amr].sort(), ['mfa', 'pwd']);
        assert.equal(satisfiesMfa(claims, []), true);
        // Existing Keycloak SSO cookies cannot bypass the required password/OTP flow.
        await authorize(client, exchange, callback);
      }
    );

    await t.test(
      'OTP enrollment cannot attest an OTP execution that never happened',
      async () => {
        const exchange = browser();
        const challenge = await authorize(client, exchange, callback);
        const enrollment = await followProviderRedirects(
          exchange,
          await submit(exchange, challenge.html, 'kc-form-login', {
            username: 'synthetic-enrollment-user',
            password
          }),
          issuer
        );
        assert.equal(
          enrollment.status,
          200,
          'Missing OTP must require enrollment before returning a code.'
        );
        const html = await enrollment.text();
        assert.equal(/id="kc-totp-settings-form"/.test(html), true);
        const secret = html.match(/name="totpSecret"[^>]*value="([^"]+)"/)?.[1];
        assert.ok(
          secret,
          'OTP enrollment must expose its synthetic setup secret to this test.'
        );
        const success = await submit(exchange, html, 'kc-totp-settings-form', {
          totpSecret: secret,
          totp: totp(secret),
          userLabel: 'Synthetic authenticator'
        });
        const claims = await grant(client, success, challenge);
        assert.equal(claims.amr.includes('mfa'), false);
        assert.equal(satisfiesMfa(claims, []), false);
      }
    );

    await t.test(
      'client rejects wildcard callbacks, missing PKCE and password grants',
      async () => {
        const wrongCallback = oidc.buildAuthorizationUrl(client, {
          response_type: 'code',
          scope: 'openid',
          redirect_uri: `${callback}/unexpected`
        });
        assert.equal((await fetch(wrongCallback)).status, 400);
        const withoutPkce = oidc.buildAuthorizationUrl(client, {
          response_type: 'code',
          scope: 'openid',
          redirect_uri: callback
        });
        const pkceDenied = await fetch(withoutPkce, { redirect: 'manual' });
        assert.equal(pkceDenied.status, 302);
        const denialCallback = new URL(pkceDenied.headers.get('location'));
        assert.equal(denialCallback.origin + denialCallback.pathname, callback);
        assert.equal(
          denialCallback.searchParams.get('error'),
          'invalid_request'
        );
        assert.equal(denialCallback.searchParams.has('code'), false);
        const denied = await fetch(`${issuer}/protocol/openid-connect/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'password',
            client_id: clientId,
            client_secret: clientSecret,
            username: 'synthetic-mfa-user',
            password
          })
        });
        assert.equal(denied.status, 400);
        assert.equal((await denied.json()).error, 'unauthorized_client');
      }
    );

    await t.test(
      'OpenG7 callback accepts signed MFA and refuses first-time enrollment without an ACR exception',
      async () => {
        const challenges = new Map();
        const issued = [];
        let deniedCount = 0;
        const handle = createAdminOidcHandler(
          loadAdminIdentityConfig({
            NODE_ENV: 'test',
            FUNDING_PUBLIC_BASE_URL: origin,
            FUNDING_ADMIN_OIDC_ISSUER: issuer,
            FUNDING_ADMIN_OIDC_CLIENT_ID: clientId,
            FUNDING_ADMIN_OIDC_CLIENT_SECRET: clientSecret
          }),
          {
            async cleanupChallenges() {},
            async createChallenge(input) {
              challenges.set(input.stateHash, input);
            },
            async consumeChallenge(stateHash, browserHash) {
              const input = challenges.get(stateHash);
              challenges.delete(stateHash);
              return input?.browserHash === browserHash ? input : undefined;
            },
            async issueSession(input) {
              issued.push(input);
            },
            async auditSignInDenied() {
              deniedCount++;
            }
          }
        );
        server.removeAllListeners('request');
        server.on('request', async (request, response) => {
          const url = new URL(request.url, origin);
          try {
            if (
              !(await handle(
                request,
                response,
                url,
                url.pathname.replace(/^\/api/, '')
              ))
            )
              response.writeHead(404).end();
          } catch {
            response.writeHead(503).end();
          }
        });
        const exchange = browser();
        const start = await exchange(`${origin}/api/admin/auth/start`);
        assert.equal(start.status, 303);
        const login = await exchange(start.headers.get('location'));
        const otp = await submit(
          exchange,
          await login.text(),
          'kc-form-login',
          {
            username: 'synthetic-api-user',
            password
          }
        );
        const otpHtml = await otp.text();
        assert.equal(/id="kc-otp-login-form"/.test(otpHtml), true);
        assert.equal(issued.length, 0);
        const authorized = await submit(
          exchange,
          otpHtml,
          'kc-otp-login-form',
          { otp: totp(apiOtpSecret) }
        );
        assert.equal(authorized.status, 302);
        const accepted = await exchange(authorized.headers.get('location'));
        assert.equal(accepted.status, 303);
        assert.equal(accepted.headers.get('location'), '/admin/fundraiser');
        assert.equal(issued.length, 1);
        assert.equal(deniedCount, 0);
        assert.match(accepted.headers.getSetCookie().join(';'), /HttpOnly/);

        const freshBrowser = browser();
        const startEnrollment = await freshBrowser(
          `${origin}/api/admin/auth/start`
        );
        const enrollmentLogin = await freshBrowser(
          startEnrollment.headers.get('location')
        );
        const enrollment = await followProviderRedirects(
          freshBrowser,
          await submit(
            freshBrowser,
            await enrollmentLogin.text(),
            'kc-form-login',
            {
              username: 'synthetic-api-enrollment-user',
              password
            }
          ),
          issuer
        );
        assert.equal(enrollment.status, 200);
        const html = await enrollment.text();
        assert.equal(/id="kc-totp-settings-form"/.test(html), true);
        const secret = html.match(/name="totpSecret"[^>]*value="([^"]+)"/)?.[1];
        assert.ok(secret);
        const enrolled = await submit(
          freshBrowser,
          html,
          'kc-totp-settings-form',
          {
            totpSecret: secret,
            totp: totp(secret),
            userLabel: 'Synthetic authenticator'
          }
        );
        assert.equal(enrolled.status, 302);
        const refused = await freshBrowser(enrolled.headers.get('location'));
        assert.equal(refused.status, 303);
        assert.equal(
          refused.headers.get('location'),
          '/admin/login?identityError=1'
        );
        assert.equal(
          issued.length,
          1,
          'Enrollment without an OTP execution must not create an OpenG7 session.'
        );
        assert.equal(deniedCount, 1);
      }
    );
  }
);
