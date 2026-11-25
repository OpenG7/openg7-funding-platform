import { readFile } from 'node:fs/promises';

import { AxeBuilder } from '@axe-core/playwright';

import { expect, test } from './support/test.js';
import { moderationFixture, completeModeration } from './support/moderation.js';
import { engineRoomFixture } from './support/engine-room.js';

const id = '11111111-1111-4111-8111-111111111111';
const planId = '22222222-2222-4222-8222-222222222222';
const base = '/admin/fundraiser/pilotage';
async function fixtures(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    sessionStorage.setItem(
      'openg7-admin-session-token',
      'openg7-admin-session.ui-fixture'
    );
    sessionStorage.setItem(
      'openg7-admin-session-expires-at',
      '2099-01-01T00:00:00Z'
    );
  });
  const photos = Array.from({ length: 3 }, (_, i) => ({
    id: `33333333-3333-4333-8333-${String(i + 1).padStart(12, '0')}`,
    version: '1',
    kind: 'supporting_image',
    originalFilename: `Photo ${i + 1}.webp`,
    reviewStatus: 'pending_review',
    altText: `Atelier synthétique ${i + 1}`
  }));
  const workspace = {
    contributionId: id,
    revision: '1',
    assets: photos,
    rules: [],
    batches: [],
    writable: true
  };
  const candidate = {
    id: 'sponsorship_needs_review:' + id,
    domain: 'sponsors',
    kind: 'sponsorship_needs_review',
    targetId: id,
    version: '1',
    title: 'Entreprise synthétique',
    severity: 'today',
    dueAt: null,
    detailsUrl: '/admin/fundraiser/sponsors?sponsorshipId=' + id,
    facts: [],
    actions: [
      { id: 'sponsor.approve', blocked: null },
      { id: 'sponsor.reject', blocked: null }
    ],
    sponsor: {
      id,
      name: 'Entreprise synthétique',
      status: 'pending_review',
      presentationId: null,
      presentationApproved: false
    }
  };
  const state = {
    generatedAt: '2026-11-22T15:00:00Z',
    coverage: 'complete',
    missingSources: [],
    total: 2,
    page: 1,
    pageSize: 30,
    domains: {
      publications: 0,
      sponsors: 2,
      email: 0,
      invoices: 0,
      contributions: 0,
      projects: 0,
      operations: 0
    },
    feeds: [],
    workerEnabled: false,
    writable: true,
    decisions: [
      candidate,
      { ...candidate, id: 'second:' + id, title: 'Autre dossier' }
    ]
  };
  const commands: Record<string, unknown>[] = [];
  const options = { blocked: false };
  const photo = await readFile(
    'apps/funding-web/src/assets/openg7-social-communautes-connectees-canada-960.webp'
  );
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (
      route.request().method() === 'POST' &&
      url.pathname.endsWith('/moderation/decisions')
    ) {
      const body = route.request().postDataJSON();
      if (body.subject?.type === 'media' && body.decision?.level === 'N3') {
        const asset = photos.find((photo) => photo.id === body.subject.id);
        if (asset) asset.reviewStatus = 'rejected';
      }
    }
    if (
      await moderationFixture(route, [
        { type: 'sponsorship', id },
        ...photos.map((p) => ({ type: 'media' as const, id: p.id }))
      ])
    )
      return;
    if (url.pathname.endsWith('/pilotage'))
      return route.fulfill({ json: state });
    if (url.pathname.endsWith('/workspace'))
      return route.fulfill({ json: workspace });
    if (url.pathname.endsWith('/approve-all/plan'))
      return route.fulfill({
        json: {
          kind: 'approve_all',
          id: planId,
          contributionId: id,
          revision: '1',
          expiresAt: '2099-01-01T00:00:00Z',
          candidates: photos.map((asset) => ({
            asset,
            classification: 'eligible',
            reasons: []
          })),
          summary: {
            total: 3,
            eligible: 3,
            blocked: options.blocked ? 1 : 0,
            alreadyApproved: 0,
            notProcessable: 0,
            authorizationRequired: 0,
            consentRequestable: 0
          },
          effects: []
        }
      });
    if (url.pathname.includes('/media/content/'))
      return route.fulfill({
        body: photo,
        contentType: 'image/webp',
        headers: {
          'X-OpenG7-Media-Version':
            url.searchParams.get('expectedVersion') || '1'
        }
      });
    if (url.pathname.endsWith('/pilotage/command')) {
      const command = route.request().postDataJSON();
      commands.push(command);
      return route.fulfill({
        json: {
          requestId: command.requestId,
          action: command.action,
          targetId: command.targetId,
          status: 'completed',
          code: 'APPROVED'
        }
      });
    }
    return route.fulfill({ status: 503, json: {} });
  });
  return { commands, options, photos };
}

for (const language of ['fr-CA', 'en'])
  for (const width of [390, 1536]) {
    test(`decision-first layout keeps three photos and drawers accessible in ${language} at ${width}`, async ({
      page
    }, info) => {
      await fixtures(page);
      await page.addInitScript(
        (locale) => localStorage.setItem('openg7.language', locale),
        language
      );
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(base);
      await expect(page.locator('[data-og7="pilot-photo"]')).toHaveCount(3);
      for (const photo of await page
        .locator('[data-og7="pilot-photo"]')
        .all()) {
        await photo.scrollIntoViewIfNeeded();
        const thumbnail = photo.locator('img');
        await expect(thumbnail).toBeVisible();
        await expect
          .poll(() =>
            thumbnail.evaluate((image: HTMLImageElement) => image.naturalWidth)
          )
          .toBeGreaterThan(0);
      }
      await page.locator('.compact-heading').scrollIntoViewIfNeeded();
      await expect(page.locator('[data-og7="pilot-queue"]')).toHaveCount(0);
      await expect(page.locator('[data-og7="pilot-domains"]')).toHaveCount(0);
      const card = page.locator('[data-og7="pilot-decision"]');
      expect(
        (await page.locator('.compact-heading').boundingBox())!.height
      ).toBeLessThan(150);
      expect((await card.boundingBox())!.y).toBeLessThan(
        width === 390 ? 430 : 300
      );
      await page.locator('[data-og7="pilot-workspace-tools"]').click();
      await expect(page.locator('[data-og7="pilot-domains"]')).toBeVisible();
      const workspace = page.locator('[data-og7="pilot-workspace-panel"]');
      expect(
        await workspace.evaluate(
          (panel) => panel.scrollWidth <= panel.clientWidth + 1
        )
      ).toBe(true);
      const workspaceAxe = await new AxeBuilder({ page })
        .include('[data-og7="admin-drawer"]')
        .analyze();
      expect(workspaceAxe.violations).toEqual([]);
      await page.screenshot({
        path: info.outputPath('spaces-and-progress.png')
      });
      await page.keyboard.press('Escape');
      await expect(
        page.locator('[data-og7="pilot-workspace-tools"]')
      ).toBeFocused();
      if (width === 390) {
        await page.locator('[data-og7="pilot-workspace-tools"]').click();
        await page.locator('[data-og7="pilot-open-queue"]').click();
      } else await page.locator('[data-og7="pilot-deck-queue"]').click();
      await expect(page.locator('[data-og7="pilot-queue"]')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(
        page.locator(
          width === 390
            ? '[data-og7="pilot-workspace-tools"]'
            : '[data-og7="pilot-deck-queue"]'
        )
      ).toBeFocused();
      await page.locator('.photo-preview').first().click();
      await expect(
        page.getByRole('dialog').locator('.full-photo')
      ).toBeVisible();
      await page.keyboard.press('Escape');
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath('decision-three-photos.png'),
        fullPage: true
      });
      const axe = await new AxeBuilder({ page })
        .include('[data-og7="pilot-decision"]')
        .analyze();
      expect(axe.violations).toEqual([]);
    });
  }

test('Approve all explicitly confirms the three-photo plan and keeps its exact scope in the command', async ({
  page
}) => {
  const { commands } = await fixtures(page);
  await page.goto(base);
  await page.locator('[data-og7="pilot-accept"]').click();
  await expect(
    page.locator('[data-og7="pilot-approve-all-scope"]')
  ).toContainText('3');
  await expect(page.locator('[data-og7="pilot-panel-confirm"] li')).toHaveCount(
    3
  );
  expect(commands).toEqual([]);
  await page.locator('[data-og7="pilot-confirm"]').click();
  await completeModeration(page);
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]!.payload).toMatchObject({ approveMediaPlanId: planId });
});

test('a blocked media plan cannot approve the dossier', async ({ page }) => {
  const { commands, options } = await fixtures(page);
  options.blocked = true;
  await page.goto(base);
  await page.locator('[data-og7="pilot-accept"]').click();
  await expect(page.locator('[data-og7="pilot-confirm"]')).toBeDisabled();
  await expect(
    page.locator('[data-og7="pilot-panel-confirm"] [role="alert"]')
  ).toBeVisible();
  expect(commands).toEqual([]);
});

test('a photo can be disapproved separately without approving or rejecting other photos', async ({
  page
}) => {
  const { commands, photos } = await fixtures(page);
  for (const photo of photos) photo.reviewStatus = 'approved';
  await page.goto(base);
  await page.locator('[data-og7="pilot-photo-disapprove"]').first().click();
  await completeModeration(page, true);
  await expect(page.locator('[data-og7="pilot-photo"]').first()).toContainText(
    'Refusée'
  );
  await expect(page.locator('[data-og7="pilot-photo"]').nth(1)).toContainText(
    'Approuvée'
  );
  await expect(page.locator('[data-og7="pilot-photo"]').nth(2)).toContainText(
    'Approuvée'
  );
  expect(commands).toEqual([]);
});

async function publicationFixtures(page: import('@playwright/test').Page) {
  await fixtures(page);
  const feed = {
    id: 'canada:facebook',
    paused: true,
    autoPrepare: false,
    mode: 'mock',
    accountId: 'sandbox-page',
    configured: true,
    connection: 'unchecked',
    checkedAt: null,
    timezone: 'America/Toronto',
    weekdays: [1],
    localTime: '09:00',
    capacity: 3,
    horizonDays: 7
  };
  const delivery = {
    id,
    feedId: feed.id,
    kind: 'sponsorship',
    batchId: planId,
    message: 'Publication synthétique',
    scheduledAt: '2099-01-01T12:00:00Z',
    mediaId: null,
    accountId: feed.accountId,
    mode: 'mock',
    autoManaged: true,
    sponsors: [
      {
        id: planId,
        name: 'Dossier synthétique',
        version: '1',
        reviewStatus: 'approved',
        presentationApproved: true
      }
    ],
    version: 1,
    status: 'draft',
    attempts: 0,
    errorCode: null
  };
  const candidate = {
    id: 'publication:' + id,
    targetId: id,
    domain: 'publications',
    kind: 'publication_draft',
    version: '1',
    title: delivery.message,
    dueAt: delivery.scheduledAt,
    severity: 'this_week',
    detailsUrl: '/admin/fundraiser/publications/automation?deliveryId=' + id,
    facts: [],
    actions: [{ id: 'publication.approve', blocked: 'CONNECTION_REQUIRED' }],
    publication: delivery
  };
  const options = { fail: false };
  const writes: string[] = [];
  const queries: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/') && request.method() !== 'GET')
      writes.push(request.method() + ' ' + request.url());
  });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/pilotage'))
      return route.fulfill({
        json: {
          generatedAt: '2026-11-22T15:00:00Z',
          coverage: 'complete',
          missingSources: [],
          total: 1,
          page: 1,
          pageSize: 30,
          writable: true,
          workerEnabled: false,
          domains: { publications: 1 },
          feeds: [feed],
          decisions: [candidate]
        }
      });
    if (url.pathname.endsWith('/publication-automation')) {
      queries.push(url.search);
      return route.fulfill(
        options.fail
          ? { status: 503, json: {} }
          : {
              json: {
                workerEnabled: false,
                workerVersion: 1,
                feeds: [feed, { ...feed, id: 'unrelated:linkedin' }],
                deliveries: [delivery],
                summary: {
                  awaitingApproval: 1,
                  scheduled: 0,
                  exceptions: 0,
                  publishedToday: 0
                }
              }
            }
      );
    }
    return route.fallback();
  });
  return { options, writes, queries };
}

test('blocked approval opens the engine room with dossier context and exact decision return', async ({
  page
}) => {
  await publicationFixtures(page);
  const { reads, writes } = await engineRoomFixture(page);
  await page.goto(base);
  await expect(page.locator('[data-og7="pilot-accept"]')).toHaveCount(0);
  await page.locator('[data-og7="pilot-publication-status"]').click();
  await expect(page).toHaveURL(/engine-room\?sponsorshipId=/);
  await expect(page.locator('[data-og7="engine-feed"]')).toHaveCount(1);
  expect(reads[0]).toContain('sponsorshipId=' + planId);
  await page.locator('[data-og7="engine-room-scope"] a').first().click();
  await expect(page.locator('[data-og7="pilot-decision"]')).toHaveAttribute(
    'data-og7-id',
    'publication:' + id
  );
  expect(writes).toEqual([]);
});
