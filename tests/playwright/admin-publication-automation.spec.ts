import type { Locator, Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import type {
  PublicationAutomationCommand,
  PublicationAutomationState,
  PublicationDelivery,
  PublicationPreparationEntry,
  PublicationPreparationQueue
} from '@openg7/funding-core';

import { test, expect } from './support/test.js';
import { moderationFixture, completeModeration } from './support/moderation.js';
import {
  registerPublicationImagePreviewTests,
  syntheticPublicationJpeg
} from './publication-image-preview.ui.js';
import { registerPublicationReliabilityTests } from './publication-reliability.ui.js';

const initialJob: PublicationDelivery = {
  id: '11111111-1111-4111-8111-111111111111',
  feedId: 'openg20:facebook',
  kind: 'news',
  batchId: null,
  message: 'Notre prochaine réalisation pour la communauté.',
  scheduledAt: '2030-06-03T14:00:00Z',
  mediaId: null,
  mediaUrl: null,
  mediaAlt: null,
  accountId: 'fixture-page-20',
  mode: 'mock',
  autoManaged: false,
  sponsors: [],
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
const sourceEntry = (
  index: number,
  overrides: Partial<PublicationPreparationEntry> = {}
): PublicationPreparationEntry => ({
  draftId: `44444444-4444-4444-8444-${String(index).padStart(12, '0')}`,
  sponsorshipId: `55555555-5555-4555-8555-${String(index).padStart(12, '0')}`,
  name: `Atelier fictif ${index}`,
  feedId: 'openg7:facebook',
  status: 'deferred',
  reason: 'AWAITING_PREPARATION',
  renderedLength: 420,
  budget: 2900,
  createdAt: '2030-06-01T12:00:00Z',
  scheduledAt: null,
  batchId: null,
  deliveryId: null,
  deliveryStatus: null,
  ...overrides
});
const sourceQueue = (
  entries: PublicationPreparationEntry[],
  overrides: Partial<PublicationPreparationQueue> = {}
): PublicationPreparationQueue => ({
  entries,
  summary: {
    retained: entries.filter((entry) => entry.status === 'retained').length,
    deferred: entries.filter((entry) => entry.status === 'deferred').length,
    needsCorrection: entries.filter(
      (entry) => entry.status === 'needs_correction'
    ).length
  },
  total: entries.length,
  offset: 0,
  limit: 200,
  hasMore: false,
  scope: 'global',
  evaluatedAt: '2030-06-01T12:00:00Z',
  ...overrides
});
async function fixtures(
  page: Page,
  status: PublicationDelivery['status'] = 'draft',
  conflict = false,
  sponsors: PublicationDelivery['sponsors'] = [],
  overrides: Partial<PublicationDelivery> = {},
  options: {
    workerEnabled?: boolean;
    role?: 'reader' | 'operator';
    workerResponse?: () => Promise<void>;
    settingsResponse?: () => Promise<void>;
    readResponse?: () => Promise<void>;
    extraDeliveries?: PublicationDelivery[];
    sponsorMedia?: Record<
      string,
      { id: string; url: string; alt: string; company: string }[]
    >;
    mediaResponse?: (deliveryId: string | null) => Promise<void>;
    contentMissing?: boolean;
    queue?: PublicationPreparationQueue;
    reliability?: PublicationAutomationState['reliability'];
    queuePages?: Record<number, PublicationPreparationQueue>;
    preparedQueue?: PublicationPreparationQueue;
    queueFailureOffset?: number;
    privateBatchCompose?: boolean;
  } = {}
): Promise<PublicationAutomationCommand[]> {
  const commands: PublicationAutomationCommand[] = [];
  const state: PublicationAutomationState = {
    workerEnabled: options.workerEnabled ?? true,
    workerVersion: 1,
    ...(options.queue ? { queue: options.queue } : {}),
    ...(options.reliability ? { reliability: options.reliability } : {}),
    summary: {
      awaitingApproval: 1,
      scheduled: 0,
      exceptions: status === 'uncertain' ? 1 : 0,
      publishedToday: 2
    },
    feeds: [
      'openg7:facebook',
      'openg7:linkedin',
      'openg20:facebook',
      'openg20:linkedin'
    ].map((id) => ({
      id: id as PublicationDelivery['feedId'],
      paused: true,
      autoPrepare: false,
      timezone: 'America/Toronto',
      weekdays: [2, 4],
      localTime: '10:00',
      capacity: 5,
      horizonDays: 14,
      mode: 'mock',
      accountId: 'fixture-page-20',
      configured: true,
      expiresAt: null,
      connection: 'ready',
      checkedAt: '2030-06-01T12:00:00Z'
    })),
    deliveries: options.privateBatchCompose
      ? []
      : [
          { ...initialJob, status, sponsors, ...overrides },
          ...(options.extraDeliveries ?? [])
        ]
  };
  await page.addInitScript((role) => {
    sessionStorage.setItem(
      'openg7-admin-session-token',
      role ? 'openg7-admin-session.cookie' : 'openg7-admin-session.ui-fixture'
    );
    sessionStorage.setItem(
      'openg7-admin-session-expires-at',
      '2099-01-01T00:00:00Z'
    );
  }, options.role);
  await page.route('**/api/**', async (route) => {
    if (
      await moderationFixture(
        route,
        state.deliveries.flatMap((delivery) => [
          { type: 'publication_delivery' as const, id: delivery.id },
          ...delivery.sponsors.map((sponsor) => ({
            type: 'sponsorship' as const,
            id: sponsor.id
          }))
        ])
      )
    )
      return;
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/current'))
      return route.fulfill({
        json: {
          id: 'fixture-account',
          sessionId: 'fixture-session',
          displayName: 'Fixture reader',
          role: options.role,
          expiresAt: '2099-01-01T00:00:00Z'
        }
      });
    if (path.endsWith('/publication-automation/media')) {
      const deliveryId = new URL(route.request().url()).searchParams.get(
        'deliveryId'
      );
      const job = state.deliveries.find(
        (delivery) => delivery.id === deliveryId
      );
      if (deliveryId !== null && !job)
        return route.fulfill({
          status: 404,
          json: { code: 'DELIVERY_NOT_FOUND' }
        });
      const media = job?.batchId
        ? job.sponsors.flatMap(
            (sponsor) => options.sponsorMedia?.[sponsor.id] ?? []
          )
        : Object.values(options.sponsorMedia ?? {}).flat();
      await options.mediaResponse?.(deliveryId);
      return route.fulfill({ json: media });
    }
    if (!path.endsWith('/publication-automation'))
      return route.fulfill({ status: 503, json: {} });
    if (route.request().method() === 'GET') {
      const params = new URL(route.request().url()).searchParams;
      const queueOffset = Number(params.get('queueOffset') ?? 0);
      if (queueOffset === options.queueFailureOffset)
        return route.fulfill({
          status: 503,
          json: { code: 'QUEUE_UNAVAILABLE' }
        });
      // A delayed GET retains the facts read before any concurrent command.
      const snapshot = structuredClone({
        ...state,
        ...(queueOffset && options.queuePages?.[queueOffset]
          ? { queue: options.queuePages[queueOffset] }
          : {}),
        deliveries: state.deliveries.filter(
          (d) =>
            (!params.has('sponsorshipId') ||
              d.sponsors.some((s) => s.id === params.get('sponsorshipId'))) &&
            (!params.has('deliveryId') || d.id === params.get('deliveryId'))
        )
      });
      await options.readResponse?.();
      return route.fulfill({ json: snapshot });
    }
    const c = route.request().postDataJSON() as PublicationAutomationCommand;
    commands.push(c);
    if (c.action === 'worker') await options.workerResponse?.();
    if (c.action === 'settings') await options.settingsResponse?.();
    if (
      options.contentMissing &&
      (c.action === 'edit' ||
        c.action === 'approve' ||
        c.action === 'reconcile')
    )
      return route.fulfill({
        status: 409,
        json: { code: 'SOURCE_CONTENT_MISSING' }
      });
    if (conflict)
      return route.fulfill({
        status: 409,
        json: {
          code:
            c.action === 'worker'
              ? 'WORKER_VERSION_CONFLICT'
              : 'VERSION_CONFLICT'
        }
      });
    if (c.action === 'worker') {
      state.workerEnabled = c.enabled;
      state.workerVersion++;
    }
    if (c.action === 'prepare' && options.preparedQueue)
      state.queue = options.preparedQueue;
    if (c.action === 'compose' && options.privateBatchCompose) {
      state.deliveries = [
        {
          ...initialJob,
          sponsors,
          ...overrides,
          feedId: c.feedId,
          kind: c.kind,
          batchId: c.batchId ?? null,
          publicationFormat: c.publicationFormat,
          photoSelections: [],
          mediaId: null,
          mediaDerivedHash: undefined
        }
      ];
      return route.fulfill({ json: { id: initialJob.id } });
    }
    const job = state.deliveries[0]!;
    if (c.action === 'reconcile') {
      if (c.externalPostId === 'missing-post')
        return route.fulfill({
          status: 503,
          json: { code: 'REMOTE_POST_UNVERIFIED' }
        });
      if (c.externalPostId === 'different-post')
        return route.fulfill({ status: 409, json: { code: 'POST_MISMATCH' } });
      job.status = 'published';
      job.externalPostId = c.externalPostId;
      job.externalPostUrl = 'https://social.openg7.local/verified';
      job.version++;
    }
    if (c.action === 'confirm-absent') {
      job.status = 'blocked';
      job.approvedAt = null;
      job.errorCode = 'ABSENCE_CONFIRMED';
      job.version++;
    }
    if (c.action === 'approve') {
      job.status = 'approved';
      job.sponsors.forEach((s) => {
        s.reviewStatus = 'approved';
      });
      job.version++;
    }
    if (c.action === 'reject') {
      job.status = 'rejected';
      job.version++;
    }
    if (c.action === 'edit') {
      state.deliveries[0] = {
        ...job,
        message: c.message,
        status: 'draft',
        version: job.version + 1,
        ...(options.privateBatchCompose && c.photoSelections?.length
          ? {
              publicationFormat: c.publicationFormat,
              photoSelections: c.photoSelections,
              mediaId: job.id,
              mediaDerivedHash: overrides.mediaDerivedHash,
              mediaAlt: overrides.mediaAlt ?? null
            }
          : {})
      };
    }
    if (c.action === 'settings') {
      Object.assign(
        state.feeds.find((f) => f.id === c.settings.id)!,
        c.settings
      );
    }
    return route.fulfill({ json: { id: 'id' in c ? c.id : undefined } });
  });
  return commands;
}

registerPublicationImagePreviewTests({
  setup: (page, job, media, privateBatchCompose = false) =>
    fixtures(page, 'draft', false, job.sponsors ?? [], job, {
      sponsorMedia: media,
      privateBatchCompose
    })
});
registerPublicationReliabilityTests({
  setup: (page, reliability) =>
    fixtures(page, 'draft', false, [], {}, { reliability })
});

const publicationPalettes = {
  mineral: {
    panel: 'rgb(255, 255, 255)',
    raised: 'rgb(240, 244, 249)',
    subtle: 'rgb(245, 247, 251)',
    border: 'rgb(216, 224, 236)',
    text: 'rgb(23, 43, 80)'
  },
  night: {
    panel: 'rgb(20, 35, 56)',
    raised: 'rgb(27, 45, 68)',
    subtle: 'rgb(16, 32, 51)',
    border: 'rgb(64, 86, 111)',
    text: 'rgb(241, 245, 252)'
  },
  graphite: {
    panel: 'rgb(37, 41, 47)',
    raised: 'rgb(50, 56, 65)',
    subtle: 'rgb(32, 36, 41)',
    border: 'rgb(86, 97, 110)',
    text: 'rgb(243, 244, 246)'
  }
} as const;

async function publicationStyleFixtures(page: Page) {
  const reliability: NonNullable<PublicationAutomationState['reliability']> = {
    scope: 'global',
    evaluatedAt: '2030-06-01T12:00:00Z',
    obligations: {
      open: 1,
      undatedSocial: 0,
      oldestOpenAt: '2030-06-01T12:00:00Z',
      oldestUndatedAt: null,
      fulfilledWithEvidence: 0,
      waived: 0,
      unqualifiedDossiers: 0
    },
    capacity: { saturatedBatches: 0, saturatedSlots: 0, accountConflicts: 0 },
    deliveries: {
      publishing: 0,
      uncertain: 0,
      uncertainAccounts: 0,
      oldestUncertainAccountAt: null,
      overdueApproved: 0
    },
    discrepancies: {
      proof: 0,
      orphanProof: 0,
      obligationReservation: 0,
      accountReservation: 0,
      accountLease: 0,
      batchCapacity: 0,
      slotCapacity: 0
    },
    incidents: [],
    incidentTotal: 0,
    correlationLimit: 50
  };
  return fixtures(
    page,
    'draft',
    false,
    [],
    {},
    {
      workerEnabled: false,
      queue: sourceQueue([sourceEntry(1)]),
      reliability,
      extraDeliveries: [2, 3].map((index) => ({
        ...initialJob,
        id: `11111111-1111-4111-8111-11111111111${index}`,
        message: `Synthetic editorial draft ${index}`
      }))
    }
  );
}

async function publicationGridColumns(element: Locator): Promise<number> {
  return element.evaluate(
    (node) => getComputedStyle(node).gridTemplateColumns.split(' ').length
  );
}

for (const theme of ['mineral', 'night', 'graphite'] as const) {
  test(`publication automation CSS preserves ${theme} panels and read-only drawers on French mobile and English desktop`, async ({
    page
  }) => {
    await page.addInitScript((theme) => {
      localStorage.setItem('openg7.language', 'fr-CA');
      localStorage.setItem(
        'openg7.pilotage.appearance.v1',
        JSON.stringify({ theme, system: false, density: 'comfortable' })
      );
    }, theme);
    await page.setViewportSize({ width: 390, height: 1000 });
    const commands = await publicationStyleFixtures(page);
    await page.goto('/admin/fundraiser/publications/automation?settings=feeds');
    const root = page.locator('[data-og7="publication-automation"]');
    const worker = root.locator('[data-og7="publication-worker"]');
    const queue = root.locator('[data-og7="publication-source-queue"]');
    const reliability = root.locator('[data-og7="publication-reliability"]');
    const job = root.locator(`[data-og7-id="${initialJob.id}"]`);
    const palette = publicationPalettes[theme];
    for (const language of ['fr-CA', 'en']) {
      await test.step(
        language === 'fr-CA' ? '390px French' : '1600px English',
        async () => {
          if (language === 'en') {
            await page.setViewportSize({ width: 1600, height: 1000 });
            await page
              .getByRole('button', {
                name: 'Switch administration language to English'
              })
              .click();
          }
          await expect(page.locator('html')).toHaveAttribute('lang', language);
          await expect(page.locator('html')).toHaveAttribute(
            'data-og7-pilot-theme',
            theme
          );
          for (const panel of [worker, queue, job]) {
            await expect(panel).toHaveCSS('background-color', palette.panel);
            await expect(panel).toHaveCSS('border-top-color', palette.border);
            await expect(panel).toHaveCSS('border-radius', '16px');
            await expect(panel).toHaveCSS('padding', '18.4px');
          }
          await expect(root).toHaveCSS(
            'padding',
            language === 'fr-CA' ? '16px' : '40px'
          );
          await expect(root.getByRole('switch')).toHaveCSS(
            'background-color',
            palette.raised
          );
          const entry = queue.locator('[data-og7="publication-source-entry"]');
          await expect(entry).toHaveCSS('background-color', palette.subtle);
          await expect(entry).toHaveCSS('padding', '16px');
          await reliability.locator('summary').focus();
          await page.keyboard.press('Enter');
          await expect(reliability).toHaveCSS('padding', '16px');
          await expect(reliability).toHaveCSS('border-radius', '12px');
          await expect(reliability.locator('summary')).toHaveCSS(
            'font-weight',
            '650'
          );
          await expect(reliability.locator('dl')).toHaveCSS('display', 'grid');
          await expect(reliability.locator('dl')).toHaveCSS('gap', '12px');
          await expect(reliability.locator('dd').first()).toHaveCSS(
            'font-weight',
            '650'
          );
          await page.keyboard.press('Space');
          const opener = root
            .getByRole('button', {
              name: language === 'en' ? 'Settings' : 'Réglages',
              exact: true
            })
            .first();
          await opener.focus();
          await page.keyboard.press('Enter');
          const settings = page.getByRole('dialog');
          const capacity = settings.locator('input[name="capacity"]');
          await expect(capacity).toHaveCSS('background-color', palette.raised);
          await expect(capacity).toHaveCSS('color', palette.text);
          await expect(capacity).toHaveCSS('padding', '10.4px');
          const actions = settings
            .getByRole('button', {
              name:
                language === 'en'
                  ? 'Save settings'
                  : 'Enregistrer les réglages',
              exact: true
            })
            .locator('..');
          await expect(actions).toHaveCSS('position', 'sticky');
          await expect(actions).toHaveCSS('bottom', '0px');
          await page.keyboard.press('Escape');
          await expect(opener).toBeFocused();
          await job.focus();
          await page.keyboard.press('Enter');
          const delivery = page.getByRole('dialog');
          const preview = delivery.getByText(initialJob.message, {
            exact: true
          });
          await expect(preview).toHaveCSS('background-color', palette.raised);
          await expect(preview).toHaveCSS('padding', '16px');
          await expect(preview).toHaveCSS('white-space', 'pre-wrap');
          await delivery
            .getByRole('button', {
              name: language === 'en' ? 'Edit' : 'Modifier',
              exact: true
            })
            .focus();
          await page.keyboard.press('Enter');
          await expect(delivery.locator('textarea')).toHaveCSS(
            'background-color',
            palette.raised
          );
          await expect(delivery.locator('textarea')).toHaveCSS(
            'padding',
            '10.4px'
          );
          await expect(delivery.locator('textarea')).toHaveCSS(
            'resize',
            'vertical'
          );
          await page.keyboard.press('Escape');
          await expect(job).toBeFocused();
          expect(commands).toEqual([]);
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1
            )
          ).toBe(true);
        }
      );
    }
  });
}

test('publication automation CSS preserves the 520px, 650px and 1100px boundaries', async ({
  page
}) => {
  const commands = await publicationStyleFixtures(page);
  await page.goto('/admin/fundraiser/publications/automation?settings=feeds');
  const root = page.locator('[data-og7="publication-automation"]');
  const job = root.locator(`[data-og7-id="${initialJob.id}"]`);
  const feeds = root.getByRole('region', { name: 'Destinations', exact: true });
  const sourceLinks = root
    .locator('[data-og7="publication-source-entry"]')
    .getByRole('link')
    .first()
    .locator('..');
  for (const width of [650, 651, 1100, 1101]) {
    await test.step(`${width}px page`, async () => {
      await page.setViewportSize({ width, height: 1000 });
      await expect
        .poll(() => publicationGridColumns(job.locator('..')))
        .toBe(width <= 650 ? 1 : width <= 1100 ? 2 : 3);
      await expect
        .poll(() => publicationGridColumns(feeds))
        .toBe(width <= 650 ? 1 : width <= 1100 ? 2 : 4);
      await expect(sourceLinks).toHaveCSS(
        'flex-direction',
        width <= 650 ? 'column' : 'row'
      );
    });
  }
  await root
    .getByRole('button', { name: 'Réglages', exact: true })
    .first()
    .click();
  const settings = page.getByRole('dialog');
  const days = settings
    .getByRole('checkbox')
    .first()
    .locator('..')
    .locator('..');
  const fields = settings
    .locator('input[name="capacity"]')
    .locator('..')
    .locator('..');
  const actions = settings
    .getByRole('button', { name: 'Enregistrer les réglages', exact: true })
    .locator('..');
  for (const width of [520, 521]) {
    await test.step(`${width}px settings`, async () => {
      await page.setViewportSize({ width, height: 1000 });
      await expect
        .poll(() => publicationGridColumns(days))
        .toBe(width <= 520 ? 4 : 7);
      await expect
        .poll(() => publicationGridColumns(fields))
        .toBe(width <= 520 ? 1 : 2);
      await expect(actions).toHaveCSS(
        'display',
        width <= 520 ? 'grid' : 'flex'
      );
    });
  }
  await page.keyboard.press('Escape');
  expect(commands).toEqual([]);
});

for (const language of ['fr-CA', 'en'] as const) {
  for (const width of [390, 1280]) {
    test(`source preparation queue explains server allocation and source correction in ${language} at ${width}px`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.addInitScript(
        (locale) => localStorage.setItem('openg7.language', locale),
        language
      );
      const correction = sourceEntry(3, {
        name: 'Atelier fictif Boréal 👩🏽‍🔧 — présentation et savoir-faire pour la communauté',
        status: 'needs_correction',
        reason: 'INDIVIDUAL_TEXT_TOO_LONG',
        renderedLength: 3012
      });
      const restricted = sourceEntry(5, {
        reason: 'MODERATION_REVIEW_REQUIRED'
      });
      const queue = sourceQueue(
        [
          sourceEntry(1, {
            status: 'retained',
            reason: 'AWAITING_APPROVAL',
            scheduledAt: initialJob.scheduledAt,
            batchId: '66666666-6666-4666-8666-666666666666',
            deliveryId: initialJob.id,
            deliveryStatus: 'draft'
          }),
          sourceEntry(2, {
            feedId: 'openg7:linkedin',
            reason: 'NO_SLOT_IN_HORIZON'
          }),
          correction,
          sourceEntry(4, {
            reason: 'MANUAL_RESERVATION',
            scheduledAt: initialJob.scheduledAt
          }),
          restricted
        ],
        {
          summary: { retained: 7, deferred: 4, needsCorrection: 1 },
          total: 12,
          hasMore: true
        }
      );
      const commands = await fixtures(page, 'draft', false, [], {}, { queue });
      await page.goto('/admin/fundraiser/publications/automation');
      const english = language === 'en';
      const section = page.locator('[data-og7="publication-source-queue"]');
      await expect(section.getByRole('heading', { level: 2 })).toHaveText(
        english ? 'Sponsorship allocation' : 'Répartition des commandites'
      );
      await expect(
        section.locator('[data-og7="publication-source-retained-count"]')
      ).toHaveText('7');
      await expect(
        section.locator('[data-og7="publication-source-deferred-count"]')
      ).toHaveText('4');
      await expect(
        section.locator('[data-og7="publication-source-correction-count"]')
      ).toHaveText('1');
      await expect(
        section.locator('[data-og7="publication-source-partial"]')
      ).toContainText(
        english ? '5 sources shown out of 12' : '5 sources affichées sur 12'
      );
      await expect(section).toContainText('UTF-16');
      const row = section.locator(`[data-og7-id="${correction.draftId}"]`);
      await expect(row).toContainText('3012 / 2900');
      await expect(row).toContainText(
        english
          ? 'even in an individual publication'
          : 'même dans une publication individuelle'
      );
      await expect(row).toContainText(
        english
          ? 'The source draft is retained'
          : 'Le brouillon source est conservé'
      );
      await expect(row).toContainText(
        english
          ? 'open the final publication, correct its blocks and save it separately'
          : 'ouvrez la publication finale, corrigez ses blocs et enregistrez-la séparément'
      );
      await expect(row).toContainText(
        english ? 'No date assigned' : 'Aucune date attribuée'
      );
      const manual = section.locator(
        `[data-og7-id="${queue.entries[3]!.draftId}"]`
      );
      await expect(manual).toContainText(
        english ? 'Slot reserved manually' : 'Créneau réservé manuellement'
      );
      await expect(manual).toContainText(
        english ? 'The reservation is retained' : 'La réservation est conservée'
      );
      await expect(manual).toContainText(
        english ? 'Proposed date:' : 'Date proposée :'
      );
      await expect(
        manual.getByRole('link', {
          name: english
            ? 'Edit the draft for Atelier fictif 4'
            : 'Modifier le brouillon de Atelier fictif 4',
          exact: true
        })
      ).toBeVisible();
      const restrictedRow = section.locator(
        `[data-og7-id="${restricted.draftId}"]`
      );
      await expect(restrictedRow).toBeVisible();
      await expect(restrictedRow).toContainText(
        english ? 'Deferred' : 'Reportées'
      );
      await expect(restrictedRow).toContainText(
        english
          ? 'A current moderation review is required before preparation'
          : 'Une revue de modération à jour est requise avant la préparation'
      );
      await expect(restrictedRow).toContainText(
        english ? 'No date assigned' : 'Aucune date attribuée'
      );
      await expect(restrictedRow.getByRole('button')).toHaveCount(0);
      await expect(
        restrictedRow.getByRole('link', {
          name: english
            ? `View the publication for ${restricted.name}`
            : `Consulter la publication de ${restricted.name}`,
          exact: true
        })
      ).toHaveCount(0);
      const reviewLink = restrictedRow.getByRole('link', {
        name: english
          ? `View the dossier for ${restricted.name}`
          : `Consulter le dossier de ${restricted.name}`,
        exact: true
      });
      await expect(reviewLink).toHaveAttribute(
        'href',
        '/admin/fundraiser/sponsors?sponsorshipId=' +
          restricted.sponsorshipId +
          '&tab=publication'
      );
      await reviewLink.focus();
      await expect(reviewLink).toBeFocused();
      await expect(
        section.getByRole('button', {
          name: english ? 'Accept and schedule' : 'Accepter et programmer'
        })
      ).toHaveCount(0);
      await expect(
        section.locator(`[data-og7-id="${queue.entries[0]!.draftId}"]`)
      ).toContainText(english ? 'Proposed date:' : 'Date proposée :');
      await page
        .getByRole('combobox', { name: 'Feed', exact: true })
        .selectOption('openg7:linkedin');
      await expect(
        section.locator('[data-og7="publication-source-entry"]')
      ).toHaveCount(5);
      await expect(section).toContainText(
        english
          ? 'independently of the publication filter'
          : 'indépendamment du filtre des publications'
      );
      expect(
        await section.evaluate(
          (element) => element.scrollWidth <= element.clientWidth
        )
      ).toBe(true);
      expect(
        (
          await new AxeBuilder({ page })
            .include('[data-og7="publication-source-queue"]')
            .analyze()
        ).violations
      ).toEqual([]);
      expect(commands).toHaveLength(0);
      const link = row.getByRole('link', {
        name: english
          ? `Edit the draft for ${correction.name}`
          : `Modifier le brouillon de ${correction.name}`,
        exact: true
      });
      await expect(link).toHaveAttribute(
        'href',
        '/admin/fundraiser/publications/drafts?draftId=' + correction.draftId
      );
      await link.focus();
      await expect(link).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(
        new RegExp('/publications/drafts\\?draftId=' + correction.draftId)
      );
      expect(commands).toHaveLength(0);
    });
  }

  test(`source preparation queue distinguishes unavailable, empty and failed refresh states in ${language}`, async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.addInitScript(
      (locale) => localStorage.setItem('openg7.language', locale),
      language
    );
    const commands = await fixtures(page);
    await page.goto('/admin/fundraiser/publications/automation');
    const english = language === 'en';
    const section = page.locator('[data-og7="publication-source-queue"]');
    await expect(section).toContainText(
      english
        ? 'Source tracking is unavailable'
        : 'Le suivi des sources n’est pas disponible'
    );
    await expect(
      section.locator('[data-og7="publication-source-retained-count"]')
    ).toHaveCount(0);
    await page.route('**/api/admin/publication-automation', (route) =>
      route.fulfill({
        json: {
          workerEnabled: true,
          workerVersion: 1,
          feeds: [],
          deliveries: [],
          queue: sourceQueue([]),
          summary: {
            awaitingApproval: 0,
            scheduled: 0,
            exceptions: 0,
            publishedToday: 0
          }
        }
      })
    );
    await section
      .getByRole('button', {
        name: english ? 'Refresh source tracking' : 'Actualiser le suivi'
      })
      .click();
    await expect(section).toContainText(
      english ? 'No source drafts to track' : 'Aucun brouillon source à suivre'
    );
    await expect(
      section.locator('[data-og7="publication-source-retained-count"]')
    ).toHaveText('0');
    await page.route('**/api/admin/publication-automation', (route) =>
      route.fulfill({ status: 503, json: { code: 'QUEUE_UNAVAILABLE' } })
    );
    await section
      .getByRole('button', {
        name: english ? 'Refresh source tracking' : 'Actualiser le suivi'
      })
      .click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(section).toContainText(
      english ? 'No source drafts to track' : 'Aucun brouillon source à suivre'
    );
    await expect(
      section.locator('[data-og7="publication-source-retained-count"]')
    ).toHaveText('0');
    expect(commands).toHaveLength(0);
  });

  test(`source preparation queue paginates server facts and resets after preparation in ${language}`, async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.addInitScript(
      (locale) => localStorage.setItem('openg7.language', locale),
      language
    );
    const first = sourceEntry(1, {
      status: 'needs_correction',
      reason: 'INDIVIDUAL_TEXT_TOO_LONG',
      renderedLength: 3100
    });
    const summary = { retained: 0, deferred: 200, needsCorrection: 1 };
    const queue = sourceQueue([first], { total: 201, summary, hasMore: true });
    const later = sourceEntry(201, { name: 'Atelier fictif dernière page' });
    const next = sourceQueue([later], { total: 201, summary, offset: 200 });
    const prepared = sourceQueue(
      [
        sourceEntry(1, {
          status: 'retained',
          reason: 'AWAITING_APPROVAL',
          renderedLength: 2700,
          scheduledAt: initialJob.scheduledAt,
          deliveryId: initialJob.id,
          deliveryStatus: 'draft'
        })
      ],
      {
        total: 201,
        hasMore: true,
        summary: { retained: 1, deferred: 200, needsCorrection: 0 }
      }
    );
    const commands = await fixtures(
      page,
      'draft',
      false,
      [],
      {},
      { queue, queuePages: { 200: next }, preparedQueue: prepared }
    );
    await page.goto('/admin/fundraiser/publications/automation?settings=feeds');
    const english = language === 'en';
    const section = page.locator('[data-og7="publication-source-queue"]');
    const reads: string[] = [];
    page.on('request', (request) => {
      if (
        request.method() === 'GET' &&
        new URL(request.url()).pathname.endsWith('/publication-automation')
      )
        reads.push(request.url());
    });
    await section
      .getByRole('button', {
        name: english ? 'Next sources' : 'Sources suivantes'
      })
      .press('Enter');
    await expect(section).toContainText(later.name);
    expect(new URL(reads.at(-1)!).searchParams.get('queueOffset')).toBe('200');
    await expect(section.getByRole('heading', { level: 2 })).toBeFocused();
    await expect(
      section.locator('[data-og7="publication-source-correction-count"]')
    ).toHaveText('1');
    await expect(
      section.getByRole('button', {
        name: english ? 'Next sources' : 'Sources suivantes'
      })
    ).toBeDisabled();
    await page
      .getByRole('button', {
        name: english ? 'Settings' : 'Réglages',
        exact: true
      })
      .first()
      .click();
    const dialog = page.getByRole('dialog', {
      name: english ? 'Settings' : 'Réglages',
      exact: true
    });
    await dialog
      .getByRole('button', {
        name: english ? 'Prepare now' : 'Préparer maintenant',
        exact: true
      })
      .click();
    await expect
      .poll(() => commands.some((command) => command.action === 'prepare'))
      .toBe(true);
    await expect(
      section.locator('[data-og7="publication-source-correction-count"]')
    ).toHaveText('0');
    await expect(
      section.locator('[data-og7="publication-source-retained-count"]')
    ).toHaveText('1');
    await expect(
      section.locator(`[data-og7-id="${first.draftId}"]`)
    ).toContainText('2700 / 2900');
    expect(new URL(reads.at(-1)!).searchParams.has('queueOffset')).toBe(false);
    expect(
      commands.filter((command) => command.action === 'approve')
    ).toHaveLength(0);
    await dialog
      .getByRole('button', { name: english ? 'Close' : 'Fermer', exact: true })
      .first()
      .click();
    await page.reload();
    await expect(
      section.locator('[data-og7="publication-source-correction-count"]')
    ).toHaveText('0');
    await expect(
      section.locator('[data-og7="publication-source-retained-count"]')
    ).toHaveText('1');
  });
}

test('source preparation queue keeps its confirmed page when another page fails', async ({
  page
}) => {
  const entry = sourceEntry(1);
  const commands = await fixtures(
    page,
    'draft',
    false,
    [],
    {},
    {
      queue: sourceQueue([entry], {
        total: 201,
        hasMore: true,
        summary: { retained: 0, deferred: 201, needsCorrection: 0 }
      }),
      queueFailureOffset: 200
    }
  );
  await page.goto('/admin/fundraiser/publications/automation');
  const section = page.locator('[data-og7="publication-source-queue"]');
  await section.getByRole('button', { name: 'Sources suivantes' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(section).toContainText(entry.name);
  await expect(
    section.locator('[data-og7="publication-source-deferred-count"]')
  ).toHaveText('201');
  await expect(
    section.getByRole('button', { name: 'Sources suivantes' })
  ).toBeEnabled();
  expect(commands).toHaveLength(0);
});

for (const language of ['fr-CA', 'en'] as const) {
  test(`source queue labels a future opportunity as private and preserves required actions in ${language}`, async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.addInitScript(
      (locale) => localStorage.setItem('openg7.language', locale),
      language
    );
    const projected = sourceEntry(1, {
      reason: 'NO_SLOT_IN_HORIZON',
      nextOpportunity: {
        reason: 'AVAILABLE_AFTER_HORIZON',
        action: 'REVIEW_HORIZON',
        proposedAt: '2030-07-15T10:00:00Z',
        withinHorizon: false,
        evaluatedAt: '2030-06-01T12:00:00Z',
        searchUntil: '2031-06-02T12:00:00Z'
      }
    });
    const uncertainAccount = sourceEntry(2, {
      nextOpportunity: {
        ...projected.nextOpportunity!,
        reason: 'ACCOUNT_RECONCILIATION_REQUIRED',
        action: 'RECONCILE_ACCOUNT',
        proposedAt: null
      }
    });
    const legacy = sourceEntry(3);
    const commands = await fixtures(
      page,
      'draft',
      false,
      [],
      {},
      { queue: sourceQueue([projected, uncertainAccount, legacy]) }
    );
    await page.goto('/admin/fundraiser/publications/automation');
    const english = language === 'en';
    const queue = page.locator('[data-og7="publication-source-queue"]');
    const row = queue.locator(`[data-og7-id="${projected.draftId}"]`);
    const opportunity = row.locator(
      '[data-og7="publication-source-opportunity"]'
    );
    await expect(opportunity).toContainText(
      english
        ? 'No slot is reserved'
        : 'Aucun créneau ni rang dans la file n’est réservé'
    );
    await expect(opportunity).toContainText(
      english
        ? 'beyond the preparation horizon'
        : 'après l’horizon de préparation'
    );
    await expect(opportunity).toContainText(
      english ? 'Possible date:' : 'Date possible :'
    );
    await expect(opportunity).toContainText(
      english
        ? 'Review the recurrence and horizon settings'
        : 'Vérifiez les réglages de récurrence et d’horizon'
    );
    await expect(row).toContainText(
      english ? 'No date assigned' : 'Aucune date attribuée'
    );
    const blocked = queue.locator(
      `[data-og7-id="${uncertainAccount.draftId}"] [data-og7="publication-source-opportunity"]`
    );
    await expect(blocked).toContainText(
      english ? 'requires reconciliation' : 'exige une réconciliation'
    );
    await expect(blocked).not.toContainText(
      english ? 'Possible date:' : 'Date possible :'
    );
    await expect(blocked).toContainText(
      english
        ? 'Investigate the uncertain delivery'
        : 'Vérifiez la livraison incertaine'
    );
    await expect(
      queue.locator(
        `[data-og7-id="${legacy.draftId}"] [data-og7="publication-source-opportunity"]`
      )
    ).toHaveCount(0);
    await expect(opportunity.getByRole('button')).toHaveCount(0);
    expect(commands).toHaveLength(0);
    expect(
      await queue.evaluate(
        (element) => element.scrollWidth <= element.clientWidth
      )
    ).toBe(true);
    expect(
      (
        await new AxeBuilder({ page })
          .include('[data-og7="publication-source-queue"]')
          .analyze()
      ).violations
    ).toEqual([]);
  });
}

for (const [language, width] of [
  ['fr-CA', 1280],
  ['en', 390]
] as const) {
  test(`feed settings separate saved configuration from preparation in ${language} at ${width}px`, async ({
    page
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(
      (locale) => localStorage.setItem('openg7.language', locale),
      language
    );
    const commands = await fixtures(page);
    await page.goto('/admin/fundraiser/publications/automation?settings=feeds');
    const english = language === 'en';
    const opener = page
      .getByRole('button', {
        name: english ? 'Settings' : 'Réglages',
        exact: true
      })
      .first();
    await opener.focus();
    await opener.press('Enter');
    const dialog = page.getByRole('dialog', {
      name: english ? 'Settings' : 'Réglages',
      exact: true
    });
    const save = dialog.getByRole('button', {
      name: english ? 'Save settings' : 'Enregistrer les réglages',
      exact: true
    });
    const prepare = dialog.getByRole('button', {
      name: english ? 'Prepare now' : 'Préparer maintenant',
      exact: true
    });
    const capacity = dialog.getByRole('spinbutton', {
      name: english ? 'Sponsors per batch' : 'Commanditaires par lot',
      exact: true
    });
    const close = dialog
      .getByRole('button', {
        name: english ? 'Close' : 'Fermer',
        exact: true
      })
      .first();
    const connectionHelp = dialog.locator('summary');
    await expect(close).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(
      dialog.getByRole('button', {
        name: english ? 'Check connection' : 'Vérifier la connexion',
        exact: true
      })
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(connectionHelp).toBeFocused();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('switch')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(connectionHelp).toBeFocused();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('switch')).toBeFocused();
    // Follow native order through weekdays and the segmented time field to Save.
    for (let step = 0; step < 30; step++) {
      if (await save.evaluate((element) => element === document.activeElement))
        break;
      await page.keyboard.press('Tab');
    }
    await expect(save).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(save).toBeFocused();
    await expect(dialog).toContainText('OPENG7');
    await expect(dialog).toContainText('Facebook');
    expect(commands).toHaveLength(0);
    await capacity.fill('0');
    await expect(save).toBeDisabled();
    await capacity.press('Enter');
    expect(commands).toHaveLength(0);
    await capacity.fill('6');
    await dialog.getByRole('switch').press('Space');
    for (const day of [english ? 'Tue' : 'Mar.', english ? 'Thu' : 'Jeu.']) {
      const checkbox = dialog.getByRole('checkbox', { name: day, exact: true });
      await checkbox.focus();
      await checkbox.press('Space');
    }
    await expect(dialog.getByRole('alert')).toContainText(
      english ? 'Choose at least one' : 'Choisissez au moins un'
    );
    await expect(save).toBeDisabled();
    const monday = dialog.getByRole('checkbox', {
      name: english ? 'Mon' : 'Lun.',
      exact: true
    });
    await monday.focus();
    await monday.press('Space');
    await expect(prepare).toBeDisabled();
    await expect(dialog).toContainText(
      english
        ? 'Save your changes before'
        : 'Enregistrez vos modifications avant'
    );
    await save.click();
    await expect(dialog).toBeVisible();
    await expect(prepare).toBeEnabled();
    expect(commands).toEqual([
      {
        action: 'settings',
        settings: expect.objectContaining({
          id: 'openg7:facebook',
          paused: true,
          autoPrepare: true,
          capacity: 6,
          weekdays: [1],
          horizonDays: 14,
          localTime: '10:00',
          timezone: 'America/Toronto'
        })
      }
    ]);
    await expect(
      dialog
        .getByRole('status')
        .filter({ hasText: english ? 'Saved.' : 'Enregistré.' })
    ).toBeVisible();
    expect(
      (await new AxeBuilder({ page }).include('dialog[open]').analyze())
        .violations
    ).toEqual([]);
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth
      )
    ).toBe(true);
    await dialog.evaluate((element) => {
      element.scrollTop = 0;
    });
    await dialog.screenshot({
      path: `test-results/feed-settings-${language}-${width}.png`
    });
    await prepare.scrollIntoViewIfNeeded();
    await dialog.screenshot({
      path: `test-results/feed-settings-actions-${language}-${width}.png`
    });
    await prepare.click();
    await expect(dialog).toContainText(
      english ? 'Preparation complete.' : 'Préparation terminée.'
    );
    expect(commands[1]).toEqual({
      action: 'prepare',
      feedId: 'openg7:facebook'
    });
    await dialog
      .getByRole('button', {
        name: english ? 'Check connection' : 'Vérifier la connexion',
        exact: true
      })
      .click();
    await expect(dialog).toContainText(
      english ? 'Check complete.' : 'Vérification terminée.'
    );
    expect(commands[2]).toEqual({ action: 'check', feedId: 'openg7:facebook' });
    await page.keyboard.press('Escape');
    await expect(opener).toBeFocused();
    await opener.press('Enter');
    await expect(capacity).toHaveValue('6');
    await expect(monday).toBeChecked();
    expect(commands).toHaveLength(3);
  });
}

test('feed settings retain edits on failure and block actions while saving', async ({
  page
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const commands = await fixtures(
    page,
    'draft',
    true,
    [],
    {},
    { settingsResponse: () => gate }
  );
  await page.goto('/admin/fundraiser/publications/automation?settings=feeds');
  await page
    .getByRole('button', { name: 'Réglages', exact: true })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'Réglages', exact: true });
  const horizon = dialog.getByRole('spinbutton', {
    name: 'Jours à préparer',
    exact: true
  });
  await horizon.fill('21');
  const save = dialog.getByRole('button', {
    name: 'Enregistrer les réglages',
    exact: true
  });
  await save.click();
  try {
    await expect(save).toBeDisabled();
    await expect(horizon).toBeDisabled();
    await dialog.locator('summary').focus();
    await page.keyboard.press('Tab');
    await expect(dialog.locator('summary')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.locator('summary')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Préparer maintenant', exact: true })
    ).toBeDisabled();
    expect(commands).toHaveLength(1);
  } finally {
    release();
  }
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(horizon).toHaveValue('21');
  await expect(save).toBeEnabled();
  await expect(
    dialog.getByRole('status').filter({ hasText: 'Enregistré.' })
  ).toHaveCount(0);
  expect(commands.map((command) => command.action)).toEqual(['settings']);
});

for (const width of [390, 1280]) {
  test(`worker switch confirms activation, persists state and stops processing at ${width}px`, async ({
    page
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const commands = await fixtures(
      page,
      'draft',
      false,
      [],
      {},
      { workerEnabled: false }
    );
    await page.goto('/admin/fundraiser/publications/automation?settings=feeds');
    const toggle = page.getByRole('switch', { name: 'Moteur automatique' });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(page.getByText(/Activer le moteur automatique/)).toBeVisible();
    expect(commands).toHaveLength(0);
    await page.keyboard.press('Escape');
    await expect(toggle).toBeEnabled();
    await expect(toggle).toBeFocused();
    expect(commands).toHaveLength(0);
    await toggle.press('Enter');
    await page.locator('[data-og7="confirm-action"]').click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(commands).toEqual([
      {
        action: 'worker',
        enabled: true,
        version: 1,
        confirmation: 'enable-worker'
      }
    ]);
    await page.reload();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(commands[1]).toEqual({
      action: 'worker',
      enabled: false,
      version: 2,
      confirmation: 'disable-worker'
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true);
    expect(
      (
        await new AxeBuilder({ page })
          .include('[data-og7="publication-automation"]')
          .analyze()
      ).violations
    ).toEqual([]);
  });
}

test('worker switch waits for the server and reports a stale decision without false success', async ({
  page
}) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const commands = await fixtures(
    page,
    'draft',
    true,
    [],
    {},
    { workerResponse: () => held }
  );
  await page.goto('/admin/fundraiser/publications/automation');
  const toggle = page.getByRole('switch', { name: 'Moteur automatique' });
  await toggle.click();
  try {
    await expect(toggle).toBeDisabled();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(commands).toHaveLength(1);
  } finally {
    release();
  }
  await expect(page.getByRole('alert')).toContainText(
    'L’état du moteur a changé'
  );
  await expect(toggle).toBeEnabled();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(
    page.getByRole('status').filter({ hasText: /enregistr/i })
  ).toHaveCount(0);
});

for (const role of ['reader', 'operator'] as const) {
  test(`${role} can read the worker state but cannot change it`, async ({
    page
  }) => {
    const commands = await fixtures(
      page,
      'draft',
      false,
      [],
      {},
      { role, workerEnabled: false }
    );
    await page.goto('/admin/fundraiser/publications/automation');
    await expect(
      page.getByRole('switch', { name: 'Moteur automatique' })
    ).toBeDisabled();
    await expect(
      page.getByText('Seul un propriétaire peut activer ou arrêter le moteur.')
    ).toBeVisible();
    expect(commands).toHaveLength(0);
  });
}
test('approves the exact destination and version only after an explicit decision; edits revoke approval', async ({
  page
}) => {
  const commands = await fixtures(page);
  await page.goto('/admin/fundraiser/publications/automation');
  await expect(
    page.getByRole('heading', { name: 'Pilotage des feeds', exact: true })
  ).toBeVisible();
  await expect(
    page.locator('[data-og7="publication-automation"] article')
  ).toHaveCount(4);
  await page.locator('[data-og7-id="' + initialJob.id + '"]').click();
  const dialog = page.getByRole('dialog', { name: 'Publication finale' });
  await expect(dialog).toContainText('fixture-page-20');
  const authorize = dialog.getByRole('button', {
    name: 'Accepter et programmer'
  });
  await expect(authorize).toBeDisabled();
  await dialog.getByRole('checkbox', { name: /J’approuve/ }).check();
  await authorize.click();
  await completeModeration(page);
  await expect(dialog).toContainText('Autorisée');
  expect(commands[0]).toMatchObject({
    action: 'approve',
    id: initialJob.id,
    version: 1,
    confirmation: initialJob.id
  });
  await dialog.getByRole('button', { name: 'Modifier', exact: true }).click();
  await dialog.getByLabel('Texte exact à publier').fill('Texte final modifié.');
  await dialog
    .getByRole('button', { name: 'Enregistrer le brouillon' })
    .click();
  await expect(
    dialog.getByRole('button', { name: 'Accepter et programmer' })
  ).toBeDisabled();
  expect(commands[1]).toMatchObject({
    action: 'edit',
    version: 2,
    message: 'Texte final modifié.'
  });
});
test('unsaved changes cannot be approved and stale versions never show success', async ({
  page
}) => {
  const commands = await fixtures(page, 'draft', true);
  await page.goto('/admin/fundraiser/publications/automation');
  await page.locator('[data-og7-id="' + initialJob.id + '"]').click();
  const dialog = page.getByRole('dialog', { name: 'Publication finale' });
  await dialog.getByRole('button', { name: 'Modifier', exact: true }).click();
  await dialog.getByLabel('Texte exact à publier').fill('A local change');
  await expect(
    dialog.getByRole('checkbox', { name: /J’approuve/ })
  ).toBeDisabled();
  expect(commands).toHaveLength(0);
  await dialog
    .getByRole('button', { name: 'Enregistrer le brouillon' })
    .click();
  await expect(dialog.getByRole('alert')).toContainText(
    'Cette publication a changé'
  );
  await expect(dialog.getByLabel('Texte exact à publier')).toHaveValue(
    'A local change'
  );
});
test('exceptions require investigation and never offer a blind retry', async ({
  page
}) => {
  const commands = await fixtures(page, 'uncertain');
  await page.goto('/admin/fundraiser/publications/automation');
  await page.getByRole('button', { name: 'À résoudre', exact: true }).click();
  await page.locator('[data-og7-id="' + initialJob.id + '"]').click();
  const dialog = page.getByRole('dialog', { name: 'Publication finale' });
  await expect(dialog).toContainText('Aucune relance automatique');
  await expect(
    dialog.getByRole('button', { name: 'Accepter et programmer' })
  ).toHaveCount(0);
  await expect(
    dialog.getByRole('button', { name: 'Annuler cet envoi' })
  ).toHaveCount(0);
  await dialog
    .getByText('Après vérification : la publication est absente', {
      exact: true
    })
    .click();
  await expect(
    dialog.getByRole('button', { name: 'Consigner la vérification' })
  ).toBeDisabled();
  expect(commands).toHaveLength(0);
});
for (const language of ['fr-CA', 'en'] as const) {
  for (const width of [390, 1280]) {
    for (const errorCode of [
      'SOURCE_NOT_ELIGIBLE',
      'PAYMENT_REVIEW_REQUIRED'
    ]) {
      test(`payment blockers explain each affected sponsor and link to their dossier in ${language} at ${width}px (${errorCode})`, async ({
        page
      }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.addInitScript(
          (locale) => localStorage.setItem('openg7.language', locale),
          language
        );
        await fixtures(
          page,
          'blocked',
          false,
          [
            {
              id: '22222222-2222-4222-8222-222222222222',
              name: 'Atelier Remboursé',
              version: 'v2',
              reviewStatus: 'approved',
              presentationApproved: true,
              paymentStatus: 'refunded'
            },
            {
              id: '33333333-3333-4333-8333-333333333333',
              name: 'Atelier Contesté',
              version: 'v2',
              reviewStatus: 'approved',
              presentationApproved: true,
              paymentStatus: 'disputed'
            },
            {
              id: '44444444-4444-4444-8444-444444444444',
              name: 'Atelier Témoin',
              version: 'v1',
              reviewStatus: 'approved',
              presentationApproved: true,
              paymentStatus: 'paid'
            }
          ],
          { kind: 'sponsorship', errorCode }
        );
        await page.goto(
          '/admin/fundraiser/publications/automation?deliveryId=' +
            initialJob.id
        );
        const dialog = page.getByRole('dialog', {
          name: language === 'en' ? 'Final publication' : 'Publication finale'
        });
        const blockers = dialog.locator(
          '[data-og7="publication-payment-blocker"]'
        );
        await expect(blockers).toHaveCount(2);
        await expect(blockers.nth(0)).toContainText(
          language === 'en'
            ? 'The payment was refunded.'
            : 'Le paiement a été remboursé.'
        );
        await expect(blockers.nth(1)).toContainText(
          language === 'en'
            ? 'The payment is disputed.'
            : 'Le paiement fait l’objet d’une contestation.'
        );
        const paymentReview = dialog.locator(
          '[data-og7="publication-payment-review"]'
        );
        if (errorCode === 'PAYMENT_REVIEW_REQUIRED')
          await expect(paymentReview).toContainText(
            language === 'en'
              ? 'This publication needs a new administrative review'
              : 'Cette publication nécessite une nouvelle validation administrative'
          );
        else await expect(paymentReview).toHaveCount(0);
        const refunded = blockers.getByRole('link', {
          name: 'Atelier Remboursé'
        });
        const disputed = blockers.getByRole('link', {
          name: 'Atelier Contesté'
        });
        await expect(refunded).toHaveAttribute(
          'href',
          /sponsorshipId=22222222-2222-4222-8222-222222222222&tab=refund$/
        );
        await expect(disputed).toHaveAttribute(
          'href',
          /sponsorshipId=33333333-3333-4333-8333-333333333333&tab=overview$/
        );
        expect(
          await dialog.evaluate(
            (element) => element.scrollWidth <= element.clientWidth
          )
        ).toBe(true);
        const a11y = await new AxeBuilder({ page })
          .include('dialog[open]')
          .analyze();
        expect(a11y.violations).toEqual([]);
        await dialog.screenshot({
          path: `test-results/admin-layout/payment-blockers-${language}-${width}-${errorCode}.png`
        });
        await refunded.focus();
        await expect(refunded).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(
          /sponsorshipId=22222222-2222-4222-8222-222222222222&tab=refund$/
        );
      });
    }
    test(`a recovered payment still requires publication review in ${language} at ${width}px`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(
        (locale) => localStorage.setItem('openg7.language', locale),
        language
      );
      const commands = await fixtures(
        page,
        'blocked',
        false,
        [
          {
            id: '33333333-3333-4333-8333-333333333333',
            name: 'Atelier Réconcilié',
            version: 'v3',
            reviewStatus: 'approved',
            presentationApproved: true,
            paymentStatus: 'paid'
          }
        ],
        { kind: 'sponsorship', errorCode: 'PAYMENT_REVIEW_REQUIRED' }
      );
      await page.goto(
        '/admin/fundraiser/publications/automation?deliveryId=' + initialJob.id
      );
      const dialog = page.getByRole('dialog', {
        name: language === 'en' ? 'Final publication' : 'Publication finale'
      });
      const review = dialog.locator('[data-og7="publication-payment-review"]');
      await expect(review).toContainText(
        language === 'en'
          ? 'even if the payment is now confirmed'
          : 'même si le paiement est maintenant confirmé'
      );
      await expect(
        dialog.locator('[data-og7="publication-payment-blocker"]')
      ).toHaveCount(0);
      await expect(
        dialog.getByRole('button', {
          name:
            language === 'en' ? 'Accept and schedule' : 'Accepter et programmer'
        })
      ).toHaveCount(0);
      const dossier = review.getByRole('link', { name: 'Atelier Réconcilié' });
      await expect(dossier).toHaveAttribute(
        'href',
        /sponsorshipId=33333333-3333-4333-8333-333333333333&tab=overview$/
      );
      expect(
        (await new AxeBuilder({ page }).include('dialog[open]').analyze())
          .violations
      ).toEqual([]);
      expect(commands).toHaveLength(0);
      await dossier.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(
        /sponsorshipId=33333333-3333-4333-8333-333333333333&tab=overview$/
      );
    });
  }
}

for (const language of ['fr-CA', 'en'] as const) {
  for (const width of [390, 1280]) {
    test(`dossier revision explains the new approval and links to review in ${language} at ${width}px`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(
        (locale) => localStorage.setItem('openg7.language', locale),
        language
      );
      await fixtures(
        page,
        'blocked',
        false,
        [
          {
            id: '22222222-2222-4222-8222-222222222222',
            name: 'Atelier Révisé',
            version: 'v2',
            reviewStatus: 'approved',
            presentationApproved: true,
            paymentStatus: 'paid'
          }
        ],
        { kind: 'sponsorship', errorCode: 'SPONSOR_REVIEW_REQUIRED' }
      );
      await page.goto(
        '/admin/fundraiser/publications/automation?deliveryId=' + initialJob.id
      );
      const dialog = page.getByRole('dialog', {
        name: language === 'en' ? 'Final publication' : 'Publication finale'
      });
      const explanation = dialog.locator(
        '[data-og7="publication-review-blocker"]'
      );
      await expect(explanation).toContainText(
        language === 'en'
          ? 'Approving the dossier alone does not reauthorize this delivery.'
          : 'Accepter le dossier seul ne réautorise pas cet envoi.'
      );
      await expect(
        dialog.getByRole('button', {
          name:
            language === 'en' ? 'Accept and schedule' : 'Accepter et programmer'
        })
      ).toHaveCount(0);
      expect(
        await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)
      ).toBe(true);
      expect(
        (await new AxeBuilder({ page }).include('dialog[open]').analyze())
          .violations
      ).toEqual([]);
      const link = explanation.getByRole('link', { name: 'Atelier Révisé' });
      await link.focus();
      await expect(link).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(
        /sponsorshipId=22222222-2222-4222-8222-222222222222$/
      );
    });
  }
}

for (const language of ['fr-CA', 'en'] as const) {
  for (const width of [390, 1280]) {
    test(`missing sponsor content explains source correction and links to drafts in ${language} at ${width}px`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(
        (locale) => localStorage.setItem('openg7.language', locale),
        language
      );
      const commands = await fixtures(
        page,
        'blocked',
        false,
        [
          {
            id: '22222222-2222-4222-8222-222222222222',
            name: 'Atelier Boréal',
            version: 'v1',
            reviewStatus: 'approved',
            presentationApproved: true,
            paymentStatus: 'paid'
          }
        ],
        {
          kind: 'sponsorship',
          batchId: '33333333-3333-4333-8333-333333333333',
          errorCode: 'SOURCE_CONTENT_MISSING'
        }
      );
      await page.goto(
        '/admin/fundraiser/publications/automation?deliveryId=' + initialJob.id
      );
      const english = language === 'en';
      const dialog = page.getByRole('dialog', {
        name: english ? 'Final publication' : 'Publication finale'
      });
      const explanation = dialog.locator(
        '[data-og7="publication-content-blocker"]'
      );
      await expect(explanation).toContainText(
        english
          ? 'a complete block for every sponsor'
          : 'un bloc complet pour chaque commanditaire'
      );
      await expect(explanation).toContainText(
        english
          ? 'save it and approve this publication again'
          : 'enregistrez-le et approuvez à nouveau cette publication'
      );
      await expect(
        dialog.getByRole('button', {
          name: english ? 'Accept and schedule' : 'Accepter et programmer'
        })
      ).toHaveCount(0);
      expect(commands).toHaveLength(0);
      expect(
        await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)
      ).toBe(true);
      expect(
        (await new AxeBuilder({ page }).include('dialog[open]').analyze())
          .violations
      ).toEqual([]);
      const link = explanation.getByRole('link', {
        name: english ? 'Edit source drafts' : 'Modifier les brouillons sources'
      });
      await expect(link).toHaveAttribute(
        'href',
        '/admin/fundraiser/publications/drafts'
      );
      await link.focus();
      await expect(link).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(
        /\/admin\/fundraiser\/publications\/drafts$/
      );
      expect(commands).toHaveLength(0);
    });

    test(`missing sponsor content keeps an uncertain delivery under investigation in ${language} at ${width}px`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(
        (locale) => localStorage.setItem('openg7.language', locale),
        language
      );
      const commands = await fixtures(
        page,
        'uncertain',
        false,
        [
          {
            id: '22222222-2222-4222-8222-222222222222',
            name: 'Atelier Boréal',
            version: 'v1',
            reviewStatus: 'approved',
            presentationApproved: true,
            paymentStatus: 'paid'
          }
        ],
        {
          kind: 'sponsorship',
          batchId: '33333333-3333-4333-8333-333333333333',
          errorCode: 'SOURCE_CONTENT_MISSING'
        },
        { contentMissing: true }
      );
      await page.goto(
        '/admin/fundraiser/publications/automation?deliveryId=' + initialJob.id
      );
      const english = language === 'en';
      const dialog = page.getByRole('dialog', {
        name: english ? 'Final publication' : 'Publication finale'
      });
      const explanation = dialog.locator(
        '[data-og7="publication-content-uncertain"]'
      );
      await expect(explanation).toContainText(
        english
          ? 'references retained in the audit'
          : 'références conservées dans l’audit'
      );
      await expect(explanation).toContainText(
        english ? 'actual account’s history' : 'l’historique du compte réel'
      );
      await expect(explanation).toContainText(
        english
          ? 'If the publication exists, keep the uncertain status'
          : 'Si la publication existe, conservez l’état incertain'
      );
      await expect(explanation).toContainText(
        english
          ? 'never attest its absence or resend this delivery'
          : 'ne confirmez jamais son absence et ne renvoyez pas cet envoi'
      );
      const editLinks = dialog.locator(
        'a[href="/admin/fundraiser/publications/drafts"]'
      );
      const editButton = dialog.getByRole('button', {
        name: english ? 'Edit' : 'Modifier',
        exact: true
      });
      const approveButton = dialog.getByRole('button', {
        name: english ? 'Accept and schedule' : 'Accepter et programmer'
      });
      await expect(editLinks).toHaveCount(0);
      await expect(editButton).toHaveCount(0);
      await expect(approveButton).toHaveCount(0);
      expect(commands).toHaveLength(0);

      const remoteId = dialog.getByRole('textbox', {
        name: english
          ? 'ID of the post already visible on the network'
          : 'Identifiant de la publication déjà visible sur le réseau'
      });
      const reconcile = dialog.getByRole('button', {
        name: english
          ? 'Verify and confirm publication'
          : 'Vérifier et confirmer la publication'
      });
      await expect(reconcile).toBeDisabled();
      await remoteId.fill('verified-post');
      await reconcile.focus();
      await expect(reconcile).toBeFocused();
      await page.keyboard.press('Enter');
      const feedback = dialog.getByRole('alert');
      await expect(feedback).toContainText(
        english
          ? 'If the publication exists, keep the uncertain status'
          : 'Si la publication existe, conservez l’état incertain'
      );
      await expect(feedback).not.toContainText(
        english
          ? 'Restore the missing blocks'
          : 'Rétablissez les blocs manquants'
      );
      await expect(explanation).toBeVisible();
      await expect(editLinks).toHaveCount(0);
      await expect(editButton).toHaveCount(0);
      await expect(approveButton).toHaveCount(0);
      await expect(
        dialog.getByRole('link', {
          name: english ? 'View publication' : 'Voir la publication'
        })
      ).toHaveCount(0);
      expect(commands).toEqual([
        {
          action: 'reconcile',
          id: initialJob.id,
          version: 1,
          confirmation: initialJob.id,
          externalPostId: 'verified-post'
        }
      ]);
      await dialog
        .locator('summary')
        .filter({
          hasText: english
            ? 'After checking: the publication is absent'
            : 'Après vérification : la publication est absente'
        })
        .click();
      await expect(dialog.getByRole('checkbox')).not.toBeChecked();
      await expect(
        dialog.getByRole('button', {
          name: english ? 'Record verification' : 'Consigner la vérification'
        })
      ).toBeDisabled();
      expect(
        await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)
      ).toBe(true);
      expect(
        (await new AxeBuilder({ page }).include('dialog[open]').analyze())
          .violations
      ).toEqual([]);
    });
  }
}

for (const [language, width] of [
  ['fr-CA', 1280],
  ['en', 390]
] as const) {
  // Defensive UI error handling; current API permits an incomplete private draft
  // and rejects it at approval. This interception verifies feedback on failure.
  test(`missing sponsor content error response keeps unsaved local text in ${language}`, async ({
    page
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(
      (locale) => localStorage.setItem('openg7.language', locale),
      language
    );
    const commands = await fixtures(
      page,
      'draft',
      false,
      [
        {
          id: '22222222-2222-4222-8222-222222222222',
          name: 'Atelier Boréal',
          version: 'v1',
          reviewStatus: 'approved',
          presentationApproved: true,
          paymentStatus: 'paid'
        }
      ],
      {
        kind: 'sponsorship',
        batchId: '33333333-3333-4333-8333-333333333333',
        message:
          'Merci à Atelier Boréal\n\nUne contribution publique.\n\nCommandite rémunérée.'
      },
      { contentMissing: true }
    );
    await page.goto(
      '/admin/fundraiser/publications/automation?deliveryId=' + initialJob.id
    );
    const english = language === 'en';
    const dialog = page.getByRole('dialog', {
      name: english ? 'Final publication' : 'Publication finale'
    });
    await dialog
      .getByRole('button', {
        name: english ? 'Edit' : 'Modifier',
        exact: true
      })
      .click();
    const text = dialog.locator('textarea[name="message"]');
    const incompleteMessage =
      'Local text without the sponsor recognition block.';
    await text.fill(incompleteMessage);
    await dialog
      .getByRole('button', {
        name: english ? 'Save draft' : 'Enregistrer le brouillon'
      })
      .click();
    await expect(dialog.getByRole('alert')).toContainText(
      english ? 'edit the source drafts' : 'modifiez les brouillons sources'
    );
    await expect(text).toHaveValue(incompleteMessage);
    await expect(dialog.getByRole('checkbox')).toBeDisabled();
    await expect(
      dialog.getByRole('button', {
        name: english ? 'Accept and schedule' : 'Accepter et programmer'
      })
    ).toBeDisabled();
    await expect(
      page.getByText(english ? 'Saved.' : 'Enregistré.', { exact: true })
    ).toHaveCount(0);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      action: 'edit',
      id: initialJob.id,
      version: 1,
      message: incompleteMessage
    });
    expect(commands.some((command) => command.action === 'approve')).toBe(
      false
    );
  });
}

for (const language of ['fr-CA', 'en'] as const) {
  for (const width of [390, 1280]) {
    test(`media withdrawal explains reauthorization and opens the media tab in ${language} at ${width}px`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(
        (locale) => localStorage.setItem('openg7.language', locale),
        language
      );
      await fixtures(
        page,
        'blocked',
        false,
        [
          {
            id: '22222222-2222-4222-8222-222222222222',
            name: 'Atelier Visuel',
            version: 'v2',
            reviewStatus: 'approved',
            presentationApproved: true,
            paymentStatus: 'paid'
          }
        ],
        {
          kind: 'sponsorship',
          errorCode: width === 390 ? 'MEDIA_NOT_APPROVED' : 'MEDIA_CHANGED',
          mediaId: '33333333-3333-4333-8333-333333333333'
        }
      );
      let previewRequests = 0;
      await page.route(
        '**/api/admin/sponsorships/media/content/**',
        async (route) => {
          previewRequests++;
          await route.fulfill({ status: 404, json: { error: 'Not found' } });
        }
      );
      await page.goto(
        '/admin/fundraiser/publications/automation?deliveryId=' + initialJob.id
      );
      const dialog = page.getByRole('dialog', {
        name: language === 'en' ? 'Final publication' : 'Publication finale'
      });
      const explanation = dialog.locator(
        '[data-og7="publication-media-blocker"]'
      );
      await expect(explanation).toContainText(
        language === 'en'
          ? 'Each destination requires a new authorization.'
          : 'Une nouvelle autorisation est nécessaire pour chaque destination.'
      );
      await expect(dialog.getByRole('checkbox')).toHaveCount(0);
      await expect(dialog.getByRole('alert')).toHaveCount(0);
      expect(previewRequests).toBe(0);
      expect(
        await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)
      ).toBe(true);
      expect(
        (await new AxeBuilder({ page }).include('dialog[open]').analyze())
          .violations
      ).toEqual([]);
      await explanation.getByRole('link', { name: 'Atelier Visuel' }).focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(
        /sponsorshipId=22222222-2222-4222-8222-222222222222&tab=media$/
      );
    });
  }
}

test('a blocked publication without a payment fact keeps the general explanation', async ({
  page
}) => {
  await fixtures(
    page,
    'blocked',
    false,
    [
      {
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Atelier Historique',
        version: 'v1',
        reviewStatus: 'approved',
        presentationApproved: true
      }
    ],
    { errorCode: 'SOURCE_NOT_ELIGIBLE' }
  );
  await page.goto(
    '/admin/fundraiser/publications/automation?deliveryId=' + initialJob.id
  );
  const dialog = page.getByRole('dialog', { name: 'Publication finale' });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.locator('[data-og7="publication-payment-blocker"]')
  ).toHaveCount(0);
  await expect(dialog.locator('.alert')).toBeVisible();
});

for (const language of ['fr-CA', 'en'] as const) {
  for (const width of [390, 1280]) {
    test(`uncertain recovery keeps evidence and explicit decisions visible in ${language} at ${width}px`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(
        (locale) => localStorage.setItem('openg7.language', locale),
        language
      );
      const commands = await fixtures(page, 'uncertain');
      const en = language === 'en';
      await page.goto(
        '/admin/fundraiser/publications/automation?deliveryId=' + initialJob.id
      );
      const dialog = page.getByRole('dialog', {
        name: en ? 'Final publication' : 'Publication finale'
      });
      const remoteId = dialog.getByRole('textbox').first();
      const reconcile = dialog.getByRole('button', {
        name: en
          ? 'Verify and confirm publication'
          : 'Vérifier et confirmer la publication'
      });
      await expect(reconcile).toBeDisabled();
      await remoteId.fill('missing-post');
      await reconcile.click();
      await expect(dialog.getByRole('alert')).toContainText(
        en
          ? 'before concluding that it is absent'
          : 'avant de conclure à son absence'
      );
      await expect(
        dialog.getByRole('link', {
          name: en ? 'View publication' : 'Voir la publication'
        })
      ).toHaveCount(0);
      await remoteId.fill('different-post');
      await reconcile.click();
      await expect(dialog.getByRole('alert')).toContainText(
        en ? 'does not match' : 'ne correspond pas'
      );
      await remoteId.fill('verified-post');
      await reconcile.click();
      await expect(
        dialog.getByRole('link', {
          name: en ? 'View publication' : 'Voir la publication'
        })
      ).toBeVisible();
      expect(commands.filter((c) => c.action === 'reconcile')).toHaveLength(3);

      await page.unroute('**/api/**');
      const absenceCommands = await fixtures(page, 'uncertain');
      await page.reload();
      await dialog
        .locator('summary')
        .filter({
          hasText: en
            ? 'After checking: the publication is absent'
            : 'Après vérification : la publication est absente'
        })
        .click();
      const reason = dialog.locator('textarea');
      const checkbox = dialog.getByRole('checkbox');
      const confirm = dialog.getByRole('button', {
        name: en ? 'Record verification' : 'Consigner la vérification'
      });
      await expect(confirm).toBeDisabled();
      await reason.fill(
        'Checked provider history; no corresponding post was found.'
      );
      await expect(confirm).toBeDisabled();
      await checkbox.check();
      await expect(confirm).toBeEnabled();
      const a11y = await new AxeBuilder({ page })
        .include('dialog[open]')
        .analyze();
      expect(a11y.violations).toEqual([]);
      expect(
        await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)
      ).toBe(true);
      await confirm.focus();
      await page.keyboard.press('Enter');
      expect(absenceCommands).toEqual([
        {
          action: 'confirm-absent',
          id: initialJob.id,
          version: 1,
          confirmation: initialJob.id,
          reason: 'Checked provider history; no corresponding post was found.'
        }
      ]);
      await expect(
        dialog.getByRole('button', {
          name: en ? 'Edit' : 'Modifier',
          exact: true
        })
      ).toBeVisible();
      await expect(
        dialog.getByRole('button', {
          name: en ? 'Accept and schedule' : 'Accepter et programmer'
        })
      ).toHaveCount(0);
    });
  }
}

test('one explicit acceptance reviews pending sponsors and the publication together', async ({
  page
}) => {
  const sponsors: PublicationDelivery['sponsors'] = [
    {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Atelier Boréal',
      version: '2030-06-01 12:00:00+00',
      reviewStatus: 'pending_review',
      presentationApproved: true
    }
  ];
  const commands = await fixtures(page, 'draft', false, sponsors);
  await page.goto('/admin/fundraiser/publications/automation');
  await page.locator('[data-og7-id="' + initialJob.id + '"]').click();
  const dialog = page.getByRole('dialog', { name: 'Publication finale' });
  await expect(dialog.getByRole('textbox')).toHaveCount(0);
  await expect(dialog).toContainText('Atelier Boréal');
  await expect(dialog).toContainText('Leurs fiches restent privées');
  await expect(
    dialog.getByRole('button', { name: 'Accepter et programmer' })
  ).toBeDisabled();
  await dialog
    .getByRole('checkbox', { name: /J’approuve ces commanditaires/ })
    .check();
  await dialog.getByRole('button', { name: 'Accepter et programmer' }).click();
  await completeModeration(page);
  await completeModeration(page);
  expect(commands[0]).toMatchObject({
    action: 'approve',
    approveSponsors: [{ id: sponsors[0]!.id, version: sponsors[0]!.version }]
  });
  await expect(dialog).toContainText('Autorisée');
});

test('a missing sponsor photo blocks acceptance and links to the dossier', async ({
  page
}) => {
  await fixtures(page, 'draft', false, [
    {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Atelier Boréal',
      version: 'v1',
      reviewStatus: 'pending_review',
      presentationApproved: false
    }
  ]);
  await page.goto('/admin/fundraiser/publications/automation');
  await page.locator('[data-og7-id="' + initialJob.id + '"]').click();
  const dialog = page.getByRole('dialog', { name: 'Publication finale' });
  await expect(dialog).toContainText('Photo de présentation à fournir');
  await expect(
    dialog.getByRole('checkbox', { name: /J’approuve/ })
  ).toBeDisabled();
  await expect(
    dialog.getByRole('link', { name: 'Atelier Boréal' })
  ).toHaveAttribute('href', /sponsorshipId=22222222/);
  const a11y = await new AxeBuilder({ page }).include('dialog[open]').analyze();
  expect(a11y.violations).toEqual([]);
});

test('refusing a proposal requires a decision and moves it to history', async ({
  page
}) => {
  const commands = await fixtures(page);
  await page.goto('/admin/fundraiser/publications/automation');
  await page.locator('[data-og7-id="' + initialJob.id + '"]').click();
  const dialog = page.getByRole('dialog', { name: 'Publication finale' });
  await dialog.getByRole('button', { name: 'Refuser', exact: true }).click();
  await expect(page.locator('[data-og7="moderation-decision"]')).toBeVisible();
  expect(commands).toHaveLength(0);
  await completeModeration(page, true);
  await expect(dialog).toContainText('Refusée');
  expect(commands[0]).toMatchObject({
    action: 'reject',
    id: initialJob.id,
    version: 1
  });
  await dialog.getByRole('button', { name: 'Fermer', exact: true }).click();
  await expect(
    page.locator('[data-og7-id="' + initialJob.id + '"]').first()
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Historique', exact: true }).click();
  await expect(
    page.locator('[data-og7-id="' + initialJob.id + '"]').first()
  ).toContainText('Refusée');
});

test('private media uses the authenticated exact JPEG admin preview before acceptance', async ({
  page
}) => {
  const mediaId = '33333333-3333-4333-8333-333333333333';
  const { bytes, hash } = await syntheticPublicationJpeg();
  await fixtures(page, 'draft', false, [], {
    mediaId,
    mediaDerivedHash: hash,
    mediaUrl: 'https://example.test/private.png',
    mediaAlt: 'Photo approuvée'
  });
  let previewRequests = 0;
  await page.route(
    '**/api/admin/publication-automation/image-preview?**',
    async (route) => {
      previewRequests++;
      const url = new URL(route.request().url());
      expect(url.searchParams.get('deliveryId')).toBe(initialJob.id);
      expect(url.searchParams.get('version')).toBe('1');
      expect(route.request().headers()['authorization']).toBe(
        'Bearer openg7-admin-session.ui-fixture'
      );
      await route.fulfill({
        contentType: 'image/jpeg',
        headers: {
          'X-Content-SHA256': hash,
          'X-Publication-Delivery-Version': '1'
        },
        body: bytes
      });
    }
  );
  await page.goto('/admin/fundraiser/publications/automation');
  await page.locator('[data-og7-id="' + initialJob.id + '"]').click();
  const dialog = page.getByRole('dialog', { name: 'Publication finale' });
  await expect(
    dialog.getByRole('img', { name: 'Photo approuvée' })
  ).toHaveAttribute('src', /^blob:/);
  expect(previewRequests).toBe(1);
  await dialog.getByRole('checkbox', { name: /J’approuve/ }).check();
  await expect(
    dialog.getByRole('button', { name: 'Accepter et programmer' })
  ).toBeEnabled();
});

test('editorial posts appear in the calendar with localized status and open their approval', async ({
  page
}) => {
  await fixtures(page);
  await page.goto('/admin/fundraiser/publications/automation');
  await page.getByRole('button', { name: 'Calendrier', exact: true }).click();
  await page.getByLabel('Choisir un mois').fill('2030-06');
  const entry = page.locator(
    '[data-og7="calendar-entry"][data-og7-id="' + initialJob.id + '"]'
  );
  await expect(entry).toContainText('Notre prochaine réalisation');
  await expect(entry).toContainText('Actualité');
  await page.screenshot({
    path: 'test-results/admin-layout/publication-automation-calendar.png',
    fullPage: true
  });
  await entry.click();
  await expect(
    page.getByRole('dialog', { name: 'Publication finale' })
  ).toBeVisible();
});

test('mobile keyboard flow, contrast and focus restoration', async ({
  page
}) => {
  await fixtures(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin/fundraiser/publications/automation');
  await expect(
    page.getByRole('heading', { name: 'Pilotage des feeds', exact: true })
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  const item = page.locator('[data-og7-id="' + initialJob.id + '"]');
  await item.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Publication finale' });
  await expect(dialog).toBeVisible();
  const a11y = await new AxeBuilder({ page }).include('dialog[open]').analyze();
  expect(a11y.violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(item).toBeFocused();
  await page.screenshot({
    path: 'test-results/admin-layout/publication-automation-mobile.png',
    fullPage: true
  });
});

for (const width of [1280, 390]) {
  test(`dossier bridge filters the engine and returns to publication at ${width}px`, async ({
    page
  }) => {
    const sponsorId = '10000000-0000-4000-8000-000000000401';
    const commands = await fixtures(
      page,
      'approved',
      false,
      [
        {
          id: sponsorId,
          name: 'Synthetic sponsor',
          version: 'v1',
          reviewStatus: 'approved',
          presentationApproved: true
        }
      ],
      { kind: 'sponsorship' },
      {
        extraDeliveries: [
          {
            ...initialJob,
            id: '22222222-2222-4222-8222-222222222222',
            message: 'Unrelated publication'
          }
        ]
      }
    );
    await page.setViewportSize({ width, height: 844 });
    await page.goto(
      `/admin/fundraiser/publications/automation?sponsorshipId=${sponsorId}`
    );
    await expect(
      page.locator('[data-og7="publication-dossier-context"]')
    ).toContainText('Publications liées à ce dossier');
    await expect(
      page.getByText('Unrelated publication', { exact: true })
    ).toHaveCount(0);
    await expect(
      page.locator(`[data-og7-id="${initialJob.id}"]`)
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Retour à l’étape 6' })
    ).toHaveAttribute(
      'href',
      `/admin/fundraiser/sponsors?sponsorshipId=${sponsorId}&tab=publication#dossier-publication`
    );
    expect(commands).toHaveLength(0);
    await page.getByRole('link', { name: 'Voir tous les dossiers' }).click();
    await expect(
      page.getByText('Unrelated publication', { exact: true })
    ).toBeVisible();
    await expect(
      page.locator('[data-og7="publication-dossier-context"]')
    ).toHaveCount(0);
    await page.goto(
      `/admin/fundraiser/publications/automation?sponsorshipId=${sponsorId}&deliveryId=${initialJob.id}`
    );
    await expect(
      page.getByRole('dialog', { name: 'Publication finale' })
    ).toBeVisible();
    expect(commands).toHaveLength(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(width);
  });
}

test('missing or mismatched delivery does not open another publication or compose a batch', async ({
  page
}) => {
  const commands = await fixtures(page);
  await page.goto(
    `/admin/fundraiser/publications/automation?sponsorshipId=10000000-0000-4000-8000-000000000401&deliveryId=${initialJob.id}&batchId=${initialJob.id}&feedId=openg20:facebook`
  );
  await expect(
    page.getByText('Cette publication est introuvable', { exact: false })
  ).toBeVisible();
  await expect(
    page.getByRole('dialog', { name: 'Publication finale' })
  ).toHaveCount(0);
  expect(commands).toHaveLength(0);
});

test('approval rereads the dossier scope and waits for server state before feedback', async ({
  page
}) => {
  const sponsorId = '10000000-0000-4000-8000-000000000401';
  let reads = 0;
  let releaseRead!: () => void;
  const reread = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  const commands = await fixtures(
    page,
    'draft',
    false,
    [
      {
        id: sponsorId,
        name: 'Synthetic scoped sponsor',
        version: 'v1',
        reviewStatus: 'approved',
        presentationApproved: true
      }
    ],
    { kind: 'sponsorship' },
    {
      extraDeliveries: [
        {
          ...initialJob,
          id: '22222222-2222-4222-8222-222222222222',
          message: 'Unrelated scoped publication'
        }
      ],
      readResponse: async () => {
        if (++reads > 1) await reread;
      }
    }
  );
  await page.goto(
    `/admin/fundraiser/publications/automation?sponsorshipId=${sponsorId}&deliveryId=${initialJob.id}`
  );
  const drawer = page.getByRole('dialog', { name: 'Publication finale' });
  await expect(drawer).toBeVisible();
  await drawer.getByRole('checkbox').check();
  try {
    await drawer
      .getByRole('button', { name: 'Accepter et programmer', exact: true })
      .click();
    await completeModeration(page);
    await expect.poll(() => reads).toBe(2);
    expect(commands).toHaveLength(1);
    await expect(
      page.locator('[data-og7="publication-automation"]')
    ).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByText('Enregistré.', { exact: true })).toHaveCount(0);
    await expect(
      drawer.getByRole('button', {
        name: 'Accepter et programmer',
        exact: true
      })
    ).toBeDisabled();
  } finally {
    releaseRead();
  }
  await expect(
    page.locator('[data-og7="publication-automation"]')
  ).toHaveAttribute('aria-busy', 'false');
  await expect(drawer).toContainText('Autorisée');
  await expect(
    page.getByText('Unrelated scoped publication', { exact: true })
  ).toHaveCount(0);
  expect(commands).toHaveLength(1);
});

test('a late dossier read cannot reopen its delivery or replace navigation back to all dossiers', async ({
  page
}) => {
  const sponsorId = '10000000-0000-4000-8000-000000000401';
  const unrelatedId = '22222222-2222-4222-8222-222222222222';
  let reads = 0;
  let releaseRead!: () => void;
  const pendingRead = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  const filters: URLSearchParams[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      request.method() === 'GET' &&
      url.pathname.endsWith('/publication-automation')
    )
      filters.push(url.searchParams);
  });
  const commands = await fixtures(
    page,
    'draft',
    false,
    [
      {
        id: sponsorId,
        name: 'Synthetic delayed dossier',
        version: 'v1',
        reviewStatus: 'approved',
        presentationApproved: true
      }
    ],
    { kind: 'sponsorship' },
    {
      extraDeliveries: [
        {
          ...initialJob,
          id: unrelatedId,
          message: 'Current unfiltered publication'
        }
      ],
      readResponse: async () => {
        if (++reads === 1) await pendingRead;
      }
    }
  );
  try {
    await page.goto(
      `/admin/fundraiser/publications/automation?sponsorshipId=${sponsorId}&deliveryId=${initialJob.id}&batchId=${initialJob.id}&feedId=openg20:facebook`
    );
    await expect.poll(() => reads).toBe(1);
    await page.getByRole('link', { name: 'Voir tous les dossiers' }).click();
    await expect(page.locator(`[data-og7-id="${unrelatedId}"]`)).toBeVisible();
    await expect.poll(() => reads).toBe(2);
    expect(filters[0]!.get('sponsorshipId')).toBe(sponsorId);
    expect(filters[0]!.get('deliveryId')).toBe(initialJob.id);
    expect(filters[1]!.has('sponsorshipId')).toBe(false);
    expect(filters[1]!.has('deliveryId')).toBe(false);
    const lateResponse = page.waitForResponse((response) =>
      response.url().includes(`sponsorshipId=${sponsorId}`)
    );
    releaseRead();
    await (await lateResponse).finished();
    await page.waitForLoadState('networkidle');
    await expect(page.locator(`[data-og7-id="${unrelatedId}"]`)).toBeVisible();
    await expect(
      page.getByRole('dialog', { name: 'Publication finale' })
    ).toHaveCount(0);
    await expect(
      page.locator('[data-og7="publication-dossier-context"]')
    ).toHaveCount(0);
    expect(commands).toHaveLength(0);
  } finally {
    releaseRead();
  }
});

test('polling waits 30 seconds and stays suspended while delivery, settings or composition panels are open', async ({
  page
}) => {
  await page.clock.install();
  let reads = 0;
  const commands = await fixtures(
    page,
    'draft',
    false,
    [],
    {},
    {
      readResponse: async () => {
        reads++;
      }
    }
  );
  await page.goto('/admin/fundraiser/publications/automation?settings=feeds');
  const delivery = page.locator(`[data-og7-id="${initialJob.id}"]`);
  await expect(delivery).toBeVisible();
  expect(reads).toBe(1);
  const tick = async (count: number) => {
    await page.clock.fastForward(30000);
    await expect.poll(() => reads).toBe(count);
  };
  await tick(2);
  await delivery.click();
  const drawer = page.getByRole('dialog', { name: 'Publication finale' });
  await expect(drawer).toBeVisible();
  await tick(2);
  await drawer.getByRole('button', { name: 'Fermer', exact: true }).click();
  await tick(3);
  await page
    .getByRole('button', { name: 'Réglages', exact: true })
    .first()
    .click();
  const settings = page.getByRole('dialog', { name: 'Réglages', exact: true });
  await expect(settings).toBeVisible();
  await tick(3);
  await settings
    .getByRole('button', { name: 'Fermer', exact: true })
    .first()
    .click();
  await tick(4);
  await page
    .getByRole('button', { name: 'Nouvelle publication', exact: true })
    .click();
  await expect(drawer).toBeVisible();
  await tick(4);
  await drawer.getByRole('button', { name: 'Fermer', exact: true }).click();
  await tick(5);
  expect(commands).toHaveLength(0);
});

for (const [language, width] of [
  ['fr-CA', 1280],
  ['en', 390]
] as const) {
  test(`delivery image choices stay inside their batch while editorial composition keeps both sponsors in ${language} at ${width}px`, async ({
    page
  }) => {
    const secondDeliveryId = '66666666-6666-4666-8666-666666666666';
    const firstSponsorId = '22222222-2222-4222-8222-222222222222';
    const secondSponsorId = '44444444-4444-4444-8444-444444444444';
    const firstImageId = '33333333-3333-4333-8333-333333333333';
    const secondImageId = '55555555-5555-4555-8555-555555555555';
    let releaseSecondCatalog!: () => void;
    const secondCatalog = new Promise<void>((resolve) => {
      releaseSecondCatalog = resolve;
    });
    const requests: (string | null)[] = [];
    const sponsor = (
      id: string,
      name: string
    ): PublicationDelivery['sponsors'][number] => ({
      id,
      name,
      version: 'v1',
      reviewStatus: 'approved',
      presentationApproved: true
    });
    const commands = await fixtures(
      page,
      'draft',
      false,
      [sponsor(firstSponsorId, 'Company A')],
      { kind: 'sponsorship', batchId: '77777777-7777-4777-8777-777777777777' },
      {
        extraDeliveries: [
          {
            ...initialJob,
            id: secondDeliveryId,
            kind: 'sponsorship',
            batchId: '88888888-8888-4888-8888-888888888888',
            message: 'Company B publication',
            sponsors: [sponsor(secondSponsorId, 'Company B')]
          }
        ],
        sponsorMedia: {
          [firstSponsorId]: [
            { id: firstImageId, url: '', alt: 'Image A', company: 'Company A' }
          ],
          [secondSponsorId]: [
            { id: secondImageId, url: '', alt: 'Image B', company: 'Company B' }
          ]
        },
        mediaResponse: async (deliveryId) => {
          requests.push(deliveryId);
          if (deliveryId === secondDeliveryId) await secondCatalog;
        }
      }
    );
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(
      (locale) => localStorage.setItem('openg7.language', locale),
      language
    );
    const english = language === 'en';
    const dialog = page.getByRole('dialog', {
      name: english ? 'Final publication' : 'Publication finale'
    });
    const imageOptions = dialog.locator('select[name="media"] option');
    const values = () =>
      imageOptions.evaluateAll((options) =>
        options.map((option) => (option as HTMLOptionElement).value)
      );
    const modify = () =>
      dialog
        .getByRole('button', {
          name: english ? 'Edit' : 'Modifier',
          exact: true
        })
        .click();
    const close = () =>
      dialog
        .getByRole('button', {
          name: english ? 'Close' : 'Fermer',
          exact: true
        })
        .first()
        .click();
    try {
      await page.goto('/admin/fundraiser/publications/automation');
      await page.locator(`[data-og7-id="${initialJob.id}"]`).click();
      await modify();
      await expect.poll(values).toEqual(['', firstImageId]);
      await expect(imageOptions).toHaveText([
        english ? 'No image' : 'Sans image',
        'Company A · Image A'
      ]);
      await close();
      await page.locator(`[data-og7-id="${secondDeliveryId}"]`).click();
      await modify();
      await expect.poll(() => requests.includes(secondDeliveryId)).toBe(true);
      await expect.poll(values).toEqual(['']);
      releaseSecondCatalog();
      await expect.poll(values).toEqual(['', secondImageId]);
      await expect(imageOptions).toHaveText([
        english ? 'No image' : 'Sans image',
        'Company B · Image B'
      ]);
      await close();
      await page
        .getByRole('button', {
          name: english ? 'New publication' : 'Nouvelle publication',
          exact: true
        })
        .click();
      await expect.poll(values).toEqual(['', firstImageId, secondImageId]);
      expect(requests).toEqual([initialJob.id, secondDeliveryId, null]);
      expect(commands).toHaveLength(0);
    } finally {
      releaseSecondCatalog();
    }
  });
}

test('a command confirmation supersedes an older polling response without restoring its draft or retrying', async ({
  page
}) => {
  await page.clock.install();
  let reads = 0;
  let releasePollingRead!: () => void;
  const pendingRead = new Promise<void>((resolve) => {
    releasePollingRead = resolve;
  });
  const commands = await fixtures(
    page,
    'draft',
    false,
    [],
    {},
    {
      readResponse: async () => {
        if (++reads === 2) await pendingRead;
      }
    }
  );
  try {
    await page.goto('/admin/fundraiser/publications/automation');
    const delivery = page.locator(`[data-og7-id="${initialJob.id}"]`);
    await expect(delivery).toBeVisible();
    await page.clock.fastForward(30000);
    await expect.poll(() => reads).toBe(2);
    await delivery.click();
    const drawer = page.getByRole('dialog', { name: 'Publication finale' });
    await drawer.getByRole('checkbox').check();
    await drawer
      .getByRole('button', { name: 'Accepter et programmer', exact: true })
      .click();
    await completeModeration(page);
    await expect(drawer).toContainText('Autorisée');
    await expect(page.getByText('Enregistré.', { exact: true })).toBeVisible();
    expect(reads).toBe(3);
    const lateResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        new URL(response.url()).pathname.endsWith('/publication-automation')
    );
    releasePollingRead();
    await (await lateResponse).finished();
    await page.waitForLoadState('networkidle');
    await expect(delivery).toHaveCount(0);
    await expect(drawer).toContainText('Autorisée');
    await expect(page.getByText('Enregistré.', { exact: true })).toBeVisible();
    expect(commands).toHaveLength(1);
  } finally {
    releasePollingRead();
  }
});
