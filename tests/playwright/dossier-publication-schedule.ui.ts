import type { Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import type {
  AdminSponsorshipProgress,
  PublicationAutomationCommand,
  PublicationAutomationState,
  PublicationDelivery,
  PublicationPreparationEntry,
  SponsorshipCommitmentRecord
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';
import { completeModeration, moderationFixture } from './support/moderation.js';
import { registerPublicationNavigationTests } from './publication-navigation.ui.js';

interface Context {
  fixtures(
    page: Page,
    role?: 'owner' | 'operator' | 'reader'
  ): Promise<{
    options: { progressOverrides: Partial<AdminSponsorshipProgress> };
  }>;
  path(tab?: string, value?: string): string;
  dossier(value?: string): AdminSponsorshipProgress;
  recordedCommitment(amountMinor: number): SponsorshipCommitmentRecord;
}

const sponsorshipId = '10000000-0000-4000-8000-000000000401';
const otherId = '10000000-0000-4000-8000-000000000402';
const deliveryId = '77777777-7777-4777-8777-777777777777';
const scheduledAt = '2030-06-04T14:00:00.000Z';
const evaluatedAt = '2030-06-01T12:00:00.000Z';

async function fixtures(
  page: Page,
  context: Context,
  role: 'owner' | 'operator' | 'reader' = 'owner'
) {
  const { options } = await context.fixtures(page, role);
  const commitment = context.recordedCommitment(10000);
  const obligation = commitment.obligations.find(
    (item) => item.channel === 'facebook'
  )!;
  options.progressOverrides = {
    amountMinor: 10000,
    commitment,
    publicationCompletion: { done: 0, total: 3 },
    publications: [
      {
        ...context.dossier().publications[0]!,
        obligationId: obligation.id,
        status: 'draft',
        batchStatus: 'scheduled',
        deliveryId,
        deliveryStatus: 'draft',
        deliveryMode: 'mock',
        scheduledAt
      }
    ],
    publicationWorkflow: {
      state: 'action_required',
      responsibility: 'admin',
      reason: 'publication_preparation_required',
      obligations: [
        {
          obligationId: obligation.id,
          channel: 'facebook',
          target: 'openg7',
          ordinal: obligation.ordinal,
          state: 'action_required',
          responsibility: 'admin',
          reason: 'publication_preparation_required',
          deliveryId,
          scheduledAt
        }
      ]
    }
  };
  const job: PublicationDelivery = {
    id: deliveryId,
    feedId: 'openg7:facebook',
    kind: 'sponsorship',
    batchId: otherId,
    message:
      'Atelier Boréal\nUne initiative synthétique.\nCommandite\n\nAtelier Rivage\nUne seconde initiative synthétique.\nCommandite',
    scheduledAt,
    mediaId: null,
    mediaUrl: null,
    mediaAlt: null,
    accountId: 'synthetic-page-openg7',
    mode: 'mock',
    autoManaged: true,
    sponsors: [sponsorshipId, otherId].map((id, index) => ({
      id,
      name: index ? 'Atelier Rivage' : 'Atelier Boréal',
      version: 'v1',
      reviewStatus: 'approved',
      paymentStatus: 'paid',
      presentationApproved: true
    })),
    version: 1,
    status: 'draft',
    attempts: 0,
    nextAttemptAt: null,
    externalPostId: null,
    externalPostUrl: null,
    errorCode: null,
    approvedAt: null,
    publishedAt: null
  };
  const entry: PublicationPreparationEntry = {
    draftId: otherId,
    sponsorshipId,
    name: 'Atelier Boréal',
    feedId: 'openg7:facebook',
    status: 'retained',
    reason: 'AWAITING_APPROVAL',
    renderedLength: 100,
    budget: 2900,
    createdAt: evaluatedAt,
    scheduledAt,
    batchId: otherId,
    deliveryId,
    deliveryStatus: 'draft',
    nextOpportunity: {
      proposedAt: scheduledAt,
      withinHorizon: true,
      reason: 'EXISTING_PROPOSAL',
      action: 'REVIEW_PROPOSAL',
      evaluatedAt,
      searchUntil: '2030-08-30T12:00:00.000Z'
    }
  };
  const state: PublicationAutomationState = {
    workerEnabled: true,
    workerVersion: 1,
    feeds: [
      {
        id: 'openg7:facebook',
        paused: true,
        autoPrepare: true,
        timezone: 'America/Toronto',
        weekdays: [2, 4],
        localTime: '10:00',
        capacity: 5,
        horizonDays: 14,
        mode: 'mock',
        accountId: job.accountId,
        configured: true,
        expiresAt: null,
        connection: 'ready',
        checkedAt: evaluatedAt
      }
    ],
    deliveries: [job],
    queue: {
      entries: [entry],
      summary: { retained: 1, deferred: 0, needsCorrection: 0 },
      total: 1,
      offset: 0,
      limit: 200,
      hasMore: false,
      scope: 'filtered',
      evaluatedAt
    },
    summary: {
      awaitingApproval: 1,
      scheduled: 0,
      exceptions: 0,
      publishedToday: 0
    }
  };
  const controls = {
    status: 200,
    commandStatus: 200,
    gate: null as Promise<void> | null,
    reads: [] as URL[],
    commands: [] as PublicationAutomationCommand[],
    preparedState: null as PublicationAutomationState | null
  };
  await page.route('**/api/admin/moderation/**', async (route) => {
    if (
      await moderationFixture(route, [
        ...state.deliveries.map((delivery) => ({
          type: 'publication_delivery' as const,
          id: delivery.id
        })),
        { type: 'sponsorship', id: sponsorshipId },
        { type: 'sponsorship', id: otherId }
      ])
    )
      return;
    await route.fallback();
  });
  await page.route('**/api/admin/publication-automation**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/media')) return route.fulfill({ json: [] });
    if (request.method() === 'GET') {
      controls.reads.push(url);
      const selected = url.searchParams.get('sponsorshipId');
      const selectedDelivery = url.searchParams.get('deliveryId');
      const snapshot = structuredClone({
        ...state,
        deliveries: state.deliveries
          .filter(
            (delivery) =>
              (!selected || delivery.sponsors.some((s) => s.id === selected)) &&
              (!selectedDelivery || delivery.id === selectedDelivery)
          )
          .slice(0, 200),
        queue: {
          ...state.queue!,
          entries: state.queue!.entries.filter(
            (source) => !selected || source.sponsorshipId === selected
          )
        }
      });
      if (selected === sponsorshipId) await controls.gate;
      return route.fulfill({
        status: controls.status,
        json: controls.status === 200 ? snapshot : { code: 'UNAVAILABLE' }
      });
    }
    const command = request.postDataJSON() as PublicationAutomationCommand;
    controls.commands.push(command);
    if (controls.commandStatus !== 200)
      return route.fulfill({
        status: controls.commandStatus,
        json: { code: 'UNAVAILABLE' }
      });
    if (command.action === 'prepare' && controls.preparedState)
      Object.assign(
        state,
        { preparationCandidates: [] },
        structuredClone(controls.preparedState)
      );
    if (command.action === 'approve') {
      job.status = 'approved';
      job.approvedAt = evaluatedAt;
      job.version++;
    }
    if (command.action === 'edit') {
      job.scheduledAt = command.scheduledAt;
      job.message = command.message;
      job.status = 'draft';
      job.approvedAt = null;
      job.version++;
    }
    return route.fulfill({ json: { updated: true } });
  });
  return { state, job, entry, controls, options };
}

const channel = (page: Page) =>
  page
    .locator('[data-og7="publication-service"]')
    .filter({ hasText: 'Facebook' })
    .first();

export function registerDossierPublicationScheduleTests(
  context: Context
): void {
  registerPublicationNavigationTests({
    host: 'sponsorship',
    open: async (page, destination) => {
      const { job, controls } = await fixtures(page, context);
      job.sponsors.forEach((sponsor) => {
        sponsor.reviewStatus = 'pending_review';
      });
      if (destination !== 'dossier') {
        job.status = 'blocked';
        job.errorCode =
          destination === 'media' ? 'MEDIA_CHANGED' : 'SOURCE_CONTENT_MISSING';
      }
      await page.goto(context.path('publication'));
      await channel(page)
        .locator('[data-og7="publication-service-action"]')
        .click();
      return controls.commands;
    }
  });

  for (const language of ['fr-CA', 'en'] as const) {
    test(`publication navigation never blocks the login redirect after its sponsorship session expires in ${language}`, async ({
      page
    }) => {
      const { job, controls } = await fixtures(page, context);
      job.sponsors[1]!.reviewStatus = 'pending_review';
      let expired = false;
      await page.route('**/api/admin/auth/current', (route) =>
        expired
          ? route.fulfill({
              status: 401,
              json: { error: 'Synthetic expired publication session' }
            })
          : route.fallback()
      );
      await page.addInitScript(
        (locale) => localStorage.setItem('openg7.language', locale),
        language
      );
      const mutations: string[] = [];
      page.on('request', (request) => {
        if (
          new URL(request.url()).pathname.startsWith('/api/admin/') &&
          !['GET', 'HEAD', 'OPTIONS'].includes(request.method())
        )
          mutations.push(request.url());
      });
      await page.goto(context.path('publication'));
      await channel(page)
        .locator('[data-og7="publication-service-action"]')
        .click();
      const english = language === 'en';
      const dialog = page.getByRole('dialog', {
        name: english ? 'Final publication' : 'Publication finale',
        exact: true
      });
      await dialog
        .getByRole('button', {
          name: english ? 'Edit' : 'Modifier',
          exact: true
        })
        .click();
      const privateText = 'Synthetic private draft from an expired session.';
      await dialog.locator('textarea[name="message"]').fill(privateText);
      const link = dialog
        .locator('[data-og7="publication-sponsor-review"]')
        .getByRole('link')
        .last();
      const target = await link.getAttribute('href');
      const deniedSession = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/api/admin/auth/current' &&
          response.status() === 401
      );
      expired = true;
      await link.focus();
      await page.keyboard.press('Enter');
      await deniedSession;
      await expect(page.locator('[data-og7="confirm-action"]')).toHaveCount(0);
      await expect(page).toHaveURL(/\/admin\/login\?/);
      expect(new URL(page.url()).searchParams.get('returnUrl')).toBe(target);
      await expect(dialog).toBeHidden();
      await expect(page.locator('[data-og7="confirm-action"]')).toHaveCount(0);
      await expect
        .poll(() =>
          page
            .locator('textarea')
            .evaluateAll((elements) =>
              elements.map((element) => (element as HTMLTextAreaElement).value)
            )
        )
        .not.toContain(privateText);
      expect(
        await page.evaluate(() =>
          sessionStorage.getItem('openg7-admin-session-token')
        )
      ).toBeNull();
      expect(controls.commands).toEqual([]);
      expect(mutations).toEqual([]);
    });

    for (const status of [401, 403]) {
      test(`publication navigation purges its private sponsorship draft and pending discard after a late ${status} media read in ${language}`, async ({
        page
      }) => {
        const { job, controls } = await fixtures(page, context);
        job.sponsors[1]!.reviewStatus = 'pending_review';
        await page.addInitScript(
          (locale) => localStorage.setItem('openg7.language', locale),
          language
        );
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        let markMediaRead!: () => void;
        const mediaRead = new Promise<void>((resolve) => {
          markMediaRead = resolve;
        });
        await page.route(
          '**/api/admin/publication-automation/media**',
          async (route) => {
            markMediaRead();
            await gate;
            await route.fulfill({
              status,
              json: { code: 'SYNTHETIC_MEDIA_ACCESS_DENIED' }
            });
          }
        );
        const mutations: string[] = [];
        page.on('request', (request) => {
          if (
            new URL(request.url()).pathname.startsWith('/api/admin/') &&
            !['GET', 'HEAD', 'OPTIONS'].includes(request.method())
          )
            mutations.push(request.url());
        });
        try {
          await page.goto(context.path('publication'));
          await channel(page)
            .locator('[data-og7="publication-service-action"]')
            .click();
          await mediaRead;
          const english = language === 'en';
          const dialog = page.getByRole('dialog', {
            name: english ? 'Final publication' : 'Publication finale',
            exact: true
          });
          await dialog
            .getByRole('button', {
              name: english ? 'Edit' : 'Modifier',
              exact: true
            })
            .click();
          const privateText = `Synthetic private draft awaiting ${status} cleanup.`;
          await dialog.locator('textarea[name="message"]').fill(privateText);
          const link = dialog
            .locator('[data-og7="publication-sponsor-review"]')
            .getByRole('link')
            .last();
          await link.focus();
          await page.keyboard.press('Enter');
          const confirmation = page.getByRole('dialog').filter({
            has: page.locator('[data-og7="confirm-action"]')
          });
          await expect(confirmation).toBeVisible();
          const deniedRead = page.waitForResponse(
            (response) =>
              new URL(response.url()).pathname ===
                '/api/admin/publication-automation/media' &&
              response.status() === status
          );
          release();
          await deniedRead;
          await expect(dialog).toBeHidden();
          await expect(confirmation).toBeHidden();
          await expect
            .poll(() =>
              page
                .locator('textarea')
                .evaluateAll((elements) =>
                  elements.map(
                    (element) => (element as HTMLTextAreaElement).value
                  )
                )
            )
            .not.toContain(privateText);
          // This media read is denied; /auth/current still describes a valid
          // fixture session. Assert private projection cleanup, not sign-out.
          expect(controls.commands).toEqual([]);
          expect(mutations).toEqual([]);
        } finally {
          release();
        }
      });
    }
  }

  test.describe('dossier publication schedule', () => {
    test.use({ timezoneId: 'Asia/Tokyo' });

    test('overview and publication monitor keep legacy delivery counts unconfirmed without qualified evidence', async ({
      page
    }) => {
      const { options, controls, job } = await fixtures(
        page,
        context,
        'reader'
      );
      job.mode = 'live';
      job.status = 'published';
      job.externalPostUrl = 'https://example.invalid/legacy-declaration';
      const commitment = options.progressOverrides.commitment!;
      const obligations = commitment.obligations.map((item) => ({
        ...item,
        state: 'fulfilled' as const,
        fulfilmentEvidenceId: 'synthetic-unqualified-proof-' + item.id
      }));
      options.progressOverrides = {
        ...options.progressOverrides,
        commitment: { ...commitment, obligations },
        publicationCompletion: { done: 3, total: 3 },
        publicationBlockers: ['review'],
        qualifiedFulfilmentEvidenceIds: [],
        fulfilmentEvidence: obligations.map((item) => ({
          id: item.fulfilmentEvidenceId,
          obligationId: item.id,
          deliveryId: item.channel === 'facebook' ? deliveryId : null,
          channel: item.channel,
          target: item.target,
          provenance:
            item.channel === 'website'
              ? 'website_verified'
              : 'provider_acknowledged',
          deliveredAt: evaluatedAt,
          externalPostUrl: job.externalPostUrl,
          visibility: 'unknown',
          visibilityObservedAt: null
        }))
      };
      await page.goto(context.path());
      const services = page.locator(
        '[data-og7="overview-stat"][data-og7-id="services"]'
      );
      await expect(services).toContainText(/0\s*\/\s*3/);
      await expect(
        page.locator('[data-og7="overview-domain"][data-og7-id="review"]')
      ).toContainText('En attente');
      await expect(
        page.locator('[data-og7="publication-blockers"]')
      ).toHaveCount(0);
      await services.focus();
      await services.press('Enter');
      const monitor = page.locator('[data-og7="publication-monitor"]');
      await expect(monitor).toBeVisible();
      await expect(
        monitor.locator('[data-og7="publication-service"]')
      ).toHaveCount(3);
      await expect(monitor.getByRole('progressbar')).toHaveAttribute(
        'value',
        '0'
      );
      await expect(monitor.getByRole('progressbar')).toHaveAttribute(
        'max',
        '3'
      );
      await expect(channel(page)).toHaveAttribute('data-state', 'exception');
      expect(controls.commands).toEqual([]);
    });

    for (const [language, width] of [
      ['fr-CA', 1280],
      ['en', 390]
    ] as const) {
      test(`publication delivery owner opens the exact proposal without preparing or authorizing in ${language} at ${width}px`, async ({
        page
      }) => {
        const { controls } = await fixtures(page, context);
        await page.addInitScript(
          (locale) => localStorage.setItem('openg7.language', locale),
          language
        );
        await page.setViewportSize({ width, height: 1000 });
        await page.goto(context.path('publication'));
        const action = channel(page).locator(
          '[data-og7="publication-service-action"]'
        );
        await expect(action).toBeEnabled();
        expect(controls.commands).toEqual([]);
        expect(
          controls.reads.every(
            (url) => url.searchParams.get('sponsorshipId') === sponsorshipId
          )
        ).toBe(true);
        await action.focus();
        await page.keyboard.press('Enter');
        const dialog = page.getByRole('dialog', {
          name: language === 'en' ? 'Final publication' : 'Publication finale',
          exact: true
        });
        await expect(dialog).toContainText('synthetic-page-openg7');
        await expect(dialog).toContainText('Asia/Tokyo');
        await expect(dialog).toContainText('Atelier Boréal');
        await expect(dialog).toContainText('Atelier Rivage');
        await expect(dialog.getByRole('checkbox')).not.toBeChecked();
        await expect(
          dialog.getByRole('button', {
            name:
              language === 'en'
                ? 'Accept and schedule'
                : 'Accepter et programmer'
          })
        ).toBeDisabled();
        expect(
          (await new AxeBuilder({ page }).include('dialog[open]').analyze())
            .violations
        ).toEqual([]);
        expect(
          await dialog.evaluate(
            (element) => element.scrollWidth <= element.clientWidth + 1
          )
        ).toBe(true);
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(action).toBeFocused();
        expect(controls.commands).toEqual([]);
      });
    }

    test('publication delivery authorization preserves the proposed instant and requires exact human moderation', async ({
      page
    }) => {
      const { controls, job, state } = await fixtures(page, context);
      job.mode = 'live';
      state.feeds[0]!.mode = 'live';
      state.feeds[0]!.paused = false;
      await page.goto(context.path('publication'));
      await channel(page)
        .locator('[data-og7="publication-service-action"]')
        .click();
      const dialog = page.getByRole('dialog', { name: 'Publication finale' });
      const approve = dialog.getByRole('button', {
        name: 'Accepter et programmer'
      });
      await expect(approve).toBeDisabled();
      await dialog.getByRole('checkbox', { name: /J’approuve/ }).check();
      await approve.click();
      expect(controls.commands).toEqual([]);
      await expect(
        page.locator('[data-og7="moderation-confirmation"]')
      ).not.toBeChecked();
      await completeModeration(page);
      await expect.poll(() => controls.commands.length).toBe(1);
      expect(controls.commands[0]).toMatchObject({
        action: 'approve',
        id: deliveryId,
        version: 1,
        confirmation: deliveryId
      });
      expect(
        controls.commands.some((command) => command.action === 'edit')
      ).toBe(false);
      expect(job.scheduledAt).toBe(scheduledAt);
      await expect(channel(page)).toHaveAttribute('data-state', 'scheduled');
      await expect(
        page
          .locator('[data-og7="publication-monitor"]')
          .getByRole('progressbar')
      ).toHaveAttribute('value', '0');
    });

    test('publication delivery editing uses the saved version and revokes prior authorization', async ({
      page
    }) => {
      const { controls, job } = await fixtures(page, context);
      job.status = 'approved';
      job.approvedAt = evaluatedAt;
      await page.goto(context.path('publication'));
      await editDelivery(page);
      const dialog = page.getByRole('dialog', { name: 'Publication finale' });
      await expect(dialog.getByLabel(/Asia\/Tokyo/)).toBeVisible();
      await expect(dialog.getByLabel('Texte exact à publier')).toHaveValue(
        job.message
      );
      await dialog
        .locator('input[type="datetime-local"]')
        .fill('2030-06-06T11:15');
      const save = dialog.getByRole('button', {
        name: 'Enregistrer le brouillon'
      });
      // Observe the pending save before letting reconciliation finish.
      let releaseRead!: () => void;
      controls.gate = new Promise<void>((resolve) => {
        releaseRead = resolve;
      });
      const reads = controls.reads.length;
      await save.click();
      await expect.poll(() => controls.commands.length).toBe(1);
      await expect.poll(() => controls.reads.length).toBeGreaterThan(reads);
      await expect(dialog).toBeVisible();
      await expect(save).toBeDisabled();
      const expectedAt = await page.evaluate(() =>
        new Date('2030-06-06T11:15').toISOString()
      );
      expect(controls.commands[0]).toMatchObject({
        action: 'edit',
        id: deliveryId,
        version: 1,
        scheduledAt: expectedAt
      });
      expect(job.approvedAt).toBeNull();
      expect(job.status).toBe('draft');
      expect(job.version).toBe(2);
      releaseRead();
      controls.gate = null;
      await expect(dialog).toBeHidden();
      const review = channel(page).locator(
        '[data-og7="publication-service-action"]'
      );
      await expect(review).toBeEnabled();
      await review.click();
      await expect(dialog).toBeVisible();
      await expect(
        dialog
          .locator('[data-og7="publication-content-context"] strong')
          .first()
      ).toHaveText('2');
      await expect(
        dialog.getByRole('checkbox', { name: /J’approuve/ })
      ).not.toBeChecked();
      await expect(
        dialog.getByRole('button', { name: 'Accepter et programmer' })
      ).toBeDisabled();
      expect(controls.commands).toHaveLength(1);
      await expect(
        page
          .locator('[data-og7="publication-monitor"]')
          .getByRole('progressbar')
      ).toHaveAttribute('value', '0');
    });

    test('publication monitor links first-draft preparation to the scoped engine without running it', async ({
      page
    }) => {
      const { state, options, controls } = await fixtures(page, context);
      state.deliveries = [];
      state.queue!.entries = [];
      options.progressOverrides = {
        ...options.progressOverrides,
        publications: [],
        publicationWorkflow: undefined
      };
      await page.goto(context.path('publication'));
      await channel(page)
        .locator('[data-og7="publication-service-action"]')
        .click();
      const detail = page.locator('[data-og7="publication-monitor-details"]');
      const engine = detail.getByRole('link', {
        name: 'Ouvrir le moteur de publication'
      });
      const target = new URL((await engine.getAttribute('href'))!, page.url());
      const obligationId =
        options.progressOverrides.commitment!.obligations.find(
          (item) => item.channel === 'facebook'
        )!.id;
      expect(target.pathname).toBe('/admin/fundraiser/publications/automation');
      expect(target.searchParams.get('sponsorshipId')).toBe(sponsorshipId);
      expect(target.searchParams.get('obligationId')).toBe(obligationId);
      expect(controls.commands).toEqual([]);
      await engine.click();
      await expect(page).toHaveURL(target.href);
      expect(controls.commands).toEqual([]);
    });

    for (const status of [401, 403]) {
      test(`publication delivery purges private edits after a failed save and ${status} reconciliation read`, async ({
        page
      }) => {
        const { controls, job } = await fixtures(page, context);
        await page.goto(context.path('publication'));
        await editDelivery(page);
        const dialog = page.getByRole('dialog', { name: 'Publication finale' });
        const privateText = 'Brouillon privé synthétique à purger';
        await dialog.getByLabel('Texte exact à publier').fill(privateText);
        controls.commandStatus = 503;
        controls.status = status;
        const reads = controls.reads.length;
        await dialog
          .getByRole('button', { name: 'Enregistrer le brouillon' })
          .click();
        await expect.poll(() => controls.reads.length).toBeGreaterThan(reads);
        await expect(dialog).toBeHidden();
        await expect
          .poll(() =>
            page
              .locator('textarea')
              .evaluateAll((fields) =>
                fields.map((field) => (field as HTMLTextAreaElement).value)
              )
          )
          .not.toContain(privateText);
        await expect(page.getByText(job.message, { exact: true })).toHaveCount(
          0
        );
        expect(controls.commands).toHaveLength(1);
        expect(controls.commands[0]).toMatchObject({ action: 'edit' });
      });
    }

    test('publication delivery retains a failed save draft and permits a safe discard after recovery', async ({
      page
    }) => {
      const { controls } = await fixtures(page, context);
      await page.goto(context.path('publication'));
      await editDelivery(page);
      const dialog = page.getByRole('dialog', { name: 'Publication finale' });
      controls.commandStatus = 503;
      const save = dialog.getByRole('button', {
        name: 'Enregistrer le brouillon'
      });
      await dialog
        .getByLabel('Texte exact à publier')
        .fill('Modification synthétique');
      const reads = controls.reads.length;
      await save.click();
      await expect.poll(() => controls.reads.length).toBeGreaterThan(reads);
      await expect(dialog.getByRole('alert')).toBeVisible();
      await expect(save).toBeEnabled();
      await page.keyboard.press('Escape');
      const confirmation = page
        .getByRole('dialog')
        .filter({ has: page.locator('[data-og7="confirm-action"]') });
      await expect(confirmation).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(confirmation).toBeHidden();
      await expect(dialog.getByLabel('Texte exact à publier')).toHaveValue(
        'Modification synthétique'
      );
      await page.keyboard.press('Escape');
      await expect(confirmation).toBeVisible();
      await confirmation.locator('[data-og7="confirm-action"]').click();
      await expect(dialog).toBeHidden();
      await expect(
        channel(page).locator('[data-og7="publication-service-action"]')
      ).toBeEnabled();
      expect(controls.commands).toHaveLength(1);
    });

    test('publication monitor opens an exact historical passage beyond the latest 200 without replacing the next passage', async ({
      page
    }) => {
      const { state, job, controls, options } = await fixtures(page, context);
      const historicalId = '77777777-7777-4777-8777-777777777778';
      const historicalDraftId = '77777777-7777-4777-8777-777777777779';
      const historicalObligationId = '77777777-7777-4777-8777-777777777780';
      const original = options.progressOverrides.commitment!;
      const facebook = original.obligations.find(
        (item) => item.channel === 'facebook'
      )!;
      const historical = {
        ...structuredClone(job),
        id: historicalId,
        batchId: historicalDraftId,
        message: 'Publication historique synthétique exacte',
        scheduledAt: '2030-05-01T14:00:00.000Z',
        status: 'published' as const,
        publishedAt: '2030-05-01T14:00:00.000Z'
      };
      state.deliveries = [
        job,
        ...Array.from({ length: 199 }, (_, index) => ({
          ...structuredClone(job),
          id: `77777777-7777-4777-8777-${String(index).padStart(12, '0')}`,
          status: 'published' as const
        })),
        historical
      ];
      options.progressOverrides = {
        ...options.progressOverrides,
        commitment: {
          ...original,
          obligations: [
            ...original.obligations,
            { ...facebook, id: historicalObligationId, ordinal: 2 }
          ]
        },
        publications: [
          ...options.progressOverrides.publications!,
          {
            ...options.progressOverrides.publications![0]!,
            id: historicalDraftId,
            obligationId: historicalObligationId,
            deliveryId: historicalId,
            deliveryStatus: 'published',
            scheduledAt: historical.scheduledAt,
            publishedAt: historical.publishedAt
          }
        ]
      };
      await page.goto(context.path('publication'));
      const historicalRow = page.locator(
        `[data-og7="publication-service"][data-og7-id="${historicalObligationId}"]`
      );
      await historicalRow
        .locator('[data-og7="publication-service-action"]')
        .click();
      await page
        .locator('[data-og7="publication-monitor-details"]')
        .getByRole('button', { name: 'Ouvrir la livraison' })
        .click();
      const dialog = page.getByRole('dialog', { name: 'Publication finale' });
      await expect(dialog).toContainText(historical.message);
      expect(
        controls.reads.some(
          (url) =>
            url.searchParams.get('sponsorshipId') === sponsorshipId &&
            url.searchParams.get('deliveryId') === historicalId
        )
      ).toBe(true);
      await page.keyboard.press('Escape');
      const current = page.locator(
        `[data-og7="publication-service"][data-og7-id="${facebook.id}"]`
      );
      await current.locator('[data-og7="publication-service-action"]').click();
      await expect(dialog).toContainText('Une seconde initiative synthétique.');
      expect(controls.commands).toEqual([]);
    });

    test('publication monitor reports a failed delivery read and refreshes without preparing or approving', async ({
      page
    }) => {
      const { controls } = await fixtures(page, context);
      controls.status = 503;
      await page.goto(context.path('publication'));
      await expect(
        page.locator('[data-og7="publication-monitor-error"]')
      ).toBeVisible();
      controls.status = 200;
      await page.locator('[data-og7="publication-monitor-refresh"]').click();
      await expect(
        page.locator('[data-og7="publication-monitor-error"]')
      ).toHaveCount(0);
      await expect(
        channel(page).locator('[data-og7="publication-service-action"]')
      ).toBeEnabled();
      expect(controls.commands).toEqual([]);
    });

    test('publication monitor ignores a late delivery snapshot after switching dossiers', async ({
      page
    }) => {
      const { controls, options } = await fixtures(page, context);
      options.progressOverrides = {
        ...options.progressOverrides,
        publications: []
      };
      let release!: () => void;
      controls.gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.goto('/admin/fundraiser/sponsors');
      await page.locator('[data-og7="sponsor-row"]').first().click();
      await page
        .locator('[data-og7="dossier-tabs"]')
        .getByRole('button', { name: 'Publication', exact: true })
        .click();
      await expect.poll(() => controls.reads.length).toBeGreaterThan(0);
      await page
        .getByRole('button', { name: 'Dossier suivant', exact: true })
        .click();
      await expect(
        page.locator('[data-og7="sponsorship-dossier"]')
      ).toContainText('Atelier Rivage');
      await expect
        .poll(() =>
          controls.reads.some(
            (url) => url.searchParams.get('sponsorshipId') === otherId
          )
        )
        .toBe(true);
      release();
      await expect(
        page
          .locator('[data-og7="publication-monitor"]')
          .getByRole('progressbar')
      ).toHaveCount(0);
      await expect(
        page.locator('[data-og7="publication-service"]')
      ).toHaveCount(0);
      expect(controls.commands).toEqual([]);
    });
  });
}

async function editDelivery(page: Page): Promise<void> {
  await channel(page)
    .locator('[data-og7="publication-service-action"]')
    .click();
  const dialog = page.getByRole('dialog', { name: 'Publication finale' });
  await dialog.getByRole('button', { name: 'Modifier', exact: true }).click();
}
