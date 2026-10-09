import { AxeBuilder } from '@axe-core/playwright';
import type { Locator, Page, Route } from '@playwright/test';
import type {
  AdminExpenseCreateRequest,
  AdminExpenseRecord,
  AdminExpensesResponse,
  AdminExpenseUpdateRequest
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';

const date = '2026-10-02T12:00:00.123Z';
const record = (id: string): AdminExpenseRecord => ({
  id,
  project_name: `Fixture ${id}`,
  public_description: `Description ${id}`,
  expected_outcome: `Outcome ${id}`,
  progress_status: 'planned',
  proof_url: 'https://example.test/proof',
  proof_source: 'Synthetic evidence',
  proof_published_at: date,
  amount_allocated: 42.5,
  currency: 'CAD',
  status: 'draft',
  published_at: null,
  created_at: date,
  updated_at: date
});
type Submission = { route: Route; payload: AdminExpenseUpdateRequest };

async function rendered(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })
  );
}

async function prepare(page: Page, language: string, width: number) {
  await page.setViewportSize({ width, height: 950 });
  await page.addInitScript((locale) => {
    localStorage.setItem('openg7.language', locale);
    sessionStorage.setItem(
      'openg7-admin-session-token',
      'openg7-admin-session.edit-fixture'
    );
    sessionStorage.setItem(
      'openg7-admin-session-expires-at',
      '2099-01-01T00:00:00Z'
    );
  }, language);
  const records = new Map(['1', '2'].map((id) => [id, record(id)]));
  const submissions: Submission[] = [];
  const reads: { route: Route; response: AdminExpensesResponse }[] = [];
  const options = { holdNextRead: false, readStatus: 200 };
  let revision = 0;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/config'))
      return route.fulfill({ json: { mode: 'oidc' } });
    if (path.endsWith('/auth/current'))
      return route.fulfill({
        json: {
          id: 'edit-owner-fixture',
          sessionId: 'edit-session-fixture',
          displayName: 'Owner fixture',
          role: 'owner',
          expiresAt: '2099-01-01T00:00:00Z'
        }
      });
    if (path.endsWith('/expenses/update')) {
      submissions.push({ route, payload: route.request().postDataJSON() });
      return;
    }
    if (path.endsWith('/admin/expenses')) {
      if (route.request().method() === 'POST') {
        const input: AdminExpenseCreateRequest = route.request().postDataJSON();
        const expense = {
          ...record('3'),
          project_name: input.projectName,
          public_description: input.publicDescription,
          expected_outcome: input.expectedOutcome,
          progress_status: input.progressStatus,
          proof_url: input.proofUrl ?? null,
          proof_source: input.proofSource ?? null,
          proof_published_at: input.proofPublishedAt ?? null,
          amount_allocated: input.amountAllocated,
          status: input.status
        };
        records.set('3', expense);
        return route.fulfill({ json: { updated: true, expense } });
      }
      const id = new URL(route.request().url()).searchParams.get('expenseId');
      const all = [...records.values()];
      const response: AdminExpensesResponse = {
        data_source: 'database',
        expenses: all.filter((row) => !id || row.id === id),
        summary: {
          total_count: all.length,
          published_count: all.filter((row) => row.status === 'published')
            .length,
          draft_count: all.filter((row) => row.status === 'draft').length,
          private_count: 0,
          archived_count: 0,
          total_allocated: all.reduce(
            (sum, row) => sum + row.amount_allocated,
            0
          ),
          published_allocated: all
            .filter((row) => row.status === 'published')
            .reduce((sum, row) => sum + row.amount_allocated, 0),
          currency: 'CAD'
        },
        last_updated_at: date
      };
      reads.push({ route, response });
      if (options.holdNextRead) {
        options.holdNextRead = false;
        return;
      }
      return route.fulfill({
        status: options.readStatus,
        json: options.readStatus === 200 ? response : {}
      });
    }
    return route.fulfill({ status: 503, json: {} });
  });
  const finish = async (submission: Submission) => {
    const input = submission.payload;
    const current = records.get(input.expenseId)!;
    if (input.expectedVersion !== current.updated_at) {
      await submission.route.fulfill({
        status: 409,
        json: { code: 'version_conflict' }
      });
      return null;
    }
    const expense: AdminExpenseRecord = {
      ...current,
      project_name: input.projectName ?? current.project_name,
      public_description: input.publicDescription ?? current.public_description,
      expected_outcome: input.expectedOutcome ?? current.expected_outcome,
      progress_status: input.progressStatus ?? current.progress_status,
      proof_url: input.proofUrl ?? null,
      proof_source: input.proofSource ?? null,
      proof_published_at: input.proofPublishedAt ?? null,
      amount_allocated: input.amountAllocated ?? current.amount_allocated,
      status: input.status ?? current.status,
      published_at:
        input.publishedAt || (input.status === 'published' ? date : null),
      updated_at: new Date(
        Date.parse('2026-10-02T12:10:00.123Z') + ++revision * 1000
      ).toISOString()
    };
    records.set(expense.id, expense);
    await submission.route.fulfill({ json: { updated: true, expense } });
    return expense;
  };
  await page.goto('/admin/fundraiser/expenses');
  const card = (id: string) =>
    page.locator(`[data-og7="allocation-card"][data-og7-id="${id}"]`);
  await expect(card('1')).toBeVisible();
  return { records, submissions, reads, options, finish, card };
}

async function save(
  page: Page,
  card: Locator,
  english: boolean,
  publish = false
) {
  const status = await card
    .getByRole('combobox', { name: english ? 'Status' : 'Statut', exact: true })
    .inputValue();
  await card
    .getByRole('button', {
      name: publish
        ? english
          ? 'Publish'
          : 'Publier'
        : english
          ? 'Save'
          : 'Enregistrer',
      exact: true
    })
    .click();
  if (publish || ['published', 'active'].includes(status)) {
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(
      card.getByRole('button', {
        name: english ? 'Save' : 'Enregistrer',
        exact: true
      })
    ).toBeDisabled();
    await page.locator('[data-og7="confirm-action"]').focus();
    await page.keyboard.press('Enter');
  }
}

for (const language of ['fr-CA', 'en']) {
  for (const width of [390, 1280]) {
    const english = language === 'en';
    const description = english ? 'Public description' : 'Description publique';
    const outcome = english ? 'Expected outcome' : 'Resultat attendu';
    const saveName = english ? 'Save' : 'Enregistrer';

    test(`allocation filters preserve page drafts when cards are recreated during a save in ${language} at ${width}px`, async ({
      page
    }) => {
      const { submissions, finish, card } = await prepare(
        page,
        language,
        width
      );
      const filters = page.locator('[data-og7="allocation-filters"]');
      const search = filters.getByRole('searchbox', {
        name: english ? 'Search' : 'Recherche',
        exact: true
      });
      const status = filters.getByRole('combobox', {
        name: english ? 'Status' : 'Statut',
        exact: true
      });
      await card('1')
        .getByLabel(description, { exact: true })
        .fill('First submitted draft');
      await card('2')
        .getByLabel(outcome, { exact: true })
        .fill('Second page-owned draft');
      await search.fill('Fixture 1');
      await expect(card('2')).toHaveCount(0);
      await search.fill('');
      await expect(card('2').getByLabel(outcome, { exact: true })).toHaveValue(
        'Second page-owned draft'
      );
      await status.selectOption('private');
      await expect(page.locator('[data-og7="allocation-card"]')).toHaveCount(0);
      await expect(
        page.getByRole('heading', {
          name: english ? 'No entries found' : 'Aucune entree trouvee',
          exact: true
        })
      ).toBeVisible();
      await status.selectOption('all');
      await expect(
        card('1').getByLabel(description, { exact: true })
      ).toHaveValue('First submitted draft');
      await expect(card('2').getByLabel(outcome, { exact: true })).toHaveValue(
        'Second page-owned draft'
      );

      await save(page, card('1'), english);
      await expect.poll(() => submissions.length).toBe(1);
      await search.fill('Fixture 2');
      await expect(card('1')).toHaveCount(0);
      await expect(search).toBeFocused();
      await expect(
        card('2').getByRole('button', { name: saveName, exact: true })
      ).toBeDisabled();
      const confirmed = (await finish(submissions[0]))!;
      await expect(
        card('2').getByRole('button', { name: saveName, exact: true })
      ).toBeEnabled();
      await expect(search).toHaveValue('Fixture 2');
      await expect(search).toBeFocused();
      await expect(card('2').getByLabel(outcome, { exact: true })).toHaveValue(
        'Second page-owned draft'
      );

      await search.fill('Fixture 1');
      await expect(
        card('1').getByLabel(description, { exact: true })
      ).toHaveValue('First submitted draft');
      await card('1')
        .getByLabel(outcome, { exact: true })
        .fill('Next first draft');
      await save(page, card('1'), english);
      await expect.poll(() => submissions.length).toBe(2);
      expect(submissions[1].payload).toMatchObject({
        expenseId: '1',
        expectedVersion: confirmed.updated_at,
        expectedOutcome: 'Next first draft'
      });
      await finish(submissions[1]);
      await expect(
        card('1').getByRole('button', { name: saveName, exact: true })
      ).toBeEnabled();
    });

    test(`allocation drafts survive another save, late reads and edits during publication in ${language} at ${width}px`, async ({
      page
    }) => {
      const { submissions, reads, options, finish, card } = await prepare(
        page,
        language,
        width
      );
      await card('1')
        .getByLabel(description, { exact: true })
        .fill('Submitted description');
      await card('2')
        .getByLabel(description, { exact: true })
        .fill('Unsaved second allocation');
      options.holdNextRead = true;
      await page
        .getByRole('button', {
          name: english ? 'Refresh' : 'Actualiser',
          exact: true
        })
        .click();
      await expect.poll(() => reads.length).toBe(2);
      await save(page, card('1'), english, true);
      await expect.poll(() => submissions.length).toBe(1);
      // The POST can start before the modal releases the underlying fields.
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await card('1')
        .getByLabel(outcome, { exact: true })
        .fill('Typed while publishing');
      await expect(card('1').getByLabel(outcome, { exact: true })).toHaveValue(
        'Typed while publishing'
      );
      expect(submissions[0].payload).toMatchObject({
        expectedVersion: date,
        confirmation: '1',
        status: 'published',
        expectedOutcome: 'Outcome 1',
        proofPublishedAt: date
      });
      options.holdNextRead = true;
      const confirmed = (await finish(submissions[0]))!;
      await expect.poll(() => reads.length).toBe(3);
      await card('1')
        .getByLabel(english ? 'Proof source' : 'Source de la preuve', {
          exact: true
        })
        .fill('Typed during the reread');
      await reads[2].route.fulfill({ json: reads[2].response });
      await expect(
        card('1').getByRole('button', { name: saveName, exact: true })
      ).toBeEnabled();
      await expect(card('1').getByLabel(outcome, { exact: true })).toHaveValue(
        'Typed while publishing'
      );
      await expect(
        card('1').getByRole('combobox', {
          name: english ? 'Status' : 'Statut',
          exact: true
        })
      ).toHaveValue('published');
      await expect(
        card('2').getByLabel(description, { exact: true })
      ).toHaveValue('Unsaved second allocation');
      const oldFinished = page.waitForEvent(
        'requestfinished',
        (request) => request === reads[1].route.request()
      );
      await reads[1].route.fulfill({ json: reads[1].response });
      await oldFinished;
      await rendered(page);
      await expect(card('1').getByLabel(outcome, { exact: true })).toHaveValue(
        'Typed while publishing'
      );
      await save(page, card('1'), english);
      await expect.poll(() => submissions.length).toBe(2);
      expect(submissions[1].payload).toMatchObject({
        expectedVersion: confirmed.updated_at,
        expectedOutcome: 'Typed while publishing',
        proofSource: 'Typed during the reread',
        status: 'published',
        confirmation: '1',
        publishedAt: date,
        proofPublishedAt: date
      });
      await finish(submissions[1]);
      await expect(
        card('1').getByRole('button', { name: saveName, exact: true })
      ).toBeEnabled();
      await expect(
        card('2').getByLabel(description, { exact: true })
      ).toHaveValue('Unsaved second allocation');
      const accessibility = await new AxeBuilder({ page })
        .include('[data-og7="allocation-card"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(accessibility.violations).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true);
    });

    test(`automatic allocation refresh preserves the original version until explicit reload in ${language} at ${width}px`, async ({
      page
    }) => {
      const { records, submissions, finish, card } = await prepare(
        page,
        language,
        width
      );
      await card('2')
        .getByLabel(description, { exact: true })
        .fill('Local second draft');
      const remoteVersion = '2026-10-02T12:05:00.456Z';
      records.set('2', {
        ...records.get('2')!,
        public_description: 'Remote administrator description',
        updated_at: remoteVersion
      });
      await card('1')
        .getByLabel(description, { exact: true })
        .fill('First saved draft');
      await save(page, card('1'), english);
      await expect.poll(() => submissions.length).toBe(1);
      await finish(submissions[0]);
      await expect(
        card('1').getByRole('button', { name: saveName, exact: true })
      ).toBeEnabled();
      await expect(
        card('2').getByLabel(description, { exact: true })
      ).toHaveValue('Local second draft');
      await expect(
        page.locator('[data-og7="allocation-conflict"]')
      ).toBeVisible();
      await save(page, card('2'), english);
      await expect.poll(() => submissions.length).toBe(2);
      expect(submissions[1].payload.expectedVersion).toBe(date);
      expect(await finish(submissions[1])).toBeNull();
      await expect(
        card('2').getByRole('button', { name: saveName, exact: true })
      ).toBeEnabled();
      await expect(
        card('2').getByLabel(description, { exact: true })
      ).toHaveValue('Local second draft');

      const create = page.locator('[data-og7="allocation-create"]');
      await create
        .getByLabel(english ? 'Project or supplier' : 'Projet ou fournisseur', {
          exact: true
        })
        .fill('New third allocation');
      await create
        .getByLabel(english ? 'Amount in CAD' : 'Montant CAD', { exact: true })
        .fill('19.75');
      await create
        .getByLabel(description, { exact: true })
        .fill('Third description');
      await create.getByLabel(outcome, { exact: true }).fill('Third outcome');
      await create
        .getByRole('button', { name: english ? 'Add' : 'Ajouter', exact: true })
        .click();
      await expect(card('3')).toBeVisible();
      await expect(
        card('2').getByLabel(description, { exact: true })
      ).toHaveValue('Local second draft');
      await expect(
        page.locator('[data-og7="allocation-conflict"]')
      ).toBeVisible();
      await page
        .getByRole('button', {
          name: english ? 'Refresh' : 'Actualiser',
          exact: true
        })
        .click();
      await expect(
        card('2').getByLabel(description, { exact: true })
      ).toHaveValue('Remote administrator description');
      await expect(
        page.locator('[data-og7="allocation-conflict"]')
      ).toHaveCount(0);
      await card('2')
        .getByLabel(description, { exact: true })
        .fill('Reviewed current version');
      await save(page, card('2'), english);
      await expect.poll(() => submissions.length).toBe(3);
      expect(submissions[2].payload).toMatchObject({
        expectedVersion: remoteVersion,
        proofPublishedAt: date
      });
      await finish(submissions[2]);
      await expect(
        card('2').getByRole('button', { name: saveName, exact: true })
      ).toBeEnabled();
    });

    test(`a failed allocation reread preserves confirmed version and further edits in ${language} at ${width}px`, async ({
      page
    }) => {
      const { submissions, options, finish, card } = await prepare(
        page,
        language,
        width
      );
      await card('1')
        .getByLabel(description, { exact: true })
        .fill('Confirmed description');
      await card('2')
        .getByLabel(description, { exact: true })
        .fill('Other local draft');
      await save(page, card('1'), english);
      await expect.poll(() => submissions.length).toBe(1);
      await card('1').getByLabel(outcome, { exact: true }).fill('Next outcome');
      options.readStatus = 500;
      const confirmed = (await finish(submissions[0]))!;
      await expect(
        card('1').getByRole('button', { name: saveName, exact: true })
      ).toBeEnabled();
      await expect(
        page.getByText(
          english
            ? 'Could not load or update expenses.'
            : 'Impossible de charger ou modifier les depenses.',
          { exact: true }
        )
      ).toBeVisible();
      await expect(card('1').getByLabel(outcome, { exact: true })).toHaveValue(
        'Next outcome'
      );
      await expect(
        card('2').getByLabel(description, { exact: true })
      ).toHaveValue('Other local draft');
      await save(page, card('1'), english);
      await expect.poll(() => submissions.length).toBe(2);
      expect(submissions[1].payload).toMatchObject({
        expectedVersion: confirmed.updated_at,
        expectedOutcome: 'Next outcome'
      });
      options.readStatus = 200;
      await finish(submissions[1]);
      await expect(
        card('1').getByRole('button', { name: saveName, exact: true })
      ).toBeEnabled();
      await expect(
        card('2').getByLabel(description, { exact: true })
      ).toHaveValue('Other local draft');
    });
  }
}

test('an untouched allocation adopts the server fields and version after another save', async ({
  page
}) => {
  const { records, submissions, finish, card } = await prepare(
    page,
    'fr-CA',
    1280
  );
  const currentVersion = '2026-10-02T12:05:00.456Z';
  records.set('2', {
    ...records.get('2')!,
    public_description: 'Fresh server fields',
    updated_at: currentVersion
  });
  await save(page, card('1'), false);
  await expect.poll(() => submissions.length).toBe(1);
  await finish(submissions[0]);
  await expect(
    card('1').getByRole('button', { name: 'Enregistrer', exact: true })
  ).toBeEnabled();
  await expect(
    card('2').getByLabel('Description publique', { exact: true })
  ).toHaveValue('Fresh server fields');
  await save(page, card('2'), false);
  await expect.poll(() => submissions.length).toBe(2);
  expect(submissions[1].payload.expectedVersion).toBe(currentVersion);
  await finish(submissions[1]);
  await expect(
    card('2').getByRole('button', { name: 'Enregistrer', exact: true })
  ).toBeEnabled();
});

test('an allocation save finishing after scope changes does not reload or populate the restored scope', async ({
  page
}) => {
  const { submissions, reads, finish, card } = await prepare(
    page,
    'fr-CA',
    1280
  );
  await card('1')
    .getByLabel('Description publique', { exact: true })
    .fill('Old scope change');
  await save(page, card('1'), false);
  await expect.poll(() => submissions.length).toBe(1);
  await page.evaluate(() => {
    history.pushState(null, '', '/admin/fundraiser/expenses?expenseId=2');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page).toHaveURL(/expenseId=2$/);
  await expect(card('1')).toHaveCount(0);
  await expect(card('2')).toBeVisible();
  await page.evaluate(() => {
    history.pushState(null, '', '/admin/fundraiser/expenses');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page).toHaveURL(/\/admin\/fundraiser\/expenses$/);
  await expect(card('1')).toBeVisible();
  await expect(
    card('1').getByLabel('Description publique', { exact: true })
  ).toHaveValue('Description 1');
  await card('1')
    .getByLabel('Description publique', { exact: true })
    .fill('Restored scope draft');
  const finished = page.waitForEvent(
    'requestfinished',
    (request) => request === submissions[0].route.request()
  );
  await finish(submissions[0]);
  await finished;
  await rendered(page);
  expect(reads).toHaveLength(3);
  await expect(
    card('1').getByLabel('Description publique', { exact: true })
  ).toHaveValue('Restored scope draft');
  await save(page, card('1'), false);
  await expect.poll(() => submissions.length).toBe(2);
  expect(submissions[1].payload).toMatchObject({
    expectedVersion: date,
    publicDescription: 'Restored scope draft'
  });
  expect(await finish(submissions[1])).toBeNull();
  await expect(page.locator('[data-og7="allocation-conflict"]')).toBeVisible();
});
