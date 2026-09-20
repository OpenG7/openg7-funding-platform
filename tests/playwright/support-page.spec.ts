import { AxeBuilder } from '@axe-core/playwright';
import type { PublicReferenceLookupFoundResponse } from '@openg7/funding-core';

import { expect, test } from './support/test.js';

const reference = 'OG7-2026-ABC123';
const contribution: PublicReferenceLookupFoundResponse = {
  found: true,
  publicReference: reference,
  contributionType: 'personal_support',
  paymentStatus: 'pending',
  amount: null,
  displayAmount: false,
  currency: 'CAD',
  paidAt: null,
  createdAt: '2026-09-19T00:00:00Z',
  reviewStatus: null,
  detailsSubmitted: null,
  nextStep: 'wait_for_payment_confirmation'
};

test.beforeEach(async ({ page }) => {
  // Every API call is intercepted: no real records, messages or payments.
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 503, json: {} })
  );
});

for (const prefix of ['', '/en']) {
  const english = prefix === '/en';
  const locale = english ? 'en' : 'fr-CA';

  test(`support lookup validates, handles missing records and shows only server status ${locale}`, async ({
    page
  }) => {
    let calls = 0;
    let found = false;
    let paid = false;
    await page.route('**/api/reference-lookup', (route) => {
      calls++;
      expect(route.request().postDataJSON()).toEqual({ reference });
      return route.fulfill({
        json: found
          ? {
              ...contribution,
              paymentStatus: paid ? 'paid' : 'pending',
              nextStep: paid ? 'none' : 'wait_for_payment_confirmation'
            }
          : { found: false, publicReference: reference }
      });
    });
    await page.goto(`${prefix}/support?checkout=success`);
    const input = page.locator('#reference-lookup-input');
    const status = page.locator('#reference-lookup-status');
    await expect(status).toBeEmpty();
    await input.fill('incorrect');
    await input.press('Enter');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(status).toContainText(
      english ? 'valid reference' : 'référence valide'
    );
    expect(calls).toBe(0);

    await input.fill(reference.toLowerCase());
    await input.press('Enter');
    await expect(input).toHaveAttribute('aria-invalid', 'false');
    await expect(status).toContainText(
      english ? 'No contribution matches' : 'Aucune contribution ne correspond'
    );
    await expect(
      page.locator('[data-og7="reference-recovery"] summary')
    ).toBeVisible();
    found = true;
    await input.press('Enter');
    await expect(status).toContainText(
      english ? 'Awaiting confirmation' : 'En attente de confirmation'
    );
    await expect(status).toContainText(
      english ? 'Amount not public' : 'Montant non public'
    );
    await expect(status).not.toContainText(english ? 'Paid' : 'Payé');
    paid = true;
    await input.press('Enter');
    await expect(status).toContainText(english ? 'Paid' : 'Payé');
    expect(calls).toBe(3);
  });

  test(`support lookup retries network and server failures without stale results ${locale}`, async ({
    page
  }) => {
    let calls = 0;
    await page.route('**/api/reference-lookup', (route) => {
      calls++;
      if (calls === 2) return route.abort('failed');
      if (calls === 3) return route.fulfill({ status: 503, json: {} });
      return route.fulfill({ json: contribution });
    });
    await page.goto(`${prefix}/support`);
    const input = page.locator('#reference-lookup-input');
    const status = page.locator('#reference-lookup-status');
    await input.fill(reference);
    await input.press('Enter');
    await expect(status).toContainText(reference);
    for (let i = 0; i < 2; i++) {
      await input.press('Enter');
      await expect(status).toContainText(
        english ? 'did not complete' : 'n’a pas abouti'
      );
      await expect(status).not.toContainText(reference);
      await expect(input).toHaveValue(reference);
      await expect(input).toHaveAttribute('aria-invalid', 'false');
    }
    await input.press('Enter');
    await expect(status).toContainText(reference);
    expect(calls).toBe(4);
  });

  test(`support recovery validates, retries and keeps its response private ${locale}`, async ({
    page
  }) => {
    let calls = 0;
    await page.route('**/api/reference-recovery', (route) => {
      calls++;
      if (calls === 1) return route.abort('failed');
      if (calls === 2) return route.fulfill({ json: { accepted: false } });
      return route.fulfill({ status: 202, json: { accepted: true } });
    });
    await page.goto(`${prefix}/support`);
    const panel = page.locator('[data-og7="reference-recovery"]');
    await panel.locator('summary').focus();
    await panel.locator('summary').press('Enter');
    const input = page.locator('#reference-recovery-email');
    const status = page.locator('#reference-recovery-status');
    await input.fill('incorrect');
    await input.press('Enter');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(calls).toBe(0);
    await input.fill('fixture@example.invalid');
    for (let i = 0; i < 2; i++) {
      await input.press('Enter');
      await expect(status).toContainText(
        english ? 'did not complete' : 'n’a pas abouti'
      );
      await expect(input).toHaveAttribute('aria-invalid', 'false');
    }
    await input.press('Enter');
    await expect(status).toContainText(
      english ? 'If a contribution matches' : 'Si une contribution correspond'
    );
    await expect(status).toContainText(english ? 'spam' : 'indésirables');
    const response = await status.textContent();
    await input.fill('unknown@example.invalid');
    await input.press('Enter');
    await expect(status).toHaveText(response!);
    await expect(status).not.toContainText('unknown@example.invalid');
  });

  for (const kind of ['lookup', 'reference', 'sponsorship'] as const) {
    const endpoint =
      kind === 'lookup'
        ? 'reference-lookup'
        : kind === 'reference'
          ? 'reference-recovery'
          : 'sponsorship-followup/recover';
    const inputId =
      kind === 'lookup'
        ? 'reference-lookup-input'
        : kind === 'reference'
          ? 'reference-recovery-email'
          : 'followup-recovery-email';
    const statusId =
      kind === 'lookup'
        ? 'reference-lookup-status'
        : kind === 'reference'
          ? 'reference-recovery-status'
          : 'followup-recovery-status';
    test(`support ${kind} times out, prevents duplicates and permits retry ${locale}`, async ({
      page
    }) => {
      let calls = 0;
      await page.route(`**/api/${endpoint}`, (route) => {
        calls++;
        if (calls === 1) return; // Leave the first request pending until the UI aborts it.
        return route.fulfill({
          json: kind === 'lookup' ? contribution : { accepted: true }
        });
      });
      await page.goto(`${prefix}/support`);
      if (kind === 'reference')
        await page.locator('[data-og7="reference-recovery"] summary').click();
      const input = page.locator(`#${inputId}`);
      const status = page.locator(`#${statusId}`);
      const form = input.locator('xpath=ancestor::form');
      const button = form.getByRole('button');
      await input.fill(
        kind === 'lookup' ? reference : 'fixture@example.invalid'
      );
      await page.clock.install();
      await input.press('Enter');
      await expect(button).toBeDisabled();
      await expect.poll(() => calls).toBe(1);
      await form.dispatchEvent('submit');
      await page.clock.fastForward(15001);
      await expect(button).toBeEnabled();
      await expect(status).toContainText(
        english
          ? /did not complete|could not be submitted/
          : /n’a pas abouti|n’a pas pu être transmise/
      );
      expect(calls).toBe(1);
      await input.press('Enter');
      await expect(status).toContainText(
        kind === 'lookup' ? reference : english ? 'If a' : 'Si une'
      );
      expect(calls).toBe(2);
    });

    test(`support ${kind} cancels pending work when leaving the page ${locale}`, async ({
      page
    }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route(`**/api/${endpoint}`, () => {});
      await page.goto(`${prefix}/support`);
      if (kind === 'reference')
        await page.locator('[data-og7="reference-recovery"] summary').click();
      const input = page.locator(`#${inputId}`);
      await input.fill(
        kind === 'lookup' ? reference : 'fixture@example.invalid'
      );
      const request = page.waitForRequest(`**/api/${endpoint}`);
      await input.press('Enter');
      await request;
      const aborted = page.waitForEvent('requestfailed', (r) =>
        r.url().endsWith(endpoint)
      );
      await page.locator('[data-og7="support-explore"]').click();
      await aborted;
      await expect(page).toHaveURL(
        new RegExp(`${prefix}/ecosystem#platforms$`)
      );
      expect(errors).toEqual([]);
    });
  }

  test(`support FAQ, technical links and optimized images remain usable ${locale}`, async ({
    page
  }) => {
    await page.goto(`${prefix}/support`);
    const faq = page.locator('[data-og7="support-faq"]');
    await expect(faq.locator('summary')).toHaveCount(4);
    const emailQuestion = faq.locator('summary').nth(1);
    await emailQuestion.focus();
    await emailQuestion.press('Enter');
    await faq.getByRole('button').click();
    await expect(page.locator('#reference-recovery-email')).toBeFocused();
    const repo = 'https://github.com/OpenG7/openg7-funding-platform';
    for (const action of ['issue', 'idea']) {
      const href = await page
        .locator(`[data-og7="support-${action}"]`)
        .getAttribute('href');
      expect(href?.startsWith(repo + '/issues/new?title=')).toBe(true);
      expect(new URL(href!).searchParams.get('title')).toBeTruthy();
    }
    await expect(page.locator('[data-og7="support-code"]')).toHaveAttribute(
      'href',
      repo + '/blob/HEAD/CONTRIBUTING.md'
    );
    await expect(page.locator('[data-og7="support-explore"]')).toHaveAttribute(
      'href',
      `${prefix}/ecosystem#platforms`
    );
    const heroImages = page.locator(
      'section[aria-labelledby="support-title"] img'
    );
    for (const image of await heroImages.all()) {
      expect(
        await image.evaluate((node) => (node as HTMLImageElement).currentSrc)
      ).toMatch(/\.webp$/);
    }
    expect(
      await page.evaluate(() =>
        performance
          .getEntriesByType('resource')
          .some((entry) =>
            /fonds-des-batisseurs-(?:canada-coffre-lumineux|dragon-coffre-fort)\.png/.test(
              entry.name
            )
          )
      )
    ).toBe(false);
    await expect(page.locator('main')).not.toContainText(
      'funding.supportPage.'
    );
  });

  test(`support expanded forms and errors remain accessible at narrow widths ${locale}`, async ({
    page
  }, info) => {
    await page.goto(`${prefix}/support`);
    await page.locator('[data-og7="reference-recovery"] summary').click();
    for (const id of [
      'reference-lookup-input',
      'reference-recovery-email',
      'followup-recovery-email'
    ]) {
      await page.locator(`#${id}`).fill('incorrect');
      await page.locator(`#${id}`).press('Enter');
      await expect(page.locator(`#${id}`)).toHaveAttribute(
        'aria-invalid',
        'true'
      );
    }
    for (const summary of await page
      .locator('[data-og7="support-faq"] summary')
      .all())
      await summary.click();
    const scan = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      scan.violations.map((v) => ({
        id: v.id,
        targets: v.nodes.map((n) => n.target)
      }))
    ).toEqual([]);
    for (const width of [320, 800]) {
      await page.setViewportSize({ width, height: 900 });
      if (width === 800)
        await page.addStyleTag({
          content: 'html { font-size: 200% !important; }'
        });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth
        )
      ).toBeLessThanOrEqual(1);
      for (const input of await page
        .locator('[data-og7="support-help"] input')
        .all()) {
        const box = await input.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      }
    }
    await page.screenshot({
      path: info.outputPath('expanded-support.png'),
      fullPage: true,
      scale: 'css'
    });
  });
}
