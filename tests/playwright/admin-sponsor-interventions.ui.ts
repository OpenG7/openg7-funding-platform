import type { Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import type {
  SponsorshipIntervention,
  SponsorshipInterventionsResponse
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';

interface InterventionTestContext {
  readonly fixtures: (
    page: Page,
    role?: 'reader' | 'operator' | 'owner'
  ) => Promise<{
    readonly calls: readonly { readonly method: string; readonly url: URL }[];
    readonly options: {
      readonly journal: Map<string, SponsorshipIntervention[]>;
      journalState: SponsorshipInterventionsResponse['followup']['state'];
    };
  }>;
  readonly path: (tab?: string, value?: string) => string;
  readonly id: string;
  readonly date: string;
}

const hostile = '<img src=x onerror="alert(1)">';
const actorReference = `admin:synthetic-${'reference'.repeat(28)}${hostile}`;

/** Exercises the private journal with intercepted API responses only. */
export function registerSponsorInterventionTests({
  fixtures,
  path,
  id,
  date
}: InterventionTestContext): void {
  test('completed information keeps an empty private journal and the note form available without offering a resend', async ({
    page
  }) => {
    const { calls, options } = await fixtures(page, 'owner');
    options.journalState = 'complete';
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(path('audit'));
    const journal = page.locator('[data-og7="dossier-interventions"]');
    await journal.locator('[data-og7="interventions-toggle"]').click();
    await expect(
      journal.locator('[data-og7="interventions-state"]')
    ).toHaveText('Informations reçues — traitement administratif à poursuivre');
    await expect(journal).toContainText('Aucune intervention consignée.');
    await expect(
      journal.locator('[data-og7="interventions-history"]')
    ).toHaveCount(0);
    await expect(
      journal.locator('[data-og7="intervention-form"]')
    ).toBeVisible();
    await expect(journal.locator('[data-og7="intervention-note"]')).toHaveValue(
      ''
    );
    await expect(
      journal.locator('[data-og7="interventions-access"]')
    ).toHaveCount(0);
    const guidance = journal.locator(
      'details[data-og7="interventions-guidance"]'
    );
    await expect(guidance).not.toHaveAttribute('open', '');
    await guidance.locator('summary').focus();
    await guidance.locator('summary').press('Enter');
    await expect(guidance).toHaveAttribute('open', '');
    await expect(guidance).toContainText('dans l’onglet Finances.');
    await expect(guidance).not.toContainText('dans l’onglet Remboursements.');
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  });

  for (const [locale, width] of [
    ['fr-CA', 1280],
    ['en', 390]
  ] as const) {
    const english = locale === 'en';

    test(`intervention history is readable before composition and preserves a collapsed draft in ${locale} at ${width}px`, async ({
      page
    }) => {
      const { calls, options } = await fixtures(page, 'operator');
      options.journal.set(id, [
        {
          id: 'synthetic-intervention-newest',
          kind: 'phone',
          actor: actorReference,
          recordedAt: date,
          note: `Synthetic recent intervention\n${hostile}`,
          nextReviewOn: null
        },
        {
          id: 'synthetic-intervention-older',
          kind: 'internal',
          actor: 'Synthetic operator',
          recordedAt: '2026-09-15T14:00:00Z',
          note: 'Synthetic older intervention',
          nextReviewOn: null
        }
      ]);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path('audit'));
      if (english)
        await page
          .getByRole('button', {
            name: 'Switch administration language to English'
          })
          .click();

      const journal = page.locator('[data-og7="dossier-interventions"]');
      await journal.locator('[data-og7="interventions-toggle"]').click();
      const history = journal.getByRole('list', {
        name: english ? 'Intervention journal' : 'Journal des interventions',
        exact: true
      });
      const form = journal.locator('[data-og7="intervention-form"]');
      await expect(history).toBeVisible();
      await expect(history).toHaveAttribute('role', 'list');
      await expect(history).toHaveAttribute(
        'aria-labelledby',
        'interventions-history-title'
      );
      await expect(history.locator('li')).toHaveCount(2);
      await expect(history.locator('li').first()).toContainText(
        'Synthetic recent intervention'
      );
      await expect(history.locator('li').last()).toContainText(
        'Synthetic older intervention'
      );
      await expect(history.locator('time').first()).toHaveAttribute(
        'datetime',
        date
      );
      await expect(
        journal.locator('[data-og7="interventions-summary"]')
      ).toContainText(/\b2\b/);
      await expect(
        journal.locator('dl[data-og7="interventions-facts"]')
      ).toBeVisible();
      expect(
        await history.evaluate((element) => {
          const compose = document.querySelector(
            '[data-og7="intervention-form"]'
          );
          return Boolean(
            compose &&
            element.compareDocumentPosition(compose) &
              Node.DOCUMENT_POSITION_FOLLOWING
          );
        })
      ).toBe(true);

      const actor = history.locator('li').first().locator('details');
      const actorSummary = actor.locator('summary');
      await expect(actorSummary).toContainText('Administration');
      await expect(actorSummary).not.toContainText(actorReference);
      await expect(actor.locator('code')).not.toBeVisible();
      await actorSummary.focus();
      await actorSummary.press('Enter');
      await expect(actor.locator('code')).toBeVisible();
      await expect(actor.locator('code')).toHaveText(actorReference);
      await expect(journal.locator('img, script, [onerror]')).toHaveCount(0);

      const guidance = journal.locator(
        'details[data-og7="interventions-guidance"]'
      );
      const guidanceSummary = guidance.locator('summary');
      await expect(guidanceSummary).toHaveText(
        english ? 'Follow-up guidance' : 'Repères et règles du suivi'
      );
      await expect(guidance).not.toHaveAttribute('open', '');
      await guidanceSummary.focus();
      await guidanceSummary.press('Enter');
      await expect(guidance).toHaveAttribute('open', '');
      await guidanceSummary.press('Space');
      await expect(guidance).not.toHaveAttribute('open', '');

      const note = form.locator('[data-og7="intervention-note"]');
      const draft = 'Synthetic unsaved journal note';
      await note.fill(draft);
      const compose = journal.locator('[data-og7="intervention-compose"]');
      await compose.focus();
      await compose.press('Enter');
      await expect(form).toBeFocused();
      await expect(note).toHaveValue(draft);
      const toggle = journal.locator('[data-og7="interventions-toggle"]');
      await page.keyboard.press('Escape');
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(toggle).toBeFocused();
      await expect(history).toBeHidden();
      await expect(form).toBeHidden();
      await toggle.press('Enter');
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(note).toHaveValue(draft);
      await expect(history).toBeVisible();

      const presentation = await journal
        .locator('dialog')
        .evaluate((element) => {
          const facts = element.querySelector(
            '[data-og7="interventions-facts"]'
          );
          const field = element.querySelector('textarea');
          const help = element.querySelector('#intervention-note-help');
          const fontSize = (target: Element | null) =>
            target ? Number.parseFloat(getComputedStyle(target).fontSize) : NaN;
          return {
            factsSize: fontSize(facts),
            fieldSize: fontSize(field),
            helpSize: fontSize(help),
            fits: element.scrollWidth <= element.clientWidth + 1,
            controlsFit: Array.from(
              element.querySelectorAll('button, select, textarea, input')
            ).every((control) => control.scrollWidth <= control.clientWidth + 1)
          };
        });
      expect(presentation.factsSize).toBeLessThanOrEqual(18);
      expect(presentation.fieldSize).toBeLessThanOrEqual(18);
      expect(presentation.helpSize).toBeLessThanOrEqual(presentation.fieldSize);
      expect(presentation.fits).toBe(true);
      expect(presentation.controlsFit).toBe(true);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
      expect(
        (
          await new AxeBuilder({ page })
            .include('[data-og7="dossier-interventions"]')
            .analyze()
        ).violations
      ).toEqual([]);
      await journal.locator('dialog').screenshot({
        path: `test-results/admin-intervention-history-${locale}-${width}.png`
      });
      expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
    });

    test(`reader can consult intervention history without a composition form in ${locale} at ${width}px`, async ({
      page
    }) => {
      const { calls, options } = await fixtures(page, 'reader');
      options.journal.set(id, [
        {
          id: 'synthetic-reader-intervention',
          kind: 'internal',
          actor: 'Synthetic operator',
          recordedAt: date,
          note: 'Synthetic private historical note',
          nextReviewOn: null
        }
      ]);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path('audit'));
      if (english)
        await page
          .getByRole('button', {
            name: 'Switch administration language to English'
          })
          .click();
      const journal = page.locator('[data-og7="dossier-interventions"]');
      await journal.locator('[data-og7="interventions-toggle"]').click();
      await expect(
        journal.getByRole('list', {
          name: english ? 'Intervention journal' : 'Journal des interventions',
          exact: true
        })
      ).toContainText('Synthetic private historical note');
      await expect(
        journal.locator('[data-og7="intervention-form"]')
      ).toHaveCount(0);
      await expect(journal.locator('textarea, select')).toHaveCount(0);
      const refresh = journal.locator('[data-og7="interventions-refresh"]');
      await expect(refresh).toBeEnabled();
      const readsBefore = calls.filter((call) =>
        call.url.pathname.endsWith('/interventions')
      ).length;
      await refresh.click();
      await expect
        .poll(
          () =>
            calls.filter((call) => call.url.pathname.endsWith('/interventions'))
              .length
        )
        .toBe(readsBefore + 1);
      await expect(
        journal.locator('[data-og7="intervention-compose"]')
      ).toHaveCount(0);
      expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
    });
  }

  test('follow-up opens from every dossier tab, loads once and restores its unsaved draft and focus', async ({
    page
  }) => {
    const { calls } = await fixtures(page, 'operator');
    await page.goto(path());
    const journal = page.locator('[data-og7="dossier-interventions"]');
    const command = journal.locator('[data-og7="interventions-toggle"]');
    await expect(command).toBeVisible();
    expect(
      calls.filter((call) => call.url.pathname.endsWith('/interventions'))
    ).toHaveLength(0);
    const draft = 'Synthetic follow-up retained across the dossier';
    for (const label of [
      'Aperçu',
      'Fiche et médias',
      'Publication',
      'Finances',
      'Historique'
    ]) {
      await page
        .locator('[data-og7="dossier-tabs"]')
        .getByRole('button', { name: label, exact: true })
        .click();
      await command.focus();
      await command.press('Enter');
      await expect(journal.locator('dialog')).toBeVisible();
      const note = journal.locator('[data-og7="intervention-note"]');
      if (label === 'Aperçu') await note.fill(draft);
      await expect(note).toHaveValue(draft);
      await page.keyboard.press('Escape');
      await expect(journal.locator('dialog')).toBeHidden();
      await expect(command).toBeFocused();
    }
    expect(
      calls.filter((call) => call.url.pathname.endsWith('/interventions'))
    ).toHaveLength(1);
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  });
}
