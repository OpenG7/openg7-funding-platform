import type { Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import type {
  AdminSponsorshipProgress,
  AdminSponsorshipRecord,
  PublicationWorkshopState,
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
      variants: candidate.editorialPreparation.variants.map((variant) => ({
        ...variant,
        obligationId: twoBenefits.obligations.find(
          (obligation) => obligation.channel === variant.destination
        )!.id
      }))
    }
  };
  const state: { value: PublicationWorkshopState; status: number } = {
    status: 200,
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
      return route.fulfill({ json: state.value });
    }
  );
  return { base, state, writes };
}

export function registerPublicationWorkshopTests(context: Context): void {
  test('publication workshop retries an uncertain preparation with the same request UUID after reconciliation', async ({
    page
  }) => {
    const { state, writes } = await fixtures(page, context);
    state.status = 503;
    await page.goto(context.path('publication'));
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
    await page.goto(context.path('publication'));
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
      await page.goto(context.path('publication'));
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
    await page.goto(context.path('publication'));
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
    await page.goto(context.path('publication'));
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
    await page.goto(context.path('publication'));
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
    await page.goto(context.path('publication'));
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
    await page.goto(context.path('publication'));
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
