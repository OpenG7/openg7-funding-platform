import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test, expect, type BrowserContext, type Page } from '@playwright/test';

import { startIdentityStack } from './stack.mjs';

test('global search: historical dossiers, exact navigation, private queries, failures and expired identity', async ({
  playwright
}, info) => {
  const stack = await startIdentityStack();
  const contexts: BrowserContext[] = [];
  const anonymous = await playwright.request.newContext({
    baseURL: stack.origin
  });
  const open = async (subject: string) => {
    const context = await playwright.chromium.launchPersistentContext(
      await mkdtemp(join(tmpdir(), 'og7-search-browser-')),
      { baseURL: stack.origin, viewport: { width: 1280, height: 1000 } }
    );
    contexts.push(context);
    const page = context.pages()[0]!;
    page.setDefaultTimeout(10000);
    await page.goto(
      '/admin/login?returnUrl=%2Fadmin%2Ffundraiser%2Fcontributions'
    );
    await page.locator('[data-og7="identity-sign-in"]').click();
    await page.getByLabel('Compte de test').selectOption(subject);
    await page.getByRole('button', { name: 'Continuer' }).click();
    await expect(page).toHaveURL(/\/admin\/fundraiser\/contributions/);
    return page;
  };
  const dialog = (page: Page) => page.locator('[data-og7="admin-search"]');
  const search = async (page: Page, query: string) => {
    if (!(await dialog(page).isVisible())) {
      await page.locator('[data-og7="admin-search-open"]').click();
    }
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/admin/search') &&
        r.request().postDataJSON().query === query
    );
    await dialog(page).getByRole('searchbox').fill(query);
    return response;
  };
  try {
    const dossiers = ['Boréal', 'Rivage'].map((name, index) => ({
      id: randomUUID(),
      invoice: randomUUID(),
      draft: randomUUID(),
      name: 'Atelier recherche ' + name,
      reference: 'OG7-SEARCH-' + index,
      number: 'FAC-SEARCH-' + index,
      email: `private-search-${index}@simulation.example.test`
    }));
    await stack.pool.query(`INSERT INTO fund_contributions
      (contribution_type,amount_cents,currency,status,paid_at,sponsor_company_name)
      SELECT 'sponsorship_interest',25000,'cad','paid',now(),'Pagination recherche ' || i
      FROM generate_series(1,260) i`);
    for (const dossier of dossiers) {
      await stack.pool.query(
        `INSERT INTO fund_contributions
        (id,contribution_type,amount_cents,currency,status,paid_at,created_at,sponsor_company_name,
         email_private,public_reference,sponsor_review_note)
        VALUES($1,'sponsorship_interest',10050,'cad','paid','2020-01-01','2020-01-01',$2,$3,$4,'PRIVATE_SEARCH_NOTE')`,
        [dossier.id, dossier.name, dossier.email, dossier.reference]
      );
      await stack.pool.query(
        `INSERT INTO sponsorship_invoices
        (id,contribution_id,invoice_number,stripe_session_id,currency,subtotal_cents,total_cents,
         issuer_name,sponsor_name,sponsor_contact_email,issued_at)
        VALUES($1,$2,$3,$4,'cad',10050,10050,'OpenG7 simulation',$5,$6,'2020-01-01')`,
        [
          dossier.invoice,
          dossier.id,
          dossier.number,
          'cs_search_' + dossier.id,
          dossier.name,
          dossier.email
        ]
      );
      await stack.pool.query(
        `INSERT INTO sponsor_publication_drafts
        (id,contribution_id,feed_target,channel,title,body,disclosure_text,created_at)
        VALUES($1,$2,'openg7','facebook',$3,'PRIVATE_SEARCH_BODY','Simulation','2020-01-01')`,
        [dossier.draft, dossier.id, dossier.name]
      );
    }
    const owner = await open('owner');
    for (const role of ['reader', 'operator']) {
      expect(
        (
          await owner.request.post('/api/admin/access', {
            headers: { Origin: stack.origin },
            data: {
              subject: 'fixture-' + role,
              confirmation: 'fixture-' + role,
              role,
              displayName: role,
              disabled: false
            }
          })
        ).status()
      ).toBe(200);
    }
    const reader = await open('reader');
    const operator = await open('operator');
    const errors: string[] = [];
    reader.on('pageerror', (error) => errors.push(error.message));
    const effects = async () =>
      (
        await stack.pool.query(`SELECT
      (SELECT count(*) FROM email_messages) AS emails,
      (SELECT count(*) FROM admin_audit_log) AS audits,
      (SELECT count(*) FROM sponsor_publication_drafts) AS drafts,
      (SELECT count(*) FROM sponsorship_invoices) AS invoices,
      (SELECT sum(amount_cents) FROM fund_contributions) AS amount`)
      ).rows[0];
    const before = await effects();

    await test.step('private POST is authenticated, bounded, uncached and available to each read role', async () => {
      for (const path of [
        '/api/admin/search',
        stack.apiOrigin + '/admin/search'
      ]) {
        const denied = await anonymous.post(path, {
          data: { query: dossiers[0].email }
        });
        expect(denied.status()).toBe(401);
        expect(denied.headers()['cache-control']).toContain('no-store');
        for (const page of [owner, reader, operator]) {
          const response = await page.request.post(path, {
            headers: { Origin: stack.origin },
            data: { query: dossiers[0].email }
          });
          expect(response.status()).toBe(200);
          expect(response.headers()['cache-control']).toContain('no-store');
          const result = await response.json();
          expect(result.total).toBe(1);
          expect(result.groups[0].contributionId).toBe(dossiers[0].id);
          expect(JSON.stringify(result)).not.toMatch(
            /private-search|PRIVATE_SEARCH/
          );
        }
        expect((await owner.request.get(path)).status()).toBe(405);
        expect(
          (
            await reader.request.post(path, {
              headers: { Origin: 'https://elsewhere.example.test' },
              data: { query: 'Atelier' }
            })
          ).status()
        ).toBe(403);
      }
      for (const data of [
        { query: 'a' },
        { query: 'x'.repeat(121) },
        { query: 'Atelier', page: 0 },
        { query: 'Atelier', pageSize: 21 }
      ]) {
        expect(
          (
            await reader.request.post('/api/admin/search', {
              headers: { Origin: stack.origin },
              data
            })
          ).status()
        ).toBe(400);
      }
      const recent = await (
        await reader.request.get('/api/admin/contributions')
      ).json();
      expect(recent.contributions).toHaveLength(250);
      expect(
        recent.contributions.map((row: { id: string }) => row.id)
      ).not.toContain(dossiers[0].id);
    });

    await test.step('each grouped result opens the exact historical object, including on the same route', async () => {
      for (const destination of [
        'contribution',
        'invoice',
        'publication',
        'sponsorship'
      ]) {
        for (const dossier of dossiers) {
          const response = await search(reader, dossier.email);
          expect(response.status()).toBe(200);
          await expect(
            dialog(reader).getByRole('heading', { name: dossier.name })
          ).toBeVisible();
          await expect(dialog(reader).getByRole('listitem')).toHaveCount(1);
          const label =
            destination === 'contribution'
              ? 'Contribution'
              : destination === 'invoice'
                ? 'Facture ' + dossier.number
                : destination === 'publication'
                  ? /Publication ·/
                  : 'Commandite';
          await dialog(reader)
            .getByRole('link', { name: label, exact: true })
            .click();
          await expect(dialog(reader)).not.toBeVisible();
          if (destination === 'contribution') {
            await expect(reader).toHaveURL(
              new RegExp('contributionId=' + dossier.id)
            );
            await expect(
              reader.getByRole('region', { name: 'Détail de la contribution' })
            ).toContainText(dossier.name);
          } else if (destination === 'invoice') {
            await expect(reader).toHaveURL(
              new RegExp('contributionId=' + dossier.id)
            );
            await expect(
              reader.getByRole('heading', { name: dossier.number, exact: true })
            ).toBeVisible();
          } else if (destination === 'publication') {
            await expect(reader).toHaveURL(
              new RegExp('draftId=' + dossier.draft)
            );
            await expect(
              reader.locator('#attention-object-' + dossier.draft)
            ).toBeFocused();
          } else {
            await expect(reader).toHaveURL(
              new RegExp('sponsorshipId=' + dossier.id)
            );
            await expect(
              reader.getByRole('complementary', {
                name: 'Dossier commanditaire selectionne'
              })
            ).toContainText(dossier.name);
          }
          expect(reader.url()).not.toContain('private-search');
        }
      }
    });

    await test.step('pagination, exact amounts, literal input, keyboard and transient private terms', async () => {
      await search(reader, 'Pagination recherche');
      await expect(dialog(reader).getByRole('listitem')).toHaveCount(10);
      const first = await dialog(reader)
        .getByRole('listitem')
        .evaluateAll((rows) =>
          rows.map((row) => row.getAttribute('data-og7-id'))
        );
      await dialog(reader)
        .getByRole('button', { name: 'Suivant', exact: true })
        .click();
      await expect(
        dialog(reader).getByText('Page 2', { exact: true })
      ).toBeVisible();
      const second = await dialog(reader)
        .getByRole('listitem')
        .evaluateAll((rows) =>
          rows.map((row) => row.getAttribute('data-og7-id'))
        );
      expect(new Set([...first, ...second]).size).toBe(20);
      expect((await (await search(reader, '100,50 CAD')).json()).total).toBe(2);
      for (const query of ['100.50 USD', "' OR TRUE --", '%_']) {
        expect((await (await search(reader, query)).json()).total).toBe(0);
        await expect(
          dialog(reader).getByText(/Aucun dossier trouvé/)
        ).toBeVisible();
      }
      await search(reader, dossiers[0].email);
      await expect(dialog(reader).getByRole('listitem')).toHaveCount(1);
      expect(
        await reader.evaluate(() =>
          JSON.stringify([
            Object.entries(localStorage),
            Object.entries(sessionStorage)
          ])
        )
      ).not.toContain('private-search');
      await reader.keyboard.press('ArrowDown');
      await expect(
        dialog(reader).getByRole('link', { name: 'Commandite', exact: true })
      ).toBeFocused();
      await reader.keyboard.press('Escape');
      await expect(
        reader.locator('[data-og7="admin-search-open"]')
      ).toBeFocused();
      await reader.keyboard.press('Control+k');
      await expect(dialog(reader).getByRole('searchbox')).toHaveValue('');
      await expect(dialog(reader).getByRole('searchbox')).toBeFocused();
      await expect(dialog(reader).getByRole('listitem')).toHaveCount(0);
    });

    await test.step('real database error clears results, then retry recovers; missing source is explicitly partial', async () => {
      await search(reader, dossiers[0].reference);
      await expect(dialog(reader).getByRole('listitem')).toHaveCount(1);
      await stack.pool.query(
        'ALTER TABLE fund_contributions RENAME COLUMN sponsor_public_slug TO search_fixture_slug'
      );
      try {
        const failed = await search(reader, dossiers[0].email);
        expect(failed.status()).toBe(503);
        await expect(dialog(reader).getByRole('alert')).toContainText(
          'La recherche a échoué'
        );
        await expect(dialog(reader).getByRole('listitem')).toHaveCount(0);
        const failure = await reader.request.post('/api/admin/search', {
          headers: { Origin: stack.origin },
          data: { query: dossiers[0].email }
        });
        expect(failure.status()).toBe(503);
        expect(await failure.json()).toEqual({
          error: 'Admin search unavailable.'
        });
      } finally {
        await stack.pool.query(
          'ALTER TABLE fund_contributions RENAME COLUMN search_fixture_slug TO sponsor_public_slug'
        );
      }
      await dialog(reader).getByRole('button', { name: 'Réessayer' }).click();
      await expect(
        dialog(reader).getByRole('heading', { name: dossiers[0].name })
      ).toBeVisible();
      await stack.pool.query(
        'ALTER TABLE sponsorship_invoices RENAME TO search_fixture_invoices'
      );
      try {
        const partial = await search(reader, dossiers[0].reference);
        expect((await partial.json()).missingSources).toEqual([
          'sponsorship_invoices'
        ]);
        await expect(
          dialog(reader).getByText(/Résultats partiels/)
        ).toBeVisible();
        await expect(
          dialog(reader).getByRole('link', { name: /Facture/ })
        ).toHaveCount(0);
      } finally {
        await stack.pool.query(
          'ALTER TABLE search_fixture_invoices RENAME TO sponsorship_invoices'
        );
      }
    });

    await test.step('English mobile and expired session clear the private dialog and explain reconnection', async () => {
      await reader.keyboard.press('Escape');
      await reader
        .getByRole('button', {
          name: 'Switch administration language to English'
        })
        .click();
      await reader.setViewportSize({ width: 390, height: 844 });
      await search(reader, dossiers[1].number);
      await expect(dialog(reader)).toHaveAccessibleName('Global search');
      await expect(
        dialog(reader).getByRole('link', {
          name: 'Invoice ' + dossiers[1].number
        })
      ).toBeVisible();
      expect(
        await dialog(reader).evaluate(
          (element) => element.scrollWidth <= element.clientWidth
        )
      ).toBe(true);
      await info.attach('search-mobile', {
        body: await reader.screenshot(),
        contentType: 'image/png'
      });
      const profile = await (
        await reader.request.get('/api/admin/auth/current')
      ).json();
      await stack.pool.query(
        "UPDATE admin_identity_sessions SET expires_at=now()-interval '1 second' WHERE id=$1",
        [profile.sessionId]
      );
      expect((await search(reader, dossiers[0].email)).status()).toBe(401);
      await expect(reader).toHaveURL(/\/admin\/login/);
      expect(reader.url()).not.toContain('private-search');
      expect(new URL(reader.url()).searchParams.get('returnUrl')).toContain(
        'sponsorshipId=' + dossiers[1].id
      );
      await expect(reader.locator('[data-og7="admin-search"]')).toHaveCount(0);
      await expect(reader.getByRole('status')).toContainText(
        /expired|revoked/i
      );
    });
    expect(await effects()).toEqual(before);
    expect(errors).toEqual([]);
  } finally {
    try {
      await Promise.all(contexts.map((context) => context.close()));
      await anonymous.dispose();
    } finally {
      await stack.stop();
    }
  }
});
