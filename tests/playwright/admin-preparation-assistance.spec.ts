import type { Page } from '@playwright/test';
import type {
  AdminDossierPreparationReceipt,
  PreparationAssistanceApplyRequest,
  PreparationAssistanceReviewRequest,
  PreparationAssistanceSourceRequest,
  PreparationAssistanceState,
  PreparationAssistanceSummary,
  PreparationAssistanceSuggestion,
  SponsorshipCommitmentRecord
} from '@openg7/funding-core';

import { expect, sampledFrames, test } from './support/test.js';
import {
  adminController,
  installAdminController
} from './support/admin-controller.js';
import {
  controllerId,
  controllerJourneysFixtures,
  controllerPath
} from './support/controller-journeys.fixtures.js';

const endpoint = '/api/admin/preparation-assistance';
const date = '2026-10-17T12:00:00Z';
const text =
  'Deux publications Facebook collectives sur OpenG7.\nUne exclusivité sectorielle est promise.';
const hook = (page: Page, name: string) => page.locator(`[data-og7="${name}"]`);
const source = () => ({
  id: 'synthetic-agreement-source',
  version: 1,
  title: 'Synthetic original agreement',
  text,
  fingerprint: 'synthetic-fingerprint-v1',
  createdAt: date
});
const originalCommitment = (): SponsorshipCommitmentRecord => ({
  id: 'synthetic-historical-commitment',
  contributionId: controllerId,
  offerId: null,
  provenance: 'historical_unverified',
  state: 'needs_confirmation',
  qualificationReason: null,
  version: 1,
  offer: null,
  obligations: []
});
const suggestion = (): PreparationAssistanceSuggestion => {
  let offset = 0;
  return {
    adapter: 'local_rules_v1',
    proposedOffer: null,
    limitations: ['local_rules_no_contractual_inference'],
    items: text.split('\n').map((excerpt, index) => {
      const start = offset;
      offset += excerpt.length + 1;
      return {
        id: `clause-${index + 1}`,
        citation: {
          sourceId: source().id,
          sourceVersion: 1,
          start,
          end: start + excerpt.length,
          excerpt
        },
        channels: index === 0 ? ['facebook'] : [],
        attention: index === 0 ? 'human_mapping_required' : 'unsupported_terms'
      };
    })
  };
};
const initial = (ready = true): PreparationAssistanceState => ({
  contributionId: controllerId,
  reference: 'XBOX-401',
  revision: 'synthetic-assistance-1',
  source: source(),
  stale: false,
  commitment: {
    version: 1,
    state: 'needs_confirmation',
    amountMinor: 50000,
    currency: 'CAD'
  },
  capabilities: {
    canManageSource: true,
    canRun: true,
    canReview: true,
    canApply: true
  },
  run: ready
    ? {
        id: 'synthetic-local-run-1',
        sourceVersion: 1,
        commitmentVersion: 1,
        adapter: 'local_rules_v1',
        state: 'succeeded',
        phase: 'finished',
        errorCode: null,
        createdAt: date,
        finishedAt: date,
        suggestion: suggestion(),
        review: null,
        application: null
      }
    : null
});

function compact(
  state: PreparationAssistanceState
): PreparationAssistanceSummary {
  const run = state.run;
  return {
    contributionId: state.contributionId,
    controlCode: 'accepted_offer',
    revision: `${state.revision}:${state.source?.version ?? 0}:${run?.id ?? ''}:${run?.state ?? ''}:${run?.phase ?? ''}:${run?.review?.version ?? 0}`,
    sourceVersion: state.source?.version ?? null,
    commitmentVersion: state.commitment.version,
    run: run
      ? {
          id: run.id,
          sourceVersion: run.sourceVersion,
          commitmentVersion: run.commitmentVersion,
          adapter: run.adapter,
          state: run.state,
          phase: run.phase,
          errorCode: run.errorCode,
          reviewVersion: run.review?.version ?? 0,
          reviewDecision: run.review?.decision ?? null,
          clauseCount: run.suggestion?.items.length ?? 0,
          unsupportedCount:
            run.suggestion?.items.filter(
              (item) => item.attention === 'unsupported_terms'
            ).length ?? 0,
          unresolvedCount: run.review
            ? run.review.items.filter(
                (item) =>
                  item.disposition === 'unresolved' ||
                  item.disposition === 'unsupported'
              ).length
            : (run.suggestion?.items.length ?? 0),
          appliedCommitmentVersion: run.application?.commitmentVersion ?? null
        }
      : null,
    stale: state.stale,
    capabilities: state.capabilities
  };
}

async function fixtures(
  page: Page,
  options: { locale?: string; role?: string; empty?: boolean } = {}
) {
  const base = await controllerJourneysFixtures(
    page,
    options.role ?? 'owner',
    options.locale ?? 'en',
    { hardware: 'native' }
  );
  base.commitment = originalCommitment();
  let runSequence = options.empty ? 0 : 1;
  const fixture = {
    state: initial(!options.empty),
    reads: 0,
    summaryReads: 0,
    compactRuns: 0,
    personal: false,
    error: 0,
    commands: [] as { path: string; body: Record<string, unknown> }[]
  };
  if (options.empty) fixture.state = { ...fixture.state, source: null };
  const receipt = (): AdminDossierPreparationReceipt => ({
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
      { code: 'payment_confirmed', state: 'complete' },
      {
        code: 'accepted_offer',
        state: fixture.personal ? 'not_required' : 'missing'
      },
      { code: 'content_prepared', state: 'missing' }
    ],
    authorizations: [],
    drafts: [],
    blockers: fixture.personal
      ? []
      : [
          {
            code: 'commitment_needs_confirmation',
            adminUrl: controllerPath('publication')
          }
        ],
    canApprove: false,
    approval: null,
    approvalHistory: []
  });
  await page.route('**/api/admin/sponsorships/preparation?**', async (route) =>
    route.fulfill({ json: receipt() })
  );
  await page.route(`**${endpoint}**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url()),
      path = url.pathname;
    if (request.method() === 'GET') {
      if (path.endsWith('/summary')) {
        fixture.summaryReads++;
        if (fixture.error)
          return route.fulfill({
            status: fixture.error,
            json: { error: 'Synthetic assistance unavailable' }
          });
        return route.fulfill({ json: compact(fixture.state) });
      }
      fixture.reads++;
      if (fixture.error)
        return route.fulfill({
          status: fixture.error,
          json: { error: 'Synthetic assistance unavailable' }
        });
      return route.fulfill({ json: fixture.state });
    }
    const body = request.postDataJSON() as Record<string, unknown>;
    fixture.commands.push({ path, body });
    if (path === `${endpoint}/source`) {
      const command = body as unknown as PreparationAssistanceSourceRequest;
      fixture.state = {
        ...fixture.state,
        revision: `synthetic-source-${fixture.commands.length}`,
        source: {
          ...source(),
          version: (command.expectedSourceVersion ?? 0) + 1,
          title: command.title,
          text: command.text
        },
        stale: !!fixture.state.run
      };
      fixture.state = {
        ...fixture.state,
        stale: false,
        capabilities: { ...fixture.state.capabilities, canRun: false },
        run: {
          ...initial().run!,
          id: `synthetic-local-run-${++runSequence}`,
          sourceVersion: fixture.state.source!.version,
          state: 'queued',
          phase: 'queued',
          suggestion: null,
          finishedAt: null
        }
      };
    } else if (path === `${endpoint}/runs`) {
      if (url.searchParams.get('view') === 'summary') fixture.compactRuns++;
      const current = initial().run!;
      fixture.state = {
        ...fixture.state,
        stale: false,
        capabilities: { ...fixture.state.capabilities, canRun: false },
        run: {
          ...current,
          id: `synthetic-local-run-${++runSequence}`,
          state: 'queued',
          phase: 'queued',
          suggestion: null,
          finishedAt: null
        }
      };
    } else if (path === `${endpoint}/review`) {
      const command = body as unknown as PreparationAssistanceReviewRequest;
      fixture.state = {
        ...fixture.state,
        revision: `synthetic-review-${fixture.commands.length}`,
        run: {
          ...fixture.state.run!,
          review: {
            ...command.draft,
            version: command.expectedReviewVersion + 1,
            decision: command.decision === 'save' ? 'saved' : 'rejected',
            actor: 'synthetic-owner',
            createdAt: date
          }
        }
      };
    } else if (path === `${endpoint}/apply`) {
      const command = body as unknown as PreparationAssistanceApplyRequest;
      base.commitment = {
        ...originalCommitment(),
        state: 'active',
        provenance: 'qualified_historical',
        version: 2,
        offer: command.draft.offer,
        qualificationReason: command.draft.reason
      };
      fixture.state = {
        ...fixture.state,
        commitment: {
          ...fixture.state.commitment,
          version: 2,
          state: 'active'
        },
        capabilities: { ...fixture.state.capabilities, canApply: false },
        run: {
          ...fixture.state.run!,
          review: {
            ...command.draft,
            version: command.expectedReviewVersion + 1,
            decision: 'accepted',
            actor: 'synthetic-owner',
            createdAt: date
          },
          application: {
            requestId: command.requestId,
            appliedAt: date,
            commitmentVersion: 2
          }
        }
      };
    } else
      return route.fulfill({
        status: 404,
        json: { error: 'Unexpected assistance command' }
      });
    return route.fulfill({
      json:
        url.searchParams.get('view') === 'summary'
          ? compact(fixture.state)
          : fixture.state
    });
  });
  return { base, fixture, receipt };
}

async function open(page: Page) {
  await page.goto(controllerPath('publication'));
  await expect(hook(page, 'admin-commitments')).toBeVisible();
}

async function documentBenefit(page: Page) {
  await hook(page, 'commitments-add-benefit').click();
  await hook(page, 'commitments-benefit-channel').selectOption('facebook');
  await hook(page, 'commitments-benefit-target').selectOption('openg7');
  await hook(page, 'commitments-benefit-quantity').fill('2');
  await hook(page, 'commitments-benefit-format').selectOption(
    'collective_text'
  );
  await hook(page, 'commitments-company-required').check();
}

for (const locale of ['en', 'fr-CA']) {
  test(`a ${locale} source and durable local job survive reload without an automatic command or business completion`, async ({
    page
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setViewportSize({
      width: locale === 'en' ? 390 : 1280,
      height: 900
    });
    const { fixture, base } = await fixtures(page, { locale, empty: true });
    await open(page);
    const panel = hook(page, 'preparation-assistance');
    await expect(panel).toContainText(
      locale === 'en'
        ? 'Deterministic local indexing'
        : 'Indexation locale déterministe'
    );
    expect(fixture.commands).toEqual([]);
    await hook(page, 'assistance-source-title').fill(
      'Synthetic original agreement'
    );
    await hook(page, 'assistance-source-text').fill(text);
    await hook(page, 'assistance-source-save').click();
    await expect(hook(page, 'assistance-source-version')).toContainText('1');
    expect(fixture.commands[0]!.body.expectedSourceVersion).toBeNull();
    await expect(hook(page, 'assistance-run')).toBeDisabled();
    await expect(hook(page, 'assistance-run-state')).toHaveAttribute(
      'data-og7-state',
      'queued'
    );
    const gear = hook(page, 'assistance-run-state').locator(
      'openg7-admin-icon'
    );
    await expect(gear).toHaveCSS('animation-name', 'none');
    await page.reload();
    await expect(hook(page, 'assistance-run-state')).toHaveAttribute(
      'data-og7-state',
      'queued'
    );
    await expect(gear).toHaveCSS('animation-name', 'none');
    expect(fixture.commands.map((command) => command.path)).toEqual([
      `${endpoint}/source`
    ]);
    fixture.state = {
      ...fixture.state,
      run: { ...fixture.state.run!, state: 'processing', phase: 'extracting' }
    };
    await expect(hook(page, 'assistance-run-state')).toHaveAttribute(
      'data-og7-state',
      'processing',
      { timeout: 10000 }
    );
    await expect(gear).toHaveClass(/processing/);
    await expect(gear).not.toHaveCSS('animation-name', 'none');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(gear).toHaveCSS('animation-name', 'none');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(gear).not.toHaveCSS('animation-name', 'none');
    fixture.state = {
      ...fixture.state,
      run: {
        ...fixture.state.run!,
        state: 'succeeded',
        phase: 'finished',
        finishedAt: date,
        suggestion: suggestion()
      }
    };
    // Polling reads the durable job; it never starts another one.
    await expect(hook(page, 'assistance-suggestion')).toBeVisible({
      timeout: 10000
    });
    await expect(gear).not.toHaveClass(/processing/);
    await expect(gear).toHaveCSS('animation-name', 'none');
    await expect(
      hook(page, 'assistance-clause').locator('blockquote')
    ).toHaveText(text.split('\n'));
    expect(fixture.commands).toHaveLength(1);
    expect(base.commitment?.state).toBe('needs_confirmation');
    await expect(hook(page, 'commitments-qualification')).toBeVisible();
    await expect(hook(page, 'commitments-benefit-channel')).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true);
  });
}

test('a human edits and saves the existing offer form, then applies once with exact versions and dossier confirmation', async ({
  page
}) => {
  const { fixture, base } = await fixtures(page);
  // A single representable clause allows an end-to-end application without discarding a contractual term.
  fixture.state = {
    ...fixture.state,
    source: { ...source(), text: text.split('\n')[0]! },
    run: {
      ...fixture.state.run!,
      suggestion: { ...suggestion(), items: suggestion().items.slice(0, 1) }
    }
  };
  await open(page);
  await hook(page, 'assistance-use-form').click();
  await expect(hook(page, 'commitments-add-benefit')).toBeFocused();
  await documentBenefit(page);
  await hook(page, 'assistance-clause-disposition').selectOption('included');
  await hook(page, 'assistance-clause-benefit').selectOption('facebook_batch');
  await hook(page, 'assistance-review-reason').fill(
    'Verified against the synthetic original agreement'
  );
  await hook(page, 'assistance-review-save').click();
  await expect(hook(page, 'assistance-review-state')).toContainText(
    'Review draft saved'
  );
  expect(fixture.commands).toHaveLength(1);
  const saved = fixture.commands[0]!
    .body as unknown as PreparationAssistanceReviewRequest;
  expect(saved.expectedReviewVersion).toBe(0);
  expect(saved.draft.offer?.benefits[0]?.quantity).toBe(2);
  expect(saved.draft.items[0]?.benefitId).toBe('facebook_batch');
  await hook(page, 'commitments-confirmation').fill('wrong-dossier');
  await hook(page, 'commitments-qualify').click();
  await expect(hook(page, 'commitments-error')).toBeVisible();
  expect(fixture.commands).toHaveLength(1);
  await hook(page, 'commitments-confirmation').fill(controllerId);
  await hook(page, 'commitments-qualify').click();
  await expect(hook(page, 'commitments-accepted-offer')).toContainText(
    'Facebook'
  );
  const applied = fixture.commands.filter((command) =>
    command.path.endsWith('/apply')
  );
  expect(applied).toHaveLength(1);
  expect(applied[0]!.body).toMatchObject({
    confirmation: controllerId,
    sourceVersion: 1,
    expectedCommitmentVersion: 1,
    expectedReviewVersion: 1
  });
  expect(applied[0]!.body.requestId).toMatch(/^[\da-f-]{36}$/);
  expect(
    base.commands.filter((command) => command.path.endsWith('/qualify'))
  ).toEqual([]);
  expect(base.commitment?.version).toBe(2);
});

test('unrepresentable clauses stay explicit, block assisted application and can be rejected before an explicit rerun', async ({
  page
}) => {
  const { fixture } = await fixtures(page);
  await open(page);
  const unsupported = hook(page, 'assistance-clause').nth(1);
  // Playwright retargets option enabled-state checks to the containing select.
  await expect(
    unsupported.locator('option[value="included"]')
  ).toHaveJSProperty('disabled', true);
  await hook(page, 'assistance-use-form').click();
  await documentBenefit(page);
  await hook(page, 'assistance-clause-disposition')
    .first()
    .selectOption('included');
  await hook(page, 'assistance-clause-benefit').selectOption('facebook_batch');
  await unsupported.locator('select').selectOption('unsupported');
  await unsupported
    .locator('textarea')
    .fill('The exclusivity promise needs manual contractual handling');
  await hook(page, 'assistance-review-reason').fill(
    'Real unsupported contractual term requires manual handling'
  );
  await expect(hook(page, 'commitments-qualify')).toBeDisabled();
  await hook(page, 'assistance-review-reject').click();
  await expect(hook(page, 'assistance-review-state')).toContainText(
    'Proposal rejected'
  );
  expect(fixture.commands.map((command) => command.path)).toEqual([
    `${endpoint}/review`
  ]);
  await hook(page, 'assistance-run').click();
  await expect(hook(page, 'assistance-run-state')).toHaveAttribute(
    'data-og7-state',
    'queued'
  );
  expect(fixture.commands[1]!.body.rerun).toBe(true);
  expect(
    fixture.commands.some((command) => command.path.endsWith('/apply'))
  ).toBe(false);
});

test('a concurrent source or human review preserves unsaved text and resolutions until explicit reset', async ({
  page
}) => {
  const { fixture } = await fixtures(page);
  await open(page);
  await hook(page, 'assistance-source-text').fill('My unsaved agreement text');
  fixture.state = {
    ...fixture.state,
    source: { ...source(), version: 2, text: 'A colleague saved this version' }
  };
  await hook(page, 'assistance-refresh').click();
  await expect(hook(page, 'assistance-source-conflict')).toBeVisible();
  await expect(hook(page, 'assistance-source-text')).toHaveValue(
    'My unsaved agreement text'
  );
  await expect(hook(page, 'assistance-source-save')).toBeDisabled();
  await hook(page, 'assistance-source-reset').click();
  await expect(hook(page, 'assistance-source-text')).toHaveValue(
    'A colleague saved this version'
  );
  await hook(page, 'assistance-clause-note')
    .first()
    .fill('My unsaved clause explanation');
  fixture.state = {
    ...fixture.state,
    run: {
      ...fixture.state.run!,
      review: {
        version: 1,
        decision: 'saved',
        offer: null,
        reason: 'Colleague review reason',
        actor: 'synthetic-other-owner',
        createdAt: date,
        items: suggestion().items.map((item) => ({
          itemId: item.id,
          disposition: 'unresolved',
          benefitId: null,
          note: 'Saved colleague note'
        }))
      }
    }
  };
  await hook(page, 'assistance-refresh').click();
  await expect(hook(page, 'assistance-review-conflict')).toBeVisible();
  await expect(hook(page, 'assistance-clause-note').first()).toHaveValue(
    'My unsaved clause explanation'
  );
  await expect(hook(page, 'assistance-review-save')).toBeDisabled();
  await hook(page, 'assistance-review-reset').click();
  await expect(hook(page, 'assistance-clause-note').first()).toHaveValue(
    'Saved colleague note'
  );
  expect(fixture.commands).toEqual([]);
});

test('a forbidden reread clears the selected parent context and private form evidence without a command', async ({
  page
}) => {
  const { fixture } = await fixtures(page);
  await open(page);
  await hook(page, 'assistance-use-form').click();
  await expect(hook(page, 'assistance-form-scope')).toBeVisible();
  await expect(hook(page, 'commitments-evidence')).toHaveValue(
    /Synthetic original agreement/
  );
  fixture.error = 403;
  await hook(page, 'assistance-refresh').click();
  await expect(hook(page, 'assistance-source-text')).toHaveCount(0);
  await expect(hook(page, 'assistance-form-scope')).toHaveCount(0);
  await expect(hook(page, 'commitments-evidence')).toHaveValue('');
  await expect(hook(page, 'commitments-confirmation')).toHaveValue('');
  expect(fixture.commands).toEqual([]);
});

test('a stale proposal cannot be selected or applied, and a failed run needs an explicit rerun', async ({
  page
}) => {
  const { fixture } = await fixtures(page);
  fixture.state = { ...fixture.state, stale: true };
  await open(page);
  await expect(hook(page, 'assistance-stale')).toBeVisible();
  await expect(hook(page, 'assistance-use-form')).toBeDisabled();
  await expect(hook(page, 'assistance-review-save')).toBeDisabled();
  expect(fixture.commands).toEqual([]);
  fixture.state = {
    ...fixture.state,
    stale: false,
    run: {
      ...fixture.state.run!,
      state: 'failed',
      errorCode: 'SYNTHETIC_LOCAL_FAILURE',
      suggestion: null
    }
  };
  await hook(page, 'assistance-refresh').click();
  await expect(hook(page, 'assistance-run-state')).toHaveAttribute(
    'data-og7-state',
    'failed'
  );
  await expect(hook(page, 'assistance-manual')).toBeEnabled();
  expect(fixture.commands).toEqual([]);
  await hook(page, 'assistance-run').click();
  await expect(hook(page, 'assistance-run-state')).toHaveAttribute(
    'data-og7-state',
    'queued'
  );
  expect(fixture.commands.map((command) => command.path)).toEqual([
    `${endpoint}/runs`
  ]);
});

test('an unavailable assistant preserves the manual qualification route', async ({
  page
}) => {
  const { fixture, base } = await fixtures(page);
  fixture.error = 503;
  await open(page);
  await expect(hook(page, 'assistance-error')).toContainText('unavailable');
  await documentBenefit(page);
  await hook(page, 'commitments-evidence').fill(
    'Synthetic manually reviewed original agreement'
  );
  await hook(page, 'commitments-reason').fill(
    'Manual qualification after reviewing actual contractual terms'
  );
  await expect(hook(page, 'commitments-qualify')).toBeEnabled();
  expect(fixture.commands).toEqual([]);
  expect(base.commands).toEqual([]);
});

for (const role of ['reader', 'operator']) {
  test(`a ${role} never requests the owner's private assistance`, async ({
    page
  }) => {
    const { fixture } = await fixtures(page, { role });
    await open(page);
    await expect(hook(page, 'preparation-assistance')).toHaveCount(0);
    await expect(hook(page, 'commitments-qualification')).toHaveCount(0);
    expect(fixture.reads).toBe(0);
    expect(fixture.summaryReads).toBe(0);
    expect(fixture.commands).toEqual([]);
  });
}

const inlineAction = (page: Page, id: string) =>
  page.locator(
    `[data-og7="preparation-assistance-action"][data-og7-id="inline-preparation-assistance-${id}"]`
  );

async function openPilotActions(
  page: Page,
  pad: ReturnType<typeof adminController>,
  checkCode = 'accepted_offer'
) {
  const issue = page.locator(
    `[data-og7="preparation-issue"][data-og7-id="check:${checkCode}"]`
  );
  await pad.reach(issue);
  // Reaching Actions with bumpers crosses other controls and changes the selection.
  // Use the same A gesture as the user: select this control, then open its actions.
  if ((await issue.getAttribute('aria-pressed')) !== 'true')
    await pad.press('A');
  await expect(issue).toHaveAttribute('aria-pressed', 'true');
  await pad.press('A');
  await expect(hook(page, 'preparation-pilot')).toHaveAttribute(
    'data-og7-mode',
    'open'
  );
}

test('the dossier shows compact assistance on the agreement only and native buttons share controller metadata and read destinations', async ({
  page
}) => {
  const { fixture } = await fixtures(page);
  await open(page);
  await expect(
    hook(page, 'preparation-assistance-summary-state')
  ).toHaveAttribute('data-og7-state', 'succeeded');
  await expect(
    hook(page, 'preparation-issue-assistance-state')
  ).toHaveAttribute('data-og7-state', 'ready');
  const pilot = hook(page, 'preparation-pilot');
  await expect(pilot).not.toContainText(source().text);
  await expect(pilot).not.toContainText(source().title);
  await expect(hook(page, 'preparation-pilot-progress')).toHaveAttribute(
    'data-og7-completed',
    '1'
  );
  await expect(hook(page, 'preparation-pilot-progress')).toHaveAttribute(
    'data-og7-total',
    '3'
  );
  await hook(page, 'preparation-pilot-actions').click();
  const radial = pilot.locator(
    '[data-og7="preparation-pilot-action"][data-og7-id^="preparation-assistance-"]'
  );
  const native = hook(page, 'preparation-assistance-action');
  const describe = (elements: Element[]) =>
    elements.map((element) => ({
      id: element.getAttribute('data-og7-id')!.replace(/^inline-/, ''),
      label: element.getAttribute('aria-label'),
      disabled: (element as HTMLButtonElement).disabled
    }));
  expect(await native.evaluateAll(describe)).toEqual(
    await radial.evaluateAll(describe)
  );
  await page.keyboard.press('Escape');
  await inlineAction(page, 'source').focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#dossier-assistance-source$/);
  await expect(hook(page, 'assistance-source-view')).toHaveJSProperty(
    'open',
    true
  );
  expect(
    await hook(page, 'assistance-source-view').evaluate((element) =>
      element.contains(document.activeElement)
    )
  ).toBe(true);
  await inlineAction(page, 'review').focus();
  await page.keyboard.press('Space');
  await expect(page).toHaveURL(/#dossier-assistance-review$/);
  await expect(hook(page, 'assistance-suggestion')).toBeFocused();
  expect(fixture.commands).toEqual([]);
  const payment = pilot.locator(
    '[data-og7="preparation-issue"][data-og7-id="check:payment_confirmed"]'
  );
  await payment.click();
  await expect(hook(page, 'preparation-assistance-summary')).toHaveCount(0);
  await expect(
    hook(page, 'preparation-issue-assistance-state')
  ).toHaveAttribute('data-og7-state', 'ready');
});

test('an indexing revision closes held controller input and a new Xbox Y intent alone reruns the compact command once', async ({
  page
}) => {
  await installAdminController(page);
  const { fixture } = await fixtures(page);
  fixture.state = {
    ...fixture.state,
    capabilities: { ...fixture.state.capabilities, canRun: false },
    run: {
      ...fixture.state.run!,
      state: 'queued',
      phase: 'queued',
      suggestion: null,
      finishedAt: null
    }
  };
  await open(page);
  const pad = adminController(page);
  await pad.ready();
  await expect(
    hook(page, 'preparation-assistance-summary-state')
  ).toHaveAttribute('data-og7-state', 'queued');
  await openPilotActions(page, pad, 'payment_confirmed');
  fixture.state = {
    ...fixture.state,
    run: { ...fixture.state.run!, state: 'processing', phase: 'extracting' }
  };
  await expect(
    hook(page, 'preparation-issue-assistance-state')
  ).toHaveAttribute('data-og7-state', 'processing', { timeout: 10000 });
  await expect(hook(page, 'preparation-pilot')).toHaveAttribute(
    'data-og7-mode',
    'open'
  );
  await expect(hook(page, 'preparation-assistance-summary')).toHaveCount(0);
  await pad.press('B');
  await openPilotActions(page, pad);
  await expect(hook(page, 'preparation-pilot')).toHaveAttribute(
    'data-og7-mode',
    'open'
  );
  await pad.hold('Y');
  fixture.state = initial();
  await expect(
    hook(page, 'preparation-assistance-summary-state')
  ).toHaveAttribute('data-og7-state', 'succeeded', { timeout: 10000 });
  await expect(hook(page, 'assistance-run-state')).toHaveAttribute(
    'data-og7-state',
    'succeeded'
  );
  await expect(hook(page, 'preparation-pilot')).toHaveAttribute(
    'data-og7-mode',
    'peek'
  );
  await expect(hook(page, 'preparation-pilot-actions')).toBeFocused();
  await sampledFrames(page, 8);
  expect(fixture.commands).toEqual([]);
  await pad.release();
  await openPilotActions(page, pad);
  await pad.press('Y');
  await expect(
    hook(page, 'preparation-assistance-summary-state')
  ).toHaveAttribute('data-og7-state', 'queued');
  expect(fixture.compactRuns).toBe(1);
  expect(fixture.commands).toHaveLength(1);
  expect(fixture.state.run?.id).toBe('synthetic-local-run-2');
  await expect(hook(page, 'assistance-run-state')).toHaveAttribute(
    'data-og7-state',
    'queued'
  );
  expect(fixture.commands[0]!.body).toMatchObject({
    contributionId: controllerId,
    sourceVersion: 1,
    expectedCommitmentVersion: 1,
    rerun: true
  });
  await expect(hook(page, 'preparation-pilot-progress')).toHaveAttribute(
    'data-og7-completed',
    '1'
  );
});

test('Xbox X opens the stored source and A examines the same result without a write', async ({
  page
}) => {
  await installAdminController(page);
  const { fixture } = await fixtures(page);
  await open(page);
  const pad = adminController(page);
  await pad.ready();
  await expect(inlineAction(page, 'review')).toBeEnabled();
  await openPilotActions(page, pad);
  await pad.press('X');
  await expect(page).toHaveURL(/#dossier-assistance-source$/);
  await expect(hook(page, 'assistance-source-view')).toHaveJSProperty(
    'open',
    true
  );
  await openPilotActions(page, pad);
  await pad.press('A');
  await expect(page).toHaveURL(/#dossier-assistance-review$/);
  await expect(hook(page, 'assistance-suggestion')).toBeFocused();
  expect(fixture.commands).toEqual([]);
});

test('an unavailable compact reread clears previous actions and an explicit receipt refresh recovers without a job', async ({
  page
}) => {
  const { fixture } = await fixtures(page);
  await open(page);
  await expect(inlineAction(page, 'rerun')).toBeEnabled();
  fixture.error = 503;
  await hook(page, 'preparation-receipt-refresh').click();
  await expect(hook(page, 'preparation-assistance-summary')).toContainText(
    'Assistance is unavailable'
  );
  await expect(hook(page, 'preparation-assistance-action')).toHaveCount(0);
  fixture.error = 0;
  await hook(page, 'preparation-assistance-summary-refresh').click();
  await expect(inlineAction(page, 'rerun')).toBeEnabled();
  expect(fixture.commands).toEqual([]);
});

test('a non-required agreement control makes no compact assistance request', async ({
  page
}) => {
  const { fixture } = await fixtures(page);
  fixture.personal = true;
  await open(page);
  await expect(
    page.locator(
      '[data-og7="preparation-issue"][data-og7-id="check:accepted_offer"]'
    )
  ).toHaveCount(0);
  await expect(hook(page, 'preparation-assistance-summary')).toHaveCount(0);
  expect(fixture.summaryReads).toBe(0);
});

test('the guide reads and reruns compact facts without loading the private source or completing its business control', async ({
  page
}) => {
  const { fixture, receipt } = await fixtures(page);
  const runId = '10000000-0000-4000-8000-000000009901';
  await page.route('**/api/admin/automatic-runs**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/preparation'))
      return route.fulfill({
        json: {
          ...receipt(),
          context: undefined,
          runId,
          position: 1,
          totalCount: 1,
          processedCount: 0
        }
      });
    if (path.endsWith('/report'))
      return route.fulfill({ json: { entries: [], nextCursor: null } });
    return route.fulfill({
      json: {
        run: {
          id: runId,
          version: 1,
          status: 'paused',
          startedAt: date,
          updatedAt: date,
          observedAt: date,
          pass: 1,
          cursor: 1,
          dossierCount: 1,
          processedCount: 0,
          balancedCount: 0,
          outstandingCount: 1,
          unknownCount: 0,
          uncoveredCount: 1,
          newPaymentCount: 0,
          currencyTotals: [{ currency: 'CAD', amountMinor: 50000 }],
          latestEntry: null,
          nextContributionId: controllerId,
          globalBalanced: false
        },
        balance: null
      }
    });
  });
  await page.goto('/admin/fundraiser/attention');
  const toggle = hook(page, 'admin-guidance-toggle');
  await expect(toggle).toBeVisible();
  if (!(await hook(page, 'admin-guidance-panel').isVisible()))
    await toggle.click();
  await hook(page, 'admin-guidance-automatic-mode').click();
  await expect(hook(page, 'preparation-receipts-carousel')).toBeVisible();
  await expect(inlineAction(page, 'rerun')).toBeEnabled();
  expect(fixture.reads).toBe(0);
  expect(fixture.summaryReads).toBeGreaterThan(0);
  await expect(hook(page, 'preparation-receipt')).not.toContainText(
    source().title
  );
  await expect(hook(page, 'preparation-receipt')).not.toContainText(
    source().text
  );
  await inlineAction(page, 'rerun').click();
  await expect(
    hook(page, 'preparation-assistance-summary-state')
  ).toHaveAttribute('data-og7-state', 'queued');
  expect(fixture.compactRuns).toBe(1);
  expect(fixture.reads).toBe(0);
  await expect(hook(page, 'preparation-pilot-progress')).toHaveAttribute(
    'data-og7-completed',
    '1'
  );
  await expect(hook(page, 'preparation-pilot-progress')).toHaveAttribute(
    'data-og7-total',
    '3'
  );
});
