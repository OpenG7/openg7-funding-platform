import { AxeBuilder } from '@axe-core/playwright';
import type { Locator, Page, Route } from '@playwright/test';
import type {
  AdminExpenseCreateRequest,
  AdminExpenseRecord,
  AdminExpensesResponse
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';

const date = '2026-10-02T12:00:00Z';
const fields = (english: boolean) => ({
  project: english ? 'Project or supplier' : 'Projet ou fournisseur',
  amount: english ? 'Amount in CAD' : 'Montant CAD',
  description: english ? 'Public description' : 'Description publique',
  outcome: english ? 'Expected outcome' : 'Resultat attendu',
  status: english ? 'Status' : 'Statut',
  progress: english ? 'Progress' : 'Avancement',
  proof: english ? 'Public proof' : 'Preuve publique',
  source: english ? 'Proof source' : 'Source de la preuve',
  date: english ? 'Proof date' : 'Date de la preuve'
});
const draft = (name: string) => ({
  project: name,
  amount: '42.50',
  description: `Synthetic description ${name}`,
  outcome: `Synthetic outcome ${name}`,
  status: 'draft',
  progress: 'in_progress',
  proof: `https://example.test/${name}`,
  source: `Synthetic source ${name}`,
  date: '2026-10-01T10:15'
});
type Draft = ReturnType<typeof draft>;
type Submission = { route: Route; payload: AdminExpenseCreateRequest };

async function fill(form: Locator, english: boolean, values: Draft) {
  const labels = fields(english);
  for (const key of Object.keys(labels) as (keyof Draft)[]) {
    if (key === 'status' || key === 'progress') {
      await form
        .getByRole('combobox', { name: labels[key], exact: true })
        .selectOption(values[key]);
    } else {
      await form.getByLabel(labels[key], { exact: true }).fill(values[key]);
    }
  }
}

async function expectDraft(form: Locator, english: boolean, values: Draft) {
  const labels = fields(english);
  for (const key of Object.keys(labels) as (keyof Draft)[]) {
    const input =
      key === 'status' || key === 'progress'
        ? form.getByRole('combobox', { name: labels[key], exact: true })
        : form.getByLabel(labels[key], { exact: true });
    await expect(input).toHaveValue(values[key]);
  }
}

async function prepare(page: Page, language: string, width: number) {
  await page.setViewportSize({ width, height: 950 });
  await page.addInitScript((locale) => {
    localStorage.setItem('openg7.language', locale);
    sessionStorage.setItem(
      'openg7-admin-session-token',
      'openg7-admin-session.allocation-fixture'
    );
    sessionStorage.setItem(
      'openg7-admin-session-expires-at',
      '2099-01-01T00:00:00Z'
    );
  }, language);
  const submissions: Submission[] = [];
  const expenses: AdminExpenseRecord[] = [];
  const reads: string[] = [];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/config')) {
      return route.fulfill({ json: { mode: 'oidc' } });
    }
    if (path.endsWith('/auth/current')) {
      return route.fulfill({
        json: {
          id: 'allocation-owner-fixture',
          sessionId: 'allocation-session-fixture',
          displayName: 'Owner fixture',
          role: 'owner',
          expiresAt: '2099-01-01T00:00:00Z'
        }
      });
    }
    if (path.endsWith('/admin/expenses')) {
      if (route.request().method() === 'POST') {
        submissions.push({ route, payload: route.request().postDataJSON() });
        return;
      }
      reads.push(route.request().url());
      const response: AdminExpensesResponse = {
        data_source: 'database',
        expenses: [...expenses],
        summary: {
          total_count: expenses.length,
          published_count: expenses.filter(
            (item) => item.status === 'published'
          ).length,
          draft_count: expenses.filter((item) => item.status === 'draft')
            .length,
          private_count: 0,
          archived_count: 0,
          total_allocated: expenses.reduce(
            (sum, item) => sum + item.amount_allocated,
            0
          ),
          published_allocated: expenses
            .filter((item) => item.status === 'published')
            .reduce((sum, item) => sum + item.amount_allocated, 0),
          currency: 'CAD'
        },
        last_updated_at: date
      };
      return route.fulfill({ json: response });
    }
    return route.fulfill({ status: 503, json: {} });
  });
  const finish = async (submission: Submission, status = 200) => {
    const input = submission.payload;
    const expense: AdminExpenseRecord = {
      id: `allocation-fixture-${expenses.length + 1}`,
      project_name: input.projectName,
      public_description: input.publicDescription,
      expected_outcome: input.expectedOutcome,
      progress_status: input.progressStatus,
      proof_url: input.proofUrl ?? null,
      proof_source: input.proofSource ?? null,
      proof_published_at: input.proofPublishedAt ?? null,
      amount_allocated: input.amountAllocated,
      currency: input.currency,
      status: input.status,
      published_at: input.status === 'published' ? date : null,
      created_at: date,
      updated_at: date
    };
    if (status === 200) expenses.push(expense);
    await submission.route.fulfill({
      status,
      json: status === 200 ? { updated: true, expense } : {}
    });
  };
  await page.goto('/admin/fundraiser/expenses');
  const form = page.locator('[data-og7="allocation-create"]');
  await expect(form).toBeVisible();
  const add = form.getByRole('button', {
    name: language === 'en' ? 'Add' : 'Ajouter',
    exact: true
  });
  return { form, add, submissions, reads, finish };
}

for (const language of ['fr-CA', 'en']) {
  for (const width of [390, 1280]) {
    const english = language === 'en';
    test(`allocation creation preserves the next draft and a failed submission in ${language} at ${width}px`, async ({
      page
    }) => {
      const { form, add, submissions, reads, finish } = await prepare(
        page,
        language,
        width
      );
      const first = draft('first');
      const next = {
        ...draft('next'),
        amount: '19.75',
        progress: 'delivered',
        date: '2026-10-02T11:30'
      };
      await fill(form, english, first);
      await add.focus();
      await page.keyboard.press('Enter');
      await expect.poll(() => submissions.length).toBe(1);
      await expect(add).toBeDisabled();
      await fill(form, english, next);
      expect(submissions[0].payload).toMatchObject({
        projectName: first.project,
        amountAllocated: 42.5,
        publicDescription: first.description,
        expectedOutcome: first.outcome,
        progressStatus: first.progress,
        proofUrl: first.proof,
        proofSource: first.source,
        proofPublishedAt: await page.evaluate(
          (value) => new Date(value).toISOString(),
          first.date
        ),
        status: 'draft',
        currency: 'CAD'
      });
      expect(submissions[0].payload.confirmation).toBeUndefined();
      await finish(submissions[0]);
      await expect(add).toBeEnabled();
      await expect.poll(() => reads.length).toBe(2);
      await expectDraft(form, english, next);
      await expect(
        page
          .locator('[data-og7="allocation-card"]')
          .getByRole('heading', { name: 'first', exact: true })
      ).toBeVisible();

      await add.click();
      await expect.poll(() => submissions.length).toBe(2);
      expect(submissions[1].payload.projectName).toBe('next');
      await finish(submissions[1], 500);
      await expect(add).toBeEnabled();
      await expectDraft(form, english, next);
      await expect(
        page.getByText(
          english
            ? 'Could not load or update expenses.'
            : 'Impossible de charger ou modifier les depenses.',
          { exact: true }
        )
      ).toBeVisible();
      expect(reads).toHaveLength(2);
      expect(submissions).toHaveLength(2);
      const accessibility = await new AxeBuilder({ page })
        .include('[data-og7="allocation-create"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(accessibility.violations).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true);
    });

    test(`allocation creation clears only the unchanged submitted form in ${language} at ${width}px`, async ({
      page
    }) => {
      const { form, add, submissions, finish } = await prepare(
        page,
        language,
        width
      );
      await fill(form, english, draft('unchanged'));
      await add.click();
      await expect.poll(() => submissions.length).toBe(1);
      await expect(
        form.getByLabel(fields(english).project, { exact: true })
      ).toHaveValue('unchanged');
      await finish(submissions[0]);
      await expect(add).toBeEnabled();
      await expectDraft(form, english, {
        project: '',
        amount: '',
        description: '',
        outcome: '',
        status: 'draft',
        progress: 'planned',
        proof: '',
        source: '',
        date: ''
      });
    });

    test(`public allocation confirmation applies only to its submitted content in ${language} at ${width}px`, async ({
      page
    }) => {
      const { form, add, submissions, finish } = await prepare(
        page,
        language,
        width
      );
      const published = { ...draft('public-fixture'), status: 'published' };
      await fill(form, english, published);
      await add.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText(published.description);
      await expect(add).toBeDisabled();
      expect(submissions).toHaveLength(0);
      await dialog
        .getByRole('button', {
          name: english ? 'Cancel' : 'Annuler',
          exact: true
        })
        .last()
        .click();
      await expect(add).toBeEnabled();
      await expectDraft(form, english, published);
      expect(submissions).toHaveLength(0);
      await add.click();
      await page.locator('[data-og7="confirm-action"]').focus();
      await page.keyboard.press('Enter');
      await expect.poll(() => submissions.length).toBe(1);
      await fill(form, english, draft('private-next'));
      expect(submissions[0].payload).toMatchObject({
        projectName: 'public-fixture',
        status: 'published',
        confirmation: 'CREATE_PUBLIC_ALLOCATION'
      });
      await finish(submissions[0]);
      await expect(add).toBeEnabled();
      await expectDraft(form, english, draft('private-next'));
      await add.click();
      await expect.poll(() => submissions.length).toBe(2);
      await expect(dialog).toHaveCount(0);
      expect(submissions[1].payload.status).toBe('draft');
      expect(submissions[1].payload.confirmation).toBeUndefined();
      await finish(submissions[1]);
      await expect(add).toBeEnabled();
    });
  }
}

test('a creation response after navigation does not reload the destroyed page', async ({
  page
}) => {
  const { form, add, submissions, reads, finish } = await prepare(
    page,
    'fr-CA',
    1280
  );
  await fill(form, false, draft('leaving'));
  await add.click();
  await expect.poll(() => submissions.length).toBe(1);
  await page.locator('a[href="/admin/fundraiser/audit"]').first().click();
  await expect(page).toHaveURL(/\/admin\/fundraiser\/audit$/);
  await expect(form).toHaveCount(0);
  const completed = page.waitForEvent(
    'requestfinished',
    (request) => request === submissions[0].route.request()
  );
  await finish(submissions[0]);
  await completed;
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
  expect(reads).toHaveLength(1);
});
