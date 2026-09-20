import { AxeBuilder } from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import type {
  SponsorshipFollowupResponse,
  SponsorshipDraftSnapshot
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';

const token = 'e2e-followup-fixture-local-only-000000000001';
const path = '/fonds-des-batisseurs/suivi-commandite';
const fixture = (): SponsorshipFollowupResponse => ({
  found: true,
  publicReference: 'CMD-LOCAL-101',
  paymentStatus: 'paid',
  reviewStatus: 'pending_review',
  amount: 250,
  currency: 'CAD',
  paidAt: '2026-09-18T12:00:00Z',
  sponsorshipTier: null,
  sponsorshipBenefits: ['website_mention'],
  detailsSubmitted: true,
  companyName: 'Atelier Boréal',
  contactName: 'Camille',
  contactEmail: 'camille@example.test',
  websiteUrl: 'https://example.test',
  logoUrl: null,
  message: null,
  reviewedAt: null
});
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body)
  });

async function mock(
  page: Page,
  options: {
    draft?: SponsorshipDraftSnapshot;
    current?: SponsorshipFollowupResponse;
    get?: (route: Route, count: number) => Promise<void>;
    post?: (route: Route) => Promise<void>;
  } = {}
) {
  let current = options.current ?? fixture();
  let reads = 0;
  let posts = 0;
  let draft: SponsorshipDraftSnapshot = options.draft ?? {
    revision: 0,
    data: null,
    updatedAt: null
  };
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/sponsorship-followup/draft') {
      if (route.request().method() === 'POST')
        draft = {
          revision: draft.revision + 1,
          data: route.request().postDataJSON().data,
          updatedAt: new Date().toISOString()
        };
      await json(route, draft);
    } else if (url.pathname === '/api/sponsorship-followup') {
      reads++;
      await (options.get ? options.get(route, reads) : json(route, current));
    } else if (url.pathname === '/api/sponsorship-followup/details') {
      posts++;
      draft = {
        revision: draft.revision + 1,
        data: null,
        updatedAt: new Date().toISOString()
      };
      if (options.post) await options.post(route);
      else {
        current = {
          ...current,
          ...route.request().postDataJSON(),
          reviewStatus: 'pending_review',
          detailsSubmitted: true
        };
        await json(route, { received: true, recorded: true });
      }
    } else if (url.pathname === '/api/sponsorship-followup/media') {
      await json(route, {
        assets: [],
        limits: {
          maxUploadBytes: 8 * 1024 * 1024,
          maxSupportingImages: 3,
          acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp']
        }
      });
    } else await json(route, {}, 503);
  });
  return { posts: () => posts, reads: () => reads, draft: () => draft };
}
async function visit(page: Page, english = false) {
  await page.goto((english ? '/en' : '') + path + '?token=' + token);
  await expect(
    page.getByRole('heading', {
      name: english ? 'Your sponsorship follow-up' : 'Suivi de votre commandite'
    })
  ).toBeVisible();
}
const save = (page: Page) =>
  page.getByRole('button', {
    name: 'Soumettre mes informations à l’équipe',
    exact: true
  });
const company = (page: Page) =>
  page.getByLabel("Nom de l'entreprise", { exact: false });

const draftStatus = (page: Page) =>
  page.locator('[data-og7="followup-draft-status"]');
const draftValues = (companyName: string) => ({
  companyName,
  contactName: 'Camille',
  contactEmail: 'camille@example.test',
  websiteUrl: '',
  logoUrl: '',
  message: ''
});

for (const english of [false, true]) {
  test(
    'the first field is on the initial mobile screen and the next step moves keyboard focus ' +
      (english ? 'EN' : 'FR') +
      ' @mobile',
    async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      const calls = await mock(page, {
        current: {
          ...fixture(),
          detailsSubmitted: false,
          companyName: null,
          contactName: null,
          contactEmail: null
        }
      });
      await visit(page, english);
      const firstField = page.getByLabel(
        english ? 'Company name' : "Nom de l'entreprise",
        { exact: false }
      );
      await expect(firstField).toBeEnabled();
      const fieldBox = await firstField.boundingBox();
      expect(fieldBox!.y + fieldBox!.height).toBeLessThan(844);
      const form = await page
        .getByRole('region', {
          name: english
            ? 'Sponsorship information'
            : 'Informations de commandite',
          exact: true
        })
        .boundingBox();
      const summary = await page
        .locator('[data-og7="followup-summary"]')
        .boundingBox();
      expect(summary!.y).toBeGreaterThan(form!.y + form!.height);
      const next = page.locator('[data-og7="followup-next-step"]');
      const complete = next.getByRole('button', {
        name: english ? 'Complete my information' : 'Compléter mes informations'
      });
      await complete.focus();
      await page.keyboard.press('Enter');
      await expect(firstField).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(
        page.getByLabel(english ? 'Contact name' : 'Nom du contact', {
          exact: false
        })
      ).toBeFocused();
      await firstField.fill('Atelier mobile');
      await expect(draftStatus(page)).toContainText(
        english ? 'Draft saved.' : 'Brouillon enregistré.'
      );
      expect(calls.posts()).toBe(0);
      const submit = page.getByRole('button', {
        name: english
          ? 'Submit my information to the team'
          : 'Soumettre mes informations à l’équipe',
        exact: true
      });
      await expect(submit).toHaveAccessibleDescription(
        english ? /Your draft stays private/ : /Votre brouillon reste privé/
      );
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
            .analyze()
        ).violations
      ).toEqual([]);
      await page.screenshot({
        path: test
          .info()
          .outputPath(
            'followup-first-action-' + (english ? 'en' : 'fr') + '.png'
          ),
        fullPage: true
      });
    }
  );
}

for (const scenario of [
  {
    paymentStatus: 'paid',
    reviewStatus: 'pending_review',
    detailsSubmitted: false,
    complete: true,
    message: 'Complétez votre fiche'
  },
  {
    paymentStatus: 'paid',
    reviewStatus: 'pending_review',
    detailsSubmitted: true,
    complete: false,
    message: 'Vos informations ont été soumises'
  },
  {
    paymentStatus: 'paid',
    reviewStatus: 'approved',
    detailsSubmitted: true,
    complete: false,
    message: 'Votre commandite est approuvée'
  },
  {
    paymentStatus: 'paid',
    reviewStatus: 'rejected',
    detailsSubmitted: false,
    complete: false,
    message: 'Contactez le support'
  },
  {
    paymentStatus: 'pending',
    reviewStatus: 'pending_review',
    detailsSubmitted: false,
    complete: false,
    message: 'Votre paiement est en cours de confirmation'
  }
] as const) {
  test(
    'next action follows server state: ' +
      scenario.paymentStatus +
      '/' +
      scenario.reviewStatus +
      '/' +
      scenario.detailsSubmitted,
    async ({ page }) => {
      await mock(page, {
        current: {
          ...fixture(),
          paymentStatus: scenario.paymentStatus,
          reviewStatus: scenario.reviewStatus,
          detailsSubmitted: scenario.detailsSubmitted
        }
      });
      await visit(page);
      const next = page.locator('[data-og7="followup-next-step"]');
      await expect(next).toContainText(scenario.message);
      await expect(
        next.getByRole('button', { name: 'Compléter mes informations' })
      ).toHaveCount(scenario.complete ? 1 : 0);
      await expect(
        next.getByRole('button', { name: 'Actualiser le statut' })
      ).toBeEnabled();
    }
  );
}

test('autosave survives reload without submitting an approved sponsorship', async ({
  page
}) => {
  const calls = await mock(page, {
    current: { ...fixture(), reviewStatus: 'approved' }
  });
  await visit(page);
  await page.getByRole('button', { name: 'Modifier mes informations' }).click();
  await company(page).fill('Brouillon privé');
  await expect(draftStatus(page)).toContainText('Brouillon enregistré.');
  expect(calls.posts()).toBe(0);
  await page.reload();
  await expect(company(page)).toHaveValue('Brouillon privé');
  await expect(company(page)).toBeEnabled();
  await expect(
    page.getByRole('heading', { name: 'Commandite acceptée' })
  ).toBeVisible();
  await save(page).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Informations enregistrées' })
  ).toBeVisible();
  expect(calls.posts()).toBe(1);
  expect(calls.draft().data).toBeNull();
  await expect(
    page.getByRole('button', { name: 'Abandonner les modifications' })
  ).toHaveCount(0);
});

test('autosave failure preserves input and manual retry persists it', async ({
  page
}) => {
  const calls = await mock(page);
  let fail = true;
  await page.route('**/api/sponsorship-followup/draft', async (route) => {
    if (route.request().method() === 'POST' && fail) await json(route, {}, 503);
    else await route.fallback();
  });
  await visit(page);
  await company(page).fill('Saisie conservée');
  await expect(draftStatus(page)).toContainText('n’a pas pu être sauvegardé');
  await expect(company(page)).toHaveValue('Saisie conservée');
  expect(calls.draft().data).toBeNull();
  fail = false;
  await draftStatus(page).getByRole('button', { name: 'Réessayer' }).click();
  await expect(draftStatus(page)).toContainText('Brouillon enregistré.');
  expect(calls.draft().data?.companyName).toBe('Saisie conservée');
});

test('a concurrent draft conflict preserves local input until explicit reload', async ({
  page
}) => {
  await mock(page);
  let conflict = false;
  await page.route('**/api/sponsorship-followup/draft**', async (route) => {
    if (route.request().method() === 'POST') {
      conflict = true;
      await json(route, { code: 'draft_conflict' }, 409);
    } else if (conflict)
      await json(route, {
        revision: 2,
        data: draftValues('Autre onglet'),
        updatedAt: new Date().toISOString()
      });
    else await route.fallback();
  });
  await visit(page);
  await company(page).fill('Mon onglet');
  await expect(draftStatus(page)).toContainText('autre onglet');
  await expect(company(page)).toHaveValue('Mon onglet');
  await expect(save(page)).toBeDisabled();
  await draftStatus(page)
    .getByRole('button', { name: 'Charger le brouillon sauvegardé' })
    .click();
  await expect(company(page)).toHaveValue('Autre onglet');
  await expect(company(page)).toBeEnabled();
});

test('edits during a slow autosave are serialized and the latest values win', async ({
  page
}) => {
  await mock(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writes: string[] = [];
  await page.route('**/api/sponsorship-followup/draft', async (route) => {
    if (route.request().method() === 'POST') {
      writes.push(route.request().postDataJSON().data.companyName);
      if (writes.length === 1) await gate;
    }
    await route.fallback();
  });
  await visit(page);
  await company(page).fill('Première saisie');
  await expect.poll(() => writes.length).toBe(1);
  await company(page).fill('Dernière saisie');
  release();
  await expect(draftStatus(page)).toContainText('Brouillon enregistré.');
  expect(writes).toEqual(['Première saisie', 'Dernière saisie']);
  await page.reload();
  await expect(company(page)).toHaveValue('Dernière saisie');
});

test('an expired access during autosave removes the private form and offers recovery', async ({
  page
}) => {
  await mock(page);
  await page.route('**/api/sponsorship-followup/draft', async (route) => {
    if (route.request().method() === 'POST')
      await json(route, { code: 'access' }, 404);
    else await route.fallback();
  });
  await visit(page);
  await company(page).fill('Données privées');
  await expect(page.locator('[data-og7="followup-recovery"]')).toBeVisible();
  await expect(company(page)).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem('openg7-sponsorship-followup-token')
    )
  ).toBeNull();
});

test('a late refresh cannot restore private information after access expires during autosave', async ({
  page
}) => {
  let releaseRead!: () => void;
  let releaseSave!: () => void;
  const readGate = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  const saveGate = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  let writing = false;
  let refreshing = false;
  await mock(page, {
    get: async (route, count) => {
      if (count > 1) {
        refreshing = true;
        await readGate;
      }
      await json(route, fixture());
    }
  });
  await page.route('**/api/sponsorship-followup/draft', async (route) => {
    if (route.request().method() === 'POST') {
      writing = true;
      await saveGate;
      await json(route, { code: 'access' }, 404);
    } else await route.fallback();
  });
  await visit(page);
  await company(page).fill('Saisie privée');
  await expect.poll(() => writing).toBe(true);
  await page.getByRole('button', { name: 'Actualiser le statut' }).click();
  await expect.poll(() => refreshing).toBe(true);
  releaseSave();
  await expect(page.locator('[data-og7="followup-recovery"]')).toBeVisible();
  const finished = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/sponsorship-followup'
  );
  releaseRead();
  await (await finished).finished();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
  await expect(company(page)).toHaveCount(0);
  await expect(page.locator('[data-og7="followup-recovery"]')).toBeVisible();
});

test('recovery validates the address and offers a retry after network failure', async ({
  page
}) => {
  await mock(page);
  let attempts = 0;
  await page.route('**/api/sponsorship-followup/recover', (route) =>
    ++attempts === 1
      ? route.abort('failed')
      : json(route, { accepted: true }, 202)
  );
  await page.goto(path);
  const recovery = page.locator('[data-og7="followup-recovery"]');
  await recovery.getByRole('button').click();
  await expect(recovery.getByRole('status')).toContainText(
    'adresse courriel valide'
  );
  expect(attempts).toBe(0);
  await recovery.locator('input').fill('payer@example.test');
  await recovery.getByRole('button').click();
  await expect(recovery.getByRole('status')).toContainText(
    'n’a pas pu être transmise'
  );
  await recovery.getByRole('button').click();
  await expect(recovery.getByRole('status')).toContainText('Si une commandite');
});

test('discarding an incomplete restored draft clears it on the server', async ({
  page
}) => {
  const calls = await mock(page, {
    draft: {
      revision: 1,
      data: { ...draftValues('Incomplet'), contactEmail: 'invalide' },
      updatedAt: null
    }
  });
  await visit(page);
  await expect(company(page)).toHaveValue('Incomplet');
  await page
    .getByRole('button', { name: 'Abandonner les modifications' })
    .click();
  await expect(company(page)).toHaveValue('Atelier Boréal');
  expect(calls.draft().data).toBeNull();
  expect(calls.posts()).toBe(0);
});

for (const english of [false, true]) {
  test(
    'missing access offers email recovery with a uniform response ' +
      (english ? 'EN' : 'FR'),
    async ({ page }) => {
      await mock(page);
      let received: Record<string, unknown> = {};
      await page.route('**/api/sponsorship-followup/recover', async (route) => {
        received = route.request().postDataJSON();
        await json(route, { accepted: true }, 202);
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto((english ? '/en' : '') + path);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        english ? 'Access my sponsorship' : 'Accéder à ma commandite'
      );
      const recovery = page.locator('[data-og7="followup-recovery"]');
      const inputBox = await recovery.locator('input').boundingBox();
      const buttonBox = await recovery.getByRole('button').boundingBox();
      expect(buttonBox!.y).toBeGreaterThan(inputBox!.y + inputBox!.height);
      expect(buttonBox!.y + buttonBox!.height).toBeLessThan(844);
      await recovery.locator('input').fill('absent@example.test');
      await recovery.getByRole('button').click();
      await expect(recovery.getByRole('status')).toContainText(
        english ? 'If a sponsorship' : 'Si une commandite'
      );
      expect(received).toEqual({
        email: 'absent@example.test',
        locale: english ? 'en' : 'fr-CA'
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true);
    }
  );
}

test('an unavailable service is retryable and never reported as an invalid link', async ({
  page
}) => {
  await mock(page, {
    get: (route, count) => json(route, fixture(), count === 1 ? 503 : 200)
  });
  await visit(page);
  await expect(page.getByRole('alert')).toContainText(
    'temporairement indisponible'
  );
  await expect(
    page.getByRole('heading', { name: 'Lien introuvable' })
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Réessayer', exact: true }).click();
  await expect(company(page)).toHaveValue('Atelier Boréal');
});

test('refresh confirms pending payment from the server and preserves typed details', async ({
  page
}) => {
  await mock(page, {
    get: (route, count) =>
      json(route, {
        ...fixture(),
        paymentStatus: count === 1 ? 'pending' : 'paid'
      })
  });
  await visit(page);
  await expect(company(page)).toBeDisabled();
  await page.getByRole('button', { name: 'Actualiser le statut' }).click();
  await expect(company(page)).toBeEnabled();
  await company(page).fill('Mon brouillon');
  await page.getByRole('button', { name: 'Actualiser le statut' }).click();
  await expect(company(page)).toHaveValue('Mon brouillon');
});

test('a confirmed save stays saved when refresh fails and cannot be submitted twice', async ({
  page
}) => {
  let releaseRead: (() => void) | undefined;
  const readGate = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  const calls = await mock(page, {
    get: async (route, count) => {
      if (count > 1) {
        await readGate;
        await json(route, {}, 503);
      } else await json(route, { ...fixture(), detailsSubmitted: false });
    }
  });
  await visit(page);
  await company(page).fill('Nouveau nom');
  await save(page).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Informations enregistrées' })
  ).toBeVisible();
  await expect(company(page)).toBeDisabled();
  await page.locator('form').evaluate((form) => {
    form.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
  });
  expect(calls.posts()).toBe(1);
  releaseRead!();
  await expect(page.getByRole('alert')).toContainText('actualisation a échoué');
  await expect(page.locator('[data-og7="followup-next-step"]')).toContainText(
    'Vos informations ont été soumises'
  );
  await expect(
    page.getByRole('button', { name: 'Compléter mes informations' })
  ).toHaveCount(0);
  await expect(company(page)).toHaveValue('Nouveau nom');
  await expect(save(page)).toBeDisabled();
  await expect(
    page.getByRole('status').filter({ hasText: 'Informations enregistrées' })
  ).toBeVisible();
});

test('a pending POST cannot be submitted twice and the confirmed draft becomes pristine', async ({
  page
}) => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calls = await mock(page, {
    post: async (route) => {
      await gate;
      await json(route, { received: true, recorded: true });
    },
    get: (route, count) =>
      json(route, {
        ...fixture(),
        companyName: count === 1 ? 'Atelier Boréal' : 'Nouveau nom'
      })
  });
  await visit(page);
  await company(page).fill('Nouveau nom');
  await save(page).click();
  await expect(company(page)).toBeDisabled();
  await page
    .locator('form')
    .evaluate((form) =>
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      )
    );
  expect(calls.posts()).toBe(1);
  release!();
  await expect(save(page)).toBeDisabled();
  await expect(company(page)).toHaveValue('Nouveau nom');
});

test('recorded false preserves the draft and permits a retry without a success message', async ({
  page
}) => {
  let attempt = 0;
  const calls = await mock(page, {
    post: (route) => json(route, { received: true, recorded: ++attempt > 1 })
  });
  await visit(page);
  await company(page).fill('Brouillon non enregistré');
  await save(page).click();
  await expect(page.getByRole('alert')).toContainText('n’a pas confirmé');
  await expect(company(page)).toHaveValue('Brouillon non enregistré');
  await expect(
    page.getByRole('status').filter({ hasText: 'Informations enregistrées' })
  ).toHaveCount(0);
  await save(page).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Informations enregistrées' })
  ).toBeVisible();
  expect(calls.posts()).toBe(2);
});

test('network failure on save preserves the draft and permits a retry', async ({
  page
}) => {
  let attempt = 0;
  await mock(page, {
    post: (route) =>
      ++attempt === 1
        ? route.abort('failed')
        : json(route, { received: true, recorded: true })
  });
  await visit(page);
  await company(page).fill('Brouillon réseau');
  await save(page).click();
  await expect(page.getByRole('alert')).toContainText(
    'enregistrement a échoué'
  );
  await expect(company(page)).toHaveValue('Brouillon réseau');
  await save(page).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Informations enregistrées' })
  ).toBeVisible();
});

test('approved sponsorship requires explicit editing; unchanged information is never resubmitted', async ({
  page
}) => {
  const calls = await mock(page, {
    current: { ...fixture(), reviewStatus: 'approved' }
  });
  await visit(page);
  await expect(company(page)).toBeDisabled();
  await expect(page.locator('[data-og7="followup-publication"]')).toContainText(
    'ne confirme ni planification ni publication'
  );
  await page.getByRole('button', { name: 'Modifier mes informations' }).click();
  await expect(company(page)).toBeEnabled();
  await expect(save(page)).toBeDisabled();
  await expect(
    page.getByText('Soumettre une modification remettra', { exact: false })
  ).toBeVisible();
  await company(page).fill('Atelier modifié');
  await page.getByRole('button', { name: 'Annuler la saisie' }).click();
  await expect(company(page)).toHaveValue('Atelier Boréal');
  expect(calls.posts()).toBe(0);
  await page.getByRole('button', { name: 'Modifier mes informations' }).click();
  await company(page).fill('Atelier modifié');
  await save(page).click();
  await expect(
    page.getByRole('heading', { name: 'Commandite acceptée' })
  ).toHaveCount(0);
  expect(calls.posts()).toBe(1);
});

for (const [status, label] of [
  ['failed', 'Échoué'],
  ['expired', 'Expiré'],
  ['refunded', 'Remboursé'],
  ['disputed', 'En litige']
]) {
  test(
    'payment ' + status + ' has its own message and never claims to be pending',
    async ({ page }) => {
      await mock(page, { current: { ...fixture(), paymentStatus: status! } });
      await visit(page);
      await expect(
        page.getByRole('heading', { name: label!, exact: true })
      ).toBeVisible();
      await expect(
        page.getByText('Paiement en confirmation', { exact: false })
      ).toHaveCount(0);
    }
  );
}

test('required errors wait for submission and lead keyboard focus to the first invalid field', async ({
  page
}) => {
  const calls = await mock(page, {
    current: {
      ...fixture(),
      detailsSubmitted: false,
      companyName: null,
      contactName: null,
      contactEmail: null
    }
  });
  await visit(page);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await save(page).click();
  await expect(company(page)).toBeFocused();
  await expect(page.getByRole('alert')).toContainText(
    'Vérifiez les champs suivants'
  );
  await company(page).fill('   ');
  await save(page).click();
  expect(calls.posts()).toBe(0);
  await page
    .getByRole('link', { name: /Courriel du contact : ce champ est requis/ })
    .click();
  await expect(page.getByLabel('Courriel du contact')).toBeFocused();
});

test('expired access clears the displayed record and token instead of retaining private information', async ({
  page
}) => {
  await mock(page, {
    get: (route, count) => json(route, fixture(), count === 1 ? 200 : 404)
  });
  await visit(page);
  await expect(company(page)).toBeVisible();
  await page.getByRole('button', { name: 'Actualiser le statut' }).click();
  await expect(
    page.getByRole('heading', { name: 'Lien introuvable' })
  ).toBeVisible();
  await expect(company(page)).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem('openg7-sponsorship-followup-token')
    )
  ).toBeNull();
});

test('an explicit invalid token never opens a different record from session storage', async ({
  page
}) => {
  const calls = await mock(page);
  await visit(page);
  await expect(company(page)).toBeVisible();
  await page.goto(path + '?token=invalid');
  await expect(
    page.getByRole('heading', { name: 'Lien introuvable' })
  ).toBeVisible();
  expect(calls.reads()).toBe(1);
});

test('English mobile follow-up is translated and language navigation keeps the same record without exposing the token', async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mock(page);
  await visit(page, true);
  await expect(page.getByLabel('Company name')).toHaveValue('Atelier Boréal');
  await expect(
    page.getByRole('heading', { name: 'Logo and presentation photos' })
  ).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: 'Submit my information to the team',
      exact: true
    })
  ).toBeVisible();
  expect(new URL(page.url()).searchParams.has('token')).toBe(false);
  await page.screenshot({
    path: test.info().outputPath('followup-mobile-en.png'),
    fullPage: true
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
  await page
    .getByRole('button', { name: 'Changer la langue du site vers le français' })
    .click();
  await expect(page).toHaveURL(new RegExp(path + '$'));
  await expect(company(page)).toHaveValue('Atelier Boréal');
  await page.reload();
  await expect(company(page)).toHaveValue('Atelier Boréal');
});

test('a rejected sponsorship keeps details and uploads disabled', async ({
  page
}) => {
  await mock(page, { current: { ...fixture(), reviewStatus: 'rejected' } });
  await visit(page);
  await expect(
    page.getByRole('heading', { name: 'Commandite refusée' })
  ).toBeVisible();
  await expect(company(page)).toBeDisabled();
  await expect(
    page.getByLabel('Ajouter des photos', { exact: true })
  ).toBeDisabled();
  await expect(save(page)).toBeDisabled();
});

test('server validation failure preserves the record and draft for correction', async ({
  page
}) => {
  await mock(page, {
    post: (route) => json(route, { error: 'Invalid field' }, 400)
  });
  await visit(page);
  await company(page).fill('À corriger');
  await save(page).click();
  await expect(page.getByRole('alert')).toContainText(
    'enregistrement a échoué'
  );
  await expect(company(page)).toHaveValue('À corriger');
  await expect(
    page.getByRole('heading', { name: 'Lien introuvable' })
  ).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem('openg7-sponsorship-followup-token')
    )
  ).toBe(token);
});

test('native autofill is synchronized before saving even without input events', async ({
  page
}) => {
  let received: Record<string, unknown> = {};
  await mock(page, {
    current: { ...fixture(), detailsSubmitted: false },
    post: async (route) => {
      received = route.request().postDataJSON();
      await json(route, { received: true, recorded: true });
    }
  });
  await visit(page);
  await company(page).evaluate((input: HTMLInputElement) => {
    input.value = 'Nom rempli par le navigateur';
  });
  await save(page).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Informations enregistrées' })
  ).toBeVisible();
  expect(received.companyName).toBe('Nom rempli par le navigateur');
});

test('media uses server limits, preserves uploads after refresh failure and confirms deletion', async ({
  page
}) => {
  await mock(page);
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  );
  let uploaded = false;
  let deleted = false;
  let reloadFails = true;
  let posts = 0;
  let deletes = 0;
  const asset = {
    id: 'media-local-1',
    kind: 'supporting_image',
    reviewStatus: 'pending_review',
    altText: 'Atelier',
    width: 1,
    height: 1,
    processedSizeBytes: png.length,
    version: 'v1'
  };
  await page.route('**/api/sponsorship-followup/media**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/delete')) {
      deletes++;
      deleted = true;
      await json(route, { deleted: true, assetId: asset.id });
    } else if (url.pathname.includes('/content/'))
      await route.fulfill({ contentType: 'image/png', body: png });
    else if (route.request().method() === 'POST') {
      posts++;
      uploaded = true;
      await json(route, { asset });
    } else if (uploaded && reloadFails) await json(route, {}, 503);
    else
      await json(route, {
        assets: uploaded && !deleted ? [asset] : [],
        limits: {
          maxUploadBytes: 1024,
          maxSupportingImages: 1,
          acceptedMimeTypes: ['image/png']
        }
      });
  });
  await visit(page);
  const input = page.getByLabel('Ajouter des photos', { exact: true });
  await expect(input).toBeEnabled();
  await input.setInputFiles([
    { name: 'invalid.gif', mimeType: 'image/gif', buffer: png },
    { name: 'atelier.png', mimeType: 'image/png', buffer: png }
  ]);
  await expect(
    page.getByRole('alert').filter({ hasText: 'Les médias' })
  ).toBeVisible();
  expect(posts).toBe(1);
  await expect(
    page
      .locator('[data-og7="media-upload-attempt"]')
      .filter({ hasText: 'atelier.png' })
  ).toContainText('Téléversement réussi');
  reloadFails = false;
  await page.getByRole('button', { name: 'Réessayer', exact: true }).click();
  await expect(page.locator('[data-og7="followup-media"]')).toHaveCount(1);
  await expect(
    page
      .locator('[data-og7="media-upload-attempt"]')
      .filter({ hasText: 'atelier.png' })
  ).toHaveCount(0);
  await expect(input).toBeDisabled();
  await expect(
    page.getByRole('img', { name: 'Atelier', exact: true })
  ).toBeVisible();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page
    .getByRole('button', { name: 'Retirer Photo de présentation' })
    .click();
  expect(deletes).toBe(0);
  page.once('dialog', (dialog) => dialog.accept());
  await page
    .getByRole('button', { name: 'Retirer Photo de présentation' })
    .click();
  await expect(page.locator('[data-og7="followup-media"]')).toHaveCount(0);
  await expect(input).toBeEnabled();
  expect(deletes).toBe(1);
});

test('desktop layout supports the form without horizontal overflow', async ({
  page
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mock(page);
  await visit(page);
  await expect(company(page)).toBeEnabled();
  const form = await page
    .getByRole('region', { name: 'Informations de commandite', exact: true })
    .boundingBox();
  const summary = await page
    .locator('[data-og7="followup-summary"]')
    .boundingBox();
  expect(summary!.x).toBeGreaterThan(form!.x + form!.width);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath('followup-desktop-fr.png'),
    fullPage: true
  });
});

test('a pristine form refreshes from the server after saving and can intentionally restore an earlier value', async ({
  page
}) => {
  let current = fixture();
  const calls = await mock(page, {
    get: (route) => json(route, current),
    post: async (route) => {
      current = { ...current, ...route.request().postDataJSON() };
      await json(route, { received: true, recorded: true });
    }
  });
  await visit(page);
  await company(page).fill('Premier changement');
  await save(page).click();
  await expect(save(page)).toBeDisabled();
  current = { ...current, companyName: 'Correction externe' };
  await page.getByRole('button', { name: 'Actualiser le statut' }).click();
  await expect(company(page)).toHaveValue('Correction externe');
  await expect(save(page)).toBeDisabled();
  await company(page).fill('Premier changement');
  await save(page).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Informations enregistrées' })
  ).toBeVisible();
  expect(calls.posts()).toBe(2);
});
