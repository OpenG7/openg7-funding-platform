import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import test from 'node:test';

import { chromium, expect } from '@playwright/test';
import * as oidc from 'openid-client';

import { startLocalKeycloakHttpsStack } from './keycloak-local-https-stack.mjs';

const totp = (secret) => {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', secret).update(counter).digest();
  const offset = digest.at(-1) & 15;
  return String(
    (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000
  ).padStart(6, '0');
};

const signedPasswordClaims = async (stack) => {
  const issuer = new URL('https://auth.openg7.test/realms/openg7');
  // This adapter routes trusted HTTPS through the fixture's ephemeral local port.
  // TLS verification and real provider discovery/JWKS/signatures stay enabled.
  const client = await oidc.discovery(
    issuer,
    'synthetic-local-funding',
    undefined,
    undefined,
    {
      execute: [oidc.enableNonRepudiationChecks],
      [oidc.customFetch]: async (url, options = {}) => {
        const target = new URL(String(url));
        assert.equal(target.origin, issuer.origin);
        const result = await stack.providerClientRequest(target, options);
        return new Response(result.body, {
          status: result.status,
          headers: result.headers
        });
      }
    }
  );
  const verifier = oidc.randomPKCECodeVerifier();
  const state = randomUUID();
  const nonce = randomUUID();
  const url = oidc.buildAuthorizationUrl(client, {
    redirect_uri: stack.origin + '/api/admin/auth/callback',
    scope: 'openid profile',
    state,
    nonce,
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
    code_challenge_method: 'S256'
  });
  const login = await stack.exchange(url.pathname + url.search, {
    provider: true
  });
  assert.equal(login.status, 200);
  const form = login.body.match(/<form[^>]*id="kc-form-login"[^>]*>/)?.[0];
  assert.ok(form, 'Password-only provider must present its password form.');
  const action = new URL(
    form.match(/action="([^"]+)"/)[1].replaceAll('&amp;', '&')
  );
  const cookies = (login.headers['set-cookie'] ?? []).map(
    (value) => value.split(';')[0]
  );
  const authenticated = await stack.exchange(action.pathname + action.search, {
    provider: true,
    method: 'POST',
    cookie: cookies.join('; '),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      username: 'synthetic-local-owner',
      password: stack.password
    }).toString()
  });
  assert.equal(authenticated.status, 302);
  const callback = new URL(authenticated.headers.location);
  const tokens = await oidc.authorizationCodeGrant(client, callback, {
    pkceCodeVerifier: verifier,
    expectedState: state,
    expectedNonce: nonce,
    idTokenExpected: true
  });
  return tokens.claims();
};

// Explicit opt-in real-provider rehearsal: no .env or personal stack is touched.
test(
  'localhost password-only Keycloak signs pwd without MFA, preserves credentials and restores mandatory OTP',
  { timeout: 600_000 },
  async () => {
    const stack = await startLocalKeycloakHttpsStack({ passwordOnly: true });
    let context;
    let stage = 'password-only setup';
    try {
      assert.equal(stack.authenticationProfile.passwordOnly, true);
      assert.equal(stack.authenticationProfile.changed, true);
      const before = await stack.snapshotUser();
      assert.deepEqual(before.credentialTypes, ['otp', 'password']);
      stage = 'signed provider password claim';
      const claims = await signedPasswordClaims(stack);
      assert.deepEqual(claims.amr, ['pwd']);
      assert.equal(claims.sub, stack.ownerSubject);

      stage = 'password-only replay';
      assert.deepEqual(await stack.replayAuthenticationProfile(), {
        passwordOnly: true,
        changed: false
      });
      assert.equal(
        (await stack.snapshotUser()).fingerprint,
        before.fingerprint
      );

      const openBrowser = async (name) => {
        context = await chromium.launchPersistentContext(
          join(stack.root, name),
          {
            viewport: { width: 1280, height: 900 },
            args: [
              `--host-resolver-rules=MAP auth.openg7.test:443 127.0.0.1:${stack.port}, EXCLUDE localhost`,
              '--no-proxy-server'
            ]
          }
        );
        const page = context.pages()[0];
        page.setDefaultTimeout(15_000);
        await page.goto(
          stack.origin +
            '/api/admin/auth/start?returnUrl=/admin/fundraiser/access'
        );
        await expect(page.locator('#kc-form-login')).toBeVisible();
        await page.locator('[name="username"]').fill('synthetic-local-owner');
        await page.locator('[name="password"]').fill(stack.password);
        await page.locator('#kc-login').click();
        return page;
      };
      stage = 'real browser and API password-only sign-in';
      let page = await openBrowser('browser-password');
      await expect(page).toHaveURL(stack.origin + '/admin/fundraiser/access');
      const cookie = (await context.cookies(stack.origin))
        .filter(({ name }) => name === '__Host-og7-admin')
        .map(({ name, value }) => `${name}=${value}`)
        .join('; ');
      assert.ok(cookie);
      const current = await stack.exchange('/api/admin/auth/current', {
        cookie
      });
      assert.equal(current.status, 200);
      assert.equal(JSON.parse(current.body).role, 'owner');
      assert.equal(
        (await stack.exchange('/api/admin/access', { cookie })).status,
        200
      );
      const status = await stack.exchange('/api/admin/setup-status', {
        cookie
      });
      assert.equal(status.status, 200);
      assert.equal(
        JSON.parse(status.body).identity.mfa_policy,
        'local-password'
      );
      const logout = await stack.exchange('/api/admin/auth/logout', {
        method: 'POST',
        cookie,
        headers: { Origin: stack.origin }
      });
      assert.equal(logout.status, 200);
      assert.equal(
        (await stack.exchange('/api/admin/auth/current', { cookie })).status,
        401
      );
      await context.browser().close();
      context = undefined;

      stage = 'restore mandatory MFA';
      assert.deepEqual(await stack.reconcilePasswordOnly(false), {
        passwordOnly: false,
        changed: true
      });
      assert.equal(
        (await stack.snapshotUser()).fingerprint,
        before.fingerprint
      );
      assert.deepEqual(await stack.replayAuthenticationProfile(), {
        passwordOnly: false,
        changed: false
      });
      stage = 'restored real browser password requires OTP';
      page = await openBrowser('browser-restored-mfa');
      const otp = page.locator('#kc-otp-login-form');
      await expect(otp).toBeVisible();
      assert.equal(
        await stack.sql(
          'SELECT count(*) FROM admin_identity_sessions WHERE revoked_at IS NULL;'
        ),
        '0'
      );
      await otp.locator('[name="otp"]').fill(totp(stack.otpSecret));
      await otp.locator('[type="submit"]').click();
      await expect(page).toHaveURL(stack.origin + '/admin/fundraiser/access');
      const restoredCookie = (await context.cookies(stack.origin))
        .filter(({ name }) => name === '__Host-og7-admin')
        .map(({ name, value }) => `${name}=${value}`)
        .join('; ');
      assert.ok(restoredCookie);
      const restoredStatus = await stack.exchange('/api/admin/setup-status', {
        cookie: restoredCookie
      });
      assert.equal(restoredStatus.status, 200);
      assert.equal(JSON.parse(restoredStatus.body).identity.mfa_policy, 'amr');
      assert.equal(
        await stack.sql(
          'SELECT count(*) FROM admin_identity_sessions WHERE revoked_at IS NULL;'
        ),
        '1'
      );
      assert.equal(
        (await stack.snapshotUser()).fingerprint,
        before.fingerprint
      );
    } catch {
      // Browser/provider errors can include codes, credential fields and URLs.
      throw new Error(
        `Local password-only rehearsal failed at ${stage}; private details withheld.`
      );
    } finally {
      try {
        if (context) await context.browser().close();
      } finally {
        await stack.stop();
      }
    }
  }
);
