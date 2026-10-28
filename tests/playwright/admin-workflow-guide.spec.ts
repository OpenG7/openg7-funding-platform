import type { Page } from '@playwright/test';
import type {
  AdminDossierPreparationReceipt,
  PreparationAssistanceState,
  PreparationAssistanceSummary,
  SponsorshipCommitmentRecord
} from '@openg7/funding-core';

import { extractStructuredPreparationPublications } from '../../packages/funding-core/src/index.js';

import { expect, test } from './support/test.js';
import { restoreLegacyGuideMode } from './support/admin-guidance-bookmarks.js';
import {
  controllerId,
  controllerJourneysFixtures,
  controllerPath
} from './support/controller-journeys.fixtures.js';

const date = '2026-10-17T12:00:00Z';
const highlighted = '[data-og7-guidance-highlight]';
const hook = (page: Page, name: string) => page.locator(`[data-og7="${name}"]`);
const journey = (page: Page, id: string) =>
  page.locator(`[data-og7="workflow-guide-journey"][data-og7-id="${id}"]`);
const step = (page: Page, id: string) =>
  page.locator(`[data-og7="workflow-guide-step"][data-og7-id="${id}"]`);
const journeyPicker = (page: Page) =>
  hook(page, 'workflow-guide')
    .locator('details')
    .filter({ has: hook(page, 'workflow-guide-journey') });
const journeys = {
  agreement: ['pilot', 'source', 'proposal', 'qualification', 'confirm'],
  preparation: ['obligations', 'prepare', 'draft'],
  authorization: ['review', 'content', 'schedule', 'authorize'],
  delivery: ['status', 'responsibility', 'evidence'],
  website: ['presentation', 'preview', 'visibility'],
  history: ['tracking', 'declare', 'save']
} as const;

/** Built Web with synthetic reads only; no API, database or publishing provider. */
async function fixtures(
  page: Page,
  options: { locale?: string; role?: 'owner' | 'reader'; source?: boolean } = {}
) {
  const role = options.role ?? 'owner';
  const base = await controllerJourneysFixtures(
    page,
    role,
    options.locale ?? 'en',
    { hardware: 'native' }
  );
  const commitment: SponsorshipCommitmentRecord = {
    id: 'synthetic-workflow-historical-commitment',
    contributionId: controllerId,
    offerId: null,
    provenance: 'historical_unverified',
    state: 'needs_confirmation',
    qualificationReason: null,
    version: 1,
    offer: null,
    obligations: []
  };
  base.commitment = commitment;
  base.progress = {
    ...base.progress,
    website: {
      visible: false,
      held: true,
      canPublish: role === 'owner',
      version: 'synthetic-workflow-website-v1',
      blockers: []
    },
    publicationWorkflow: {
      state: 'action_required',
      responsibility: 'admin',
      reason: 'commitment_needs_confirmation',
      obligations: []
    }
  };
  const source = {
    id: 'synthetic-workflow-original-agreement',
    version: 1,
    title: 'Synthetic original agreement',
    text: 'Deux publications Facebook sur OpenG7, format texte collectif.',
    fingerprint: 'synthetic-workflow-agreement-v1',
    createdAt: date
  };
  const state: PreparationAssistanceState = {
    contributionId: controllerId,
    reference: 'XBOX-401',
    revision: 'synthetic-workflow-assistance-v1',
    source: options.source === false ? null : source,
    stale: false,
    commitment: {
      version: 1,
      state: 'needs_confirmation',
      amountMinor: 50000,
      currency: 'CAD'
    },
    capabilities: {
      canManageSource: role === 'owner',
      canRun: role === 'owner',
      canReview: role === 'owner',
      canApply: role === 'owner'
    },
    run:
      options.source === false
        ? null
        : {
            id: 'synthetic-workflow-analysis',
            sourceVersion: 1,
            commitmentVersion: 1,
            adapter: 'local_rules_v2',
            state: 'succeeded',
            phase: 'finished',
            errorCode: null,
            createdAt: date,
            finishedAt: date,
            suggestion: extractStructuredPreparationPublications(source),
            review: null,
            application: null
          }
  };
  const summary: PreparationAssistanceSummary = {
    contributionId: controllerId,
    controlCode: 'accepted_offer',
    revision: state.revision,
    sourceVersion: state.source?.version ?? null,
    commitmentVersion: 1,
    stale: false,
    capabilities: state.capabilities,
    run: state.run
      ? {
          id: state.run.id,
          sourceVersion: 1,
          commitmentVersion: 1,
          adapter: state.run.adapter,
          state: 'succeeded',
          phase: 'finished',
          errorCode: null,
          reviewVersion: 0,
          reviewDecision: null,
          clauseCount: 1,
          unsupportedCount: 0,
          unresolvedCount: 1,
          appliedCommitmentVersion: null
        }
      : null
  };
  const receipt: AdminDossierPreparationReceipt = {
    context: 'dossier',
    contributionId: controllerId,
    reference: 'XBOX-401',
    version: 'a'.repeat(64),
    status: 'incomplete',
    payment: {
      amountMinor: 50000,
      currency: 'CAD',
      status: 'paid',
      confirmedAt: date
    },
    acceptedOffer: null,
    balance: null,
    checks: [
      { code: 'dossier_examined', state: 'complete' },
      { code: 'payment_confirmed', state: 'complete' },
      { code: 'accepted_offer', state: 'missing' },
      { code: 'content_prepared', state: 'missing' }
    ],
    authorizations: [
      { code: 'public_consent', state: 'complete' },
      { code: 'sponsor_review', state: 'complete' },
      { code: 'moderation_review', state: 'missing' }
    ],
    drafts: [],
    blockers: [
      {
        code: 'commitment_needs_confirmation',
        adminUrl: controllerPath('publication')
      }
    ],
    canApprove: false,
    approval: null,
    approvalHistory: []
  };
  const f = { base, privateReads: [] as string[], mutations: [] as string[] };
  page.on('request', (request) => {
    if (
      request.method() !== 'GET' &&
      new URL(request.url()).pathname.startsWith('/api/')
    )
      f.mutations.push(
        `${request.method()} ${new URL(request.url()).pathname}`
      );
  });
  await page.route('**/api/admin/preparation-assistance**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    f.privateReads.push(path);
    return route.fulfill({
      status: role === 'owner' ? 200 : 403,
      json:
        role === 'owner' ? (path.endsWith('/summary') ? summary : state) : {}
    });
  });
  await page.route('**/api/admin/sponsorships/preparation?**', async (route) =>
    route.fulfill({ json: receipt })
  );
  return f;
}

async function open(page: Page, path = controllerPath('publication')) {
  await page.goto(path);
  await restoreLegacyGuideMode(page, 'workflows');
  await expect(hook(page, 'workflow-guide')).toBeVisible();
  if (
    !(await journeyPicker(page).evaluate(
      (element) => (element as HTMLDetailsElement).open
    ))
  )
    await journeyPicker(page).locator('summary').click();
}

async function expectAreaOrExplanation(page: Page) {
  await expect
    .poll(async () => {
      const missing = await hook(page, 'workflow-guide-missing').isVisible();
      const count = await page.locator(highlighted).count();
      return missing ? count === 0 : count > 0;
    })
    .toBe(true);
}

for (const locale of ['fr-CA', 'en']) {
  for (const width of [1536, 390]) {
    test(`the ${locale} workflow guide explores all six journeys freely without business actions at ${width}px`, async ({
      page
    }, testInfo) => {
      await page.setViewportSize({ width, height: 864 });
      const f = await fixtures(page, { locale });
      await open(page);
      const guide = hook(page, 'workflow-guide');
      await expect(hook(page, 'workflow-guide-journey')).toHaveCount(6);
      for (const label of locale === 'en'
        ? ['Action to examine', 'Expected outcome', 'Current location']
        : ['Action à examiner', 'Résultat attendu', 'Emplacement actuel'])
        await expect(guide).toContainText(label);
      await expect(guide).toContainText(
        locale === 'en'
          ? 'Exploring these journeys does not prepare, authorize or publish anything.'
          : 'Explorer ces parcours ne prépare, n’autorise et ne publie rien.'
      );
      for (const [id, steps] of Object.entries(journeys)) {
        if (!(await journey(page, id).isVisible()))
          await journeyPicker(page).locator('summary').click();
        await expect(journey(page, id)).toHaveAccessibleName(/\S/);
        await journey(page, id).click();
        await expect(hook(page, 'workflow-guide-step')).toHaveCount(
          steps.length
        );
        if (locale === 'fr-CA' && width === 1536)
          await journeyPicker(page).locator('summary').click();
        for (const stepId of [...steps].reverse()) {
          await step(page, stepId).click();
          await expect(step(page, stepId)).toHaveAttribute(
            'aria-current',
            'step'
          );
          await expectAreaOrExplanation(page);
          await expect(page.locator('dialog[open]')).toHaveCount(0);
          await expect(guide).not.toContainText('admin.workflowGuide.');
          if (locale === 'fr-CA' && width === 1536) {
            await guide
              .getByRole('heading', { level: 3 })
              .scrollIntoViewIfNeeded();
            await page.screenshot({
              path: testInfo.outputPath(`workflow-guide-${id}-${stepId}.png`),
              animations: 'disabled'
            });
          }
        }
        await hook(page, 'workflow-guide-next').click();
        await expect(step(page, steps[1]!)).toHaveAttribute(
          'aria-current',
          'step'
        );
        await hook(page, 'workflow-guide-previous').click();
        await expect(step(page, steps[0]!)).toHaveAttribute(
          'aria-current',
          'step'
        );
        await hook(page, 'workflow-guide-show').click();
        await expectAreaOrExplanation(page);
      }
      await expect(guide).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
      expect(f.mutations).toEqual([]);
      expect(f.base.commands).toEqual([]);
      await expect(page).toHaveURL(controllerPath('publication'));
    });
  }
}

test('source and review URL fragments preserve the publication dossier context for workflow highlighting', async ({
  page
}) => {
  const f = await fixtures(page);
  for (const section of ['source', 'review']) {
    await open(
      page,
      controllerPath('publication') + '#dossier-assistance-' + section
    );
    await journey(page, 'agreement').click();
    await step(page, section === 'source' ? 'source' : 'proposal').click();
    await expect(
      hook(
        page,
        section === 'source'
          ? 'assistance-source-view'
          : 'assistance-suggestion'
      )
    ).toHaveAttribute('data-og7-guidance-highlight', '');
    await expect(hook(page, 'workflow-guide-open-dossier')).toHaveCount(0);
    await expect(hook(page, 'workflow-guide-missing')).toBeHidden();
    await expect(hook(page, 'workflow-guide-show')).toBeEnabled();
    await expect(page).toHaveURL(
      new RegExp('#dossier-assistance-' + section + '$')
    );
  }
  expect(f.mutations).toEqual([]);
  expect(f.base.commands).toEqual([]);
});

test('pausing, closing and normal dossier navigation remove the workflow highlight without trapping navigation or editing', async ({
  page
}) => {
  const f = await fixtures(page);
  await open(page);
  await journey(page, 'agreement').click();
  await step(page, 'qualification').focus();
  await page.keyboard.press('Enter');
  await expect(hook(page, 'commitments-qualification')).toHaveAttribute(
    'data-og7-guidance-highlight',
    ''
  );
  await hook(page, 'commitments-evidence').fill(
    'Synthetic unsaved original agreement reference'
  );
  await expect(hook(page, 'commitments-evidence')).toBeFocused();
  await expect(hook(page, 'workflow-guide')).toBeVisible();
  await expect(page.locator('dialog[open]')).toHaveCount(0);

  await hook(page, 'workflow-guide-pause').focus();
  await page.keyboard.press('Space');
  await expect(page.locator(highlighted)).toHaveCount(0);
  await hook(page, 'workflow-guide-resume').focus();
  await page.keyboard.press('Enter');
  await hook(page, 'workflow-guide-show').click();
  await expect(hook(page, 'commitments-qualification')).toHaveAttribute(
    'data-og7-guidance-highlight',
    ''
  );
  await hook(page, 'admin-guidance-toggle').click();
  await expect(page.locator(highlighted)).toHaveCount(0);
  await hook(page, 'admin-guidance-toggle').click();
  await expect(hook(page, 'workflow-guide')).toBeVisible();
  await expect(step(page, 'qualification')).toHaveAttribute(
    'aria-current',
    'step'
  );
  await hook(page, 'workflow-guide-show').click();
  await expect(page.locator(highlighted)).not.toHaveCount(0);
  await expect(hook(page, 'commitments-evidence')).toHaveValue(
    'Synthetic unsaved original agreement reference'
  );

  await hook(page, 'dossier-tabs').getByRole('button').nth(1).click();
  await expect(page).toHaveURL(controllerPath('identity'));
  await expect(page.locator(highlighted)).toHaveCount(0);
  await expect(hook(page, 'workflow-guide')).toBeVisible();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  expect(f.mutations).toEqual([]);
  expect(f.base.commands).toEqual([]);
});

test('a reader can explore the journeys while private agreement sources remain unavailable and unread', async ({
  page
}) => {
  const f = await fixtures(page, { role: 'reader' });
  await open(page);
  await expect(hook(page, 'workflow-guide-journey')).toHaveCount(6);
  await journey(page, 'agreement').click();
  await step(page, 'source').click();
  await expect(hook(page, 'workflow-guide-missing')).toContainText(
    'This area is not available in the displayed dossier.'
  );
  await expect(page.locator(highlighted)).toHaveCount(0);
  await expect(hook(page, 'assistance-source-view')).toHaveCount(0);
  await expect(hook(page, 'commitments-qualification')).toHaveCount(0);
  expect(f.privateReads).toEqual([]);
  await journey(page, 'website').click();
  await step(page, 'visibility').click();
  await expect(hook(page, 'publication-website')).toHaveAttribute(
    'data-og7-guidance-highlight',
    ''
  );
  await expect(hook(page, 'workflow-guide-missing')).toBeHidden();
  expect(f.mutations).toEqual([]);
  expect(f.base.commands).toEqual([]);
});

test('delivery evidence highlights the scoped Campaigns link and handles its disappearance without mutation', async ({
  page
}) => {
  const f = await fixtures(page);
  await open(page);
  await journey(page, 'delivery').click();
  await step(page, 'responsibility').click();
  await expect(hook(page, 'publication-obligations')).toHaveAttribute(
    'data-og7-guidance-highlight',
    ''
  );
  await step(page, 'evidence').click();
  const campaign = hook(page, 'publication-campaign-benefits');
  await expect(campaign).toHaveAttribute('data-og7-guidance-highlight', '');
  await expect(campaign).toHaveAttribute(
    'href',
    `/admin/fundraiser/campaigns?sponsorshipId=${controllerId}`
  );
  await expect(hook(page, 'workflow-guide-missing')).toBeHidden();
  await expect(page).toHaveURL(/\/admin\/fundraiser\/sponsors\?/);
  await campaign.evaluate((element) => element.remove());
  await expect(hook(page, 'workflow-guide-missing')).toBeVisible();
  await expect(page.locator(highlighted)).toHaveCount(0);
  await step(page, 'responsibility').click();
  await expect(hook(page, 'workflow-guide-missing')).toBeHidden();
  await expect(hook(page, 'publication-obligations')).toHaveAttribute(
    'data-og7-guidance-highlight',
    ''
  );
  expect(f.mutations).toEqual([]);
  expect(f.base.commands).toEqual([]);
});

test('website and manual-history steps expose only their existing details and never save or publish a form', async ({
  page
}) => {
  const f = await fixtures(page);
  await open(page);
  const advanced = hook(page, 'publication-advanced');
  const tracking = hook(page, 'publication-declared-tracking');
  await expect(advanced).toHaveJSProperty('open', false);
  await expect(tracking).toHaveJSProperty('open', false);
  const save = hook(page, 'publication-tracking-save');
  const disabledBefore = await save.isDisabled();
  const draftValues = () =>
    advanced.locator('input, select, textarea').evaluateAll((fields) =>
      fields.map((field) => ({
        value: (field as HTMLInputElement).value,
        checked:
          field instanceof HTMLInputElement && field.type === 'checkbox'
            ? field.checked
            : null
      }))
    );
  const draftBefore = await draftValues();
  await journey(page, 'website').click();
  await step(page, 'presentation').click();
  await expect(advanced).toHaveJSProperty('open', true);
  await expect(tracking).toHaveJSProperty('open', false);
  for (const target of [
    'publication-public-address',
    'publication-public-summary'
  ])
    await expect(hook(page, target)).toHaveAttribute(
      'data-og7-guidance-highlight',
      ''
    );
  await advanced.locator(':scope > summary').click();
  await expect(advanced).toHaveJSProperty('open', false);
  await journey(page, 'history').click();
  await step(page, 'declare').click();
  await expect(advanced).toHaveJSProperty('open', true);
  await expect(tracking).toHaveJSProperty('open', true);
  for (const target of [
    'publication-manual-status',
    'publication-manual-link',
    'publication-manual-notes'
  ]) {
    await expect(hook(page, target)).toHaveAttribute(
      'data-og7-guidance-highlight',
      ''
    );
    await expect(hook(page, target)).toBeVisible();
  }
  await step(page, 'save').focus();
  await page.keyboard.press('Enter');
  await expect(save).toHaveAttribute('data-og7-guidance-highlight', '');
  expect(await save.isDisabled()).toBe(disabledBefore);
  expect(await draftValues()).toEqual(draftBefore);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  expect(f.mutations).toEqual([]);
  expect(f.base.commands).toEqual([]);
});

for (const validContext of [true, false]) {
  test(`the workflow guide explains missing dossier context and builds a safe ${validContext ? 'selected' : 'unselected'} publication link`, async ({
    page
  }) => {
    const f = await fixtures(page);
    const path = validContext
      ? controllerPath('identity') + '&search=synthetic-private-filter'
      : '/admin/fundraiser/attention?sponsorshipId=invalid-dossier&search=synthetic-private-filter';
    await open(page, path);
    await expect(hook(page, 'workflow-guide')).toContainText(
      'Choose a sponsorship dossier to show the journey’s areas.'
    );
    await expect(hook(page, 'workflow-guide-show')).toBeDisabled();
    await expect(hook(page, 'workflow-guide-missing')).toHaveCount(0);
    await expect(page.locator(highlighted)).toHaveCount(0);
    const link = hook(page, 'workflow-guide-open-dossier');
    await expect(link).toBeVisible();
    const destination = new URL((await link.getAttribute('href'))!, page.url());
    expect(destination.pathname).toBe('/admin/fundraiser/sponsors');
    expect(destination.hash).toBe('');
    expect([...destination.searchParams.keys()].sort()).toEqual(
      validContext ? ['sponsorshipId', 'tab'] : ['tab']
    );
    expect(destination.searchParams.get('tab')).toBe('publication');
    expect(destination.searchParams.get('sponsorshipId')).toBe(
      validContext ? controllerId : null
    );
    if (validContext) {
      await link.click();
      await expect(page).toHaveURL(destination.toString());
      await expect(hook(page, 'preparation-pilot')).toHaveAttribute(
        'data-og7-guidance-highlight',
        ''
      );
    }
    expect(f.mutations).toEqual([]);
    expect(f.base.commands).toEqual([]);
  });
}

test('a failed lazy workflow chunk can retry locally and discovery remains usable without a business action', async ({
  page
}) => {
  const f = await fixtures(page);
  const blocked: string[] = [];
  let failImport = true;
  await page.route('**/*.js', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith('/api/')) return route.fallback();
    const response = await route.fetch();
    if (
      failImport &&
      (await response.text()).includes('admin.workflowGuide.')
    ) {
      blocked.push(path);
      return route.abort();
    }
    return route.fulfill({ response });
  });
  await page.goto(controllerPath('publication'));
  await restoreLegacyGuideMode(page, 'workflows');
  const panel = hook(page, 'admin-guidance-panel');
  await expect(panel.getByRole('alert')).toHaveText(
    'The journeys could not be loaded. Retry while keeping your place.'
  );
  await expect(hook(page, 'workflow-guide')).toHaveCount(0);
  expect([...new Set(blocked)]).toHaveLength(1);
  const currentUrl = page.url();
  failImport = false;
  await hook(page, 'admin-guidance-workflows-retry').click();
  await expect(hook(page, 'workflow-guide')).toBeVisible();
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await expect(hook(page, 'admin-guidance-workflows-mode')).toHaveCount(0);
  expect(page.url()).toBe(currentUrl);
  await hook(page, 'admin-guidance-discovery-mode').click();
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await expect(hook(page, 'admin-guidance-step')).toHaveAttribute(
    'data-og7-id',
    'read'
  );
  await hook(page, 'admin-guidance-next').click();
  await expect(hook(page, 'admin-guidance-step')).toHaveAttribute(
    'data-og7-id',
    'choose'
  );
  await hook(page, 'admin-guidance-show').click();
  await expect(hook(page, 'sponsorship-dossier')).toHaveAttribute(
    'data-og7-guidance-highlight',
    ''
  );
  expect(f.mutations).toEqual([]);
  expect(f.base.commands).toEqual([]);
});
