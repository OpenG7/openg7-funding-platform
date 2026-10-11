import { randomUUID } from 'node:crypto';

import type {
  PublicationAutomationCommand,
  PublicationAutomationState
} from '@openg7/funding-core';

import { adminSessionHeaders, signInAsAdmin } from './support/admin-auth.js';
import { acceptanceSql } from './support/acceptance-database.js';
import { expect, test } from './support/test.js';

test('oversized recognition stays visible and correction returns the same source to private preparation', async ({
  page,
  request
}, info) => {
  test.skip(
    process.env.OPENG7_E2E_ISOLATED !== '1',
    'Disposable simulation only.'
  );
  test.setTimeout(180000);
  const url = '/api/admin/publication-automation';
  const feedId = 'openg20:linkedin' as const;
  const headers = await adminSessionHeaders(request);
  const state = async (
    sponsorshipId?: string
  ): Promise<PublicationAutomationState> => {
    const response = await request.get(
      url + (sponsorshipId ? '?sponsorshipId=' + sponsorshipId : ''),
      { headers }
    );
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const command = async (data: PublicationAutomationCommand) => {
    const response = await request.post(url, { headers, data });
    expect(response.ok(), await response.text()).toBe(true);
  };
  const initial = await state();
  expect(initial.feeds.every((feed) => feed.mode === 'mock')).toBe(true);
  if (initial.workerEnabled)
    await command({
      action: 'worker',
      enabled: false,
      version: initial.workerVersion,
      confirmation: 'disable-worker'
    });
  const feed = initial.feeds.find((value) => value.id === feedId)!;
  const future = new Date(Date.now() + 5 * 60000);
  await command({
    action: 'settings',
    settings: {
      ...feed,
      paused: true,
      autoPrepare: false,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      timezone: 'UTC',
      localTime: future.toISOString().slice(11, 16),
      capacity: 10,
      horizonDays: 14
    }
  });
  const sponsorIds = [randomUUID(), randomUUID()];
  const draftIds = [randomUUID(), randomUUID()];
  const names = sponsorIds.map(
    (id, index) => `Atelier file ${index} ${id.slice(0, 8)}`
  );
  for (let index = 0; index < sponsorIds.length; index++) {
    await acceptanceSql(
      `INSERT INTO fund_contributions(id,contribution_type,amount_cents,status,public_display_consent,sponsor_review_status,sponsor_company_name,sponsor_feed_target,sponsor_feed_channels)
       VALUES($1,'sponsorship_interest',50000,'paid',TRUE,'pending_review',$2,'openg20','["linkedin"]')`,
      [sponsorIds[index], names[index]]
    );
    await acceptanceSql(
      `INSERT INTO sponsor_publication_drafts(id,contribution_id,feed_target,channel,title,body,disclosure_text,created_at)
       VALUES($1,$2,'openg20','linkedin',$3,$4,'Commandite rémunérée.',NOW()-($5::int * INTERVAL '1 minute'))`,
      [
        draftIds[index],
        sponsorIds[index],
        'Merci à ' + names[index],
        index === 0 ? 'x'.repeat(2900) : 'Reconnaissance de recette.',
        2 - index
      ]
    );
  }
  const [original] = await acceptanceSql<{ created_at: string }>(
    'SELECT created_at::text FROM sponsor_publication_drafts WHERE id=$1',
    [draftIds[0]]
  );
  const before = await acceptanceSql(
    'SELECT id,status,amount_cents,sponsor_review_status FROM fund_contributions WHERE id=ANY($1::uuid[]) ORDER BY id',
    [sponsorIds]
  );
  try {
    expect((await request.get(url)).status()).toBe(401);
    expect(
      (await request.get(url + '?queueOffset=-1', { headers })).status()
    ).toBe(400);
    await command({ action: 'prepare', feedId });
    let blocked = await state(sponsorIds[0]);
    expect(blocked.deliveries).toHaveLength(0);
    expect(blocked.queue?.summary).toEqual({
      retained: 0,
      deferred: 0,
      needsCorrection: 1
    });
    expect(blocked.queue?.entries[0]).toMatchObject({
      draftId: draftIds[0],
      status: 'needs_correction',
      reason: 'INDIVIDUAL_TEXT_TOO_LONG',
      budget: 2900,
      batchId: null,
      deliveryId: null
    });
    expect(blocked.queue!.entries[0]!.renderedLength).toBeGreaterThan(2900);
    expect((await state(sponsorIds[1])).queue?.entries[0]?.status).toBe(
      'retained'
    );
    await command({ action: 'prepare', feedId });
    const audits = await acceptanceSql<{ count: number }>(
      `SELECT count(*)::int FROM admin_audit_log WHERE entity_id=$1 AND action='publication_automation.source_render_blocked'`,
      [draftIds[0]]
    );
    expect(audits[0]!.count).toBe(1);
    await signInAsAdmin(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(
      '/admin/fundraiser/publications/automation?sponsorshipId=' + sponsorIds[0]
    );
    const row = page.locator(
      `[data-og7="publication-source-entry"][data-og7-id="${draftIds[0]}"]`
    );
    await expect(row).toContainText(names[0]!);
    await expect(
      row.getByRole('link', { name: /Modifier le brouillon/ })
    ).toHaveAttribute('href', /draftId=/);
    await page.reload();
    await expect(row).toContainText(/2\s?900/);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath('source-correction-mobile.png'),
      fullPage: true
    });
    const response = await request.post(
      '/api/admin/publication-drafts/update',
      {
        headers,
        data: {
          draftId: draftIds[0],
          body: 'Texte corrigé de recette, sans troncature automatique.'
        }
      }
    );
    expect(response.ok(), await response.text()).toBe(true);
    await command({ action: 'prepare', feedId });
    blocked = await state(sponsorIds[0]);
    expect(blocked.queue?.summary).toEqual({
      retained: 1,
      deferred: 0,
      needsCorrection: 0
    });
    expect(blocked.queue?.entries[0]).toMatchObject({
      draftId: draftIds[0],
      status: 'retained',
      reason: 'AWAITING_APPROVAL'
    });
    expect(blocked.deliveries).toHaveLength(1);
    expect(blocked.deliveries[0]).toMatchObject({
      status: 'draft',
      approvedAt: null,
      attempts: 0
    });
    expect(blocked.deliveries[0]!.message).toContain(names[0]!);
    await page.reload();
    await expect(row).toContainText(names[0]!);
    await expect(
      page.locator('[data-og7="publication-source-retained-count"]')
    ).toHaveText('1');
    expect(
      await acceptanceSql(
        'SELECT created_at::text FROM sponsor_publication_drafts WHERE id=$1',
        [draftIds[0]]
      )
    ).toEqual([original]);
    expect(
      await acceptanceSql(
        'SELECT id,status,amount_cents,sponsor_review_status FROM fund_contributions WHERE id=ANY($1::uuid[]) ORDER BY id',
        [sponsorIds]
      )
    ).toEqual(before);
    const publicResponse = await request.get('/api/public/sponsorships');
    expect(publicResponse.ok()).toBe(true);
    const publicDirectory = JSON.stringify(await publicResponse.json());
    for (const name of names) expect(publicDirectory).not.toContain(name);
    for (const id of sponsorIds) {
      const result = await state(id);
      for (const delivery of result.deliveries) {
        const receipt = await request.get(
          process.env.STRIPE_STUB_BASE_URL! +
            '/__test__/social/receipts?deliveryId=' +
            delivery.id
        );
        expect((await receipt.json()).requests).toHaveLength(0);
      }
    }
  } finally {
    await command({ action: 'settings', settings: feed });
  }
});
