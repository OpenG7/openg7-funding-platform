import type { Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import type {
  AdminSponsorshipProgress,
  AdminSponsorshipRecord,
  PublicationWorkshopState,
  PreflightDeskOrder,
  PreflightDeskResponse,
  SponsorshipCommitmentRecord,
  WorkshopProposal
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';

interface Context {
  fixtures(
    page: Page,
    role?: 'owner' | 'operator' | 'reader'
  ): Promise<{
    options: {
      edited: Map<string, Partial<AdminSponsorshipRecord>>;
      progressOverrides: Partial<AdminSponsorshipProgress>;
    };
  }>;
  path(tab?: string, value?: string): string;
  recordedCommitment(amountMinor: number): SponsorshipCommitmentRecord;
}

const id = '10000000-0000-4000-8000-000000000401';
const timestamp = '2030-06-01T12:00:00.000Z';
const workshop = (page: Page) =>
  page.locator('[data-og7="publication-workshop"]');
const operationsPath = () =>
  `/admin/fundraiser/preflight?view=publication&workshopSponsorshipId=${id}&publicationReturn=${id}`;
const monitor = (page: Page) =>
  page.locator('[data-og7="publication-monitor"]');

function proposal(complete = false, version = 1): WorkshopProposal {
  return {
    id: `20000000-0000-4000-8000-${String(version).padStart(12, '0')}`,
    missionId: '30000000-0000-4000-8000-000000000001',
    sourceVersion: version,
    version,
    createdAt: timestamp,
    obsolete: false,
    provenance: {
      simulated: true,
      provider: 'mock',
      model: 'deterministic-v1'
    },
    adoptedAt: null,
    editorialPreparation: {
      schemaVersion: '1.0',
      sourceVersion: version,
      sourceSnapshotDigest: 'a'.repeat(64),
      sourceCommitmentId: '40000000-0000-4000-8000-000000000001',
      commitmentVersion: 1,
      state: complete ? 'ready_for_review' : 'partial',
      publicationAuthorized: false,
      common: {
        version,
        title: complete ? 'Partenaire synthétique' : '',
        presentation: complete ? 'Une présentation synthétique autorisée.' : '',
        recognition: complete ? 'Merci pour cet engagement.' : '',
        sourceFacts: complete
          ? [
              {
                key: 'publicPresentation',
                value: 'Résumé autorisé avant préparation.'
              },
              { key: 'publicName', value: 'Partenaire synthétique' }
            ]
          : [],
        mediaReferences: [],
        missingInformation: complete
          ? []
          : ['organization', 'contact_email', 'public_name_consent']
      },
      variants: (['website', 'facebook'] as const).map(
        (destination, index) => ({
          destination,
          obligationId: `50000000-0000-4000-8000-00000000000${index + 1}`,
          obligationVersion: 1,
          version,
          title: complete ? 'Partenaire synthétique' : '',
          body: complete ? 'Une reconnaissance préparée à examiner.' : '',
          summary: complete ? 'Présentation synthétique' : '',
          format: 'individual',
          mediaReferences: [],
          publicationAuthorized: false
        })
      )
    }
  };
}

async function fixtures(
  page: Page,
  context: Context,
  complete = false,
  role: 'owner' | 'operator' | 'reader' = 'owner'
) {
  const base = await context.fixtures(page, role);
  const commitment = context.recordedCommitment(25000);
  const twoBenefits = {
    ...commitment,
    offer: commitment.offer
      ? {
          ...commitment.offer,
          benefits: commitment.offer.benefits.filter(
            (benefit) => benefit.channel !== 'linkedin'
          )
        }
      : null,
    obligations: commitment.obligations.filter(
      (obligation) => obligation.channel !== 'linkedin'
    )
  };
  base.options.progressOverrides = {
    amountMinor: 25000,
    currency: 'CAD',
    companyName: complete ? 'Partenaire synthétique' : null,
    commitment: twoBenefits,
    publicConsent: complete,
    publications: [],
    publicationCompletion: { done: 0, total: 2 },
    website: {
      visible: false,
      held: true,
      canPublish: false,
      version: 'website-v1',
      blockers: complete ? ['review'] : ['identity', 'consent']
    }
  };
  base.options.edited.set(id, {
    amount: 250,
    sponsor_company_name: complete ? 'Partenaire synthétique' : null,
    sponsor_contact_email: complete ? 'synthetic@example.invalid' : null,
    public_display_consent: complete,
    // Administrative completion never creates an official sponsor submission.
    sponsor_details_submitted_at: null
  });
  const candidate = proposal(complete);
  const current = {
    ...candidate,
    editorialPreparation: {
      ...candidate.editorialPreparation,
      sourceCommitmentId: twoBenefits.id,
      variants: candidate.editorialPreparation.variants.map((variant) => ({
        ...variant,
        obligationId: twoBenefits.obligations.find(
          (obligation) => obligation.channel === variant.destination
        )!.id
      }))
    }
  };
  const state: {
    value: PublicationWorkshopState;
    status: number;
    readStatus: number;
  } = {
    status: 200,
    readStatus: 200,
    value: {
      contributionId: id,
      enabled: true,
      sourceVersion: 1,
      sourceSnapshotDigest: 'a'.repeat(64),
      mission: {
        id: current.missionId,
        status: 'review_ready',
        delivery: 'acknowledged',
        createdAt: timestamp,
        updatedAt: timestamp,
        errorCode: null
      },
      proposal: current,
      history: [current],
      canPrepare: role !== 'reader',
      canAdopt: complete && role !== 'reader'
    }
  };
  const desk: { orders: PreflightDeskOrder[]; status: number } = {
    orders: [],
    status: 200
  };
  await page.route('**/api/admin/preflight/desk?**', (route) => {
    const response: PreflightDeskResponse = {
      generatedAt: timestamp,
      orders: desk.orders,
      pagination: {
        page: 1,
        pageSize: 50,
        totalItems: desk.orders.length,
        totalPages: 1,
        hasPreviousPage: false,
        hasNextPage: false
      },
      summary: {
        total: desk.orders.reduce(
          (sum, order) => sum + order.services.length,
          0
        ),
        toPrepare: 0,
        toReview: desk.orders.reduce(
          (sum, order) =>
            sum +
            order.services.filter((service) => service.stage === 'to_review')
              .length,
          0
        ),
        toDeliver: 0,
        delivered: 0,
        excludedAdjusted: 0,
        orders: desk.orders.length,
        scope: 'recorded_promised_services',
        preflightLink: 'unverified'
      }
    };
    return route.fulfill({
      status: desk.status,
      json: desk.status === 200 ? response : { code: 'TEMPORARILY_UNAVAILABLE' }
    });
  });
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  await page.route('**/api/admin/publication-automation?**', (route) =>
    route.fulfill({
      json: {
        workerEnabled: false,
        workerVersion: 1,
        feeds: [],
        deliveries: [],
        preparationCandidates: [],
        queue: {
          entries: [],
          summary: { retained: 0, deferred: 0, needsCorrection: 0 },
          total: 0,
          offset: 0,
          limit: 200,
          hasMore: false,
          scope: 'filtered',
          evaluatedAt: timestamp
        },
        summary: {
          awaitingApproval: 0,
          scheduled: 0,
          exceptions: 0,
          publishedToday: 0
        }
      }
    })
  );
  await page.route(
    '**/api/admin/sponsorships/publication-workshop**',
    async (route) => {
      const request = route.request(),
        path = new URL(request.url()).pathname;
      if (request.method() === 'POST') {
        const body = request.postDataJSON();
        writes.push({ path, body });
        if (state.status !== 200)
          return route.fulfill({
            status: state.status,
            json: { code: 'WORKSHOP_DRAFT_CHANGED' }
          });
        if (path.endsWith('/adopt')) {
          const adopted = { ...state.value.proposal!, adoptedAt: timestamp };
          state.value = {
            ...state.value,
            proposal: adopted,
            history: [adopted],
            canAdopt: false
          };
        } else {
          state.value = {
            ...state.value,
            canPrepare: false,
            mission: {
              ...state.value.mission!,
              status: 'received',
              delivery: 'queued'
            }
          };
        }
      }
      if (request.method() === 'GET' && state.readStatus !== 200)
        return route.fulfill({
          status: state.readStatus,
          json: {
            code:
              state.readStatus === 403 ? 'FORBIDDEN' : 'TEMPORARILY_UNAVAILABLE'
          }
        });
      return route.fulfill({ json: state.value });
    }
  );
  return { base, state, writes, desk };
}

export function registerPublicationWorkshopTests(context: Context): void {
  test('publication workshop retries an uncertain preparation with the same request UUID after reconciliation', async ({
    page
  }) => {
    const { state, writes } = await fixtures(page, context);
    state.status = 503;
    await page.goto(operationsPath());
    await workshop(page).locator('[data-og7="workshop-prepare"]').click();
    await expect(
      workshop(page).locator('[data-og7="workshop-error"]')
    ).toContainText('réconcilié');
    expect(writes).toHaveLength(1);
    state.status = 200;
    await expect(
      workshop(page).locator('[data-og7="workshop-prepare"]')
    ).toBeEnabled();
    await workshop(page).locator('[data-og7="workshop-prepare"]').click();
    await expect(
      workshop(page).locator('[data-og7="workshop-mission"]')
    ).toContainText('Préparation en cours');
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual(writes[0]);
    await expect(
      workshop(page).locator('[data-og7="workshop-prepare"]')
    ).toBeDisabled();
  });

  test('publication workshop purges private previews when a read loses permission', async ({
    page
  }) => {
    await fixtures(page, context, true);
    await page.goto(operationsPath());
    await workshop(page).locator('[data-og7="workshop-preview"]').click();
    await expect(workshop(page)).toContainText('Une reconnaissance préparée');
    await page.route(
      '**/api/admin/sponsorships/publication-workshop?**',
      (route) => route.fulfill({ status: 403, json: { code: 'FORBIDDEN' } })
    );
    await workshop(page).locator('[data-og7="workshop-refresh"]').click();
    await expect(
      workshop(page).locator('[data-og7="workshop-error"]')
    ).toContainText('droits');
    await expect(workshop(page)).not.toContainText(
      'Une reconnaissance préparée'
    );
    await expect(
      workshop(page).locator('[data-og7="workshop-adopt"]')
    ).toHaveCount(0);
  });

  for (const [locale, width] of [
    ['fr-CA', 1920],
    ['en', 390]
  ] as const) {
    test(`publication workshop presents partial preparation without public consent in ${locale} at ${width}px`, async ({
      page
    }, testInfo) => {
      const { writes } = await fixtures(page, context);
      await page.addInitScript((language) => {
        localStorage.setItem('openg7.language', language);
        localStorage.setItem(
          'openg7.pilotage.appearance.v1',
          JSON.stringify({
            theme: 'night',
            system: false,
            density: 'comfortable'
          })
        );
      }, locale);
      await page.setViewportSize({ width, height: 1080 });
      await page.goto(operationsPath());
      const view = workshop(page);
      await expect(view).toContainText(
        locale === 'en' ? 'Partial preparation' : 'Préparation partielle'
      );
      await expect(
        view.locator('[data-og7="workshop-provenance"]')
      ).toContainText(
        locale === 'en' ? 'Simulated provider' : 'Fournisseur simulé'
      );
      await expect(view.locator('[data-og7="workshop-missing"]')).toContainText(
        locale === 'en' ? 'Public name consent' : 'nom public'
      );
      await expect(view.locator('[data-og7="workshop-adopt"]')).toHaveCount(0);
      await view.locator('[data-og7="workshop-preview"]').focus();
      await page.keyboard.press('Enter');
      await expect(view.locator('[data-og7="workshop-variant"]')).toHaveCount(
        2
      );
      await expect(
        view.locator('[data-og7="workshop-not-authorized"]')
      ).toContainText(
        locale === 'en'
          ? 'Publication not authorized'
          : 'Publication non autorisée'
      );
      await expect(
        view.locator('[data-og7="workshop-preview-content"]')
      ).not.toContainText('Atelier Boréal');
      expect(writes).toEqual([]);
      expect(
        (
          await new AxeBuilder({ page })
            .include('[data-og7="publication-workshop"]')
            .analyze()
        ).violations
      ).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth
        )
      ).toBe(false);
      await view.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: testInfo.outputPath(`publication-workshop-${width}.png`),
        fullPage: true
      });
      await view.locator('[data-og7="workshop-preview"]').click();
      await page.screenshot({
        path: testInfo.outputPath(`publication-workshop-compact-${width}.png`),
        fullPage: true
      });
    });
  }

  test('publication workshop adopts an exact proposal only after confirmation and leaves review and delivery separate', async ({
    page
  }) => {
    const { writes } = await fixtures(page, context, true);
    await page.goto(operationsPath());
    const view = workshop(page);
    await expect(view.locator('[data-og7="workshop-adopt"]')).toBeVisible();
    await view.locator('[data-og7="workshop-preview"]').click();
    await expect(
      view.locator('[data-og7="workshop-summary-comparison"]')
    ).toContainText('Résumé autorisé avant préparation.');
    await expect(
      view.locator('[data-og7="workshop-summary-comparison"]')
    ).toContainText('Présentation synthétique');
    expect(writes).toEqual([]);
    await view.locator('[data-og7="workshop-adopt"]').click();
    await expect(page.locator('[data-og7="confirm-action"]')).toBeVisible();
    expect(writes).toEqual([]);
    await page.locator('[data-og7="confirm-action"]').click();
    await expect(view.locator('[data-og7="workshop-notice"]')).toContainText(
      'autorisations de diffusion restent à effectuer'
    );
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      path: '/api/admin/sponsorships/publication-workshop/adopt',
      body: {
        contributionId: id,
        proposalId: proposal(true).id,
        expectedSourceVersion: 1
      }
    });
    expect(writes[0].body.requestId).toMatch(/^[a-f\d-]{36}$/);
    const preview = view.locator('[data-og7="workshop-preview"]');
    if ((await preview.getAttribute('aria-expanded')) !== 'true')
      await preview.click();
    await expect(view.locator('[data-og7="workshop-examine"]')).toHaveCount(2);
    expect(
      writes.every(({ path }) => !/publish|approve|visibility/.test(path))
    ).toBe(true);
  });

  test('publication workshop retains outdated versions and blocks their adoption', async ({
    page
  }) => {
    const { state, writes } = await fixtures(page, context, true);
    const old = { ...proposal(true), obsolete: true };
    const current = proposal(true, 2);
    state.value = {
      ...state.value,
      sourceVersion: 2,
      proposal: current,
      history: [current, old]
    };
    await page.goto(operationsPath());
    const view = workshop(page);
    await view.locator('[data-og7="workshop-versions"] > summary').click();
    await view.locator(`[data-og7-id="${old.id}"]`).click();
    await expect(
      view.locator('[data-og7="workshop-proposal-state"]')
    ).toHaveText('Version obsolète');
    await expect(view.locator('[data-og7="workshop-adopt"]')).toHaveCount(0);
    await expect(
      view.locator('[data-og7="workshop-preview-content"]')
    ).toBeVisible();
    expect(writes).toEqual([]);
  });

  test('publication workshop keeps history accessible when no current proposal remains', async ({
    page
  }) => {
    const { state, writes } = await fixtures(page, context, true);
    const old = { ...state.value.proposal!, obsolete: true };
    state.value = {
      ...state.value,
      sourceVersion: 2,
      proposal: null,
      history: [old],
      canAdopt: false
    };
    await page.goto(operationsPath());
    const view = workshop(page);
    await expect(view.locator('[data-og7="workshop-empty"]')).toBeVisible();
    await view.locator('[data-og7="workshop-versions"] > summary').click();
    await view.locator(`[data-og7-id="${old.id}"]`).click();
    await expect(
      view.locator('[data-og7="workshop-proposal-state"]')
    ).toHaveText('Version obsolète');
    await expect(
      view.locator('[data-og7="workshop-preview-content"]')
    ).toBeVisible();
    await expect(view.locator('[data-og7="workshop-adopt"]')).toHaveCount(0);
    expect(writes).toEqual([]);
  });

  test('publication workshop preserves human drafts on concurrent adoption conflict', async ({
    page
  }) => {
    const { state, writes } = await fixtures(page, context, true);
    state.status = 409;
    await page.goto(operationsPath());
    await workshop(page).locator('[data-og7="workshop-adopt"]').click();
    await page.locator('[data-og7="confirm-action"]').click();
    await expect(
      workshop(page).locator('[data-og7="workshop-error"]')
    ).toContainText('modifications existantes sont préservées');
    expect(writes).toHaveLength(1);
    expect(state.value.proposal?.adoptedAt).toBeNull();
  });

  test('publication workshop readers see provenance and previews without generation or adoption controls', async ({
    page
  }) => {
    const { state, writes } = await fixtures(page, context, true, 'reader');
    state.value = {
      ...state.value,
      proposal: {
        ...state.value.proposal!,
        provenance: {
          simulated: false,
          provider: 'qualified-provider',
          model: 'qualified-model'
        }
      }
    };
    await page.goto(operationsPath());
    await expect(
      workshop(page).locator('[data-og7="workshop-provenance"]')
    ).toContainText('Fournisseur réel');
    await expect(
      workshop(page).locator('[data-og7="workshop-prepare"]')
    ).toHaveCount(0);
    await expect(
      workshop(page).locator('[data-og7="workshop-adopt"]')
    ).toHaveCount(0);
    await workshop(page).locator('[data-og7="workshop-preview"]').click();
    await expect(
      workshop(page).locator('[data-og7="workshop-variant"]')
    ).toHaveCount(2);
    expect(writes).toEqual([]);
  });
}

async function monitorFixtures(
  page: Page,
  context: Context,
  role: 'owner' | 'operator' | 'reader' = 'owner'
) {
  const fixture = await fixtures(page, context, true, role);
  fixture.base.options.edited.set(id, {
    sponsor_company_name: 'Partenaire synthétique',
    sponsor_contact_email: 'synthetic@example.invalid',
    sponsor_details_submitted_at: timestamp,
    sponsor_review_status: 'approved',
    public_display_consent: true
  });
  fixture.base.options.progressOverrides = {
    ...fixture.base.options.progressOverrides,
    reviewStatus: 'approved',
    publicationBlockers: [],
    website: {
      visible: false,
      held: true,
      canPublish: false,
      version: 'website-v1',
      blockers: []
    }
  };
  return fixture;
}

/** The individual monitor reads facts; the existing owners retain all mutations. */
export function registerPublicationMonitorTests(context: Context): void {
  for (const theme of ['mineral', 'night', 'graphite'] as const)
    for (const [locale, width] of [
      ['fr-CA', 1440],
      ['en', 390]
    ] as const) {
      test(`publication monitor replaces the old workshop with compact real services in ${theme} ${locale} at ${width}px`, async ({
        page
      }, testInfo) => {
        const fixture = await monitorFixtures(page, context, 'reader');
        await page.addInitScript(
          ({ language, theme }) => {
            localStorage.setItem('openg7.language', language);
            localStorage.setItem(
              'openg7.pilotage.appearance.v1',
              JSON.stringify({ theme, system: false })
            );
          },
          { language: locale, theme }
        );
        await page.setViewportSize({ width, height: 1000 });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto(context.path('publication'));
        const view = monitor(page);
        await expect(view).toBeVisible();
        await expect(
          view.locator('[data-og7="publication-service"]')
        ).toHaveCount(2);
        await expect(
          view.locator(
            '[data-og7="publication-service"][data-state="proposal"]'
          )
        ).toHaveCount(2);
        await expect(
          view.getByRole('heading', { name: 'Publication', exact: true })
        ).toBeVisible();
        await expect(
          view.locator('[data-og7="publication-delivery-progress"] progress')
        ).toHaveAttribute('value', '0');
        await expect(
          view.locator('[data-og7="publication-delivery-progress"] progress')
        ).toHaveAttribute('max', '2');
        for (const oldHook of [
          'publication-workshop',
          'publication-advanced',
          'publication-administrative-controls',
          'publication-contract-history',
          'dossier-publication-editor'
        ])
          await expect(view.locator(`[data-og7="${oldHook}"]`)).toHaveCount(0);
        await expect(view.locator('input, textarea, select')).toHaveCount(0);
        await expect(
          view.locator(
            '[data-og7="workshop-prepare"], [data-og7="workshop-adopt"]'
          )
        ).toHaveCount(0);
        await expect(
          view.locator('[data-state="collective_review"]')
        ).toHaveCount(0);
        for (const service of await view
          .locator('[data-og7="publication-service"]')
          .all()) {
          await expect(
            service.locator('[data-og7="publication-service-action"]')
          ).toHaveCount(1);
          await expect(
            service.locator('[data-og7="publication-service-action"]')
          ).toHaveAccessibleName(/\S/);
        }
        expect(fixture.writes).toEqual([]);
        expect(
          (
            await new AxeBuilder({ page })
              .include('[data-og7="publication-monitor"]')
              .analyze()
          ).violations
        ).toEqual([]);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1
          )
        ).toBe(true);
        const refresh = view.locator(
          '[data-og7="publication-monitor-refresh"]'
        );
        await refresh.focus();
        await expect(refresh).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(
          view.locator('[data-og7="publication-service"]')
        ).toHaveCount(2);
        expect(fixture.writes).toEqual([]);
        await view.screenshot({
          path: testInfo.outputPath(
            `publication-monitor-${theme}-${locale}-${width}.png`
          )
        });
        await view
          .locator('[data-og7="publication-service-action"]')
          .first()
          .click();
        await expect(page).toHaveURL(operationsPath());
        await expect(
          page.locator('[data-og7="publication-owner"]')
        ).toBeVisible();
        expect(fixture.writes).toEqual([]);
      });
    }

  test('publication monitor shows observed preparation without fabricated delivery progress', async ({
    page
  }) => {
    const fixture = await monitorFixtures(page, context);
    fixture.state.value = {
      ...fixture.state.value,
      proposal: null,
      history: [],
      mission: {
        ...fixture.state.value.mission!,
        status: 'running',
        delivery: 'acknowledged'
      },
      canAdopt: false
    };
    await page.goto(context.path('publication'));
    const view = monitor(page);
    await expect(
      view.locator('[data-og7="publication-service"][data-state="preparing"]')
    ).toHaveCount(2);
    await expect(
      view.locator('[data-og7="publication-delivery-progress"] progress')
    ).toHaveAttribute('value', '0');
    await expect(view).toContainText(/préparation/i);
    expect(fixture.writes).toEqual([]);
  });

  test('publication monitor treats collective review as exact recorded queue membership and preserves the return context', async ({
    page
  }) => {
    const fixture = await monitorFixtures(page, context);
    const commitment = fixture.base.options.progressOverrides.commitment!;
    const obligation = commitment.obligations.find(
      (item) => item.channel === 'facebook'
    )!;
    fixture.desk.orders = [
      {
        contributionId: id,
        reference: 'DEMO-401',
        companyName: 'Partenaire synthétique',
        amountMinor: '25000',
        currency: 'CAD',
        commitmentId: commitment.id,
        commitmentVersion: commitment.version,
        paidAt: timestamp,
        delivered: 0,
        total: 1,
        adminUrl: context.path('publication'),
        services: [
          {
            id: obligation.id,
            contributionId: id,
            reference: 'DEMO-401',
            companyName: 'Partenaire synthétique',
            paidAt: timestamp,
            channel: 'facebook',
            target: 'openg7',
            ordinal: 1,
            quantity: 1,
            format: 'collective_text',
            obligationState: 'pending',
            timing: null,
            preparation: {
              status: 'ready',
              version: 'service-v1',
              approvedAt: null,
              blockers: []
            },
            workflow: {
              obligationId: obligation.id,
              channel: 'facebook',
              target: 'openg7',
              ordinal: 1,
              state: 'action_required',
              responsibility: 'admin',
              reason: 'publication_preparation_required',
              deliveryId: null,
              scheduledAt: null
            },
            content: {
              title: 'Titre synthétique',
              body: 'Contenu synthétique à examiner'
            },
            proof: null,
            adminUrl: context.path('publication'),
            stage: 'to_review',
            blocked: false,
            blockers: [],
            preparationOrigin: 'funding',
            preflightLink: 'unverified',
            reviewUrl: `/admin/fundraiser/preflight?sponsorshipId=${id}&obligationId=${obligation.id}`
          }
        ]
      }
    ];
    await page.goto(context.path('publication'));
    const row = monitor(page).locator(
      `[data-og7="publication-service"][data-og7-id="${obligation.id}"]`
    );
    await expect(row).toHaveAttribute('data-state', 'collective_review');
    await expect(
      monitor(page).locator(
        '[data-og7="publication-service"][data-state="collective_review"]'
      )
    ).toHaveCount(1);
    const action = row.locator('[data-og7="publication-service-action"]');
    await action.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/admin\/fundraiser\/preflight\?view=desk/);
    const target = new URL(page.url());
    expect(target.searchParams.get('reviewReturn')).toBe(obligation.id);
    expect(target.searchParams.get('publicationReturn')).toBe(id);
    expect(target.searchParams.has('sponsorshipId')).toBe(false);
    await expect(
      page.locator(
        `[data-og7="preflight-desk-service"][data-og7-id="${obligation.id}"]`
      )
    ).toHaveAttribute('data-context', 'true');
    await page.locator('[data-og7="publication-return"]').first().click();
    await expect(page).toHaveURL(
      new RegExp(`sponsorshipId=${id}.*tab=publication`)
    );
    expect(fixture.writes).toEqual([]);
  });

  test('publication monitor exposes obsolete proposals as exceptions without adoption', async ({
    page
  }) => {
    const fixture = await monitorFixtures(page, context);
    const outdated = { ...fixture.state.value.proposal!, obsolete: true };
    fixture.state.value = {
      ...fixture.state.value,
      proposal: outdated,
      history: [outdated],
      canAdopt: false
    };
    await page.goto(context.path('publication'));
    const view = monitor(page);
    await expect(
      view.locator('[data-og7="publication-service"][data-state="obsolete"]')
    ).toHaveCount(2);
    await expect(view).toContainText(/obsolète/i);
    await expect(view.locator('[data-og7="workshop-adopt"]')).toHaveCount(0);
    expect(fixture.writes).toEqual([]);
  });

  test('publication monitor distinguishes a disabled preparation service from an unavailable read', async ({
    page
  }) => {
    const fixture = await monitorFixtures(page, context);
    fixture.state.value = {
      ...fixture.state.value,
      enabled: false,
      proposal: null,
      history: [],
      mission: null,
      canAdopt: false,
      canPrepare: false
    };
    await page.goto(context.path('publication'));
    const view = monitor(page);
    await expect(
      view.locator('[data-og7="publication-service"][data-state="disabled"]')
    ).toHaveCount(2);
    await expect(
      view.locator('[data-og7="publication-monitor-error"]')
    ).toHaveCount(0);
    fixture.state.readStatus = 503;
    await view.locator('[data-og7="publication-monitor-refresh"]').click();
    await expect(
      view.locator('[data-og7="publication-monitor-error"]')
    ).toBeVisible();
    await expect(
      view.locator('[data-og7="publication-monitor-empty"]')
    ).toHaveCount(0);
    await expect(view.locator('[data-og7="publication-service"]')).toHaveCount(
      2
    );
    expect(fixture.writes).toEqual([]);
  });

  test('publication monitor retains known proposal facts on transient errors and clears them when access is denied', async ({
    page
  }) => {
    const fixture = await monitorFixtures(page, context, 'reader');
    await page.goto(context.path('publication'));
    const view = monitor(page);
    await expect(
      view.locator('[data-og7="publication-service"][data-state="proposal"]')
    ).toHaveCount(2);
    fixture.state.readStatus = 503;
    await view.locator('[data-og7="publication-monitor-refresh"]').click();
    await expect(
      view.locator('[data-og7="publication-monitor-error"]')
    ).toBeVisible();
    await expect(
      view.locator('[data-og7="publication-service"][data-state="proposal"]')
    ).toHaveCount(2);
    fixture.state.readStatus = 403;
    await view.locator('[data-og7="publication-monitor-refresh"]').click();
    await expect(
      view.locator('[data-og7="publication-monitor-error"]')
    ).toContainText(/droits|accès/i);
    await expect(
      view.locator('[data-og7="publication-service"][data-state="proposal"]')
    ).toHaveCount(0);
    await expect(view).not.toContainText('Présentation synthétique');
    expect(fixture.writes).toEqual([]);
  });

  test('publication monitor counts contractual passages and only their exact qualified evidence', async ({
    page
  }) => {
    const fixture = await monitorFixtures(page, context);
    const original = fixture.base.options.progressOverrides.commitment!;
    const facebook = original.obligations.find(
      (item) => item.channel === 'facebook'
    )!;
    const evidenceId = '10000000-0000-4000-8000-000000000601';
    const secondPassage = {
      ...facebook,
      id: '10000000-0000-4000-8000-000000000602',
      ordinal: 2
    };
    const thirdPassage = {
      ...facebook,
      id: '10000000-0000-4000-8000-000000000603',
      ordinal: 3
    };
    fixture.base.options.progressOverrides = {
      ...fixture.base.options.progressOverrides,
      commitment: {
        ...original,
        obligations: original.obligations
          .map((item) =>
            item.id === facebook.id
              ? {
                  ...item,
                  state: 'fulfilled' as const,
                  fulfilmentEvidenceId: evidenceId
                }
              : item
          )
          .concat([secondPassage, thirdPassage])
      },
      fulfilmentEvidence: [
        {
          id: evidenceId,
          obligationId: facebook.id,
          deliveryId: '10000000-0000-4000-8000-000000000604',
          channel: 'facebook',
          target: 'openg7',
          provenance: 'provider_acknowledged',
          deliveredAt: timestamp,
          externalPostUrl: 'https://example.invalid/qualified-publication',
          visibility: 'unknown',
          visibilityObservedAt: null
        }
      ],
      qualifiedFulfilmentEvidenceIds: [evidenceId],
      publicationCompletion: { done: 1, total: 4 },
      publicationWorkflow: {
        state: 'waiting',
        responsibility: 'platform',
        reason: 'publication_scheduled',
        obligations: [
          {
            obligationId: secondPassage.id,
            channel: 'facebook',
            target: 'openg7',
            ordinal: 2,
            state: 'waiting',
            responsibility: 'platform',
            reason: 'publication_scheduled',
            deliveryId: '10000000-0000-4000-8000-000000000606',
            scheduledAt: '2030-06-04T14:00:00Z'
          }
        ]
      },
      publications: [
        {
          id: '10000000-0000-4000-8000-000000000605',
          obligationId: secondPassage.id,
          channel: 'facebook',
          target: 'openg7',
          status: 'approved',
          batchStatus: null,
          slotStatus: null,
          deliveryId: '10000000-0000-4000-8000-000000000606',
          deliveryStatus: 'approved',
          deliveryMode: 'live',
          scheduledAt: '2030-06-04T14:00:00Z',
          publishedAt: null
        }
      ]
    };
    await page.goto(context.path('publication'));
    const view = monitor(page);
    await expect(view.locator('[data-og7="publication-service"]')).toHaveCount(
      4
    );
    await expect(
      view.locator(
        `[data-og7="publication-service"][data-og7-id="${facebook.id}"]`
      )
    ).toHaveAttribute('data-state', 'delivered');
    await expect(
      view.locator(
        `[data-og7="publication-service"][data-og7-id="${secondPassage.id}"]`
      )
    ).toHaveAttribute('data-state', 'scheduled');
    await expect(
      view.locator('[data-og7="publication-delivery-progress"] progress')
    ).toHaveAttribute('value', '1');
    await expect(
      view.locator('[data-og7="publication-delivery-progress"] progress')
    ).toHaveAttribute('max', '4');
    expect(fixture.writes).toEqual([]);
  });

  test('publication monitor never counts an approved or simulated publication as a delivery', async ({
    page
  }) => {
    const fixture = await monitorFixtures(page, context);
    const facebook =
      fixture.base.options.progressOverrides.commitment!.obligations.find(
        (item) => item.channel === 'facebook'
      )!;
    fixture.base.options.progressOverrides = {
      ...fixture.base.options.progressOverrides,
      publicationCompletion: { done: 1, total: 2 },
      publications: [
        {
          id: '10000000-0000-4000-8000-000000000607',
          obligationId: facebook.id,
          channel: 'facebook',
          target: 'openg7',
          status: 'approved',
          batchStatus: null,
          slotStatus: null,
          deliveryId: '10000000-0000-4000-8000-000000000608',
          deliveryStatus: 'published',
          deliveryMode: 'mock',
          scheduledAt: timestamp,
          publishedAt: timestamp
        }
      ]
    };
    await page.goto(context.path('publication'));
    const view = monitor(page);
    await expect(
      view.locator(
        `[data-og7="publication-service"][data-og7-id="${facebook.id}"]`
      )
    ).toHaveAttribute('data-state', 'simulated');
    await expect(
      view.locator('[data-og7="publication-delivery-progress"] progress')
    ).toHaveAttribute('value', '0');
    await expect(
      view.locator('[data-og7="publication-service"][data-state="delivered"]')
    ).toHaveCount(0);
    expect(fixture.writes).toEqual([]);
  });

  test('publication monitor has an explicit empty state when no publication is promised', async ({
    page
  }) => {
    const fixture = await monitorFixtures(page, context);
    const original = fixture.base.options.progressOverrides.commitment!;
    fixture.base.options.progressOverrides = {
      ...fixture.base.options.progressOverrides,
      commitment: {
        ...original,
        obligations: [],
        offer: { ...original.offer!, benefits: [] }
      },
      publications: [],
      publicationCompletion: { done: 0, total: 0 }
    };
    fixture.state.value = {
      ...fixture.state.value,
      proposal: null,
      history: [],
      mission: null
    };
    await page.goto(context.path('publication'));
    const view = monitor(page);
    await expect(
      view.locator('[data-og7="publication-monitor-empty"]')
    ).toBeVisible();
    await expect(view.locator('[data-og7="publication-service"]')).toHaveCount(
      0
    );
    await expect(
      view.locator('[data-og7="publication-delivery-progress"] progress')
    ).toHaveCount(0);
    await expect(
      view.locator('[data-og7="publication-monitor-error"]')
    ).toHaveCount(0);
    expect(fixture.writes).toEqual([]);
  });
}
