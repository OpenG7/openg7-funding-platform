import { randomUUID } from 'node:crypto';

import {
  test,
  expect,
  type Browser,
  type BrowserContext,
  type Page
} from '@playwright/test';

import { startIdentityStack } from './stack.mjs';
import { signInAdminIdentity } from './support/admin-browser.js';

async function login(page: Page, subject: string, destination: string) {
  await signInAdminIdentity(page, destination, subject);
  await expect(page).toHaveURL(destination);
}

async function fixture(browser: Browser) {
  const stack = await startIdentityStack();
  const contexts: BrowserContext[] = [];
  const open = async () => {
    const context = await browser.newContext({ baseURL: stack.origin });
    contexts.push(context);
    return context.newPage();
  };
  try {
    const owner = await open();
    await login(owner, 'owner', '/admin/fundraiser/access');
    const account = await owner.request.post('/api/admin/access', {
      headers: { Origin: stack.origin },
      data: {
        subject: 'fixture-operator',
        confirmation: 'fixture-operator',
        role: 'owner',
        displayName: 'Propriétaire de recette financière',
        disabled: false
      }
    });
    expect(account.ok()).toBe(true);
    const id = randomUUID();
    const invoice = randomUUID();
    const email = randomUUID();
    const name = 'Dossier privé révocation ' + id.slice(0, 8);
    const reference = 'OG7-REVOKE-' + id.slice(0, 8);
    await stack.pool.query(
      `INSERT INTO fund_contributions
      (id,contribution_type,amount_cents,currency,status,paid_at,public_reference,sponsor_company_name,sponsor_contact_email,stripe_session_id,stripe_payment_intent_id)
      VALUES($1,'sponsorship_interest',50000,'cad','paid',NOW(),$2,$3,'finance-private@simulation.example.test',$4,$5)`,
      [id, reference, name, 'cs_test_revoke_' + id, 'pi_test_revoke_' + id]
    );
    await stack.pool.query(
      `INSERT INTO sponsorship_invoices
      (id,contribution_id,invoice_number,stripe_session_id,currency,subtotal_cents,total_cents,issuer_name,sponsor_name,sponsor_contact_email)
      VALUES($1,$2,$3,$4,'cad',50000,50000,'OpenG7 simulation',$5,'finance-private@simulation.example.test')`,
      [
        invoice,
        id,
        'FAC-REVOKE-' + id.slice(0, 8),
        'cs_test_revoke_' + id,
        name
      ]
    );
    await stack.pool.query(
      `INSERT INTO email_messages
      (id,template_key,recipient_email,from_email,subject,text_body,html_body,status,attempts)
      VALUES($1,'sponsorship_invoice','queue-private@simulation.example.test','sender@simulation.example.test',$2,'Simulation privée','<p>Simulation privée</p>','failed',1)`,
      [email, 'Courriel privé révocation ' + id.slice(0, 8)]
    );
    const revoke = async (page: Page) => {
      const current = await page.request.get('/api/admin/auth/current');
      expect(current.ok()).toBe(true);
      const { sessionId } = await current.json();
      const revoked = await owner.request.post('/api/admin/access', {
        headers: { Origin: stack.origin },
        data: { sessionId, confirmation: sessionId }
      });
      expect(revoked.ok()).toBe(true);
    };
    return {
      ...stack,
      owner,
      open,
      revoke,
      id,
      invoice,
      email,
      name,
      reference,
      async stop() {
        try {
          await Promise.all(contexts.map((context) => context.close()));
        } finally {
          await stack.stop();
        }
      }
    };
  } catch (error) {
    await Promise.all(contexts.map((context) => context.close()));
    await stack.stop();
    throw error;
  }
}

test('private invoice and email pages erase their snapshot and pending inspection after real OIDC revocation', async ({
  browser
}) => {
  const f = await fixture(browser);
  try {
    for (const kind of ['invoices', 'email-queue'] as const) {
      const page = await f.open();
      const destination =
        kind === 'invoices'
          ? '/admin/fundraiser/invoices?contributionId=' + f.id
          : '/admin/fundraiser/email-queue?messageId=' + f.email;
      await login(page, 'operator', destination);
      const privateText =
        kind === 'invoices' ? f.name : 'queue-private@simulation.example.test';
      await expect(
        page.getByText(privateText, { exact: true }).first()
      ).toBeVisible();
      if (kind === 'invoices') {
        await page
          .locator('openg7-admin-document-delivery input')
          .first()
          .fill('draft-private@simulation.example.test');
      }
      await f.revoke(page);
      await page
        .getByRole('button', { name: 'Actualiser', exact: true })
        .click();
      await expect(page).toHaveURL(/\/admin\/login\?/);
      await expect(page.getByRole('status')).toContainText(/expiré|révoquée/i);
      await expect(page.getByText(privateText, { exact: true })).toHaveCount(0);
      await expect(page.locator('openg7-admin-document-delivery')).toHaveCount(
        0
      );
      expect(
        await page.evaluate(() =>
          sessionStorage.getItem('openg7-admin-session-token')
        )
      ).toBeNull();
      const endpoint =
        kind === 'invoices'
          ? '/api/admin/sponsorship-invoices'
          : '/api/admin/email-queue';
      expect((await page.request.get(endpoint)).status()).toBe(401);
    }
  } finally {
    await f.stop();
  }
});

test('a forbidden private refresh purges drafts and a late successful read cannot restore the revoked session', async ({
  browser
}) => {
  const f = await fixture(browser);
  try {
    for (const kind of ['invoices', 'email-queue'] as const) {
      const page = await f.open();
      const destination = '/admin/fundraiser/' + kind;
      const endpoint =
        kind === 'invoices'
          ? '/api/admin/sponsorship-invoices'
          : '/api/admin/email-queue';
      await login(page, 'operator', destination);
      await expect(
        page.locator(
          kind === 'invoices'
            ? 'openg7-admin-invoice-detail'
            : 'openg7-admin-email-queue-summary'
        )
      ).toBeVisible();
      // Only a refusal is injected: the initial snapshot comes from the real API/DB.
      await page.route('**' + endpoint, (route) =>
        route.fulfill({ status: 403, json: {} })
      );
      await page
        .getByRole('button', { name: 'Actualiser', exact: true })
        .click();
      await expect(
        page.getByText(
          'Votre compte ne permet plus de consulter ces données.',
          { exact: false }
        )
      ).toBeVisible();
      await expect(
        page.locator(
          kind === 'invoices'
            ? 'openg7-admin-invoice-detail'
            : 'openg7-admin-email-queue-summary'
        )
      ).toHaveCount(0);
      await expect(page).toHaveURL(destination);
      await page.unroute('**' + endpoint);
      await page
        .getByRole('button', { name: 'Actualiser', exact: true })
        .click();
      await expect(
        page.locator(
          kind === 'invoices'
            ? 'openg7-admin-invoice-detail'
            : 'openg7-admin-email-queue-summary'
        )
      ).toBeVisible();

      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let started!: () => void;
      const waiting = new Promise<void>((resolve) => {
        started = resolve;
      });
      await page.route('**' + endpoint, async (route) => {
        const response = await route.fetch({ maxRetries: 0 });
        expect(response.ok()).toBe(true);
        started();
        await held;
        await route.fulfill({ response }).catch(() => {});
      });
      await page
        .getByRole('button', { name: 'Actualiser', exact: true })
        .click();
      await waiting;
      await f.revoke(page);
      // A genuine protected search detects revocation while the old read is held.
      await page.locator('[data-og7="admin-search-open"]').click();
      await page
        .locator('[data-og7="admin-search"]')
        .getByRole('searchbox')
        .fill(f.reference);
      await expect(page).toHaveURL(/\/admin\/login/);
      release();
      await expect(
        page.locator(
          kind === 'invoices'
            ? 'openg7-admin-invoice-detail'
            : 'openg7-admin-email-queue-summary'
        )
      ).toHaveCount(0);
      expect(
        await page.evaluate(() =>
          sessionStorage.getItem('openg7-admin-session-token')
        )
      ).toBeNull();
    }
  } finally {
    await f.stop();
  }
});

test('real revocation blocks pending recipient correction, allocation publication and Stripe refund without business effects', async ({
  browser
}) => {
  const f = await fixture(browser);
  try {
    const effects = async () =>
      (
        await f.pool.query(
          `SELECT
      (SELECT count(*)::int FROM email_messages) AS emails,
      (SELECT count(*)::int FROM sponsorship_credit_notes) AS credit_notes,
      (SELECT count(*)::int FROM fund_allocations WHERE status IN ('published','active')) AS public_allocations,
      (SELECT count(*)::int FROM admin_audit_log WHERE action NOT LIKE 'admin.%' AND entity_type != 'admin_access') AS business_audits,
      (SELECT sponsorship_refund_status FROM fund_contributions WHERE id=$1) AS refund`,
          [f.id]
        )
      ).rows[0];
    const allocation = (
      await f.pool.query(`INSERT INTO fund_allocations
      (project_name,public_description,expected_outcome,amount_allocated,currency,status)
      VALUES('Allocation privée révocation','Description publique synthétique','Résultat synthétique',4250,'cad','draft') RETURNING id`)
    ).rows[0]!.id;
    const before = await effects();
    for (const operation of ['recipient', 'allocation', 'refund'] as const) {
      const page = await f.open();
      const destination =
        operation === 'recipient'
          ? '/admin/fundraiser/invoices?contributionId=' + f.id
          : operation === 'allocation'
            ? '/admin/fundraiser/expenses?expenseId=' + allocation
            : '/admin/fundraiser/sponsors?sponsorshipId=' +
              f.id +
              '&tab=refund';
      await login(page, 'operator', destination);
      let endpoint: string;
      if (operation === 'recipient') {
        await page
          .locator('openg7-admin-document-delivery input')
          .first()
          .fill('corrected-private@simulation.example.test');
        await page
          .getByRole('button', { name: 'Renvoyer', exact: true })
          .click();
        await expect(page.getByRole('dialog')).toContainText(
          'corrected-private@simulation.example.test'
        );
        endpoint = '/api/admin/sponsorship-invoices/resend';
      } else if (operation === 'allocation') {
        await page
          .locator('[data-og7="allocation-card"]')
          .getByRole('button', { name: 'Publier', exact: true })
          .click();
        await expect(page.getByRole('dialog')).toBeVisible();
        endpoint = '/api/admin/expenses/update';
      } else {
        await page
          .getByRole('button', { name: 'Rembourser Stripe', exact: true })
          .click();
        await page
          .getByRole('region', { name: 'Remboursement Stripe' })
          .getByLabel(/Texte de confirmation/)
          .fill(f.reference);
        endpoint = '/api/admin/sponsorships/refund';
      }
      await f.revoke(page);
      const rejected = page.waitForResponse(
        (response) =>
          response.url().endsWith(endpoint) &&
          response.request().method() === 'POST'
      );
      if (operation === 'refund') {
        await page
          .getByRole('region', { name: 'Remboursement Stripe' })
          .getByRole('button', { name: 'Rembourser Stripe', exact: true })
          .click();
      } else await page.locator('[data-og7="confirm-action"]').click();
      expect((await rejected).status()).toBe(401);
      await expect(page).toHaveURL(/\/admin\/login/);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByText(f.name, { exact: true })).toHaveCount(0);
      expect(await effects()).toEqual(before);
    }
  } finally {
    await f.stop();
  }
});

test('moderation content refusals stay distinct, retries use real content and obsolete or revoked decisions never persist', async ({
  browser
}) => {
  const f = await fixture(browser);
  try {
    await f.pool.query(
      `UPDATE fund_contributions SET sponsor_details_submitted_at=NOW(),sponsor_contact_name='Contact synthétique',sponsor_website_url='https://simulation.example.test',sponsor_review_status='pending_review' WHERE id=$1`,
      [f.id]
    );
    await f.pool.query(
      `INSERT INTO sponsor_media_assets
      (contribution_id,kind,review_status,original_filename,original_mime_type,original_size_bytes,original_storage_key,processed_size_bytes,processed_storage_key,public_storage_key,public_url,checksum_sha256,width,height,alt_text)
      VALUES($1,'supporting_image','approved','simulation.png','image/png',68,'revocation/original',44,'revocation/processed','revocation/public','data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAA==',repeat('a',64),1,1,'Image synthétique')`,
      [f.id]
    );
    const page = await f.open();
    await login(
      page,
      'operator',
      '/admin/fundraiser/sponsors?sponsorshipId=' + f.id
    );
    const open = async () => {
      const feature = page.locator('[data-og7="moderation-feature-toggle"]');
      if ((await feature.getAttribute('aria-expanded')) !== 'true')
        await feature.click();
      const actions = page.locator('[data-og7="moderation-actions"]').first();
      await actions.getByRole('combobox').first().selectOption('N0');
      await actions.locator('[data-og7="moderation-open"]').click();
    };
    const subject = '**/api/admin/moderation/content?**';
    const errors = new Map([
      [403, 'Vous n’avez pas les droits nécessaires'],
      [404, 'Ce contenu n’existe plus'],
      [503, 'Le contenu ne peut pas être chargé']
    ]);
    for (const [status, message] of errors) {
      await page.route(subject, (route) => route.fulfill({ status, json: {} }));
      await open();
      await expect(
        page.locator('[data-og7="moderation-decision"]').getByRole('alert')
      ).toContainText(message);
      await expect(
        page.locator('[data-og7="moderation-submit"]')
      ).toBeDisabled();
      await page.unroute(subject);
      await page
        .locator('[data-og7="moderation-decision"]')
        .getByRole('button', { name: 'Réessayer', exact: true })
        .click();
      await expect(
        page.locator('[data-og7="moderation-snapshot"]')
      ).toHaveCount(1);
      await page.keyboard.press('Escape');
      await expect(
        page.locator('[data-og7="moderation-decision"]')
      ).toHaveCount(0);
    }
    expect(
      (
        await f.pool.query(
          'SELECT count(*)::int AS count FROM moderation_decisions'
        )
      ).rows[0]!.count
    ).toBe(0);
    let releaseOld!: () => void;
    const oldGate = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    let oldStarted!: () => void;
    const oldWaiting = new Promise<void>((resolve) => {
      oldStarted = resolve;
    });
    let contentReads = 0;
    await page.route(subject, async (route) => {
      if (++contentReads !== 1) return route.continue();
      const response = await route.fetch({ maxRetries: 0 });
      expect(response.ok()).toBe(true);
      oldStarted();
      await oldGate;
      await route.fulfill({ response });
    });
    await open();
    await oldWaiting;
    await page
      .locator('[data-og7="moderation-decision"]')
      .getByRole('button', { name: 'Annuler', exact: true })
      .last()
      .click();
    await f.pool.query(
      `UPDATE fund_contributions SET sponsor_message='Nouvelle version après fermeture' WHERE id=$1`,
      [f.id]
    );
    await open();
    await expect(
      page.locator('[data-og7="moderation-snapshot"]')
    ).toContainText('Nouvelle version après fermeture');
    const late = page.waitForResponse((response) =>
      response.url().includes('/api/admin/moderation/content?')
    );
    releaseOld();
    await late;
    await expect(
      page.locator('[data-og7="moderation-snapshot"]')
    ).toContainText('Nouvelle version après fermeture');
    await page.keyboard.press('Escape');
    await page.unroute(subject);
    await open();
    await expect(page.locator('[data-og7="moderation-snapshot"]')).toHaveCount(
      1
    );
    await f.pool.query(
      `UPDATE fund_contributions SET sponsor_message='Contenu modifié après lecture' WHERE id=$1`,
      [f.id]
    );
    await page.locator('[data-og7="moderation-confirmation"]').check();
    const stale = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/admin/moderation/decisions') &&
        response.request().method() === 'POST'
    );
    await page.locator('[data-og7="moderation-submit"]').click();
    expect((await stale).status()).toBe(409);
    expect(
      (
        await f.pool.query(
          'SELECT count(*)::int AS count FROM moderation_decisions'
        )
      ).rows[0]!.count
    ).toBe(0);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });
    await page.route(subject, async (route) => {
      started();
      await gate;
      await route.continue();
    });
    await open();
    await waiting;
    const activityRefusal = page.waitForResponse(
      (response) =>
        response.url().includes('/api/admin/contribution-activity?') &&
        response.status() === 401
    );
    const contentRefusal = page.waitForResponse((response) =>
      response.url().includes('/api/admin/moderation/content?')
    );
    await f.revoke(page);
    try {
      // The activity client invalidates the same session before the held read
      // finishes. Its cancellation of the panel must not swallow the 401.
      expect((await activityRefusal).status()).toBe(401);
      await expect(
        page.locator('[data-og7="moderation-decision"]')
      ).toHaveCount(0);
    } finally {
      release();
    }
    expect((await contentRefusal).status()).toBe(401);
    await expect(page).toHaveURL(/\/admin\/login/);
    await expect(page.locator('[data-og7="moderation-decision"]')).toHaveCount(
      0
    );
    expect(
      (
        await f.pool.query(
          'SELECT count(*)::int AS count FROM moderation_decisions'
        )
      ).rows[0]!.count
    ).toBe(0);
  } finally {
    await f.stop();
  }
});
