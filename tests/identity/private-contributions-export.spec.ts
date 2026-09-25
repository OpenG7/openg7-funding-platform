import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { test, expect, type BrowserContext, type Page } from '@playwright/test';

import { startIdentityStack } from './stack.mjs';

test('private CSV: filtered confirmation, concurrent change, audit failure, download, roles and expired session', async ({
  playwright
}, info) => {
  const stack = await startIdentityStack();
  const contexts: BrowserContext[] = [];
  const anonymous = await playwright.request.newContext({
    baseURL: stack.origin
  });
  const open = async (subject: string): Promise<Page> => {
    const context = await playwright.chromium.launchPersistentContext(
      await mkdtemp(join(tmpdir(), 'og7-export-browser-')),
      {
        baseURL: stack.origin,
        viewport: { width: 1280, height: 1000 }
      }
    );
    contexts.push(context);
    const page = context.pages()[0]!;
    page.setDefaultTimeout(10000);
    await page.goto(
      '/admin/login?returnUrl=' +
        encodeURIComponent('/admin/fundraiser/contributions')
    );
    await page.locator('[data-og7="identity-sign-in"]').click();
    await page.getByLabel('Compte de test').selectOption(subject);
    await page.getByRole('button', { name: 'Continuer' }).click();
    await expect(page).toHaveURL(/\/admin\/fundraiser\/contributions/);
    return page;
  };
  try {
    const ids = Array.from({ length: 5 }, () => randomUUID());
    const names = [
      '=1+1',
      'Entreprise, "Québec"\nLigne 2',
      'Excluded pending',
      'Excluded sponsorship',
      'Excluded public'
    ];
    for (let i = 0; i < ids.length; i++)
      await stack.pool.query(
        `INSERT INTO fund_contributions
      (id,contribution_type,amount_cents,currency,status,public_name,email_private,public_display_consent,sponsor_review_note)
      VALUES($1,$2,$3,'cad',$4,$5,$6,$7,'PRIVATE_NOTE_NEVER_EXPORT')`,
        [
          ids[i],
          i === 3 ? 'sponsorship_interest' : 'personal_support',
          4250 + i,
          i === 2 ? 'pending' : 'paid',
          names[i],
          `export-fixture-${i}@simulation.example.test`,
          i === 4
        ]
      );
    const owner = await open('owner');
    const profile = await (
      await owner.request.get('/api/admin/auth/current')
    ).json();
    const exports = () =>
      stack.pool.query(
        "SELECT actor,metadata FROM admin_audit_log WHERE action='contributions.export' ORDER BY created_at,id"
      );
    const selection = async () => ({
      confirmation: 'export_private_contributions',
      contributions: (
        await stack.pool.query(
          'SELECT id,updated_at::text AS "expectedVersion" FROM fund_contributions WHERE id=ANY($1::uuid[])',
          [ids.slice(0, 2)]
        )
      ).rows
    });
    let downloads = 0;
    owner.on('download', () => downloads++);
    const errors: string[] = [];
    owner.on('pageerror', (error) => errors.push(error.message));
    const button = owner.locator('[data-og7="contribution-export"]');
    const confirm = owner.locator('[data-og7="confirm-action"]');

    await test.step('API rejects anonymous reads, legacy GET and unconfirmed selections', async () => {
      for (const path of [
        '/api/admin/contributions.csv',
        stack.apiOrigin + '/admin/contributions.csv'
      ]) {
        expect(
          (await anonymous.post(path, { data: await selection() })).status()
        ).toBe(401);
        expect((await anonymous.get(path)).status()).toBe(401);
        const legacy = await owner.request.get(path);
        expect(legacy.status()).toBe(405);
        expect(legacy.headers()['cache-control']).toContain('no-store');
      }
      for (const data of [
        {},
        { confirmation: true, contributions: [] },
        { ...(await selection()), confirmation: undefined }
      ]) {
        expect(
          (
            await owner.request.post('/api/admin/contributions.csv', {
              headers: { Origin: stack.origin },
              data
            })
          ).status()
        ).toBe(400);
      }
      expect(
        (
          await owner.request.post('/api/admin/contributions.csv', {
            headers: { Origin: 'https://elsewhere.example.test' },
            data: await selection()
          })
        ).status()
      ).toBe(403);
      expect((await exports()).rows).toHaveLength(0);
    });

    await owner.getByLabel('Recherche', { exact: true }).fill('export-fixture');
    await owner
      .getByRole('combobox', { name: /^Type/ })
      .selectOption('personal_support');
    await owner.getByLabel('Statut paiement').selectOption('paid');
    await owner.getByLabel('Affichage public').selectOption('private');
    await expect(
      owner.locator('[data-og7="contributions-list"] tbody tr')
    ).toHaveCount(2);
    await expect(
      owner.locator('[data-og7="contribution-export-scope"]')
    ).toContainText('2 contributions');
    await expect(
      owner.locator('[data-og7="contribution-export-scope"]')
    ).toContainText('250');

    await test.step('cancel and stale version do not download or audit an export', async () => {
      await button.click();
      await expect(owner.getByRole('dialog')).toContainText(
        'données privées des 2 contributions'
      );
      await expect(button).toBeDisabled();
      await owner.keyboard.press('Escape');
      await expect(button).toBeEnabled();
      expect(downloads).toBe(0);
      await button.click();
      await stack.pool.query(
        "UPDATE fund_contributions SET updated_at=updated_at+interval '1 microsecond' WHERE id=$1",
        [ids[0]]
      );
      const response = owner.waitForResponse((r) =>
        r.url().endsWith('/admin/contributions.csv')
      );
      await confirm.click();
      expect((await response).status()).toBe(409);
      await expect(
        owner.locator('[data-og7="contribution-export-error"]')
      ).toContainText('La sélection a changé');
      expect(downloads).toBe(0);
      expect((await exports()).rows).toHaveLength(0);
      await owner
        .getByRole('button', { name: 'Actualiser', exact: true })
        .click();
      await expect(button).toBeEnabled();
    });

    await test.step('audit failure prevents download; recovery exports exactly the confirmed rows', async () => {
      await stack.pool
        .query(`CREATE FUNCTION reject_export_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.action='contributions.export' THEN RAISE EXCEPTION 'SYNTHETIC_AUDIT_FAILURE'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER reject_export_audit BEFORE INSERT ON admin_audit_log FOR EACH ROW EXECUTE FUNCTION reject_export_audit()`);
      await button.click();
      const failed = owner.waitForResponse((r) =>
        r.url().endsWith('/admin/contributions.csv')
      );
      await confirm.click();
      expect((await failed).status()).toBe(503);
      await expect(
        owner.locator('[data-og7="contribution-export-error"]')
      ).toContainText('Aucun fichier');
      expect(downloads).toBe(0);
      expect((await exports()).rows).toHaveLength(0);
      await stack.pool.query(
        'DROP TRIGGER reject_export_audit ON admin_audit_log'
      );
      await button.click();
      const download = owner.waitForEvent('download');
      const response = owner.waitForResponse((r) =>
        r.url().endsWith('/admin/contributions.csv')
      );
      await confirm.focus();
      await owner.keyboard.press('Enter');
      const file = await download;
      expect(file.suggestedFilename()).toBe('openg7-admin-contributions.csv');
      const chunks: Buffer[] = [];
      for await (const chunk of await file.createReadStream())
        chunks.push(chunk as Buffer);
      const csv = Buffer.concat(chunks).toString('utf8');
      expect(csv).toContain('"\'=1+1"');
      expect(csv).toContain('"Entreprise, ""Québec""\nLigne 2"');
      for (const id of ids.slice(0, 2)) expect(csv).toContain(id);
      for (const id of ids.slice(2)) expect(csv).not.toContain(id);
      expect(csv).not.toContain('PRIVATE_NOTE_NEVER_EXPORT');
      expect(csv).not.toContain('token');
      const delivered = await response;
      expect(delivered.headers()['cache-control']).toContain('no-store');
      const audit = (await exports()).rows;
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        actor: `admin:${profile.id}`,
        metadata: {
          result: 'generated',
          count: 2,
          requestId: delivered.headers()['x-request-id']
        }
      });
      expect(JSON.stringify(audit)).not.toMatch(
        /export-fixture|PRIVATE_NOTE|Québec/
      );
      expect(downloads).toBe(1);
      await info.attach('private-export-receipt', {
        body: JSON.stringify(audit[0]),
        contentType: 'application/json'
      });
    });

    await test.step('reader and operator cannot export even with a confirmed request', async () => {
      for (const role of ['operator', 'reader']) {
        const subject = 'fixture-' + role;
        expect(
          (
            await owner.request.post('/api/admin/access', {
              headers: { Origin: stack.origin },
              data: {
                subject,
                confirmation: subject,
                displayName: role,
                role,
                disabled: false
              }
            })
          ).status()
        ).toBe(200);
        const restricted = await open(role);
        await expect(
          restricted.locator('[data-og7="contribution-export"]')
        ).toBeDisabled();
        for (const path of [
          '/api/admin/contributions.csv',
          stack.apiOrigin + '/admin/contributions.csv'
        ]) {
          expect(
            (
              await restricted.request.post(path, {
                headers: { Origin: stack.origin },
                data: await selection()
              })
            ).status()
          ).toBe(403);
        }
      }
      expect((await exports()).rows).toHaveLength(1);
    });

    await test.step('English mobile, empty selection and expiry while confirming preserve the private boundary', async () => {
      await owner
        .getByRole('button', {
          name: 'Switch administration language to English'
        })
        .click();
      await owner.setViewportSize({ width: 390, height: 844 });
      await owner.getByLabel('Search', { exact: true }).fill('no-match-export');
      await expect(button).toBeDisabled();
      await owner.getByLabel('Search', { exact: true }).fill('export-fixture');
      await button.click();
      await expect(owner.getByRole('dialog')).toContainText(
        '2 displayed contributions'
      );
      await stack.pool.query(
        "UPDATE admin_identity_sessions SET expires_at=now()-interval '1 second' WHERE id=$1",
        [profile.sessionId]
      );
      const expired = owner.waitForResponse((r) =>
        r.url().endsWith('/admin/contributions.csv')
      );
      await confirm.click();
      expect((await expired).status()).toBe(401);
      await expect(
        owner.locator('[data-og7="contribution-export-error"]')
      ).toContainText('session has expired');
      expect(downloads).toBe(1);
      expect((await exports()).rows).toHaveLength(1);
      expect(
        await owner.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1
        )
      ).toBe(true);
      expect(errors).toEqual([]);
    });
  } finally {
    await anonymous.dispose();
    await Promise.all(contexts.map((context) => context.close()));
    await stack.stop();
  }
});
