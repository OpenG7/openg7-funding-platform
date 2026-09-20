import { AxeBuilder } from '@axe-core/playwright';

import { expect, test } from './support/test.js';

const locales = [
  {
    prefix: '',
    language: 'fr-CA',
    title: 'Politique d’utilisation et de remboursement',
    refund: 'Demander un remboursement',
    subject: 'Demande de remboursement — Fonds des Bâtisseurs'
  },
  {
    prefix: '/en',
    language: 'en',
    title: 'Usage and refund policy',
    refund: 'Request a refund',
    subject: 'Refund request — Builders Fund'
  }
] as const;

test.beforeEach(async ({ page }) => {
  // Static policy and isolated support links: no payment or email is sent.
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 503, json: {} })
  );
});

for (const locale of locales) {
  const route = `${locale.prefix}/politique-utilisation-remboursement`;
  const english = locale.language === 'en';

  test(`refund policy presents the request, independent review and bank timing ${locale.language}`, async ({
    page
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const response = await page.goto(route);
    expect(response?.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang', locale.language);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      locale.title
    );
    const request = page.locator('[data-og7="refund-request"]');
    await expect(request.getByRole('listitem')).toHaveCount(3);
    await expect(request).toContainText(
      english ? 'does not confirm approval' : 'ne confirme ni son acceptation'
    );
    await expect(request).toContainText(
      english
        ? 'Do not send card numbers'
        : 'Ne transmettez aucun numéro de carte'
    );
    const email = new URL(
      (await page.locator('[data-og7="refund-email"]').getAttribute('href'))!
    );
    expect(email.protocol).toBe('mailto:');
    expect(email.pathname).toBe('contact@openg7.org');
    expect(email.searchParams.get('subject')).toBe(locale.subject);
    // Only a subject is prefilled, never a private payment or follow-up token.
    expect([...email.searchParams.keys()]).toEqual(['subject']);
    const refunds = page.getByRole('region', {
      name: english
        ? 'Refund review and follow-up'
        : 'Examen et suivi des remboursements'
    });
    await expect(refunds).toContainText(
      english ? '5 to 10 business days' : '5 à 10 jours ouvrables'
    );
    await expect(refunds).toContainText(
      english
        ? 'excludes the initial review'
        : 'ne couvre pas l’analyse préalable'
    );
    await expect(refunds).toContainText(
      english ? 'full or partial' : 'total ou partiel'
    );
    await expect(refunds).toContainText(english ? 'refund failed' : 'un échec');
    await expect(
      page.getByRole('region', {
        name: english ? 'Business sponsorships' : 'Commandites d’entreprise',
        exact: true
      })
    ).toContainText(
      english
        ? 'does not by itself confirm a refund'
        : 'ne confirme pas à lui seul un remboursement'
    );
    await expect(page.locator('time')).toHaveAttribute(
      'datetime',
      '2026-09-19'
    );
    await expect(page.locator('[data-og7="refund-policy"]')).not.toContainText(
      /funding\.policyPage\.|webhook|idempotence|idempotency|\bMVP\b/
    );
    const hero = page
      .getByRole('region', { name: locale.title })
      .locator('img');
    await expect(hero).toHaveAttribute(
      'srcset',
      /960\.webp\s+960w,[\s\S]*1920\.webp\s+1920w/
    );
    expect(
      await hero.evaluate(
        (image: HTMLImageElement) => image.complete && image.naturalWidth > 0
      )
    ).toBe(true);
    expect(errors).toEqual([]);
  });

  test(`refund policy anchors are reachable by keyboard and preserve language ${locale.language}`, async ({
    page
  }) => {
    await page.goto(route);
    const primary = page
      .getByRole('region', { name: locale.title })
      .getByRole('link', { name: locale.refund, exact: true });
    await primary.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(route + '#refund-request');
    await expect(page.locator('#refund-request')).toBeFocused();
    const links = page.locator('[data-og7="policy-toc"] a');
    await expect(links).toHaveCount(9);
    for (const link of await links.all()) {
      const href = (await link.getAttribute('href'))!;
      expect(href).toMatch(new RegExp('^' + route + '#'));
      const id = href.split('#')[1];
      await link.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(href);
      const heading = page.locator('#' + id);
      await expect(heading).toBeFocused();
      await expect(heading).toBeInViewport();
    }
    const top = page.getByRole('link', {
      name: english ? 'Back to top' : 'Retour en haut'
    });
    await top.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#policy-title')).toBeFocused();
  });

  test(`refund policy connects to reference recovery and changes language ${locale.language}`, async ({
    page
  }) => {
    await page.goto(route);
    await page
      .getByRole('link', {
        name: english
          ? 'I do not know my reference'
          : 'Je ne connais pas ma référence',
        exact: true
      })
      .click();
    await expect(page).toHaveURL(`${locale.prefix}/support#contribution-help`);
    await expect(page.locator('#reference-lookup-input')).toBeVisible();
    await expect(page.locator('#reference-recovery')).toBeAttached();
    await page.goBack();
    await page
      .getByRole('button', {
        name: english
          ? 'Changer la langue du site vers le français'
          : 'Switch site language to English'
      })
      .click();
    const alternate = locales.find(
      (entry) => entry.language !== locale.language
    )!;
    await expect(page).toHaveURL(
      `${alternate.prefix}/politique-utilisation-remboursement`
    );
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      alternate.title
    );
    const email = new URL(
      (await page.locator('[data-og7="refund-email"]').getAttribute('href'))!
    );
    expect(email.searchParams.get('subject')).toBe(alternate.subject);
    await expect(
      page.getByRole('link', {
        name: alternate.language === 'en' ? 'Open support' : 'Ouvrir le support'
      })
    ).toHaveAttribute('href', `${alternate.prefix}/support#contact-help`);
  });

  test(`refund policy has accessible contrast and reflows at 320px ${locale.language}`, async ({
    page
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(route);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze()
      ).violations
    ).toEqual([]);
    const width = () =>
      page.evaluate(() => ({
        page: document.documentElement.scrollWidth,
        viewport: innerWidth
      }));
    let dimensions = await width();
    expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    dimensions = await width();
    expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const request = page.locator('[data-og7="policy-toc"] a').first();
    await request.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#refund-request')).toBeFocused();
    await expect(page.locator('#refund-request')).toBeInViewport();
  });

  test(`refund policy print keeps terms and contact without navigation or audio controls ${locale.language}`, async ({
    page
  }) => {
    await page.goto(route);
    await page.evaluate(() => {
      window.print = () => {
        document.documentElement.dataset['printRequested'] = 'true';
      };
    });
    await page.locator('[data-og7="print-policy"]').click();
    await expect(page.locator('html')).toHaveAttribute(
      'data-print-requested',
      'true'
    );
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('openg7-funding-header')).toBeHidden();
    await expect(page.locator('openg7-site-music')).toBeHidden();
    await expect(page.locator('[data-og7="policy-toc"]')).toBeHidden();
    await expect(page.locator('[data-og7="print-policy"]')).toBeHidden();
    for (const id of [
      'policy-title',
      'refund-request',
      'contributions',
      'payments',
      'refunds',
      'disputes',
      'sponsorships',
      'visibility',
      'privacy',
      'policy-contact'
    ]) {
      await expect(page.locator('#' + id)).toBeVisible();
    }
    await expect(page.locator('address')).toHaveText('contact@openg7.org');
    expect(
      await page
        .locator('body')
        .evaluate((element) => getComputedStyle(element).backgroundColor)
    ).toBe('rgb(255, 255, 255)');
    await page.emulateMedia({ media: 'screen' });
    await expect(page.locator('openg7-funding-header')).toBeVisible();
  });
}

test.describe('refund policy prerender without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  for (const locale of locales) {
    test(`keeps translated terms, email and anchors ${locale.language}`, async ({
      page
    }) => {
      const route = `${locale.prefix}/politique-utilisation-remboursement`;
      expect((await page.goto(route))?.status()).toBe(200);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        locale.title
      );
      await expect(page.locator('html')).toHaveAttribute(
        'lang',
        locale.language
      );
      await expect(page.locator('[data-og7="print-policy"]')).toHaveCount(0);
      await expect(
        page.locator('[data-og7="refund-policy"]')
      ).not.toContainText('funding.policyPage.');
      await expect(page.locator('[data-og7="refund-email"]')).toHaveAttribute(
        'href',
        'mailto:contact@openg7.org?subject=' +
          encodeURIComponent(locale.subject)
      );
      await page.locator('[data-og7="policy-toc"] a[href$="#refunds"]').click();
      await expect(page).toHaveURL(route + '#refunds');
      await expect(page.locator('#refunds')).toBeInViewport();
      await expect(
        page.getByRole('heading', {
          name:
            locale.language === 'en'
              ? 'Privacy and public data'
              : 'Confidentialité et données publiques'
        })
      ).toBeAttached();
    });
  }
});
