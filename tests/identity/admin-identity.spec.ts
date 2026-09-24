import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { test, expect, type BrowserContext, type Page } from '@playwright/test';

import { startIdentityStack } from './stack.mjs';

const login = async (
  page: Page,
  subject: string,
  returnUrl = '/admin/fundraiser/sponsors'
) => {
  await page.goto('/admin/login?returnUrl=' + encodeURIComponent(returnUrl));
  await page.locator('[data-og7="identity-sign-in"]').click();
  await page.getByLabel('Compte de test').selectOption(subject);
  await page.getByRole('button', { name: 'Continuer' }).click();
};
const current = async (page: Page) =>
  (await page.request.get('/api/admin/auth/current')).json();
const saveAccount = async (
  page: Page,
  subject: string,
  name: string,
  role: string
) => {
  await page
    .getByRole('button', { name: 'Nouveau compte', exact: true })
    .click();
  await page.getByLabel('Identifiant du fournisseur').fill(subject);
  await page.getByLabel('Nom affiché', { exact: true }).fill(name);
  await page.getByRole('combobox', { name: /^Rôle/ }).selectOption(role);
  await page.getByLabel('Je confirme ce changement').check();
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith('/api/admin/access') && r.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Enregistrer les accès' }).click();
  expect((await response).status()).toBe(200);
  await expect(
    page.locator('[data-og7="admin-account"]').filter({ hasText: name })
  ).toHaveCount(1);
};

test('owner creates roles, operator reviews, role withdrawal blocks an open action, sessions revoke individually and expire', async ({
  playwright
}, testInfo) => {
  const stack = await startIdentityStack();
  const contexts: BrowserContext[] = [];
  const open = async (width = 1280) => {
    const profile = await mkdtemp(join(tmpdir(), 'og7-identity-browser-'));
    const context = await playwright.chromium.launchPersistentContext(profile, {
      baseURL: stack.origin,
      viewport: { width, height: 1000 }
    });
    contexts.push(context);
    return context.pages()[0] ?? (await context.newPage());
  };
  try {
    const owner = await open(),
      operator = await open(),
      reader = await open(390),
      otherReader = await open();
    const id = randomUUID();
    await stack.pool.query(
      `INSERT INTO fund_contributions
      (id,contribution_type,amount_cents,currency,status,public_reference,sponsor_company_name,sponsor_review_status,sponsor_details_submitted_at)
      VALUES($1,'sponsorship_interest',50000,'cad','paid','OG7-IDENTITY-FIXTURE','Entreprise accès simulés','pending_review',NOW())`,
      [id]
    );
    // The identity recipe starts with an existing paid dossier and reviewed media,
    // as does the Docker seed. It does not qualify payment or media storage.
    await stack.pool.query(
      `INSERT INTO sponsor_media_assets
      (contribution_id,kind,review_status,uploaded_by,original_filename,original_mime_type,
       original_size_bytes,original_storage_key,processed_size_bytes,processed_storage_key,
       public_storage_key,public_url,checksum_sha256,width,height,alt_text,reviewed_at,reviewed_by)
      VALUES($1,'supporting_image','approved','admin','identity.png','image/png',68,
       'identity/original.png',44,'identity/processed.webp','identity/public.webp',
       'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAA==',
       repeat('a',64),1,1,'Image de recette',NOW(),'identity-fixture')`,
      [id]
    );
    const before = (
      await stack.pool.query(
        'SELECT amount_cents,status,sponsor_feed_status FROM fund_contributions WHERE id=$1',
        [id]
      )
    ).rows[0];

    await test.step('Owner signs in through signed OIDC and creates operator and reader accounts through the UI', async () => {
      await login(owner, 'owner', '/admin/fundraiser/access');
      await expect(owner.getByRole('heading', { level: 1 })).toHaveText(
        'Accès et sessions'
      );
      await saveAccount(
        owner,
        'fixture-operator',
        'Opérateur de recette',
        'operator'
      );
      await saveAccount(
        owner,
        'fixture-reader',
        'Lecteur de recette',
        'reader'
      );
      const profile = await current(owner);
      expect(profile.role).toBe('owner');
      const cookies = await owner.context().cookies();
      expect(cookies.find((c) => c.name === 'og7-admin')).toMatchObject({
        httpOnly: true,
        sameSite: 'Lax'
      });
      expect(await owner.evaluate(() => document.cookie)).not.toContain(
        'og7-admin='
      );
      expect(
        await owner.evaluate(() =>
          sessionStorage.getItem('openg7-admin-session-token')
        )
      ).toBe('openg7-admin-session.cookie');
      for (const body of [
        {
          subject: 'fixture-forbidden',
          displayName: 'No confirmation',
          role: 'owner',
          disabled: false
        },
        { sessionId: profile.sessionId, confirmation: 'another-session' }
      ]) {
        const response = await owner.request.post('/api/admin/access', {
          headers: { Origin: stack.origin },
          data: body
        });
        expect(response.status()).toBe(400);
        expect(await response.json()).toMatchObject({
          code: 'CONFIRMATION_REQUIRED'
        });
      }
      expect(
        (
          await owner.request.post('/api/admin/access', {
            data: {
              sessionId: profile.sessionId,
              confirmation: profile.sessionId
            }
          })
        ).status()
      ).toBe(403);
      expect(
        (
          await stack.pool.query(
            "SELECT 1 FROM admin_accounts WHERE subject='fixture-forbidden'"
          )
        ).rowCount
      ).toBe(0);
      expect(
        (await owner.request.get('/api/admin/auth/current')).status()
      ).toBe(200);
    });

    await test.step('The last owner is protected and changing a confirmed draft requires confirmation again', async () => {
      const profile = await current(owner);
      await owner
        .locator(`[data-og7="admin-account"][data-og7-id="${profile.id}"]`)
        .getByRole('button')
        .click();
      await owner
        .getByRole('combobox', { name: /^Rôle/ })
        .selectOption('reader');
      await owner.getByLabel('Je confirme ce changement').check();
      await owner.getByLabel('Désactivé', { exact: true }).check();
      await expect(
        owner.getByRole('button', { name: 'Enregistrer les accès' })
      ).toBeDisabled();
      await owner.getByLabel('Je confirme ce changement').check();
      await owner
        .getByRole('button', { name: 'Enregistrer les accès' })
        .click();
      await expect(owner.getByRole('alert')).toContainText(
        'Conservez au moins un propriétaire actif'
      );
      expect((await current(owner)).role).toBe('owner');
      expect(
        (
          await stack.pool.query(
            'SELECT disabled,role FROM admin_accounts WHERE id=$1',
            [profile.id]
          )
        ).rows[0]
      ).toEqual({ disabled: false, role: 'owner' });
    });

    await login(
      operator,
      'operator',
      `/admin/fundraiser/sponsors?sponsorshipId=${id}`
    );
    await login(
      reader,
      'reader',
      `/admin/fundraiser/sponsors?sponsorshipId=${id}`
    );
    await login(
      otherReader,
      'operator',
      `/admin/fundraiser/sponsors?sponsorshipId=${id}`
    );
    const opProfile = await current(operator),
      readerProfile = await current(reader),
      secondOpProfile = await current(otherReader);

    await test.step('Reader can inspect but cannot mutate; operator cannot access owner-only operations', async () => {
      expect(opProfile.role).toBe('operator');
      expect(readerProfile.role).toBe('reader');
      for (const page of [operator, reader]) {
        for (const path of [
          '/api/admin/access',
          '/api/admin/contributions.csv',
          '/api/admin/setup-status'
        ])
          expect((await page.request.get(path)).status()).toBe(403);
        expect(
          (
            await page.request.post('/api/admin/sponsorships/refund', {
              headers: { Origin: stack.origin },
              data: { contributionId: id }
            })
          ).status()
        ).toBe(403);
        expect(
          (
            await page.request.post('/api/admin/access', {
              headers: { Origin: stack.origin },
              data: {
                subject: 'fixture-owner',
                confirmation: 'fixture-owner',
                displayName: 'Escalation',
                role: 'owner',
                disabled: true
              }
            })
          ).status()
        ).toBe(403);
      }
      expect(
        (
          await reader.request.post('/api/admin/sponsorships/review', {
            headers: { Origin: stack.origin },
            data: { contributionId: id, reviewStatus: 'approved' }
          })
        ).status()
      ).toBe(403);
      await reader.goto('/admin/fundraiser/access');
      await expect(reader.getByRole('alert')).toContainText(
        'réservée aux propriétaires'
      );
      await expect(reader.locator('form')).toHaveCount(0);
      expect(
        (await reader.request.get('/api/admin/auth/current')).status()
      ).toBe(200);
      await reader.goto(`/admin/fundraiser/sponsors?sponsorshipId=${id}`);
      await expect(
        operator.getByRole('button', { name: 'Accepter', exact: true })
      ).toBeVisible();
      await operator
        .getByRole('button', { name: 'Accepter', exact: true })
        .click();
      await expect(
        operator.getByText('Action confirmee: commandite acceptee.')
      ).toBeVisible();
      expect(
        (
          await stack.pool.query(
            'SELECT sponsor_review_status FROM fund_contributions WHERE id=$1',
            [id]
          )
        ).rows[0].sponsor_review_status
      ).toBe('approved');
      expect(
        (
          await stack.pool.query(
            'SELECT 1 FROM admin_audit_log WHERE actor=$1 AND entity_id=$2',
            [`admin:${opProfile.id}`, id]
          )
        ).rowCount
      ).toBeGreaterThan(0);
    });

    await test.step('Withdraw the operator role while its confirmed request is held before reaching the API', async () => {
      await operator
        .getByRole('button', { name: 'Remettre en attente' })
        .click();
      let release!: () => void, intercepted!: () => void;
      const held = new Promise<void>((resolve) => {
        intercepted = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await operator.route(
        '**/api/admin/sponsorships/review',
        async (route) => {
          intercepted();
          await gate;
          await route.continue();
        }
      );
      const refused = operator.waitForResponse(
        (r) =>
          r.url().endsWith('/api/admin/sponsorships/review') &&
          r.status() === 401
      );
      await operator.locator('[data-og7="confirm-action"]').click();
      await held;
      try {
        await owner.reload();
        await owner
          .locator(`[data-og7="admin-account"][data-og7-id="${opProfile.id}"]`)
          .getByRole('button')
          .click();
        await owner
          .getByRole('combobox', { name: /^Rôle/ })
          .selectOption('reader');
        await owner.getByLabel('Je confirme ce changement').check();
        const changed = owner.waitForResponse(
          (r) =>
            r.url().endsWith('/api/admin/access') &&
            r.request().method() === 'POST'
        );
        await owner
          .getByRole('button', { name: 'Enregistrer les accès' })
          .click();
        expect((await changed).status()).toBe(200);
      } finally {
        release();
      }
      await refused;
      await expect(operator).toHaveURL(/\/admin\/login\?/);
      await expect(operator.getByRole('status')).toContainText(
        'expiré ou a été révoquée'
      );
      await expect(
        operator.getByText('Entreprise accès simulés', { exact: true })
      ).toHaveCount(0);
      expect(
        await operator.evaluate(() =>
          sessionStorage.getItem('openg7-admin-session-token')
        )
      ).toBeNull();
      expect(
        (
          await stack.pool.query(
            'SELECT sponsor_review_status FROM fund_contributions WHERE id=$1',
            [id]
          )
        ).rows[0].sponsor_review_status
      ).toBe('approved');
      expect(
        (
          await stack.pool.query(
            'SELECT 1 FROM admin_identity_sessions WHERE account_id=$1 AND revoked_at IS NULL',
            [opProfile.id]
          )
        ).rowCount
      ).toBe(0);
      expect(secondOpProfile.id).toBe(opProfile.id);
      expect(secondOpProfile.sessionId).not.toBe(opProfile.sessionId);
      expect(
        (await otherReader.request.get('/api/admin/auth/current')).status()
      ).toBe(401);
      await operator.unroute('**/api/admin/sponsorships/review');
      await login(operator, 'operator');
      expect((await current(operator)).role).toBe('reader');
      expect(
        (
          await operator.request.post('/api/admin/sponsorships/review', {
            headers: { Origin: stack.origin },
            data: { contributionId: id, reviewStatus: 'pending_review' }
          })
        ).status()
      ).toBe(403);
    });

    await login(
      otherReader,
      'reader',
      `/admin/fundraiser/sponsors?sponsorshipId=${id}`
    );
    const otherProfile = await current(otherReader);

    await test.step('Cancel then confirm one session revocation; replay keeps a single audit and the other reader session works', async () => {
      await owner.reload();
      const session = owner.locator(
        `[data-og7="admin-session"][data-og7-id="${readerProfile.sessionId}"]`
      );
      await session.getByRole('button').click();
      const confirmation = owner.getByRole('group', {
        name: 'Révoquer la session'
      });
      await expect(confirmation).toContainText('Lecteur de recette');
      await confirmation.getByRole('button', { name: 'Annuler' }).click();
      expect(
        (await reader.request.get('/api/admin/auth/current')).status()
      ).toBe(200);
      await session.getByRole('button').click();
      await confirmation
        .getByRole('button', { name: 'Révoquer la session' })
        .click();
      await expect(session).toHaveCount(0);
      expect(
        (await reader.request.get('/api/admin/auth/current')).status()
      ).toBe(401);
      expect(
        (await otherReader.request.get('/api/admin/auth/current')).status()
      ).toBe(200);
      for (let i = 0; i < 2; i++)
        expect(
          (
            await owner.request.post('/api/admin/access', {
              headers: { Origin: stack.origin },
              data: {
                sessionId: readerProfile.sessionId,
                confirmation: readerProfile.sessionId
              }
            })
          ).status()
        ).toBe(200);
      expect(
        (
          await stack.pool.query(
            "SELECT 1 FROM admin_audit_log WHERE action='admin.session.revoked' AND entity_id=$1",
            [readerProfile.sessionId]
          )
        ).rowCount
      ).toBe(1);
      await reader.reload();
      await expect(reader).toHaveURL(/\/admin\/login/);
      await stack.pool.query(
        "UPDATE admin_identity_sessions SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",
        [otherProfile.sessionId]
      );
      expect(
        (await otherReader.request.get('/api/admin/auth/current')).status()
      ).toBe(401);
      await otherReader.reload();
      await expect(otherReader).toHaveURL(/\/admin\/login/);
    });

    await test.step('Disabling a member blocks its active session and a new login; re-enabling requires a fresh sign-in', async () => {
      await owner.reload();
      const row = owner.locator(
        `[data-og7="admin-account"][data-og7-id="${opProfile.id}"]`
      );
      await row.getByRole('button').click();
      await owner.getByLabel('Désactivé', { exact: true }).check();
      await owner.getByLabel('Je confirme ce changement').check();
      await owner
        .getByRole('button', { name: 'Enregistrer les accès' })
        .click();
      await expect(row).toContainText('Désactivé');
      expect(
        (await operator.request.get('/api/admin/auth/current')).status()
      ).toBe(401);
      await login(operator, 'operator');
      await expect(operator).toHaveURL(/identityError=1/);
      await row.getByRole('button').click();
      await owner.getByLabel('Désactivé', { exact: true }).uncheck();
      await owner.getByLabel('Je confirme ce changement').check();
      await owner
        .getByRole('button', { name: 'Enregistrer les accès' })
        .click();
      await expect(row).not.toContainText('Désactivé');
      await login(operator, 'operator');
      const restored = await current(operator);
      expect(restored.role).toBe('reader');
      await operator
        .getByRole('button', { name: 'Déconnexion', exact: true })
        .click();
      await expect(operator).toHaveURL(/\/admin\/login$/);
      expect(
        (await operator.request.get('/api/admin/auth/current')).status()
      ).toBe(401);
      expect(
        (
          await stack.pool.query(
            'SELECT revoked_at FROM admin_identity_sessions WHERE id=$1',
            [restored.sessionId]
          )
        ).rows[0].revoked_at
      ).not.toBeNull();
    });

    await test.step('Expiring the owner session clears the access form on its next attempted save', async () => {
      const profile = await current(owner);
      await owner
        .getByRole('button', { name: 'Nouveau compte', exact: true })
        .click();
      await owner
        .getByLabel('Identifiant du fournisseur')
        .fill('fixture-expired-write');
      await owner
        .getByLabel('Nom affiché', { exact: true })
        .fill('Doit rester absent');
      await owner.getByLabel('Je confirme ce changement').check();
      await stack.pool.query(
        "UPDATE admin_identity_sessions SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",
        [profile.sessionId]
      );
      await owner
        .getByRole('button', { name: 'Enregistrer les accès' })
        .click();
      await expect(owner).toHaveURL(/\/admin\/login\?/);
      await expect(owner.getByRole('status')).toContainText(
        'expiré ou a été révoquée'
      );
      await expect(owner.locator('[data-og7="admin-access"]')).toHaveCount(0);
      expect(
        (
          await stack.pool.query(
            "SELECT 1 FROM admin_accounts WHERE subject='fixture-expired-write'"
          )
        ).rowCount
      ).toBe(0);
      expect(
        (
          await stack.pool.query(
            'SELECT amount_cents,status,sponsor_feed_status FROM fund_contributions WHERE id=$1',
            [id]
          )
        ).rows[0]
      ).toEqual(before);
      const audits = (
        await stack.pool.query(
          "SELECT actor,action,entity_id,metadata FROM admin_audit_log WHERE entity_type='admin_access'"
        )
      ).rows;
      expect(
        audits.some(
          (a) =>
            a.action === 'admin.account.updated' &&
            a.entity_id === opProfile.id &&
            a.metadata.role === 'reader'
        )
      ).toBe(true);
      const serialized = JSON.stringify(audits);
      for (const key of [
        'id_token',
        'client_secret',
        'code_verifier',
        'token_hash'
      ])
        expect(serialized).not.toContain(key);
      expect(
        (
          await stack.pool.query(
            'SELECT token_hash FROM admin_identity_sessions'
          )
        ).rows.every((r) => /^[a-f0-9]{64}$/.test(r.token_hash))
      ).toBe(true);
      await testInfo.attach('identity-audit-summary', {
        body: JSON.stringify({
          accounts: 3,
          reviewPreserved: true,
          auditActions: audits.map((a) => a.action)
        }),
        contentType: 'application/json'
      });
    });
  } finally {
    try {
      await Promise.all(contexts.map((context) => context.close()));
    } finally {
      await stack.stop();
    }
  }
});

test('OIDC refuses missing MFA, invalid signature, unknown member and provider outage without falling back to a root token', async ({
  playwright
}) => {
  const stack = await startIdentityStack();
  let context: BrowserContext | undefined;
  try {
    const profile = await mkdtemp(join(tmpdir(), 'og7-identity-denials-'));
    context = await playwright.chromium.launchPersistentContext(profile, {
      baseURL: stack.origin
    });
    const page = context.pages()[0] ?? (await context.newPage());
    // These two are members: their denial must come from MFA/signature checks.
    for (const subject of ['no-mfa', 'bad-signature'])
      await stack.pool.query(
        "INSERT INTO admin_accounts(issuer,subject,display_name,role) VALUES($1,$2,$2,'reader')",
        [stack.provider.issuer + '/', `fixture-${subject}`]
      );
    for (const subject of ['no-mfa', 'bad-signature', 'unknown']) {
      await login(page, subject);
      await expect(page).toHaveURL(/identityError=1/);
      await expect(page.getByRole('alert')).toContainText(
        'Connexion impossible'
      );
      expect((await page.request.get('/api/admin/auth/current')).status()).toBe(
        401
      );
    }
    await page.goto('/admin/login');
    await page.locator('[data-og7="identity-sign-in"]').click();
    await page.getByLabel('Compte de test').selectOption('owner');
    // The provider still authorizes the browser, but its token endpoint fails.
    stack.provider.setTokenAvailable(false);
    await page.getByRole('button', { name: 'Continuer' }).click();
    await expect(page).toHaveURL(/identityError=1/);
    expect(
      (
        await page.request.post('/api/admin/session', {
          data: { token: 'synthetic-root' }
        })
      ).status()
    ).toBe(403);
    expect(
      (
        await page.request.get('/api/admin/dashboard', {
          headers: { 'x-funding-admin-token': 'synthetic-root' }
        })
      ).status()
    ).toBe(401);
    await expect(page.getByLabel(/Jeton admin/i)).toHaveCount(0);
    expect(
      (await stack.pool.query('SELECT 1 FROM admin_identity_sessions')).rowCount
    ).toBe(0);
    expect(
      (
        await stack.pool.query(
          "SELECT 1 FROM admin_audit_log WHERE action='admin.sign_in.denied'"
        )
      ).rowCount
    ).toBe(4);
    stack.provider.setTokenAvailable(true);
    await login(page, 'owner', '/admin/fundraiser/access');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Accès et sessions'
    );
    expect((await current(page)).role).toBe('owner');
  } finally {
    try {
      await context?.close();
    } finally {
      await stack.stop();
    }
  }
});
