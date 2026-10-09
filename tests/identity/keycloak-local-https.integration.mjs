import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';

import { chromium, expect } from '@playwright/test';

import { startLocalKeycloakHttpsStack } from './keycloak-local-https-stack.mjs';

// Same Keycloak credential/enrollment TOTP contract as keycloak-identity.integration.
const totp = (secret, now = Date.now()) => {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const digest = createHmac('sha1', secret).update(counter).digest();
  const offset = digest.at(-1) & 15;
  return String(
    (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000
  ).padStart(6, '0');
};

// Opt-in rehearsal: genuine Compose profile, HTTPS, provider, API and Chromium.
// Trust must already exist in the invoking platform/container; this never installs
// a CA, edits hosts, relaxes certificate checks or reads the development .env.
test(
  'local HTTPS Keycloak enrolls OTP, preserves a hashed API session after restart and revokes it',
  { timeout: 360_000 },
  async () => {
    const stack = await startLocalKeycloakHttpsStack();
    let context;
    let stage = 'browser startup';
    try {
      context = await chromium.launchPersistentContext(
        join(stack.root, 'browser'),
        {
          viewport: { width: 1280, height: 1000 },
          args: [
            `--host-resolver-rules=MAP auth.openg7.test:443 127.0.0.1:${stack.port}, EXCLUDE localhost`,
            '--no-proxy-server'
          ]
        }
      );
      const page = context.pages()[0];
      page.setDefaultTimeout(10_000);
      const errors = [];
      page.on('pageerror', () => errors.push(true));
      const countSessions = async () =>
        Number(
          await stack.sql('SELECT count(*) FROM admin_identity_sessions;')
        );
      const login = async () => {
        await page.goto(
          stack.origin +
            '/admin/login?returnUrl=' +
            encodeURIComponent('/admin/fundraiser/access')
        );
        await page.locator('[data-og7="identity-sign-in"]').click();
        await expect(page.locator('#kc-form-login')).toBeVisible();
        await page.locator('[name="username"]').fill('synthetic-local-owner');
        await page.locator('[name="password"]').fill(stack.password);
        await page.locator('#kc-login').click();
      };

      stage = 'OTP enrollment';
      await login();
      const enrollment = page.locator('#kc-totp-settings-form');
      await expect(enrollment).toBeVisible();
      const secret = await enrollment
        .locator('[name="totpSecret"]')
        .inputValue();
      assert.ok(
        secret.length > 0,
        'The provider must supply an enrollment secret.'
      );
      await enrollment.locator('[name="totp"]').fill(totp(secret));
      await enrollment
        .locator('[name="userLabel"]')
        .fill('Synthetic HTTPS authenticator');
      await enrollment.locator('[type="submit"]').click();
      // Enrollment itself did not execute the required OTP authentication step:
      // the signed provider claims must not authorize an OpenG7 session yet.
      await expect(page).toHaveURL(/\/admin\/login\?identityError=1/);
      assert.equal(await countSessions(), 0);
      assert.ok(
        !(await context.cookies(stack.origin)).some(
          (cookie) => cookie.name === '__Host-og7-admin'
        ),
        'Enrollment alone must not issue an admin cookie.'
      );

      // Keycloak forbids reuse of an OTP step, including the enrollment code.
      await setTimeout(30_000 - (Date.now() % 30_000) + 50);
      stage = 'mandatory password and OTP';
      await login();
      const otp = page.locator('#kc-otp-login-form');
      await expect(otp).toBeVisible();
      assert.equal(
        await countSessions(),
        0,
        'Password alone must not issue an API session.'
      );
      const validCodes = new Set(
        [-30_000, 0, 30_000].map((offset) => totp(secret, Date.now() + offset))
      );
      let invalid = '000000';
      while (validCodes.has(invalid))
        invalid = String(Number(invalid) + 1).padStart(6, '0');
      await otp.locator('[name="otp"]').fill(invalid);
      const rejectedOtp = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).hostname === 'auth.openg7.test'
      );
      await otp.locator('[type="submit"]').click();
      assert.equal((await rejectedOtp).status(), 200);
      await expect(otp).toBeVisible();
      assert.equal(
        await countSessions(),
        0,
        'An incorrect OTP must not issue an API session.'
      );
      await otp.locator('[name="otp"]').fill(totp(secret));
      await otp.locator('[type="submit"]').click();
      stage = 'secure hashed API session';
      await expect(page).toHaveURL(stack.origin + '/admin/fundraiser/access');
      await expect(page.locator('[data-og7="admin-access"]')).toBeVisible();
      // MFA_ACR is empty: acceptance relies on Keycloak's native signed AMR,
      // verified by the real API rather than a browser assertion or ACR exception.
      assert.equal(await countSessions(), 1);
      const sessionCookie = (await context.cookies(stack.origin)).find(
        (cookie) => cookie.name === '__Host-og7-admin'
      );
      assert.ok(
        sessionCookie,
        'A completed MFA login must issue the host-only admin cookie.'
      );
      assert.equal(sessionCookie.httpOnly, true);
      assert.equal(sessionCookie.secure, true);
      assert.equal(sessionCookie.sameSite, 'Lax');
      assert.equal(sessionCookie.path, '/');
      assert.equal(sessionCookie.domain, 'localhost');
      assert.ok(
        await page.evaluate(
          () => !document.cookie.includes('__Host-og7-admin')
        ),
        'JavaScript must not read the admin session cookie.'
      );
      const cookie = sessionCookie.name + '=' + sessionCookie.value;
      const current = await stack.exchange('/api/admin/auth/current', {
        cookie
      });
      assert.equal(current.status, 200);
      const profile = JSON.parse(current.body);
      assert.equal(profile.role, 'owner');
      const hash = await stack.sql(
        'SELECT token_hash FROM admin_identity_sessions;'
      );
      assert.ok(
        hash === createHash('sha256').update(sessionCookie.value).digest('hex'),
        'The DB must store the session hash, not the cookie token.'
      );
      assert.equal(
        await stack.sql(
          `SELECT subject FROM admin_accounts WHERE id='${profile.id}';`
        ),
        stack.ownerSubject
      );
      assert.equal(
        await stack.sql(
          "SELECT count(*) FROM admin_audit_log WHERE action='admin.session.created';"
        ),
        '1'
      );

      stage = 'session persistence after API restart';
      await stack.restartApi();
      const restored = await stack.exchange('/api/admin/auth/current', {
        cookie
      });
      assert.equal(restored.status, 200);
      assert.equal(JSON.parse(restored.body).sessionId, profile.sessionId);
      assert.equal(await countSessions(), 1);
      stage = 'confirmed session revocation';
      await page.reload();
      const session = page.locator(
        `[data-og7="admin-session"][data-og7-id="${profile.sessionId}"]`
      );
      await expect(session).toBeVisible();
      await session.getByRole('button').click();
      const confirmation = page.getByRole('group', {
        name: 'Révoquer la session'
      });
      await expect(confirmation).toContainText('Synthetic Administrator');
      await confirmation.getByRole('button', { name: 'Annuler' }).click();
      assert.equal(
        (await stack.exchange('/api/admin/auth/current', { cookie })).status,
        200
      );
      await session.getByRole('button').click();
      const revoked = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/api/admin/access' &&
          response.request().method() === 'POST'
      );
      await confirmation
        .getByRole('button', { name: 'Révoquer la session' })
        .click();
      assert.equal((await revoked).status(), 200);
      assert.equal(
        (await stack.exchange('/api/admin/auth/current', { cookie })).status,
        401,
        'The old HTTPS cookie must be refused after revocation.'
      );
      assert.equal(
        await stack.sql(
          'SELECT count(*) FROM admin_identity_sessions WHERE revoked_at IS NOT NULL;'
        ),
        '1'
      );
      assert.equal(
        await stack.sql(
          "SELECT count(*) FROM admin_audit_log WHERE action='admin.session.revoked';"
        ),
        '1'
      );
      assert.equal(
        errors.length,
        0,
        'The real browser must not report application errors.'
      );
    } catch {
      // Playwright errors may include authentication URLs or filled credentials.
      throw new Error(
        `Local HTTPS Keycloak failed at ${stage}; sensitive browser details are withheld.`
      );
    } finally {
      try {
        // No HAR, video or downloads need flushing. Closing the owning browser
        // closes this sole persistent context through Playwright's bounded
        // browser-process close-or-kill path (30 seconds in the pinned version).
        if (context) {
          const browser = context.browser();
          assert.ok(browser, 'The fixture must own its Chromium browser.');
          await browser.close({
            reason: 'Local HTTPS identity fixture finished.'
          });
        }
      } finally {
        await stack.stop();
      }
    }
  }
);
