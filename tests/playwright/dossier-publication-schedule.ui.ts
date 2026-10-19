import type { Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import type {
  AdminSponsorshipProgress,
  PublicationAutomationCommand,
  PublicationAutomationState,
  PublicationDelivery,
  PublicationPreparationCandidate,
  PublicationPreparationEntry,
  SponsorshipCommitmentRecord
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';
import { completeModeration, moderationFixture } from './support/moderation.js';

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
  options.progressOverrides = {
    amountMinor: 10000,
    commitment: context.recordedCommitment(10000),
    publicationCompletion: { done: 0, total: 3 },
    publications: [
      {
        ...context.dossier().publications[0]!,
        batchStatus: 'scheduled',
        deliveryId,
        deliveryStatus: 'draft',
        deliveryMode: 'mock',
        scheduledAt
      }
    ]
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
    .locator('[data-og7="publication-channel"]')
    .filter({ hasText: 'Facebook' })
    .first();

export function registerDossierPublicationScheduleTests(
  context: Context
): void {
  test.describe('dossier publication schedule', () => {
    test.use({ timezoneId: 'Asia/Tokyo' });
    for (const [language, width] of [
      ['fr-CA', 1280],
      ['en', 390]
    ] as const) {
      test(`publication guideposts keep a web-only agreement navigable for a ${language} reader at ${width}px`, async ({
        page
      }) => {
        const { options, state, controls } = await fixtures(
          page,
          context,
          'reader'
        );
        const commitment = options.progressOverrides.commitment!;
        const benefits = commitment.offer!.benefits.filter(
          (benefit) => benefit.channel === 'website'
        );
        expect(benefits).toHaveLength(1);
        const offerVersion = 'synthetic-accepted-web-offer-v2';
        options.progressOverrides = {
          ...options.progressOverrides,
          commitment: {
            ...commitment,
            version: 7,
            offer: { ...commitment.offer!, version: offerVersion, benefits },
            obligations: commitment.obligations.filter(
              (obligation) => obligation.channel === 'website'
            )
          },
          publications: [],
          fulfilmentEvidence: [],
          qualifiedFulfilmentEvidenceIds: [],
          publicationCompletion: { done: 0, total: 1 },
          website: {
            visible: false,
            held: false,
            canPublish: true,
            version: 'synthetic-website-v4',
            blockers: []
          }
        };
        state.deliveries = [];
        state.queue!.entries = [];
        state.queue!.summary.retained = 0;
        state.queue!.total = 0;
        const writes: string[] = [];
        page.on('request', (request) => {
          if (request.method() === 'POST')
            writes.push(new URL(request.url()).pathname);
        });
        await page.addInitScript(
          (locale) => localStorage.setItem('openg7.language', locale),
          language
        );
        await page.setViewportSize({ width, height: 1000 });
        await page.goto(context.path('publication'));
        const journey = page.locator(
          '[data-og7="dossier-publication-journey"]'
        );
        const guide = journey.getByRole('navigation', {
          name:
            language === 'en'
              ? 'Publication guideposts'
              : 'Repères de publication'
        });
        const links = guide.locator('[data-og7="publication-chain-link"]');
        await expect(links).toHaveCount(6);
        const labels =
          language === 'en'
            ? [
                'Offer',
                'Preparation',
                'Content',
                'Authorization',
                'Delivery',
                'Evidence'
              ]
            : [
                'Offre',
                'Préparation',
                'Contenu',
                'Autorisation',
                'Livraison',
                'Preuve'
              ];
        for (const [index, label] of labels.entries())
          await expect(links.nth(index)).toHaveAccessibleName(label);
        await expect(
          journey.locator('[data-og7="publication-agreement-version"]')
        ).toHaveText('7');
        await expect(
          journey.locator('[data-og7="publication-offer-version"]')
        ).toHaveText(offerVersion);
        await expect(
          journey.locator('#publication-delivery-count')
        ).toContainText(language === 'en' ? '0 of 1' : '0 / 1');
        await expect(
          journey.locator('[data-og7="publication-channel"]')
        ).toHaveCount(0);
        await expect(
          journey.locator('[data-og7="website-visibility"]')
        ).toHaveCount(0);
        await expect(page.getByRole('dialog')).toHaveCount(0);
        for (const [id, fragment] of [
          ['offer', 'dossier-agreement'],
          ['preparation', 'dossier-preparation'],
          ['content', 'dossier-publication-content'],
          ['authorization', 'dossier-publication-content']
        ] as const) {
          await expect(guide.locator(`[data-og7-id="${id}"]`)).toHaveAttribute(
            'href',
            context.path('publication') + '#' + fragment
          );
        }
        for (const [id, path] of [
          ['delivery', '/admin/fundraiser/publications/automation'],
          ['evidence', '/admin/fundraiser/campaigns']
        ] as const)
          await expect(guide.locator(`[data-og7-id="${id}"]`)).toHaveAttribute(
            'href',
            path + '?sponsorshipId=' + sponsorshipId
          );
        await guide.screenshot({
          path: test
            .info()
            .outputPath(`publication-guideposts-${language}-${width}.png`)
        });
        for (const [id, fragment] of [
          ['offer', 'dossier-agreement'],
          ['preparation', 'dossier-preparation'],
          ['content', 'dossier-publication-content']
        ] as const) {
          const link = guide.locator(`[data-og7-id="${id}"]`);
          await link.focus();
          await link.press('Enter');
          await expect(page).toHaveURL(
            context.path('publication') + '#' + fragment
          );
          await expect(page.locator('#' + fragment)).toBeFocused();
        }
        await expect(journey).not.toContainText('admin.dossier.');
        expect(
          (
            await new AxeBuilder({ page })
              .include('[data-og7="publication-chain"]')
              .analyze()
          ).violations
        ).toEqual([]);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1
          )
        ).toBe(true);
        expect(controls.commands).toEqual([]);
        expect(writes).toEqual([]);
      });
    }
    for (const language of ['fr-CA', 'en'] as const) {
      test(`publication console assigns scheduled work to the platform in ${language}`, async ({
        page
      }) => {
        const { options, job, state, controls } = await fixtures(page, context);
        job.mode = 'live';
        job.status = 'approved';
        state.feeds[0]!.paused = false;
        options.progressOverrides = {
          ...options.progressOverrides,
          publicationWorkflow: {
            state: 'waiting',
            responsibility: 'platform',
            reason: 'publication_scheduled',
            obligations: [
              {
                obligationId: 'synthetic-facebook-obligation',
                channel: 'facebook',
                target: 'openg7',
                ordinal: 1,
                state: 'waiting',
                responsibility: 'platform',
                reason: 'publication_scheduled',
                deliveryId,
                scheduledAt
              }
            ]
          }
        };
        await page.addInitScript(
          (locale) => localStorage.setItem('openg7.language', locale),
          language
        );
        await page.setViewportSize({
          width: language === 'en' ? 390 : 1280,
          height: 1000
        });
        await page.goto(context.path('publication'));
        const console = page.locator('[data-og7="publication-obligations"]');
        await expect(console).toBeVisible();
        await expect(console).toHaveAttribute(
          'data-responsibility',
          'platform'
        );
        await expect(console.locator('[data-og7-id], time')).toHaveCount(0);
        await expect(
          console.locator('[data-og7="publication-campaign-benefits"]')
        ).toHaveAttribute(
          'href',
          `/admin/fundraiser/campaigns?sponsorshipId=${sponsorshipId}`
        );
        await expect(channel(page)).toHaveAttribute('data-state', 'scheduled');
        const authorizedDate = channel(page).locator(
          '[data-og7="publication-next-slot"]'
        );
        await expect(authorizedDate).toContainText(
          language === 'en'
            ? 'Authorized publication date:'
            : 'Date d’envoi autorisée :'
        );
        await expect(authorizedDate).not.toContainText(
          language === 'en' ? 'Proposed time:' : 'Créneau proposé :'
        );
        await expect(console).toContainText(
          language === 'en'
            ? 'automatic publication pending'
            : 'envoi automatique à venir'
        );
        await expect(console.getByRole('button')).toHaveCount(0);
        await expect(
          console.locator('[data-og7="publication-obligation-proof"]')
        ).toHaveCount(0);
        expect(controls.commands).toEqual([]);
        const violations = (
          await new AxeBuilder({ page })
            .include('[data-og7="publication-obligations"]')
            .analyze()
        ).violations;
        expect(violations).toEqual([]);
        await console.screenshot({
          path: test.info().outputPath(`publication-console-${language}.png`)
        });
      });
    }

    test('publication console keeps an uncertain delivery actionable despite an existing qualified proof', async ({
      page
    }) => {
      const { options, job, state, controls } = await fixtures(page, context);
      job.mode = 'live';
      job.status = 'uncertain';
      job.externalPostUrl = 'https://example.invalid/uncertain-delivery';
      state.feeds[0]!.paused = false;
      const commitment = options.progressOverrides.commitment!;
      const facebookId = commitment.obligations.find(
        (item) => item.channel === 'facebook'
      )!.id;
      options.progressOverrides = {
        ...options.progressOverrides,
        commitment: {
          ...commitment,
          obligations: commitment.obligations.map((item) =>
            item.id === facebookId
              ? {
                  ...item,
                  state: 'fulfilled',
                  fulfilmentEvidenceId: 'synthetic-existing-proof'
                }
              : item
          )
        },
        qualifiedFulfilmentEvidenceIds: ['synthetic-existing-proof'],
        fulfilmentEvidence: [
          {
            id: 'synthetic-existing-proof',
            obligationId: facebookId,
            deliveryId,
            channel: 'facebook',
            target: 'openg7',
            provenance: 'provider_acknowledged',
            deliveredAt: evaluatedAt,
            externalPostUrl: 'https://example.invalid/retained-proof',
            visibility: 'unknown',
            visibilityObservedAt: null
          }
        ],
        publicationWorkflow: {
          state: 'uncertain',
          responsibility: 'admin',
          reason: 'publication_uncertain',
          obligations: [
            {
              obligationId: facebookId,
              channel: 'facebook',
              target: 'openg7',
              ordinal: 1,
              state: 'uncertain',
              responsibility: 'admin',
              reason: 'publication_uncertain',
              deliveryId,
              scheduledAt
            }
          ]
        }
      };
      await page.goto(context.path('publication'));
      const card = channel(page);
      await expect(card).toHaveAttribute('data-state', 'uncertain');
      await expect(card).toContainText('Résultat à vérifier');
      await expect(
        card.getByRole('link', { name: 'Voir la publication' })
      ).toHaveCount(0);
      await expect(
        card.locator('[data-og7="publication-review"]')
      ).toHaveAccessibleName('Examiner le blocage');
      const summary = page.locator('[data-og7="publication-obligations"]');
      await expect(summary).toHaveAttribute('data-state', 'uncertain');
      await expect(summary).toContainText('vérifier avant toute relance');
      await expect(
        summary.locator('[data-og7="publication-campaign-benefits"]')
      ).toHaveAttribute(
        'href',
        `/admin/fundraiser/campaigns?sponsorshipId=${sponsorshipId}`
      );
      await expect(
        page.locator(
          `[data-og7="commitments-obligations"] [data-og7-id="${facebookId}"]`
        )
      ).toContainText('synthetic-existing-proof');
      await card.locator('[data-og7="publication-review"]').click();
      await expect(
        page.getByRole('dialog', { name: 'Publication finale' })
      ).toContainText('Le résultat de cet envoi est incertain');
      expect(controls.commands).toEqual([]);
    });

    test('publication console keeps legacy completion counts unconfirmed without qualified evidence', async ({
      page
    }) => {
      const { options, job, controls } = await fixtures(page, context);
      job.mode = 'live';
      job.status = 'published';
      job.externalPostUrl = 'https://example.invalid/legacy-declaration';
      const commitment = options.progressOverrides.commitment!;
      const obligations = commitment.obligations.map((item) => ({
        ...item,
        state: 'fulfilled' as const,
        fulfilmentEvidenceId: 'synthetic-legacy-proof-' + item.id
      }));
      options.progressOverrides = {
        ...options.progressOverrides,
        commitment: { ...commitment, obligations },
        publicationCompletion: { done: 3, total: 3 },
        publicationBlockers: ['review'],
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
      await page.goto(context.path('publication'));
      await expect(page.locator('#publication-delivery-count')).toContainText(
        '0 / 3'
      );
      await expect(
        page.getByRole('progressbar', { name: /Contreparties livrées/ })
      ).toHaveAttribute('value', '0');
      const tabs = page.locator('[data-og7="dossier-tabs"]');
      await tabs.getByRole('button', { name: 'Aperçu', exact: true }).click();
      await expect(
        page.locator('[data-og7="publication-blockers"]')
      ).toContainText('Vérifier et accepter le dossier');
      await tabs
        .getByRole('button', { name: 'Publication', exact: true })
        .click();
      await expect(channel(page)).toHaveAttribute('data-state', 'unverified');
      await expect(
        channel(page).getByRole('link', { name: 'Voir la publication' })
      ).toHaveCount(0);
      options.progressOverrides = {
        ...options.progressOverrides,
        commitment: {
          ...commitment,
          obligations: obligations.map((item) => ({
            ...item,
            state: 'adjusted',
            fulfilmentEvidenceId: null
          }))
        },
        publicationCompletion: { done: 0, total: 0 }
      };
      await page.reload();
      await expect(page.locator('#publication-delivery-count')).toContainText(
        '0 / 0'
      );
      await expect(
        page.locator('[data-og7="publication-blockers"]')
      ).toHaveCount(0);
      await expect(
        page.getByRole('progressbar', { name: /Contreparties livrées/ })
      ).toHaveCount(0);
      expect(controls.commands).toEqual([]);
    });

    test('publication console preserves the Facebook proof when LinkedIn fails or remains uncertain', async ({
      page
    }) => {
      const { options, job, controls } = await fixtures(page, context);
      job.mode = 'live';
      job.status = 'published';
      job.publishedAt = evaluatedAt;
      const commitment = options.progressOverrides.commitment!;
      const facebookId = commitment.obligations.find(
        (item) => item.channel === 'facebook'
      )!.id;
      const linkedinId = commitment.obligations.find(
        (item) => item.channel === 'linkedin'
      )!.id;
      options.progressOverrides = {
        ...options.progressOverrides,
        commitment: {
          ...commitment,
          obligations: commitment.obligations.map((item) =>
            item.id === facebookId
              ? {
                  ...item,
                  state: 'fulfilled',
                  fulfilmentEvidenceId: 'synthetic-facebook-proof'
                }
              : item
          )
        },
        qualifiedFulfilmentEvidenceIds: ['synthetic-facebook-proof'],
        publicationCompletion: { done: 1, total: 3 },
        fulfilmentEvidence: [
          {
            id: 'synthetic-facebook-proof',
            obligationId: facebookId,
            deliveryId,
            channel: 'facebook',
            target: 'openg7',
            provenance: 'provider_acknowledged',
            deliveredAt: evaluatedAt,
            externalPostUrl: 'https://example.invalid/facebook-post',
            visibility: 'unknown',
            visibilityObservedAt: null
          }
        ],
        publicationWorkflow: {
          state: 'error',
          responsibility: 'admin',
          reason: 'publication_failed',
          obligations: [
            {
              obligationId: facebookId,
              channel: 'facebook',
              target: 'openg7',
              ordinal: 1,
              state: 'complete',
              responsibility: 'none',
              reason: 'publication_done',
              deliveryId,
              scheduledAt
            },
            {
              obligationId: linkedinId,
              channel: 'linkedin',
              target: 'openg7',
              ordinal: 1,
              state: 'error',
              responsibility: 'admin',
              reason: 'publication_failed',
              deliveryId: null,
              scheduledAt
            }
          ]
        }
      };
      await page.goto(context.path('publication'));
      const console = page.locator('[data-og7="publication-obligations"]');
      await expect(console).toHaveAttribute('data-state', 'error');
      await expect(console.locator('[data-og7-id]')).toHaveCount(0);
      const benefits = console.locator(
        '[data-og7="publication-campaign-benefits"]'
      );
      await expect(benefits).toHaveAttribute(
        'href',
        `/admin/fundraiser/campaigns?sponsorshipId=${sponsorshipId}`
      );
      const detailedFacebook = page.locator(
        `[data-og7="commitments-obligations"] [data-og7-id="${facebookId}"]`
      );
      await expect(detailedFacebook).toContainText('Réalisée avec preuve');
      await expect(detailedFacebook).toContainText('synthetic-facebook-proof');
      await expect(channel(page)).toHaveAttribute('data-state', 'published');
      await expect(page.locator('#publication-delivery-count')).toContainText(
        '1 / 3'
      );
      options.progressOverrides = {
        ...options.progressOverrides,
        publicationWorkflow: {
          ...options.progressOverrides.publicationWorkflow!,
          state: 'uncertain',
          reason: 'publication_uncertain',
          obligations:
            options.progressOverrides.publicationWorkflow!.obligations.map(
              (item) =>
                item.obligationId === linkedinId
                  ? {
                      ...item,
                      state: 'uncertain',
                      reason: 'publication_uncertain'
                    }
                  : item
            )
        }
      };
      await page.reload();
      await expect(console).toHaveAttribute('data-state', 'uncertain');
      await expect(console).toContainText('vérifier avant toute relance');
      await expect(detailedFacebook).toContainText('synthetic-facebook-proof');
      await expect(channel(page)).toHaveAttribute('data-state', 'published');
      options.progressOverrides = {
        ...options.progressOverrides,
        qualifiedFulfilmentEvidenceIds: [],
        publicationCompletion: { done: 0, total: 3 },
        publicationWorkflow: {
          ...options.progressOverrides.publicationWorkflow!,
          state: 'blocked',
          responsibility: 'admin',
          reason: 'fulfilment_unverified',
          obligations:
            options.progressOverrides.publicationWorkflow!.obligations.map(
              (item) =>
                item.obligationId === facebookId
                  ? {
                      ...item,
                      state: 'blocked',
                      responsibility: 'admin',
                      reason: 'fulfilment_unverified'
                    }
                  : item
            )
        }
      };
      await page.reload();
      await expect(console).toHaveAttribute('data-state', 'blocked');
      await expect(console).toContainText('Preuve de livraison à vérifier');
      await expect(
        console.locator('[data-og7="publication-obligation-proof"]')
      ).toHaveCount(0);
      await expect(channel(page)).toHaveAttribute('data-state', 'unverified');
      await expect(detailedFacebook).toContainText(
        'Déclaration historique · livraison non confirmée'
      );
      expect(controls.commands).toEqual([]);
    });

    for (const [language, width] of [
      ['fr-CA', 1280],
      ['en', 390]
    ] as const) {
      test(`publication schedule proposal remains a Toronto suggestion until explicit review in ${language} at ${width}px`, async ({
        page
      }) => {
        const { controls } = await fixtures(page, context);
        await page.addInitScript((language) => {
          localStorage.setItem('openg7.language', language);
        }, language);
        await page.setViewportSize({ width, height: 1000 });
        await page.goto(context.path('publication'));
        const card = channel(page);
        const slot = card.locator('[data-og7="publication-next-slot"]');
        await expect(slot).toContainText('10');
        await expect(slot).toContainText('Toronto');
        await expect(slot).toContainText(
          language === 'en' ? 'Proposed time:' : 'Créneau proposé :'
        );
        await expect(slot.locator('time')).toHaveAttribute(
          'datetime',
          scheduledAt
        );
        await expect(
          page.locator('[data-og7="publication-slot-help"]')
        ).toBeVisible();
        expect(controls.commands).toEqual([]);
        expect(controls.reads.length).toBeGreaterThan(0);
        expect(
          controls.reads.every(
            (url) => url.searchParams.get('sponsorshipId') === sponsorshipId
          )
        ).toBe(true);
        const review = card.locator('[data-og7="publication-review"]');
        await expect(review).toHaveAccessibleName(
          language === 'en' ? /Review/ : /Vérifier/
        );
        await page
          .locator('[data-og7="dossier-publication-journey"]')
          .screenshot({
            path: `test-results/publication-schedule-proposal-${width}.png`
          });
        await review.focus();
        await page.keyboard.press('Enter');
        const dialog = page.getByRole('dialog', {
          name: language === 'en' ? 'Final publication' : 'Publication finale'
        });
        await expect(dialog).toContainText('synthetic-page-openg7');
        await expect(dialog).toContainText('Asia/Tokyo');
        await expect(dialog).toContainText('Atelier Boréal');
        await expect(dialog).toContainText('Atelier Rivage');
        await expect(dialog).toContainText(
          'Une seconde initiative synthétique.'
        );
        await expect(
          dialog.getByRole('button', {
            name:
              language === 'en'
                ? 'Accept and schedule'
                : 'Accepter et programmer'
          })
        ).toBeDisabled();
        expect(controls.commands).toEqual([]);
        expect(
          (await new AxeBuilder({ page }).include('dialog[open]').analyze())
            .violations
        ).toEqual([]);
        expect(
          await dialog.evaluate(
            (element) => element.scrollWidth <= element.clientWidth
          )
        ).toBe(true);
        await dialog.screenshot({
          path: `test-results/publication-schedule-review-${width}.png`
        });
        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
        await expect(review).toBeFocused();
      });
    }

    test('publication schedule proposal keeps the proposed instant and requires the existing human confirmation', async ({
      page
    }) => {
      const { controls, job } = await fixtures(page, context);
      await page.goto(context.path('publication'));
      await channel(page).locator('[data-og7="publication-review"]').click();
      const dialog = page.getByRole('dialog', { name: 'Publication finale' });
      const approve = dialog.getByRole('button', {
        name: 'Accepter et programmer'
      });
      await expect(approve).toBeDisabled();
      await dialog.getByRole('checkbox', { name: /J’approuve/ }).check();
      expect(controls.commands).toEqual([]);
      await approve.click();
      await expect(
        page.locator('[data-og7="moderation-confirmation"]')
      ).not.toBeChecked();
      expect(controls.commands).toEqual([]);
      await completeModeration(page);
      await expect.poll(() => controls.commands.length).toBe(1);
      expect(controls.commands[0]).toMatchObject({
        action: 'approve',
        id: deliveryId,
        version: 1,
        confirmation: deliveryId
      });
      await expect(channel(page)).toHaveAttribute('data-state', 'scheduled');
      if (!(await dialog.isVisible()))
        await channel(page).locator('[data-og7="publication-review"]').click();
      await expect(dialog).toContainText('Autorisée');
      expect(
        controls.commands.some((command) => command.action === 'edit')
      ).toBe(false);
      expect(job.scheduledAt).toBe(scheduledAt);
    });

    test('publication schedule proposal opens the exact date editor and saving revokes authorization', async ({
      page
    }) => {
      const { controls, job } = await fixtures(page, context);
      job.status = 'approved';
      job.approvedAt = evaluatedAt;
      await page.goto(context.path('publication'));
      await channel(page).locator('[data-og7="publication-slot-edit"]').click();
      const dialog = page.getByRole('dialog', { name: 'Publication finale' });
      await expect(dialog.getByLabel(/Asia\/Tokyo/)).toBeVisible();
      await expect(dialog.getByLabel('Texte exact à publier')).toHaveValue(
        job.message
      );
      await dialog
        .locator('input[type="datetime-local"]')
        .fill('2030-06-06T11:15');
      expect(controls.commands).toEqual([]);
      await dialog
        .getByRole('button', { name: 'Enregistrer le brouillon' })
        .click();
      await expect.poll(() => controls.commands.length).toBe(1);
      const expectedAt = await page.evaluate(() =>
        new Date('2030-06-06T11:15').toISOString()
      );
      expect(controls.commands[0]).toMatchObject({
        action: 'edit',
        id: deliveryId,
        version: 1,
        scheduledAt: expectedAt
      });
      await expect(
        channel(page).locator('[data-og7="publication-next-slot"] time')
      ).toHaveAttribute('datetime', expectedAt);
      if (!(await dialog.isVisible()))
        await channel(page).locator('[data-og7="publication-review"]').click();
      await expect(
        dialog.getByRole('button', { name: 'Accepter et programmer' })
      ).toBeDisabled();
      expect(job.approvedAt).toBeNull();
    });

    test('publication schedule proposal displays the server forecast without preparing or approving a delivery', async ({
      page
    }) => {
      const { state, entry, controls, options } = await fixtures(page, context);
      state.deliveries = [];
      state.feeds[0]!.paused = false;
      state.queue!.entries = [
        {
          ...entry,
          scheduledAt: null,
          batchId: null,
          deliveryId: null,
          deliveryStatus: null,
          status: 'deferred',
          reason: 'AWAITING_PREPARATION',
          nextOpportunity: {
            ...entry.nextOpportunity!,
            reason: 'AVAILABLE_IN_HORIZON',
            action: 'PREPARE_FEED'
          }
        }
      ];
      options.progressOverrides = {
        ...options.progressOverrides,
        publications: []
      };
      await page.goto(context.path('publication'));
      const card = channel(page);
      await expect(
        card.locator('[data-og7="publication-next-slot"]')
      ).toContainText('10');
      await expect(
        card.locator('[data-og7="publication-prepare"]')
      ).toBeVisible();
      await expect(card.locator('[data-og7="publication-review"]')).toHaveCount(
        0
      );
      expect(controls.commands).toEqual([]);
    });

    test('publication schedule proposal prepares a first draft only after confirmation when the worker is disabled', async ({
      page
    }) => {
      const { state, entry, controls, options } = await fixtures(page, context);
      state.feeds[0]!.paused = false;
      controls.preparedState = {
        ...structuredClone(state),
        workerEnabled: false
      };
      state.workerEnabled = false;
      state.deliveries = [];
      state.queue!.entries = [];
      state.queue!.summary.retained = 0;
      state.queue!.total = 0;
      const commitment = options.progressOverrides.commitment!;
      Object.assign(state, {
        preparationCandidates: [
          {
            obligationId: commitment.obligations.find(
              (obligation) => obligation.channel === 'facebook'
            )!.id,
            sponsorshipId,
            name: 'Atelier Boréal',
            feedId: 'openg7:facebook',
            publicationFormat: 'collective_text',
            renderedLength: entry.renderedLength,
            budget: entry.budget,
            status: 'deferred',
            reason: 'AWAITING_PREPARATION',
            nextOpportunity: {
              ...entry.nextOpportunity!,
              reason: 'AVAILABLE_IN_HORIZON',
              action: 'PREPARE_FEED'
            }
          }
        ] satisfies PublicationPreparationCandidate[]
      });
      options.progressOverrides = {
        ...options.progressOverrides,
        publications: []
      };
      await page.goto(context.path('publication'));
      const card = channel(page);
      await expect(
        card.locator('[data-og7="publication-next-slot"] time')
      ).toHaveAttribute('datetime', scheduledAt);
      await expect(
        card.locator('[data-og7="publication-next-slot"]')
      ).toContainText('Toronto');
      const prepare = card.locator('[data-og7="publication-prepare"]');
      await expect(prepare).toBeEnabled();
      await expect(card.locator('[data-og7="publication-review"]')).toHaveCount(
        0
      );
      expect(controls.commands).toEqual([]);
      await page.locator('[data-og7="publication-delivery-board"]').screenshot({
        path: 'test-results/publication-schedule-first-proposal.png'
      });
      await prepare.click();
      const confirmation = page.getByRole('dialog', {
        name: 'Confirmer l’action'
      });
      await expect(confirmation).toContainText('tous les dossiers admissibles');
      await expect(confirmation).toContainText('openg7:facebook');
      expect(controls.commands).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(confirmation).not.toBeVisible();
      expect(controls.commands).toEqual([]);
      await prepare.click();
      await page.locator('[data-og7="confirm-action"]').click();
      await expect.poll(() => controls.commands.length).toBe(1);
      expect(controls.commands[0]).toEqual({
        action: 'prepare',
        feedId: 'openg7:facebook'
      });
      const dialog = page.getByRole('dialog', { name: 'Publication finale' });
      await expect(
        channel(page).locator('[data-og7="publication-review"]')
      ).toBeVisible();
      if (!(await dialog.isVisible()))
        await channel(page).locator('[data-og7="publication-review"]').click();
      await expect(dialog).toContainText('Atelier Boréal');
      await expect(
        dialog.getByRole('button', { name: 'Accepter et programmer' })
      ).toBeDisabled();
      await expect(
        dialog.getByRole('checkbox', { name: /J’approuve/ })
      ).not.toBeChecked();
      expect(controls.commands).toHaveLength(1);
    });

    for (const status of [401, 403]) {
      test(`publication schedule proposal clears its private drawer after a failed save and ${status} recovery read`, async ({
        page
      }) => {
        const { controls, job } = await fixtures(page, context);
        await page.goto(context.path('publication'));
        await channel(page)
          .locator('[data-og7="publication-slot-edit"]')
          .click();
        const dialog = page.getByRole('dialog', { name: 'Publication finale' });
        const privateText = 'Brouillon privé synthétique à purger';
        await dialog.getByLabel('Texte exact à publier').fill(privateText);
        controls.commandStatus = 503;
        controls.status = status;
        const initialReads = controls.reads.length;
        await dialog
          .getByRole('button', { name: 'Enregistrer le brouillon' })
          .click();
        await expect
          .poll(() => controls.reads.length)
          .toBeGreaterThan(initialReads);
        await expect(dialog).not.toBeVisible();
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
        await expect(page.getByText(job.message, { exact: true })).toHaveCount(
          0
        );
        await expect(
          page.locator('[data-og7="publication-schedule-error"]')
        ).toBeVisible();
        await expect(
          page.locator('[data-og7="publication-schedule-loading"]')
        ).toHaveCount(0);
        expect(controls.commands).toHaveLength(1);
        expect(controls.commands[0]).toMatchObject({ action: 'edit' });
      });
    }

    test('publication schedule proposal allows editing again after a failed save and successful recovery', async ({
      page
    }) => {
      const { controls } = await fixtures(page, context);
      await page.goto(context.path('publication'));
      await channel(page).locator('[data-og7="publication-slot-edit"]').click();
      const dialog = page.getByRole('dialog', { name: 'Publication finale' });
      controls.commandStatus = 503;
      const save = dialog.getByRole('button', {
        name: 'Enregistrer le brouillon'
      });
      await dialog
        .getByLabel('Texte exact à publier')
        .fill('Modification synthétique');
      const initialReads = controls.reads.length;
      await save.click();
      await expect
        .poll(() => controls.reads.length)
        .toBeGreaterThan(initialReads);
      await expect(dialog.getByRole('alert')).toBeVisible();
      await expect(save).toBeEnabled();
      await expect(
        page.locator('[data-og7="publication-schedule-loading"]')
      ).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
      await expect(
        channel(page).locator('[data-og7="publication-review"]')
      ).toBeEnabled();
      expect(controls.commands).toHaveLength(1);
    });

    test('publication schedule proposal opens an exact historical delivery beyond the latest 200 without replacing other cards', async ({
      page
    }) => {
      const { state, job, controls, options } = await fixtures(page, context);
      const historicalId = '77777777-7777-4777-8777-777777777778';
      const historicalDraftId = '77777777-7777-4777-8777-777777777779';
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
          batchId: `88888888-8888-4888-8888-${String(index).padStart(12, '0')}`,
          status: 'published' as const,
          scheduledAt: '2030-05-02T14:00:00.000Z',
          publishedAt: '2030-05-02T14:00:00.000Z'
        })),
        historical
      ];
      options.progressOverrides = {
        ...options.progressOverrides,
        publications: [
          ...options.progressOverrides.publications!,
          {
            ...options.progressOverrides.publications![0]!,
            id: historicalDraftId,
            deliveryId: historicalId,
            deliveryStatus: 'published',
            scheduledAt: historical.scheduledAt,
            publishedAt: historical.publishedAt
          }
        ]
      };
      await page.goto(context.path('publication'));
      const historicalCard = page.locator(
        `[data-og7="publication-channel"][data-og7-id="${historicalDraftId}"]`
      );
      const firstCard = page.locator(
        `[data-og7="publication-channel"][data-og7-id="${otherId}"]`
      );
      await historicalCard.locator('[data-og7="publication-review"]').click();
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
      await expect(firstCard).toHaveAttribute('data-state', 'review');
      await expect(
        firstCard.locator('[data-og7="publication-next-slot"] time')
      ).toHaveAttribute('datetime', scheduledAt);
      await firstCard.locator('[data-og7="publication-review"]').click();
      await expect(dialog).toContainText('Une seconde initiative synthétique.');
      expect(controls.commands).toEqual([]);
    });

    test('publication schedule proposal reports a failed read and retries without preparing or approving', async ({
      page
    }) => {
      const { controls, options } = await fixtures(page, context);
      controls.status = 503;
      options.progressOverrides = {
        ...options.progressOverrides,
        publications: []
      };
      await page.goto(context.path('publication'));
      await expect(
        page.locator('[data-og7="publication-schedule-error"]')
      ).toBeVisible();
      await expect(
        page.locator('[data-og7="publication-next-slot"]')
      ).toHaveCount(0);
      controls.status = 200;
      await page.locator('[data-og7="publication-schedule-refresh"]').click();
      await expect(
        channel(page).locator('[data-og7="publication-next-slot"]')
      ).toBeVisible();
      expect(controls.commands).toEqual([]);
    });

    test('publication schedule proposal ignores a late forecast after switching dossiers', async ({
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
        .getByRole('button', {
          name: 'Publication',
          exact: true
        })
        .click();
      await expect(
        page.locator('[data-og7="publication-schedule-loading"]')
      ).toBeVisible();
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
      const lateResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).searchParams.get('sponsorshipId') ===
            sponsorshipId &&
          new URL(response.url()).pathname.endsWith('/publication-automation')
      );
      release();
      await (await lateResponse).finished();
      await expect(
        page.locator('[data-og7="publication-schedule-loading"]')
      ).toHaveCount(0);
      await expect(
        page.locator('[data-og7="publication-next-slot"]')
      ).toHaveCount(0);
      await expect(page.locator('[data-og7="publication-review"]')).toHaveCount(
        0
      );
      expect(controls.commands).toEqual([]);
    });
  });
}
