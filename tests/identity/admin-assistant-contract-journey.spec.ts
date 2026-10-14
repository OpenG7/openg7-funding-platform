import { randomUUID } from 'node:crypto';

import { test, expect } from '@playwright/test';

import { startIdentityStack } from './stack.mjs';
import { openAdminIdentity } from './support/admin-browser.js';

test('assistant real HTTP preserves scope, tool budget, disabled mode and revoked identity', async ({
  playwright
}) => {
  const stack = await startIdentityStack({
    assistant: { enabled: true, maxToolCalls: 1 }
  });
  const session = await openAdminIdentity(
    playwright.chromium,
    stack.origin,
    '/admin/fundraiser/assistant'
  );
  const { page } = session;
  const id = randomUUID();
  try {
    await stack.pool.query(
      `INSERT INTO fund_contributions
      (id,contribution_type,amount_cents,currency,status,sponsor_company_name,sponsor_review_status,
       sponsor_details_submitted_at,public_display_consent,email_private,sponsor_review_note)
      VALUES($1,'sponsorship_interest',10000,'cad','paid','Atelier contrat synthétique','pending_review',now(),true,
      'private-assistant@simulation.example.test','PRIVATE_ASSISTANT_CONTRACT')`,
      [id]
    );
    await page.reload();
    await page.locator('[data-og7="assistant-question"] summary').click();
    await page
      .getByLabel('Question', { exact: true })
      .fill('Quelles fiches sont incomplètes et quels courriels ont échoué ?');
    const response = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/admin/assistant/query'
    );
    await page.getByRole('button', { name: 'Demander', exact: true }).click();
    const received = await response;
    expect(received.status()).toBe(200);
    const answer = await received.json();
    expect(answer.mode).toBe('mock');
    expect(answer.toolInvocations.length).toBeGreaterThan(0);
    expect(answer.toolInvocations.length).toBeLessThanOrEqual(1);
    expect(answer.status).toBe('ok');
    expect(JSON.stringify(answer.links)).toContain(id);
    expect(JSON.stringify(answer)).not.toMatch(
      /PRIVATE_ASSISTANT_CONTRACT|private-assistant@/
    );
    await expect(page.locator('[data-og7="assistant-answer"]')).toContainText(
      'Faits vérifiés'
    );
    expect(
      (
        await stack.pool.query(
          "SELECT count(*)::int AS n FROM admin_audit_log WHERE action='admin_assistant.query'"
        )
      ).rows[0].n
    ).toBe(1);
    expect(
      (await stack.pool.query('SELECT count(*)::int AS n FROM email_messages'))
        .rows[0].n
    ).toBe(0);
    expect(
      (
        await stack.pool.query(
          'SELECT count(*)::int AS n FROM publication_deliveries'
        )
      ).rows[0].n
    ).toBe(0);

    await stack.restartAssistant({ enabled: false });
    await page.reload();
    await page.locator('[data-og7="assistant-question"] summary').click();
    await expect(
      page.locator('[data-og7="assistant-question"] input')
    ).toHaveCount(0);
    const disabled = await page.request.post('/api/admin/assistant/query', {
      headers: { Origin: stack.origin },
      data: { message: 'Résumé' }
    });
    expect(disabled.status()).toBe(200);
    expect((await disabled.json()).status).toBe('assistant_disabled');

    await stack.restartAssistant({ enabled: true });
    await page.reload();
    await page.locator('[data-og7="assistant-question"] summary').click();
    await page
      .getByLabel('Question', { exact: true })
      .fill('Quelles commandites sont à réviser ?');
    await stack.pool.query(
      'UPDATE admin_identity_sessions SET revoked_at=now()'
    );
    const denied = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/admin/assistant/query'
    );
    await page.getByRole('button', { name: 'Demander', exact: true }).click();
    expect((await denied).status()).toBe(401);
    await expect(page).toHaveURL(/\/admin\/login/);
    expect(
      (await stack.pool.query('SELECT count(*)::int AS n FROM email_messages'))
        .rows[0].n
    ).toBe(0);
  } finally {
    await session.context.close();
    await stack.stop();
  }
});

test('assistant overdue slot preparation is localized through real HTTP and creates no slot', async ({
  playwright
}) => {
  const stack = await startIdentityStack();
  const slot = randomUUID();
  const sessions = [];
  try {
    await stack.pool.query(
      `INSERT INTO publication_slots(id,feed_target,channel,starts_at,timezone,capacity,status)
      VALUES($1,'openg7','facebook',now()-interval '2 days','America/Toronto',5,'scheduled')`,
      [slot]
    );
    for (const language of ['fr-CA', 'en']) {
      const session = await openAdminIdentity(
        playwright.chromium,
        stack.origin,
        '/admin/fundraiser/assistant?type=publication_late',
        'owner',
        language
      );
      sessions.push(session);
      const { page } = session;
      await page
        .locator(
          `[data-og7="assistant-items"] [data-og7-id="publication_late:slot:${slot}"] button`
        )
        .click();
      const dialog = page.getByRole('dialog');
      const [result] = await Promise.all([
        page.waitForResponse(
          (r) => new URL(r.url()).pathname === '/api/admin/assistant/prepare'
        ),
        dialog
          .getByRole('button', {
            name: language === 'en' ? /Propose a slot/ : /Proposer un créneau/
          })
          .click()
      ]);
      expect(result.status()).toBe(200);
      const proposal = await result.json();
      expect(proposal.draft.reference).toBe(slot);
      expect(proposal.draft.persisted).toBe(false);
      expect(proposal.draft.published).toBe(false);
      expect(proposal.draft.sent).toBe(false);
      await expect(
        dialog.locator('[data-og7="assistant-draft"]')
      ).toContainText(
        language === 'en' ? 'Slot proposal' : 'Proposition de créneau'
      );
      expect(
        (
          await stack.pool.query(
            'SELECT count(*)::int AS n FROM publication_slots'
          )
        ).rows[0].n
      ).toBe(1);
      expect(
        (
          await stack.pool.query(
            'SELECT count(*)::int AS n FROM publication_deliveries'
          )
        ).rows[0].n
      ).toBe(0);
      expect(
        (
          await stack.pool.query(
            'SELECT count(*)::int AS n FROM email_messages'
          )
        ).rows[0].n
      ).toBe(0);
    }
  } finally {
    for (const session of sessions) await session.context.close();
    await stack.stop();
  }
});
