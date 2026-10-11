import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
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
  'local HTTPS Keycloak provisions an owner, preserves credentials on replay, loads resources, enrolls OTP and maintains revocable API sessions',
  { timeout: 360_000 },
  async () => {
    const stack = await startLocalKeycloakHttpsStack({ provisionUser: true });
    let context;
    let page;
    let applicationStatus;
    let stage = 'new owner provisioning and preparation replay';
    try {
      assert.ok(stack.provisioned?.created);
      const prepared = await stack.snapshotUser();
      assert.ok(prepared.subject === stack.ownerSubject);
      assert.equal(prepared.username, 'synthetic-local-owner');
      assert.equal(prepared.enabled, true);
      assert.deepEqual(prepared.actions, ['CONFIGURE_TOTP', 'UPDATE_PASSWORD']);
      assert.deepEqual(prepared.credentialTypes, ['password']);
      assert.ok(!prepared.roles.includes('admin'));
      const replayed = await stack.reprovision({ password: stack.password });
      assert.equal(replayed.result.created, false);
      assert.ok(replayed.result.subject === stack.ownerSubject);
      assert.ok(replayed.ownerSubjects === stack.ownerSubject);
      assert.ok(
        (await stack.snapshotUser()).fingerprint === prepared.fingerprint,
        'Replaying provisioning must preserve the temporary password, actions and identity.'
      );

      stage = 'unenrolled owner is refused by the deployment enrollment check';
      await assert.rejects(
        stack.reprovision({ requireEnrollment: true }),
        /enroll|OTP|MFA|required action/i
      );
      assert.ok(
        (await stack.snapshotUser()).fingerprint === prepared.fingerprint,
        'Refusing an unenrolled owner must preserve its account and credentials.'
      );

      stage = 'console resource burst';
      const consolePage = await stack.exchange('/admin/master/console/', {
        provider: true
      });
      assert.equal(consolePage.status, 200);
      const resource = Array.from(
        consolePage.body.matchAll(/<script\b[^>]*\ssrc=(["'])(.*?)\1/gi),
        (match) => match[2]
      ).find(
        (path) => path.startsWith('/resources/') && /\.js(?:\?|$)/.test(path)
      );
      assert.ok(resource, 'The console must reference a public script.');
      // A cold console loads more modules than an authentication burst allows.
      // Eight workers keep the burst below the independent in-flight bound.
      const workers = await Promise.allSettled(
        Array.from({ length: 8 }, async () => {
          const responses = [];
          for (let index = 0; index < 6; index++) {
            const response = await stack.exchange(resource, { provider: true });
            responses.push({
              status: response.status,
              contentType: response.headers['content-type'],
              noSniff: response.headers['x-content-type-options']
            });
          }
          return responses;
        })
      );
      for (const worker of workers) {
        assert.equal(worker.status, 'fulfilled');
        for (const response of worker.value) {
          assert.equal(response.status, 200);
          assert.match(
            response.contentType || '',
            /^(?:application|text)\/javascript(?:;|$)/i
          );
          assert.equal(response.noSniff, 'nosniff');
        }
      }

      stage = 'browser startup';
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
      page = context.pages()[0];
      page.setDefaultTimeout(10_000);
      const errors = [];
      page.on('pageerror', () => errors.push(true));
      const countSessions = async () =>
        Number(
          await stack.sql('SELECT count(*) FROM admin_identity_sessions;')
        );
      const login = async (phase, password = stack.password) => {
        stage = `${phase}: OpenG7 login page`;
        const response = await page.goto(
          stack.origin +
            '/admin/login?returnUrl=' +
            encodeURIComponent('/admin/fundraiser/access')
        );
        applicationStatus = response?.status();
        assert.equal(applicationStatus, 200);
        stage = `${phase}: OIDC sign-in navigation`;
        await page.locator('[data-og7="identity-sign-in"]').click();
        stage = `${phase}: Keycloak password form`;
        await expect(page.locator('#kc-form-login')).toBeVisible();
        await page.locator('[name="username"]').fill('synthetic-local-owner');
        await page.locator('[name="password"]').fill(password);
        stage = `${phase}: Keycloak password submission`;
        await page.locator('#kc-login').click();
      };

      const updatePassword = page.locator('#kc-passwd-update-form');
      const updateProfile = page.locator('form:has(input[name="firstName"])');
      const setPersonalPassword = async () => {
        stage = 'personal password update form';
        await expect(updatePassword).toBeVisible();
        await updatePassword
          .locator('[name="password-new"]')
          .fill(stack.password);
        await updatePassword
          .locator('[name="password-confirm"]')
          .fill(stack.password);
        stage = 'personal password update submission';
        await updatePassword.locator('[type="submit"]').click();
      };
      const setPersonalProfile = async () => {
        stage = 'personal profile setup';
        await expect(updateProfile).toBeVisible();
        await updateProfile
          .locator('[name="firstName"]')
          .fill('synthetic-local-owner');
        await updateProfile.locator('[name="lastName"]').fill('Synthetic');
        const email = updateProfile.locator('[name="email"]');
        if (await email.count())
          await email.fill('synthetic-local-owner@example.test');
        await updateProfile.locator('[type="submit"]').click();
      };
      const waitForPersonalAction = async (afterEnrollment = false) => {
        await page.waitForFunction(
          (allowCallback) =>
            document.querySelector(
              '#kc-passwd-update-form, #kc-totp-settings-form, form:has(input[name="firstName"])'
            ) ||
            (allowCallback && location.pathname === '/admin/login'),
          afterEnrollment
        );
      };
      const completePasswordAndProfile = async (afterEnrollment = false) => {
        // The optional provider profile may appear before or after the explicit
        // password/OTP actions. Only the synthetic browser supplies its values.
        for (let index = 0; index < 3; index++) {
          await waitForPersonalAction(afterEnrollment);
          if (await updatePassword.isVisible()) await setPersonalPassword();
          else if (await updateProfile.isVisible()) await setPersonalProfile();
          else return;
        }
        throw new Error('The provider repeated a personal setup action.');
      };
      await login('OTP enrollment', stack.initialPassword);
      // Keycloak decides the ordering of these two required actions. Neither
      // the provisioner nor deployment may finish the personal enrollment.
      stage = 'initial password or OTP action';
      await completePasswordAndProfile();
      stage = 'OTP enrollment form';
      const enrollment = page.locator('#kc-totp-settings-form');
      await expect(enrollment).toBeVisible();
      const secret = await enrollment
        .locator('[name="totpSecret"]')
        .inputValue();
      assert.ok(
        secret.length > 0,
        'The provider must supply an enrollment secret.'
      );
      stage = 'OTP enrollment submission';
      await enrollment.locator('[name="totp"]').fill(totp(secret));
      await enrollment
        .locator('[name="userLabel"]')
        .fill('Synthetic HTTPS authenticator');
      await enrollment.locator('[type="submit"]').click();
      stage = 'remaining personal password action or first callback';
      await completePasswordAndProfile(true);
      // Enrollment itself did not execute the required OTP authentication step:
      // the signed provider claims must not authorize an OpenG7 session yet.
      stage = 'first callback rejects enrollment-only MFA';
      await expect(page).toHaveURL(/\/admin\/login\?identityError=1/);
      stage = 'enrollment session refusal';
      assert.equal(await countSessions(), 0);
      assert.ok(
        !(await context.cookies(stack.origin)).some(
          (cookie) => cookie.name === '__Host-og7-admin'
        ),
        'Enrollment alone must not issue an admin cookie.'
      );

      // Keycloak forbids reuse of an OTP step, including the enrollment code.
      await setTimeout(30_000 - (Date.now() % 30_000) + 50);
      await login('mandatory password and OTP');
      stage = 'mandatory OTP form';
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
      stage = 'incorrect OTP submission';
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
      stage = 'correct OTP submission';
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

      stage = 'existing owner adoption preserves personal password and OTP';
      const enrolled = await stack.snapshotUser();
      assert.deepEqual(enrolled.actions, []);
      assert.deepEqual(enrolled.credentialTypes, ['otp', 'password']);
      const existingOwners = stack.ownerSubject + ',' + randomUUID();
      const adopted = await stack.reprovision({
        adoption: true,
        ownerSubjects: existingOwners,
        password: randomBytes(24).toString('hex'),
        requireEnrollment: true
      });
      assert.equal(adopted.result.created, false);
      assert.ok(adopted.result.subject === stack.ownerSubject);
      assert.ok(adopted.ownerSubjects === existingOwners);
      assert.ok(
        (await stack.snapshotUser()).fingerprint === enrolled.fingerprint,
        'Adopting a confirmed existing owner must preserve the password, OTP, actions and identity.'
      );
      stage = 'provisioning state replay preserves enrolled owner';
      const restoredOwner = await stack.reprovision({
        password: randomBytes(24).toString('hex'),
        requireEnrollment: true
      });
      assert.equal(restoredOwner.result.created, false);
      assert.ok(restoredOwner.result.subject === stack.ownerSubject);
      assert.ok(restoredOwner.ownerSubjects === stack.ownerSubject);
      assert.ok(
        (await stack.snapshotUser()).fingerprint === enrolled.fingerprint,
        'Replaying after OTP enrollment must preserve the established credentials.'
      );

      stage = 'restricted service client preparation';
      const provisioningClient = await stack.prepareProvisioningClient();
      stage = 'service client replay preserves enrolled owner';
      const serviceReplay = await stack.reprovision({
        password: randomBytes(24).toString('hex'),
        requireEnrollment: true,
        provisioningClient
      });
      assert.equal(serviceReplay.result.created, false);
      assert.ok(serviceReplay.result.subject === stack.ownerSubject);
      assert.ok(serviceReplay.ownerSubjects === stack.ownerSubject);
      assert.ok(
        (await stack.snapshotUser()).fingerprint === enrolled.fingerprint,
        'A restricted provisioning service must preserve the personal password and OTP without bootstrap authentication.'
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
      await expect(confirmation).toContainText('synthetic-local-owner');
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
      // Only status/count metadata is included; never provider URLs or inputs.
      const configStatus = await stack
        .exchange('/api/admin/auth/config')
        .then(({ status }) => status)
        .catch(() => 'unavailable');
      const signInCount = page
        ? await page
            .locator('[data-og7="identity-sign-in"]')
            .count()
            .catch(() => 'unavailable')
        : 'unavailable';
      const personalProfilePresent = page
        ? await page
            .locator('form:has(input[name="firstName"])')
            .count()
            .then((count) => count > 0)
            .catch(() => 'unavailable')
        : 'unavailable';
      const accessPagePresent = page
        ? await page
            .locator('[data-og7="admin-access"]')
            .count()
            .then((count) => count > 0)
            .catch(() => 'unavailable')
        : 'unavailable';
      throw new Error(
        `Local HTTPS Keycloak failed at ${stage} (page status ${applicationStatus ?? 'unavailable'}, auth config status ${configStatus}, sign-in count ${signInCount}, personal profile ${personalProfilePresent}, access page ${accessPagePresent}); sensitive browser details are withheld.`
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
