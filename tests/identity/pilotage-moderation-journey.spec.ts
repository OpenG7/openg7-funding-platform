import { randomUUID } from 'node:crypto';

import { test, expect, type Page } from '@playwright/test';

import { recordFixtureSponsorshipAgreement } from '../integration/support/sponsorship-agreement-fixture.mjs';

import { startIdentityStack } from './stack.mjs';
import { openAdminIdentity } from './support/admin-browser.js';

async function automation(page: Page, origin: string, data: unknown) {
  const response = await page.request.post(
    '/api/admin/publication-automation',
    { headers: { Origin: origin }, data }
  );
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

async function approvePanel(page: Page, content: string) {
  const panel = page.locator('[data-og7="moderation-decision"]');
  const check = panel.locator('[data-og7="moderation-confirmation"]');
  await expect(check).toBeVisible();
  await expect(panel).toContainText(content);
  const node = await check.elementHandle();
  await check.check();
  await panel.locator('[data-og7="moderation-submit"]').click();
  await node!.waitForElementState('hidden');
  await node!.dispose();
}

test('pilotage real subjects distinguish overdue slots from moderatable deliveries without creating a decision', async ({
  playwright
}) => {
  const stack = await startIdentityStack();
  const session = await openAdminIdentity(
    playwright.chromium,
    stack.origin,
    '/admin/fundraiser/pilotage'
  );
  const { page } = session;
  const slot = randomUUID();
  try {
    await stack.pool.query(
      `INSERT INTO publication_slots(id,feed_target,channel,starts_at,timezone,capacity,status)
      VALUES($1,'openg7','facebook',now()-interval '3 days','America/Toronto',5,'scheduled')`,
      [slot]
    );
    await automation(page, stack.origin, {
      action: 'check',
      feedId: 'openg7:facebook'
    });
    const delivery = await automation(page, stack.origin, {
      action: 'compose',
      feedId: 'openg7:facebook',
      kind: 'news',
      message: 'Publication synthétique avec sujet réel',
      scheduledAt: new Date(Date.now() + 86400000).toISOString()
    });
    await page.reload();
    const card = page.locator('[data-og7="pilot-decision"]');
    await expect(card).toHaveAttribute(
      'data-og7-id',
      `publication_late:slot:${slot}`
    );
    await expect(page.locator('[data-og7="moderation-open"]')).toHaveCount(0);
    await page.locator('[data-og7="pilot-details"]').click();
    await expect(
      page.locator('[data-og7="pilot-details-footer"] a')
    ).toHaveAttribute('href', `/admin/fundraiser/publications?slotId=${slot}`);
    await page.keyboard.press('Escape');
    await page
      .locator('[data-og7="pilot-queue"]')
      .getByRole('button', { name: /Publication synthétique avec sujet réel/ })
      .click();
    await expect(card).toHaveAttribute(
      'data-og7-id',
      'publication:' + delivery.id
    );
    const [read] = await Promise.all([
      page.waitForResponse(
        (r) => new URL(r.url()).pathname === '/api/admin/moderation/content'
      ),
      page.locator('[data-og7="moderation-open"]').click()
    ]);
    expect(read.status()).toBe(200);
    expect((await read.json()).subject).toEqual({
      type: 'publication_delivery',
      id: delivery.id
    });
    await expect(
      page.locator('[data-og7="moderation-confirmation"]')
    ).toBeVisible();
    await expect(page.locator('[data-og7="moderation-submit"]')).toBeDisabled();
    await page.keyboard.press('Escape');
    expect(
      (
        await stack.pool.query(
          'SELECT count(*)::int AS n FROM moderation_decisions'
        )
      ).rows[0].n
    ).toBe(0);
    expect(
      (
        await stack.pool.query(
          'SELECT count(*)::int AS n FROM admin_command_receipts'
        )
      ).rows[0].n
    ).toBe(0);
  } finally {
    await session.context.close();
    await stack.stop();
  }
});

for (const conflict of [false, true]) {
  test(`pilotage combined approval is atomic across two sponsors and delivery after ${conflict ? 'a concurrent change' : 'cancelling and reopening confirmation'}`, async ({
    playwright
  }) => {
    const stack = await startIdentityStack();
    const session = await openAdminIdentity(
      playwright.chromium,
      stack.origin,
      '/admin/fundraiser/pilotage'
    );
    const { page } = session;
    const ids = [randomUUID(), randomUUID()].sort();
    try {
      for (const [index, id] of ids.entries()) {
        await stack.pool.query(
          `INSERT INTO fund_contributions
          (id,contribution_type,amount_cents,currency,status,paid_at,public_display_consent,sponsor_review_status,
           sponsor_company_name,sponsor_public_summary,sponsor_details_submitted_at,sponsor_contact_email)
          VALUES($1,'sponsorship_interest',25000,'cad','paid',now(),true,'pending_review',$2,'Résumé public synthétique',now(),'contact@simulation.example.test')`,
          [id, `Atelier groupé synthétique ${index + 1}`]
        );
        await recordFixtureSponsorshipAgreement(stack.pool, id, {
          channel: 'facebook'
        });
        const media = (
          await stack.pool.query(
            `INSERT INTO sponsor_media_assets
          (contribution_id,kind,review_status,original_filename,original_mime_type,original_size_bytes,original_storage_key,
           processed_size_bytes,processed_storage_key,checksum_sha256,width,height,alt_text,public_storage_key,public_url)
          VALUES($1,'supporting_image','approved','simulation.webp','image/webp',44,$2,44,$3,repeat('a',64),1,1,'Image synthétique',$2,
          'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAA==') RETURNING id`,
            [id, `${id}/original`, `${id}/processed`]
          )
        ).rows[0].id;
        const contentResponse = await page.request.get(
          `/api/admin/moderation/content?subjectType=media&subjectId=${media}`
        );
        expect(contentResponse.ok()).toBe(true);
        const content = await contentResponse.json();
        const approved = await page.request.post(
          '/api/admin/moderation/decisions',
          {
            headers: { Origin: stack.origin },
            data: {
              subject: { type: 'media', id: media },
              decision: {
                requestId: randomUUID(),
                policyVersion: '1.0',
                contentVersion: content.contentVersion,
                contentFingerprint: content.fingerprint,
                expectedDecisionId: content.currentDecisionId,
                confirmation: media,
                level: 'N0'
              }
            }
          }
        );
        expect(approved.ok(), await approved.text()).toBe(true);
      }
      await automation(page, stack.origin, {
        action: 'check',
        feedId: 'openg7:facebook'
      });
      // Real private preparation is fixture setup; the decisions below belong to the UI.
      await automation(page, stack.origin, {
        action: 'prepare',
        feedId: 'openg7:facebook'
      });
      const delivery = (
        await (
          await page.request.get('/api/admin/publication-automation')
        ).json()
      ).deliveries.find(
        (d: { sponsors: { id: string }[] }) => d.sponsors.length === 2
      );
      expect(delivery).toBeTruthy();
      const snapshot = async () => ({
        sponsors: (
          await stack.pool.query(
            'SELECT id,sponsor_review_status,sponsor_feed_status,status,amount_cents FROM fund_contributions WHERE id=ANY($1::uuid[]) ORDER BY id',
            [ids]
          )
        ).rows,
        delivery: (
          await stack.pool.query(
            'SELECT status,version,approved_at FROM publication_deliveries WHERE id=$1',
            [delivery.id]
          )
        ).rows[0],
        decisions: (
          await stack.pool.query(
            "SELECT count(*)::int AS n FROM moderation_decisions WHERE subject_type IN ('sponsorship','publication_delivery')"
          )
        ).rows[0].n
      });
      const baseline = await snapshot();
      await page.reload();
      await page
        .locator('[data-og7="pilot-domains"] [data-domain="publications"]')
        .click();
      await expect(page.locator('[data-og7="pilot-decision"]')).toHaveAttribute(
        'data-og7-id',
        'publication:' + delivery.id
      );
      await page.locator('[data-og7="pilot-accept"]').click();
      await expect(
        page.locator('[data-og7="pilot-panel-confirm"]')
      ).toContainText('Atelier groupé synthétique 2');
      await page.locator('[data-og7="pilot-confirm"]').click();
      await approvePanel(
        page,
        `Atelier groupé synthétique ${ids.indexOf(delivery.sponsors[0].id) + 1}`
      );
      // Aborting the second subject must persist none of the collected decisions.
      await expect(
        page.locator('[data-og7="moderation-confirmation"]')
      ).toBeVisible();
      await page.keyboard.press('Escape');
      expect(await snapshot()).toEqual(baseline);
      await page.locator('[data-og7="pilot-confirm"]').click();
      for (const sponsor of delivery.sponsors)
        await approvePanel(
          page,
          `Atelier groupé synthétique ${ids.indexOf(sponsor.id) + 1}`
        );
      await expect(
        page.locator('[data-og7="moderation-confirmation"]')
      ).toBeVisible();
      if (conflict)
        await stack.pool.query(
          "UPDATE fund_contributions SET sponsor_review_note='Concurrent synthetic review',updated_at=clock_timestamp() WHERE id=$1",
          [ids[1]]
        );
      const [command] = await Promise.all([
        page.waitForResponse(
          (r) =>
            new URL(r.url()).pathname === '/api/admin/pilotage/command' &&
            r.request().method() === 'POST'
        ),
        approvePanel(page, delivery.message.split('\n')[0])
      ]);
      const receipt = await command.json();
      const submitted = command.request().postDataJSON();
      expect(submitted.targetId).toBe(delivery.id);
      expect(
        submitted.payload.approveSponsors
          .map((s: { id: string }) => s.id)
          .sort()
      ).toEqual(ids);
      for (const sponsor of submitted.payload.approveSponsors)
        expect(sponsor.moderationDecision.confirmation).toBe(sponsor.id);
      expect(submitted.payload.moderationDecision.confirmation).toBe(
        delivery.id
      );
      const audits = (
        await stack.pool.query(
          `SELECT actor,action,entity_id,metadata FROM admin_audit_log
        WHERE action LIKE 'pilotage.%' AND metadata->>'requestId'=$1 ORDER BY created_at`,
          [submitted.requestId]
        )
      ).rows;
      expect(audits.map((a) => a.action)).toEqual([
        'pilotage.requested',
        conflict ? 'pilotage.failed' : 'pilotage.completed'
      ]);
      expect(
        audits.every(
          (a) => /^admin:/.test(a.actor) && a.entity_id === delivery.id
        )
      ).toBe(true);
      expect(new Set(audits.map((a) => a.actor)).size).toBe(1);
      if (conflict) {
        expect(receipt.status).toBe('failed');
        expect(receipt.code).toBe('VERSION_CONFLICT');
        expect(await snapshot()).toEqual(baseline);
      } else {
        expect(receipt.status).toBe('completed');
        const saved = await snapshot();
        expect(saved.sponsors.map((s) => s.sponsor_review_status)).toEqual([
          'approved',
          'approved'
        ]);
        expect(saved.sponsors.map((s) => s.sponsor_feed_status)).toEqual(
          baseline.sponsors.map((s) => s.sponsor_feed_status)
        );
        expect(saved.sponsors.map((s) => [s.status, s.amount_cents])).toEqual(
          baseline.sponsors.map((s) => [s.status, s.amount_cents])
        );
        expect(saved.delivery.status).toBe('approved');
        expect(saved.decisions).toBe(3);
        const decisions = (
          await stack.pool
            .query(`SELECT subject_id,actor FROM moderation_decisions
          WHERE subject_type IN ('sponsorship','publication_delivery') ORDER BY subject_id`)
        ).rows;
        expect(decisions.map((d) => d.subject_id).sort()).toEqual(
          [...ids, delivery.id].sort()
        );
        expect(decisions.every((d) => d.actor === audits[0].actor)).toBe(true);
        const replay = await page.request.post('/api/admin/pilotage/command', {
          headers: { Origin: stack.origin },
          data: command.request().postDataJSON()
        });
        expect((await replay.json()).status).toBe('completed');
        expect(await snapshot()).toEqual(saved);
      }
      expect(
        (
          await stack.pool.query(
            'SELECT count(*)::int AS n FROM social_publication_jobs'
          )
        ).rows[0].n
      ).toBe(0);
    } finally {
      await session.context.close();
      await stack.stop();
    }
  });
}
