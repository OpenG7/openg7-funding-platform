import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { test, expect, type BrowserContext, type Page } from '@playwright/test';

import { startDisposableProvider } from '../integration/support/disposable-provider.mjs';

import { startIdentityStack } from './stack.mjs';
import { signInAdminIdentity } from './support/admin-browser.js';

test('moderation correction and reconsideration preserve private explanations, actors and publication boundaries through real OIDC and SMTP', async ({
  browser
}) => {
  test.setTimeout(180000);
  const mail = await startDisposableProvider('mail');
  let stack: Awaited<ReturnType<typeof startIdentityStack>> | undefined;
  const contexts: BrowserContext[] = [];
  try {
    stack = await startIdentityStack({ smtpPort: mail.ports[1025] });
    const { origin, pool } = stack;
    const open = async () => {
      const context = await browser.newContext({ baseURL: origin });
      contexts.push(context);
      return context.newPage();
    };
    const login = async (page: Page, subject: string, destination: string) => {
      await signInAdminIdentity(page, destination, subject);
      await expect(page).toHaveURL(destination);
    };
    const owner = await open();
    await login(owner, 'owner', '/admin/fundraiser/access');
    expect(
      (
        await owner.request.post('/api/admin/access', {
          headers: { Origin: origin },
          data: {
            subject: 'fixture-operator',
            confirmation: 'fixture-operator',
            displayName: 'Révision de recours synthétique',
            role: 'operator',
            disabled: false
          }
        })
      ).ok()
    ).toBe(true);
    const member = (
      await (await owner.request.get('/api/admin/access')).json()
    ).accounts.find(
      (account: { subject: string }) => account.subject === 'fixture-operator'
    );
    const id = randomUUID();
    const token = randomBytes(32).toString('base64url');
    const paymentRecipient = 'paid-recipient@simulation.example.test';
    await pool.query(
      `INSERT INTO fund_contributions
      (id,contribution_type,amount_cents,currency,status,paid_at,email_private,public_display_consent,non_charity_acknowledged,sponsor_company_name,sponsor_contact_name,sponsor_contact_email,sponsor_message,sponsor_details_submitted_at,sponsor_review_status,sponsorship_followup_token_hash,sponsorship_followup_token_created_at)
      VALUES($1,'sponsorship_interest',2500,'cad','paid',NOW(),$2,TRUE,TRUE,'Atelier correction synthétique','Contact synthétique','editable-contact@simulation.example.test','Proposition originale à clarifier',NOW(),'pending_review',$3,NOW())`,
      [id, paymentRecipient, createHash('sha256').update(token).digest('hex')]
    );
    await pool.query(
      `INSERT INTO sponsor_media_assets
      (contribution_id,kind,review_status,original_filename,original_mime_type,original_size_bytes,original_storage_key,processed_size_bytes,processed_storage_key,public_storage_key,public_url,checksum_sha256,width,height,alt_text)
      VALUES($1,'supporting_image','approved','simulation.png','image/png',68,'correction/original',44,'correction/processed','correction/public','data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAA==',repeat('a',64),1,1,'Image synthétique')`,
      [id]
    );
    const destination = '/admin/fundraiser/sponsors?sponsorshipId=' + id;
    const reviewer = await open();
    const sponsor = await open();
    const followup = '/fonds-des-batisseurs/suivi-commandite?token=' + token;
    await login(reviewer, 'operator', destination);
    await owner.goto(destination);
    const finances = async () =>
      (
        await pool.query(
          'SELECT amount_cents,currency,status,paid_at FROM fund_contributions WHERE id=$1',
          [id]
        )
      ).rows[0];
    const baseline = await finances();
    const privacy = async () => {
      const response = await sponsor.request.get(
        '/api/sponsorship-followup/moderation?token=' + token
      );
      expect(response.ok()).toBe(true);
      const body = await response.json();
      expect(JSON.stringify(body)).not.toMatch(
        /PRIVATE_INTERNAL_RECIPE|PRIVATE_APPEAL_TEXT|internalReason|"actor"/
      );
      return body;
    };
    const noPublication = async () => {
      const row = (
        await pool.query(
          'SELECT sponsor_review_status,sponsor_feed_status FROM fund_contributions WHERE id=$1',
          [id]
        )
      ).rows[0]!;
      expect(row.sponsor_feed_status).not.toBe('published');
      expect(row.sponsor_review_status).not.toBe('approved');
      expect(await finances()).toEqual(baseline);
    };
    const decide = async (
      page: Page,
      level: 'N1' | 'N2',
      explanation: string
    ) => {
      const actions = page.locator('[data-og7="moderation-actions"]').first();
      await actions.getByRole('combobox').first().selectOption(level);
      await actions.locator('[data-og7="moderation-open"]').click();
      const panel = page.locator('[data-og7="moderation-decision"]');
      await panel
        .locator('[data-og7="moderation-primary-reason"]')
        .selectOption('MISLEADING_CLAIM');
      await panel
        .locator('[data-og7="moderation-internal-reason"]')
        .fill(
          'PRIVATE_INTERNAL_RECIPE: justification synthétique réservée aux relecteurs.'
        );
      await panel
        .locator('[data-og7="moderation-explanation"]')
        .fill(explanation);
      await panel.locator('[data-og7="moderation-confirmation"]').check();
      const accepted = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/admin/moderation/decisions') &&
          response.request().method() === 'POST'
      );
      await panel.locator('[data-og7="moderation-submit"]').click();
      const response = await accepted;
      expect(response.ok(), await response.text()).toBe(true);
      return (await response.json()).decision;
    };
    const first = await decide(
      owner,
      'N1',
      'Veuillez préciser la proposition commerciale et retirer les affirmations non étayées.'
    );
    await sponsor.goto(followup);
    await expect(
      sponsor.locator('[data-og7="followup-moderation"]')
    ).toContainText('Veuillez préciser la proposition commerciale');
    await sponsor.locator('[data-og7="followup-correction"]').click();
    await sponsor
      .getByLabel("Nom de l'entreprise", { exact: false })
      .fill('Atelier correction clarifiée');
    const corrected = sponsor.waitForResponse(
      (response) =>
        response.url().endsWith('/api/sponsorship-followup/correction') &&
        response.request().method() === 'POST'
    );
    await sponsor
      .getByRole('button', {
        name: 'Soumettre mes informations à l’équipe',
        exact: true
      })
      .click();
    expect((await corrected).ok()).toBe(true);
    await noPublication();
    await privacy();
    expect(
      (
        await pool.query('SELECT id FROM moderation_decisions WHERE id=$1', [
          first.id
        ])
      ).rows[0]
    ).toBeTruthy();

    await reviewer.reload();
    const refused = await decide(
      reviewer,
      'N2',
      'La proposition corrigée conserve une affirmation commerciale non étayée ; vous pouvez demander un réexamen humain.'
    );
    await sponsor.reload();
    await sponsor.locator('[data-og7="followup-reconsideration"]').click();
    const appeal = sponsor.locator(
      '[data-og7="followup-reconsideration-form"]'
    );
    await appeal
      .getByRole('textbox')
      .fill(
        'PRIVATE_APPEAL_TEXT: merci de relire la précision et son contexte complet.'
      );
    await appeal.getByRole('checkbox').check();
    const requested = sponsor.waitForResponse(
      (response) =>
        response.url().endsWith('/api/sponsorship-followup/reconsideration') &&
        response.request().method() === 'POST'
    );
    await appeal.locator('button[type="submit"]').click();
    expect((await requested).status()).toBe(202);
    await noPublication();
    await privacy();

    await owner.reload();
    const actions = owner.locator('[data-og7="moderation-actions"]').first();
    await actions.locator('summary').click();
    await actions
      .locator('[data-og7="moderation-assigned-member"]')
      .selectOption('admin:' + member.id);
    await actions.locator('[data-og7="moderation-assign"]').click();
    await owner.keyboard.press('Escape');
    expect(
      (
        await pool.query(
          'SELECT assigned_to FROM moderation_cases WHERE subject_id=$1',
          [id]
        )
      ).rows[0]!.assigned_to
    ).toBeNull();
    await actions.locator('[data-og7="moderation-assign"]').click();
    const assigned = owner.waitForResponse(
      (response) =>
        response.url().endsWith('/api/admin/moderation/assignment') &&
        response.request().method() === 'POST'
    );
    await owner.locator('[data-og7="confirm-action"]').click();
    expect((await assigned).ok()).toBe(true);
    await actions.getByRole('combobox').first().selectOption('N0');
    await actions
      .locator('[data-og7="moderation-resolve-reconsideration"]')
      .click();
    const panel = owner.locator('[data-og7="moderation-decision"]');
    await panel
      .locator('[data-og7="moderation-explanation"]')
      .fill(
        'Après réexamen du contexte et de la précision, cette version est recevable éditorialement.'
      );
    await panel.locator('[data-og7="moderation-confirmation"]').check();
    const resolved = owner.waitForResponse(
      (response) =>
        response
          .url()
          .endsWith('/api/admin/moderation/reconsiderations/resolve') &&
        response.request().method() === 'POST'
    );
    await panel.locator('[data-og7="moderation-submit"]').click();
    expect((await resolved).ok()).toBe(true);
    expect(
      (
        await pool.query(
          'SELECT state FROM moderation_appeals WHERE decision_id=$1',
          [refused.id]
        )
      ).rows[0]!.state
    ).toBe('resolved');
    await noPublication();
    await privacy();
    const audits = (
      await pool.query(
        "SELECT actor,action,metadata FROM admin_audit_log WHERE action LIKE 'moderation.%' ORDER BY created_at,id"
      )
    ).rows;
    for (const action of [
      'moderation.decision',
      'moderation.correction_submitted',
      'moderation.reconsideration_requested',
      'moderation.assigned',
      'moderation.reconsideration_reviewed'
    ])
      expect(
        audits.some((row) => row.action === action),
        action
      ).toBe(true);
    expect(
      new Set(
        audits
          .filter((row) => row.action === 'moderation.decision')
          .map((row) => row.actor)
      ).size
    ).toBe(2);

    // Exercise the existing explicit queue path against local SMTP; the usual worker is disabled in this fixture.
    const queued = (
      await pool.query(
        "SELECT id FROM email_messages WHERE status='queued' ORDER BY created_at,id"
      )
    ).rows;
    expect(queued.length).toBeGreaterThanOrEqual(4);
    for (const message of queued) {
      await owner.goto('/admin/fundraiser/email-queue?messageId=' + message.id);
      await owner
        .getByRole('button', { name: /Relancer|Réessayer/ })
        .first()
        .click();
      const sent = owner.waitForResponse(
        (response) =>
          response.url().endsWith('/api/admin/email-queue/retry') &&
          response.request().method() === 'POST'
      );
      await owner.locator('[data-og7="confirm-action"]').click();
      expect((await sent).ok()).toBe(true);
    }
    const mailUrl = `http://127.0.0.1:${mail.ports[8025]}`;
    const messages = (await (await fetch(mailUrl + '/api/v1/messages')).json())
      .messages as { ID: string; To: { Address: string }[] }[];
    expect(messages).toHaveLength(queued.length);
    for (const message of messages) {
      expect(message.To.map((recipient) => recipient.Address)).toEqual([
        paymentRecipient
      ]);
      const content = await (
        await fetch(mailUrl + '/api/v1/message/' + message.ID)
      ).json();
      expect(JSON.stringify(content)).not.toMatch(
        /PRIVATE_INTERNAL_RECIPE|PRIVATE_APPEAL_TEXT|fixture-operator/
      );
    }
  } finally {
    try {
      await Promise.all(contexts.map((context) => context.close()));
    } finally {
      try {
        await stack?.stop();
      } finally {
        await mail.stop();
      }
    }
  }
});
