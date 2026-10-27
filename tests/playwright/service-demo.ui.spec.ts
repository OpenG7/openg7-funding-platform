import type { Locator, Page } from '@playwright/test';

import { expect, test } from './support/test.js';

const base = '/demo/prestations';
const dossier = `${base}/dossier/atelier-boreal`;
const editedText =
  'Atelier Boréal : un partenariat au service de notre communauté.';

async function expectSingleLineText(
  label: Locator,
  container = label
): Promise<void> {
  const text = await label.evaluate((element) => {
    const range = element.ownerDocument.createRange();
    range.selectNodeContents(element);
    const lines = new Set(
      Array.from(range.getClientRects())
        .filter((rectangle) => rectangle.width > 0)
        .map((rectangle) => Math.round(rectangle.top))
    );
    const bounds = range.getBoundingClientRect();
    return { lines: lines.size, left: bounds.left, right: bounds.right };
  });
  const box = await container.boundingBox();
  expect(box).not.toBeNull();
  expect(text.lines).toBe(1);
  expect(text.left).toBeGreaterThanOrEqual(box!.x - 1);
  expect(text.right).toBeLessThanOrEqual(box!.x + box!.width + 1);
}

async function acceptLocalWorkLoss(
  page: Page,
  navigate: () => Promise<unknown>
): Promise<void> {
  await Promise.all([
    page.waitForEvent('dialog').then(async (dialog) => {
      expect(dialog.type()).toBe('beforeunload');
      await dialog.accept();
    }),
    navigate()
  ]);
}

async function openLocalProof(page: Page): Promise<void> {
  await page.locator('[data-og7="service-demo-more"]').click();
  await page
    .getByRole('link', { name: 'Preuves de réalisation', exact: true })
    .click();
  await page.locator('a[href$="/preuve"]').first().click();
  await expect(
    page.locator('[data-og7="service-demo-detail"][data-og7-id="preuve"]')
  ).toBeVisible();
}

test('explore un dossier et conserve le brouillon entre les onglets', async ({
  page
}) => {
  const errors: string[] = [];
  const apiRequests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) {
      apiRequests.push(
        request.method() + ' ' + new URL(request.url()).pathname
      );
    }
  });

  await page.goto(base);
  await expect(page.locator('[data-og7="service-demo-list"]')).toBeVisible();
  await page
    .locator(
      '[data-og7="service-demo-open-dossier"][data-og7-id="atelier-boreal"]'
    )
    .click();
  await expect(page).toHaveURL(new RegExp(`${dossier}$`));
  await page
    .locator('[data-og7="service-demo-step"][data-og7-id="contenu"]')
    .click();
  await page.locator(`a[href="${dossier}/corriger/texte"]`).first().click();
  await page.locator('[data-og7="service-demo-editor-text"]').fill(editedText);
  await expect(page.locator('[data-og7="service-demo-preview"]')).toContainText(
    editedText
  );

  await page
    .locator('[data-og7="service-demo-editor-tab"][data-og7-id="image"]')
    .click();
  await page
    .getByRole('checkbox', { name: 'Afficher l’image dans l’aperçu' })
    .uncheck();
  await expect(
    page.locator('[data-og7="service-demo-preview"] img')
  ).toHaveCount(0);
  await page
    .locator('[data-og7="service-demo-editor-tab"][data-og7-id="liens"]')
    .click();
  await page
    .getByRole('textbox', { name: 'Lien associé au brouillon' })
    .fill('https://example.test/partenariat');
  await page
    .locator('[data-og7="service-demo-editor-tab"][data-og7-id="texte"]')
    .click();
  await expect(
    page.locator('[data-og7="service-demo-editor-text"]')
  ).toHaveValue(editedText);
  await page.locator('[data-og7="service-demo-editor-save"]').click();
  await expect(
    page.locator('[data-og7="service-demo-editor-saved"]')
  ).toBeVisible();
  await page
    .getByRole('link', { name: 'Revenir au contenu', exact: true })
    .click();
  await expect(page.locator('[data-og7="service-demo-preview"]')).toContainText(
    editedText
  );
  await expect(page.locator('[data-og7="service-demo-preview"]')).toContainText(
    'https://example.test/partenariat'
  );
  await expect(
    page.locator('[data-og7="service-demo-preview"] img')
  ).toHaveCount(0);
  expect(apiRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test('représente la recherche et les filtres dans l’URL et affiche le vide', async ({
  page
}) => {
  await page.goto(base);
  await expect(
    page.locator('[data-og7="service-demo-open-dossier"]')
  ).toHaveCount(3);
  const search = page.locator('[data-og7="service-demo-search"]');
  await search.pressSequentially('Boréal', { delay: 50 });
  await expect(search).toHaveValue('Boréal');
  await expect(search).toBeFocused();
  await expect(
    page.locator('[data-og7="service-demo-open-dossier"]')
  ).toHaveCount(1);
  await page.locator('[data-og7="service-demo-search"]').fill('zzzintrouvable');
  await expect(page).toHaveURL(/q=zzzintrouvable/);
  await expect(
    page.locator('[data-og7="service-demo-open-dossier"]')
  ).toHaveCount(0);
  await expect(
    page.getByRole('status').filter({ hasText: /Aucun|Aucune/ })
  ).toBeVisible();
  await page.locator('[data-og7="service-demo-search"]').fill('');
  await expect(
    page.locator('[data-og7="service-demo-open-dossier"]')
  ).toHaveCount(3);
  await page
    .locator('[data-og7="service-demo-filter"][data-og7-id="autorisation"]')
    .click();
  await expect(page).toHaveURL(/etat=autorisation/);
  await expect(
    page.locator('[data-og7="service-demo-open-dossier"]')
  ).toHaveCount(1);
  await page.locator('[data-og7="service-demo-open-dossier"]').click();
  await expect(page).toHaveURL(/dossier\/collectif-rivages$/);
  await page.goBack();
  await expect(page).toHaveURL(/etat=autorisation/);
  await expect(
    page.locator('[data-og7="service-demo-open-dossier"]')
  ).toHaveCount(1);
  await expect(
    page.locator('[data-og7="service-demo-open-dossier"]')
  ).toHaveText(/Collectif Rivages/);
  await page.reload();
  await expect(
    page.locator('[data-og7="service-demo-filter"][data-og7-id="autorisation"]')
  ).toHaveAttribute('aria-current', 'page');
  await expect(
    page.locator('[data-og7="service-demo-open-dossier"]')
  ).toHaveCount(1);
});

test('restaure une sélection d’historique et permet les filtres sans publication fictive', async ({
  page
}) => {
  await page.goto(`${dossier}/historique?filtre=commentaires&version=c1`);
  await expect(
    page.locator(
      '[data-og7="service-demo-history-filter"][data-og7-id="commentaires"]'
    )
  ).toHaveAttribute('aria-current', 'page');
  await expect(
    page.locator('[data-og7="service-demo-history-event"]')
  ).toHaveCount(1);
  await expect(
    page.locator('[data-og7="service-demo-history-event"][data-og7-id="c1"]')
  ).toHaveAttribute('aria-current', 'true');
  await page
    .locator('[data-og7="service-demo-history-filter"][data-og7-id="tout"]')
    .click();
  await page
    .locator('[data-og7="service-demo-history-event"][data-og7-id="v1"]')
    .click();
  await expect(page).toHaveURL(/version=v1/);
  await page.reload();
  await expect(
    page.locator('[data-og7="service-demo-history-event"][data-og7-id="v1"]')
  ).toHaveAttribute('aria-current', 'true');
  await page
    .locator(
      '[data-og7="service-demo-history-filter"][data-og7-id="publications"]'
    )
    .click();
  await expect(
    page.locator('[data-og7="service-demo-history-event"]')
  ).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Aucune publication dans cet exemple' })
  ).toBeVisible();
});

test('ouvre les liens profonds, conserve les confirmations sans effet et change de langue', async ({
  page
}, testInfo) => {
  const apiRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/'))
      apiRequests.push(request.url());
  });
  const response = await page.goto(`${dossier}/autorisation`);
  expect(response?.status()).toBe(200);
  await expect(
    page.locator('[data-og7="service-demo-autorisation"]')
  ).toBeVisible();
  await page.reload();
  await expect(
    page.locator('[data-og7="service-demo-step"][data-og7-id="autorisation"]')
  ).toHaveAttribute('aria-current', 'step');
  await page.screenshot({
    path: testInfo.outputPath('autorisation.png'),
    fullPage: true
  });
  await page.locator(`a[href="${dossier}/accord-recu"]`).first().click();
  await expect(
    page.locator('[data-og7="service-demo-detail"][data-og7-id="accord-recu"]')
  ).toBeVisible();
  await expect(
    page.getByText('contact@example.test', { exact: true })
  ).toBeVisible();
  await page.locator(`a[href="${dossier}/autorisation"]`).first().click();
  await page.locator('[data-og7="service-demo-next"]').click();
  await expect(
    page.locator(
      '[data-og7="service-demo-detail"][data-og7-id="confirmer-autorisation"]'
    )
  ).toBeVisible();
  await expect(
    page.locator('[data-og7="service-demo-detail"] button[disabled]')
  ).toHaveCount(1);
  await page.locator('[data-og7="service-demo-language"]').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#service-demo-heading')).not.toContainText(
    'serviceDemo'
  );
  await expect(page.locator('#service-demo-heading')).not.toHaveText(
    /autorisation/i
  );
  await page
    .locator('[data-og7="service-demo-step"][data-og7-id="contenu"]')
    .click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#service-demo-heading')).not.toContainText(
    'serviceDemo'
  );
  await page.locator('[data-og7="service-demo-language"]').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr-CA');
  expect(apiRequests).toEqual([]);
});

test('restaure le focus du menu et garde l’action principale dans le viewport desktop', async ({
  page
}, testInfo) => {
  await page.goto(`${dossier}/autorisation`);
  const toggle = page.locator('[data-og7="service-demo-more"]');
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Tab');
  await expect(page.locator('#service-demo-more a').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeFocused();
  if (testInfo.project.name === 'chromium') {
    const action = page.locator('[data-og7="service-demo-next"]');
    const box = await action.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(
      page.viewportSize()!.height
    );
  }
});

test('garde le formulaire et ses actions accessibles sans débordement horizontal', async ({
  page
}, testInfo) => {
  await page.goto(`${dossier}/corriger/texte`);
  await expect(
    page.locator('[data-og7="service-demo-editor-text"]')
  ).toBeVisible();
  await page.locator('[data-og7="service-demo-editor-text"]').focus();
  await expect(
    page.locator('[data-og7="service-demo-editor-text"]')
  ).toBeFocused();
  await page.keyboard.type(' Exemple local.');
  await page.locator('[data-og7="service-demo-editor-save"]').click();
  await expect(
    page.locator('[data-og7="service-demo-editor-saved"]')
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('editeur.png'),
    fullPage: true
  });
});

test('renvoie 404 pour les dossiers et destinations inconnus', async ({
  page
}) => {
  for (const path of [
    `${base}/dossier/inconnu/contenu`,
    `${dossier}/inconnu`,
    `${dossier}/corriger/inconnu`
  ]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole('heading', { name: /introuvable/i }).first()
    ).toBeVisible();
  }
});

test('parcourt les destinations de détail sans erreur ni traduction manquante', async ({
  page
}) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  const apiRequests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/'))
      apiRequests.push(request.url());
  });
  const destinations = [
    'apercu',
    'preuves',
    'accord',
    'controle',
    'proposition',
    'comparer',
    'commentaire',
    'demander-correction',
    'demander-accord',
    'preuve',
    'accord-recu',
    'conditions',
    'contact',
    'planifier',
    'confirmer-envoi',
    'resultat',
    'reconcilier',
    'attester',
    'web',
    'confirmer-visibilite',
    'approuver-preparation',
    'autres-actions',
    'quitter',
    'conflit',
    'indisponible',
    'medias',
    'guide',
    'destinations',
    'filtres',
    'retablir',
    'annuler-autorisation',
    'apercu-envoi',
    'confirmer-autorisation'
  ];
  for (const destination of destinations) {
    const response = await page.goto(`${dossier}/${destination}`);
    expect(response?.status(), destination).toBe(200);
    await expect(
      page.locator(
        `[data-og7="service-demo-detail"][data-og7-id="${destination}"]`
      )
    ).toBeVisible();
    await expect(page.locator('[data-og7="service-demo"]')).not.toContainText(
      /serviceDemo(?:Editor|Detail|History)?\./
    );
  }
  expect(errors).toEqual([]);
  expect(apiRequests).toEqual([]);
});

test('conserve l’horaire dans le récapitulatif et initialise les autres dossiers', async ({
  page
}, testInfo) => {
  await page.goto(`${dossier}/planifier`);
  await page.getByLabel('Date et heure locales').fill('2026-11-05T15:30');
  await page.getByLabel('Fuseau horaire').selectOption('Europe/Paris');
  await page
    .getByRole('link', { name: 'Voir le récapitulatif d’envoi' })
    .click();
  await expect(page.locator('[data-og7="service-demo-detail"]')).toContainText(
    '2026-11-05 · 15:30'
  );
  await expect(page.locator('[data-og7="service-demo-detail"]')).toContainText(
    'Europe/Paris'
  );
  await page.screenshot({
    path: testInfo.outputPath('recapitulatif.png'),
    fullPage: true
  });
  await acceptLocalWorkLoss(page, () =>
    page.goto(`${base}/dossier/collectif-rivages/contenu`)
  );
  await expect(page.locator('[data-og7="service-demo-preview"]')).toContainText(
    'Collectif Rivages'
  );
  await expect(
    page.locator('[data-og7="service-demo-preview"]')
  ).not.toContainText('Atelier Boréal');
  await page.goto(`${base}/dossier/studio-canopée/corriger`);
  await expect(page).toHaveURL(/studio-canop%C3%A9e\/corriger\/texte$/);
  await expect(
    page.locator('[data-og7="service-demo-editor-text"]')
  ).toHaveValue(/Studio Canopée/);
  await expect(page.locator('[data-og7="service-demo-preview"]')).toContainText(
    'Studio Canopée'
  );
});

test('revient à la publication après l’aperçu ouvert depuis le pied de page', async ({
  page
}) => {
  await page.goto(`${dossier}/publication`);
  await page
    .getByRole('link', { name: 'Voir le contenu exact', exact: true })
    .last()
    .click();
  await expect(page).toHaveURL(/\/apercu\?origine=publication$/);
  await page.locator('[data-og7="service-demo-back"]').click();
  await expect(page).toHaveURL(/\/publication(?:\?|$)/);
  await expect(
    page.locator('[data-og7="service-demo-step"][data-og7-id="publication"]')
  ).toHaveAttribute('aria-current', 'step');
});

test('garde un brouillon distinct par dossier pendant la visite puis le réinitialise au rechargement', async ({
  page
}) => {
  const apiRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/'))
      apiRequests.push(request.url());
  });
  await page.goto(`${dossier}/corriger/texte`);
  await page.locator('[data-og7="service-demo-editor-text"]').fill(editedText);
  await page
    .locator('[data-og7="service-demo-editor-tab"][data-og7-id="liens"]')
    .click();
  await page
    .getByLabel('Lien associé au brouillon')
    .fill('https://example.test/boreal-local');
  await page
    .locator('[data-og7="service-demo-editor-tab"][data-og7-id="mentions"]')
    .click();
  await page.getByLabel('Mention à examiner').fill('@AtelierDémo');
  await page
    .locator('[data-og7="service-demo-editor-tab"][data-og7-id="image"]')
    .click();
  await page.getByLabel('Afficher l’image dans l’aperçu').uncheck();
  await page
    .locator('[data-og7="service-demo-editor-tab"][data-og7-id="options"]')
    .click();
  await page
    .getByLabel('Afficher le lien du brouillon sous l’aperçu')
    .uncheck();
  await page.locator('[data-og7="service-demo-editor-save"]').click();
  await page
    .locator('[data-og7="service-demo-step"][data-og7-id="publication"]')
    .click();
  await page.locator(`a[href="${dossier}/planifier"]`).first().click();
  await page.getByLabel('Date et heure locales').fill('2026-11-06T09:15');
  await page.getByLabel('Fuseau horaire').selectOption('Europe/Paris');
  await page
    .getByRole('link', { name: 'Prestations de services', exact: true })
    .click();
  await expect(
    page.locator(
      '[data-og7="service-demo-draft-badge"][data-og7-id="atelier-boreal"]'
    )
  ).toBeVisible();
  await page
    .locator(
      '[data-og7="service-demo-open-dossier"][data-og7-id="collectif-rivages"]'
    )
    .click();
  await expect(
    page.locator('[data-og7="service-demo-preview"]')
  ).not.toContainText(editedText);
  await expect(
    page.locator('[data-og7="service-demo-preview"] img')
  ).toHaveCount(1);
  await page
    .locator('[data-og7="service-demo-step"][data-og7-id="contenu"]')
    .click();
  await page
    .getByRole('link', { name: 'Corriger le contenu', exact: true })
    .click();
  await page
    .locator('[data-og7="service-demo-editor-text"]')
    .fill('Texte distinct du Collectif Rivages.');
  await page
    .getByRole('link', { name: 'Prestations de services', exact: true })
    .click();
  await page
    .locator(
      '[data-og7="service-demo-open-dossier"][data-og7-id="atelier-boreal"]'
    )
    .click();
  const preview = page.locator('[data-og7="service-demo-preview"]');
  await expect(preview).toContainText(editedText);
  await expect(preview).toContainText('@AtelierDémo');
  await expect(preview).not.toContainText(
    'Texte distinct du Collectif Rivages.'
  );
  await expect(preview.locator('img')).toHaveCount(0);
  await expect(preview).not.toContainText('https://example.test/boreal-local');
  await page
    .locator('[data-og7="service-demo-step"][data-og7-id="contenu"]')
    .click();
  await page
    .getByRole('link', { name: 'Corriger le contenu', exact: true })
    .click();
  await page
    .locator('[data-og7="service-demo-editor-tab"][data-og7-id="liens"]')
    .click();
  await expect(page.getByLabel('Lien associé au brouillon')).toHaveValue(
    'https://example.test/boreal-local'
  );
  await page
    .locator('[data-og7="service-demo-editor-tab"][data-og7-id="options"]')
    .click();
  await expect(
    page.getByLabel('Afficher le lien du brouillon sous l’aperçu')
  ).not.toBeChecked();
  await page
    .locator('[data-og7="service-demo-step"][data-og7-id="publication"]')
    .click();
  await page.locator(`a[href="${dossier}/planifier"]`).first().click();
  await expect(page.getByLabel('Date et heure locales')).toHaveValue(
    '2026-11-06T09:15'
  );
  await expect(page.getByLabel('Fuseau horaire')).toHaveValue('Europe/Paris');
  await acceptLocalWorkLoss(page, () => page.reload());
  await expect(page.getByLabel('Date et heure locales')).toHaveValue(
    '2026-10-28T10:00'
  );
  await expect(page.getByLabel('Fuseau horaire')).toHaveValue(
    'America/Toronto'
  );
  await expect(
    page.locator('[data-og7="service-demo-preview"]')
  ).not.toContainText(editedText);
  expect(apiRequests).toEqual([]);
});

test('recherche sans accents, retire les filtres et retrouve la liste filtrée au retour', async ({
  page
}) => {
  await page.goto(base);
  const search = page.locator('[data-og7="service-demo-search"]');
  await search.pressSequentially('boreal', { delay: 35 });
  await expect(search).toBeFocused();
  await expect(
    page.locator('[data-og7="service-demo-open-dossier"]')
  ).toHaveCount(1);
  await expect(
    page.locator('[data-og7="service-demo-open-dossier"]')
  ).toHaveText(/Atelier Boréal/);
  await search.fill('canopee');
  await expect(
    page.locator('[data-og7="service-demo-open-dossier"]')
  ).toHaveText(/Studio Canopée/);
  await page.locator('[data-og7="service-demo-reset-filters"]').click();
  await expect(search).toHaveValue('');
  await expect(page).toHaveURL(new RegExp(`${base}$`));
  await expect(
    page.locator('[data-og7="service-demo-open-dossier"]')
  ).toHaveCount(3);
  await page
    .locator('[data-og7="service-demo-filter"][data-og7-id="autorisation"]')
    .click();
  await expect(
    page.locator('[data-og7="service-demo-open-dossier"]')
  ).toHaveCount(1);
  await page.locator('[data-og7="service-demo-open-dossier"]').click();
  await page.locator('[data-og7="service-demo-back"]').click();
  await expect(page).toHaveURL(/etat=autorisation/);
  await expect(
    page.locator('[data-og7="service-demo-open-dossier"]')
  ).toHaveCount(1);
  await page.locator('[data-og7="service-demo-reset-filters"]').click();
  await expect(
    page.locator('[data-og7="service-demo-open-dossier"]')
  ).toHaveCount(3);
});

test('consulte l’aide au clavier et conserve le brouillon lors des changements d’étape', async ({
  page
}) => {
  await page.goto(`${dossier}/corriger/texte`);
  const editor = page.locator('[data-og7="service-demo-editor-text"]');
  await editor.fill(editedText);
  const toggle = page.locator('[data-og7="service-demo-help-toggle"]');
  const content = page.locator('[data-og7="service-demo-help-content"]');
  await expect(content).toBeHidden();
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(content).toBeVisible();
  const editorHelp = await content.innerText();
  expect(editorHelp.trim().length).toBeGreaterThan(30);
  await expect(page).toHaveURL(new RegExp(`${dossier}/corriger/texte$`));
  await expect(editor).toHaveValue(editedText);
  await page
    .locator('[data-og7="service-demo-step"][data-og7-id="autorisation"]')
    .click();
  await expect(content).toBeVisible();
  await expect(content).not.toHaveText(editorHelp);
  await expect(page.locator('[data-og7="service-demo-preview"]')).toContainText(
    editedText
  );
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(content).toBeHidden();
  await expect(toggle).toBeFocused();
});

test('retrouve l’origine après un détour de correction et conserve au clavier sans publier', async ({
  page
}) => {
  const apiRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/'))
      apiRequests.push(request.url());
  });
  await page.goto(`${dossier}/publication`);
  await page
    .getByRole('link', { name: 'Corriger le contenu', exact: true })
    .click();
  await expect(page).toHaveURL(/retour=publication/);
  await expect(
    page.locator('[data-og7="service-demo-step"][data-og7-id="publication"]')
  ).toHaveAttribute('aria-current', 'step');
  await page
    .locator('[data-og7="service-demo-editor-tab"][data-og7-id="image"]')
    .click();
  await expect(
    page.locator('[data-og7="service-demo-editor-tab"][data-og7-id="image"]')
  ).toBeFocused();
  await page
    .getByRole('link', { name: 'Examiner le média', exact: true })
    .click();
  await page
    .getByRole('link', { name: 'Revenir à l’éditeur', exact: true })
    .click();
  await expect(page).toHaveURL(/corriger\/image(?:\?|$)/);
  expect(new URL(page.url()).searchParams.get('retour')).toBe('publication');
  await page
    .locator('[data-og7="service-demo-editor-tab"][data-og7-id="texte"]')
    .click();
  await page
    .getByRole('link', { name: 'Examiner une proposition', exact: true })
    .click();
  await page
    .getByRole('link', { name: 'Utiliser dans le brouillon', exact: true })
    .click();
  await expect(page).toHaveURL(/corriger\/texte(?:\?|$)/);
  expect(new URL(page.url()).searchParams.get('retour')).toBe('publication');
  const editor = page.locator('[data-og7="service-demo-editor-text"]');
  await editor.fill(editedText);
  await editor.press('ControlOrMeta+s');
  await expect(
    page.locator('[data-og7="service-demo-editor-saved"]')
  ).toBeVisible();
  await expect(editor).toBeFocused();
  await editor.press('End');
  await editor.pressSequentially(' Modifié.');
  await expect(
    page.locator('[data-og7="service-demo-editor-saved"]')
  ).toBeHidden();
  await page
    .getByRole('link', { name: 'Revenir à la publication', exact: true })
    .click();
  await expect(page).toHaveURL(/\/publication(?:\?|$)/);
  await expect(page.locator('[data-og7="service-demo-preview"]')).toContainText(
    editedText
  );
  expect(apiRequests).toEqual([]);
});

test('revient à la planification ou à la confirmation après la lecture du contenu exact', async ({
  page
}) => {
  await page.goto(`${dossier}/planifier`);
  await page.getByLabel('Date et heure locales').fill('2026-11-09T11:45');
  await page
    .getByRole('link', { name: 'Voir le contenu exact', exact: true })
    .click();
  await expect(page).toHaveURL(/\/apercu\?/);
  expect(new URL(page.url()).searchParams.get('origine')).toBe('planifier');
  await page.locator('[data-og7="service-demo-back"]').click();
  await expect(page).toHaveURL(/\/planifier(?:\?|$)/);
  await expect(page.getByLabel('Date et heure locales')).toHaveValue(
    '2026-11-09T11:45'
  );
  await page
    .getByRole('link', { name: 'Voir le récapitulatif d’envoi', exact: true })
    .click();
  await page
    .getByRole('link', { name: 'Voir le contenu exact', exact: true })
    .click();
  expect(new URL(page.url()).searchParams.get('origine')).toBe(
    'confirmer-envoi'
  );
  await page.locator('[data-og7="service-demo-back"]').click();
  await expect(page).toHaveURL(/\/confirmer-envoi(?:\?|$)/);
  await expect(
    page.locator(
      '[data-og7="service-demo-detail"][data-og7-id="confirmer-envoi"]'
    )
  ).toContainText('2026-11-09 · 11:45');
});

test('retrouve le filtre, la version et le défilement de l’historique après un commentaire', async ({
  page
}, testInfo) => {
  await page.goto(`${dossier}/historique?filtre=tout&version=v1`);
  const body = page.locator('#service-demo-body');
  let previousScroll = 0;
  if (testInfo.project.name === 'chromium') {
    previousScroll = await body.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      return element.scrollTop;
    });
    expect(previousScroll).toBeGreaterThan(0);
  }
  await page
    .getByRole('link', { name: 'Ajouter un commentaire interne', exact: true })
    .last()
    .click();
  await expect(page).toHaveURL(/\/commentaire\?/);
  await page
    .getByLabel('Commentaire interne', { exact: true })
    .fill('Note de démonstration gardant le contexte de lecture.');
  await page.locator('[data-og7="service-demo-back"]').click();
  await expect(page).toHaveURL(/\/historique\?/);
  expect(new URL(page.url()).searchParams.get('filtre')).toBe('tout');
  expect(new URL(page.url()).searchParams.get('version')).toBe('v1');
  await expect(
    page.locator('[data-og7="service-demo-history-event"][data-og7-id="v1"]')
  ).toHaveAttribute('aria-current', 'true');
  if (testInfo.project.name === 'chromium') {
    await expect
      .poll(async () =>
        Math.abs(
          (await body.evaluate((element) => element.scrollTop)) - previousScroll
        )
      )
      .toBeLessThan(4);
  }
});

test('compare puis rétablit le dernier brouillon réellement conservé pendant la visite', async ({
  page
}, testInfo) => {
  const savedText = 'Version conservée pour Atelier Boréal.';
  const pendingText = 'Nouvelle saisie locale à comparer à la conservation.';
  const savedLink = 'https://example.test/brouillon-conserve';
  await page.goto(`${dossier}/retablir`);
  await expect(
    page.locator('[data-og7="service-demo-restore-saved"]')
  ).toBeDisabled();
  await page.locator(`a[href^="${dossier}/corriger/texte"]`).first().click();
  await page.locator('[data-og7="service-demo-editor-text"]').fill(savedText);
  await page
    .locator('[data-og7="service-demo-editor-tab"][data-og7-id="liens"]')
    .click();
  await page.getByLabel('Lien associé au brouillon').fill(savedLink);
  await page.locator('[data-og7="service-demo-editor-save"]').click();
  await page
    .getByLabel('Lien associé au brouillon')
    .fill('https://example.test/autre-lien');
  await page
    .locator('[data-og7="service-demo-editor-tab"][data-og7-id="texte"]')
    .click();
  await page.locator('[data-og7="service-demo-editor-text"]').fill(pendingText);
  await page
    .getByRole('link', { name: 'Examiner une version précédente', exact: true })
    .click();
  await page.locator(`a[href^="${dossier}/comparer"]`).first().click();
  await page.locator('#demo-compare-version').selectOption('conserve');
  await expect(page).toHaveURL(/comparaison=conserve/);
  const comparison = page.locator('[data-og7="service-demo-comparison"]');
  await expect(comparison).toContainText(savedText);
  await expect(comparison).toContainText(pendingText);
  await page
    .getByText('Comparer aussi le lien, la mention et le visuel', {
      exact: true
    })
    .click();
  await expect(comparison).toContainText(savedLink);
  await expect(comparison).toContainText('https://example.test/autre-lien');
  await expect(comparison.getByText(savedLink)).toBeVisible();
  await page.locator(`a[href^="${dossier}/retablir"]`).first().click();
  if (testInfo.project.name === 'chromium') {
    const restoreBox = await page
      .locator('[data-og7="service-demo-restore-saved"]')
      .boundingBox();
    expect(restoreBox).not.toBeNull();
    expect(restoreBox!.y).toBeGreaterThanOrEqual(0);
    expect(restoreBox!.y + restoreBox!.height).toBeLessThanOrEqual(
      page.viewportSize()!.height
    );
  }
  await page.locator('[data-og7="service-demo-restore-saved"]').click();
  await expect(
    page.locator('[data-og7="service-demo-restore-saved"]')
  ).toBeDisabled();
  await page.locator(`a[href^="${dossier}/corriger/texte"]`).first().click();
  await expect(
    page.locator('[data-og7="service-demo-editor-text"]')
  ).toHaveValue(savedText);
  await page
    .locator('[data-og7="service-demo-editor-tab"][data-og7-id="liens"]')
    .click();
  await expect(page.getByLabel('Lien associé au brouillon')).toHaveValue(
    savedLink
  );
});

test('choisit un visuel et son texte alternatif puis conserve le mode compact entre les vues', async ({
  page
}) => {
  const imageAlt = 'Illustration de démonstration choisie pour Atelier Boréal.';
  await page.goto(`${dossier}/corriger/image`);
  await page
    .locator('[data-og7="service-demo-editor-image"][data-og7-id="companion"]')
    .check();
  await page
    .locator('[data-og7="service-demo-editor-image-alt"]')
    .fill(imageAlt);
  const preview = page.locator('[data-og7="service-demo-preview"]');
  await expect(preview.locator('img')).toHaveAttribute(
    'src',
    /admin-guide-princess-lion\.webp/
  );
  await expect(preview.locator('img')).toHaveAttribute('alt', imageAlt);
  await page
    .locator('[data-og7="service-demo-preview-mode"][data-og7-id="compact"]')
    .click();
  await expect(
    page.locator(
      '[data-og7="service-demo-preview-mode"][data-og7-id="compact"]'
    )
  ).toHaveAttribute('aria-pressed', 'true');
  const imageBox = await preview.locator('img').boundingBox();
  expect(imageBox).not.toBeNull();
  expect(imageBox!.width).toBeLessThanOrEqual(375);
  await page
    .locator('[data-og7="service-demo-editor-tab"][data-og7-id="texte"]')
    .click();
  await expect(preview.locator('img')).toHaveAttribute('alt', imageAlt);
  await expect(
    page.locator(
      '[data-og7="service-demo-preview-mode"][data-og7-id="compact"]'
    )
  ).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-og7="service-demo-editor-text"]').fill('');
  await expect(
    preview.locator('[data-og7="service-demo-preview-empty"]')
  ).toBeVisible();
  await page
    .locator('[data-og7="service-demo-step"][data-og7-id="contenu"]')
    .click();
  await expect(preview.locator('img')).toHaveAttribute(
    'src',
    /admin-guide-princess-lion\.webp/
  );
  await expect(preview.locator('img')).toHaveAttribute('alt', imageAlt);
  await page
    .locator('[data-og7="service-demo-preview-mode"][data-og7-id="standard"]')
    .click();
  await expect(
    page.locator(
      '[data-og7="service-demo-preview-mode"][data-og7-id="standard"]'
    )
  ).toHaveAttribute('aria-pressed', 'true');
});

test('présente une fiche Web distincte de l’aperçu Facebook sans la rendre publique', async ({
  page
}, testInfo) => {
  const apiRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/'))
      apiRequests.push(request.url());
  });
  await page.goto(`${dossier}/web`);
  const preview = page.locator('[data-og7="service-demo-preview"]');
  await expect(preview).toContainText('Atelier Boréal');
  await expect(preview).not.toContainText('Facebook');
  if (testInfo.project.name === 'chromium') {
    const visibilityBox = await page
      .locator(`a[href^="${dossier}/confirmer-visibilite"]`)
      .first()
      .boundingBox();
    expect(visibilityBox).not.toBeNull();
    expect(visibilityBox!.y).toBeGreaterThanOrEqual(0);
    expect(visibilityBox!.y + visibilityBox!.height).toBeLessThanOrEqual(
      page.viewportSize()!.height
    );
  }
  await page
    .locator(`a[href^="${dossier}/confirmer-visibilite"]`)
    .first()
    .click();
  await expect(preview).toContainText('Atelier Boréal');
  await expect(preview).not.toContainText('Facebook');
  await expect(
    page.locator('[data-og7="service-demo-detail"] button[disabled]')
  ).toHaveCount(1);
  await page
    .locator('[data-og7="service-demo-step"][data-og7-id="publication"]')
    .click();
  await expect(preview).toContainText('Facebook');
  expect(apiRequests).toEqual([]);
});

test('garde les notes et noms de pièces locaux sans les mélanger entre les dossiers', async ({
  page
}) => {
  const note = 'Commentaire en cours, encore non conservé par le bouton.';
  const proofNote = 'Pièce fictive : la preuve reste locale à cette visite.';
  await page.goto(`${dossier}/commentaire`);
  await page.getByLabel('Commentaire interne', { exact: true }).fill(note);
  await page.locator('[data-og7="service-demo-back"]').click();
  await page
    .getByRole('link', { name: 'Ajouter un commentaire interne', exact: true })
    .last()
    .click();
  await expect(
    page.getByLabel('Commentaire interne', { exact: true })
  ).toHaveValue(note);
  await openLocalProof(page);
  await page.getByLabel('Choisir un fichier local').setInputFiles({
    name: 'accord-local-demo.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(
      'Pièce synthétique de démonstration, sans effet externe.'
    )
  });
  await page.getByLabel('Origine et portée de la pièce').fill(proofNote);
  await page.locator('[data-og7="service-demo-back"]').click();
  await openLocalProof(page);
  await expect(page.getByLabel('Origine et portée de la pièce')).toHaveValue(
    proofNote
  );
  await expect(
    page.locator('[data-og7="service-demo-detail"][data-og7-id="preuve"]')
  ).toContainText('accord-local-demo.txt');
  await page
    .getByRole('link', { name: 'Prestations de services', exact: true })
    .click();
  await page
    .locator(
      '[data-og7="service-demo-open-dossier"][data-og7-id="collectif-rivages"]'
    )
    .click();
  await openLocalProof(page);
  await expect(page.getByLabel('Origine et portée de la pièce')).toHaveValue(
    ''
  );
  await expect(
    page.locator('[data-og7="service-demo-detail"][data-og7-id="preuve"]')
  ).not.toContainText('accord-local-demo.txt');
  await page
    .getByRole('link', { name: 'Prestations de services', exact: true })
    .click();
  await page
    .locator(
      '[data-og7="service-demo-open-dossier"][data-og7-id="atelier-boreal"]'
    )
    .click();
  await openLocalProof(page);
  await expect(page.getByLabel('Origine et portée de la pièce')).toHaveValue(
    proofNote
  );
  await expect(
    page.locator('[data-og7="service-demo-detail"][data-og7-id="preuve"]')
  ).toContainText('accord-local-demo.txt');
});

test('revient à la demande de correction après deux aperçus successifs sans perdre le message', async ({
  page
}) => {
  const message =
    'Merci de relire cette correction de démonstration avant accord.';
  await page.goto(`${dossier}/demander-correction`);
  await page.getByLabel('Message à préparer', { exact: true }).fill(message);
  await page
    .getByRole('link', { name: 'Prévisualiser le message', exact: true })
    .click();
  await expect(page).toHaveURL(/\/apercu-envoi(?:\?|$)/);
  await expect(
    page.locator('[data-og7="service-demo-detail"][data-og7-id="apercu-envoi"]')
  ).toContainText(message);
  await page
    .getByRole('link', { name: 'Relire le contenu', exact: true })
    .click();
  await expect(page).toHaveURL(/\/apercu(?:\?|$)/);
  await page.locator('[data-og7="service-demo-back"]').click();
  await expect(page).toHaveURL(/\/apercu-envoi(?:\?|$)/);
  await expect(page.locator('#service-demo-heading')).toBeFocused();
  await expect(
    page.locator('[data-og7="service-demo-detail"][data-og7-id="apercu-envoi"]')
  ).toContainText(message);
  await page.locator('[data-og7="service-demo-back"]').click();
  await expect(page).toHaveURL(/\/demander-correction(?:\?|$)/);
  await expect(
    page.getByLabel('Message à préparer', { exact: true })
  ).toHaveValue(message);
});

test('quitte une simple consultation sans confirmation de perte', async ({
  page
}) => {
  await page.goto(base);
  await page.locator('a[href="/admin/fundraiser"]').click();
  await expect(page).not.toHaveURL(new RegExp(base));
  await expect(page.locator('[data-og7="service-demo"]')).toHaveCount(0);
});

for (const language of ['fr-CA', 'en'] as const) {
  test(`protège les brouillons modifiés et conservés de tous les dossiers en ${language}`, async ({
    page
  }) => {
    const english = language === 'en';
    const browserDialogs: string[] = [];
    page.on('dialog', async (dialog) => {
      browserDialogs.push(dialog.type());
      await dialog.dismiss();
    });
    await page.addInitScript(
      (locale) => localStorage.setItem('openg7.language', locale),
      language
    );
    await page.goto(`${dossier}/corriger/texte`);
    const editor = page.locator('[data-og7="service-demo-editor-text"]');
    const exit = page.locator('a[href="/admin/fundraiser"]');
    const dialog = page.getByRole('dialog', {
      name: english ? 'Leave the demo?' : 'Quitter la démo ?',
      exact: true
    });
    const close = dialog.getByRole('button', {
      name: english ? 'Close confirmation' : 'Fermer la confirmation',
      exact: true
    });
    const stay = dialog.locator('[data-og7="service-demo-exit-stay"]');
    const leave = dialog.locator('[data-og7="service-demo-exit-confirm"]');

    await editor.fill(editedText);
    await page
      .locator('[data-og7="service-demo-editor-tab"][data-og7-id="image"]')
      .click();
    await page
      .locator('[data-og7="service-demo-editor-tab"][data-og7-id="texte"]')
      .click();
    await expect(editor).toHaveValue(editedText);
    await expect(dialog).toBeHidden();

    await exit.focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await expect(close).toBeFocused();
    await page.keyboard.press('ControlOrMeta+s');
    await expect(dialog).toBeVisible();
    await expect(
      page.locator('[data-og7="service-demo-editor-saved"]')
    ).toBeHidden();
    await expect(dialog).toContainText('Atelier Boréal');
    await expect(stay).toHaveAccessibleName(
      english ? 'Stay in the demo' : 'Rester dans la démo'
    );
    await expect(leave).toHaveAccessibleName(
      english ? 'Leave and clear drafts' : 'Quitter et effacer les brouillons'
    );
    await page.keyboard.press('Shift+Tab');
    await expect(stay).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(exit).toBeFocused();
    await expect(editor).toHaveValue(editedText);

    await page.locator('[data-og7="service-demo-editor-save"]').click();
    await expect(
      page.locator('[data-og7="service-demo-editor-saved"]')
    ).toBeVisible();
    await exit.click();
    await expect(dialog).toBeVisible();
    await stay.click();
    await expect(dialog).toBeHidden();
    await expect(exit).toBeFocused();
    await expect(editor).toHaveValue(editedText);

    await page.locator(`a[href="${base}"]`).first().click();
    await page
      .locator(
        '[data-og7="service-demo-open-dossier"][data-og7-id="collectif-rivages"]'
      )
      .click();
    await expect(dialog).toBeHidden();
    await expect(
      page.locator('[data-og7="service-demo-draft-status"]')
    ).toHaveCount(0);
    await exit.click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Atelier Boréal');
    await expect(dialog).not.toContainText('Collectif Rivages');
    await leave.click();
    await expect(page).not.toHaveURL(new RegExp(base));
    await expect(page.locator('[data-og7="service-demo"]')).toHaveCount(0);

    await page.locator(`a[href="${base}"]`).first().click();
    await expect(
      page.locator('[data-og7="service-demo-draft-badge"]')
    ).toHaveCount(0);
    await page
      .locator(
        '[data-og7="service-demo-open-dossier"][data-og7-id="atelier-boreal"]'
      )
      .click();
    await page
      .locator('[data-og7="service-demo-step"][data-og7-id="contenu"]')
      .click();
    await page.locator(`a[href="${dossier}/corriger/texte"]`).first().click();
    await expect(editor).not.toHaveValue(editedText);
    await expect(editor).toHaveValue(/Atelier Boréal/);
    expect(browserDialogs).toEqual([]);
  });
}

test('annule une sortie en attente quand le retour navigateur reste dans la démo', async ({
  page
}) => {
  await page.goto(`${dossier}/corriger/texte`);
  await page
    .locator('[data-og7="service-demo-editor-tab"][data-og7-id="image"]')
    .click();
  await page
    .locator('[data-og7="service-demo-editor-tab"][data-og7-id="texte"]')
    .click();
  await page.locator('[data-og7="service-demo-editor-text"]').fill(editedText);
  await page.locator('a[href="/admin/fundraiser"]').click();
  const dialog = page.getByRole('dialog', { name: 'Quitter la démo ?' });
  await expect(dialog).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/corriger\/image$/);
  await expect(dialog).toBeHidden();
  await page
    .locator('[data-og7="service-demo-editor-tab"][data-og7-id="texte"]')
    .click();
  await expect(
    page.locator('[data-og7="service-demo-editor-text"]')
  ).toHaveValue(editedText);
});

for (const source of [
  { kind: 'commentaire', path: 'commentaire', field: '#demo-comment' },
  {
    kind: 'message',
    path: 'demander-correction',
    field: '#demo-request-message'
  },
  { kind: 'note-piece', path: 'preuve', field: '#demo-proof-note' },
  { kind: 'fichier', path: 'preuve', field: '#demo-proof-file' },
  {
    kind: 'reference-externe',
    path: 'reconcilier',
    field: '#demo-external-reference'
  },
  {
    kind: 'lien-externe',
    path: 'reconcilier',
    field: '#demo-external-link'
  },
  {
    kind: 'motif-absence',
    path: 'attester',
    field: '#demo-absence-reason'
  }
] as const) {
  test(`protège la saisie locale de type ${source.kind} avant de quitter`, async ({
    page
  }) => {
    await page.goto(`${dossier}/${source.path}`);
    const value =
      source.kind === 'lien-externe'
        ? 'https://example.test/reference-locale'
        : `Saisie synthétique ${source.kind}, locale à cette visite.`;
    const field = page.locator(source.field);
    if (source.kind === 'fichier') {
      await page.getByLabel('Choisir un fichier local').setInputFiles({
        name: 'reference-locale.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('Référence synthétique sans téléversement.')
      });
    } else {
      await field.fill(value);
    }
    if (source.kind !== 'message') {
      await expect(
        page.locator('[data-og7="service-demo-draft-status"]')
      ).toHaveCount(0);
    }
    await page.locator('a[href="/admin/fundraiser"]').click();
    const dialog = page.getByRole('dialog', { name: 'Quitter la démo ?' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Atelier Boréal');
    await dialog.locator('[data-og7="service-demo-exit-stay"]').click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`${dossier}/${source.path}$`));
    if (source.kind === 'fichier') {
      await expect(
        page.locator('[data-og7="service-demo-detail"][data-og7-id="preuve"]')
      ).toContainText('reference-locale.txt');
    } else {
      await expect(field).toHaveValue(value);
    }
    await page.locator('[data-og7="service-demo-back"]').click();
    await expect(dialog).toBeHidden();
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${dossier}/${source.path}$`));
    await expect(dialog).toBeHidden();
    await page.locator(`a[href="${base}"]`).first().click();
    await page
      .locator(
        '[data-og7="service-demo-open-dossier"][data-og7-id="collectif-rivages"]'
      )
      .click();
    await page.goBack();
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${dossier}/${source.path}$`));
    await expect(dialog).toBeHidden();
    if (source.kind === 'fichier') {
      await expect(
        page.locator('[data-og7="service-demo-proof-name"]')
      ).toContainText('reference-locale.txt');
    } else {
      await expect(field).toHaveValue(value);
    }
  });
}

test('avertit au rechargement avant et après conservation locale du brouillon', async ({
  page
}) => {
  await page.goto(`${dossier}/corriger/texte`);
  const editor = page.locator('[data-og7="service-demo-editor-text"]');
  await editor.fill(editedText);
  await expect(
    page.locator('[data-og7="service-demo-draft-status"]')
  ).toBeVisible();
  await Promise.all([
    page.waitForEvent('dialog').then(async (dialog) => {
      expect(dialog.type()).toBe('beforeunload');
      await dialog.dismiss();
    }),
    page.evaluate(() => window.location.reload())
  ]);
  await expect(editor).toHaveValue(editedText);
  await page.locator('[data-og7="service-demo-editor-save"]').click();
  await expect(
    page.locator('[data-og7="service-demo-editor-saved"]')
  ).toBeVisible();
  await acceptLocalWorkLoss(page, () => page.reload());
  await expect(editor).not.toHaveValue(editedText);
  await expect(
    page.locator('[data-og7="service-demo-draft-status"]')
  ).toHaveCount(0);
});

for (const language of ['fr-CA', 'en'] as const) {
  test(`garde les actions accessibles à 320 px et en mise en page équivalente à 200 % en ${language}`, async ({
    page
  }) => {
    await page.addInitScript(
      (locale) => localStorage.setItem('openg7.language', locale),
      language
    );
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${dossier}/corriger/texte`);
    const save = page.locator('[data-og7="service-demo-editor-save"]');
    const footer = page.locator('footer').filter({ has: save });
    // 640 × 450 CSS pixels models the reflow of 1280 × 900 at 200% zoom.
    for (const viewport of [
      { width: 320, height: 760 },
      { width: 640, height: 450 }
    ]) {
      await page.setViewportSize(viewport);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1
        )
      ).toBe(true);
      const steps = page.locator('[data-og7="service-demo-step"]');
      await expect(steps).toHaveCount(3);
      for (const step of await steps.all()) {
        await expectSingleLineText(step.locator('strong'), step);
      }
      const tabs = page.locator('[data-og7="service-demo-editor-tab"]');
      await expect(tabs).toHaveCount(5);
      for (const tab of await tabs.all()) await expectSingleLineText(tab);
      if (viewport.width === 320) {
        const rows = await tabs.evaluateAll(
          (elements) =>
            new Set(
              elements.map((element) =>
                Math.round(element.getBoundingClientRect().top)
              )
            ).size
        );
        expect(rows).toBeGreaterThan(1);
      }
      const actions = footer.locator('a, button');
      expect(await actions.count()).toBeGreaterThanOrEqual(3);
      for (const action of await actions.all()) {
        await action.focus();
        await expect(action).toBeFocused();
        await action.scrollIntoViewIfNeeded();
        const box = await action.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(
          await action.evaluate(
            (element) => element.scrollWidth <= element.clientWidth + 1
          )
        ).toBe(true);
      }
      await page
        .locator('[data-og7="service-demo-editor-text"]')
        .fill(editedText);
      await page.locator('a[href="/admin/fundraiser"]').click();
      const dialog = page.getByRole('dialog', {
        name: language === 'en' ? 'Leave the demo?' : 'Quitter la démo ?'
      });
      await expect(dialog).toBeVisible();
      for (const hook of [
        'service-demo-exit-stay',
        'service-demo-exit-confirm'
      ]) {
        const action = dialog.locator(`[data-og7="${hook}"]`);
        await action.scrollIntoViewIfNeeded();
        const box = await action.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
      await dialog.locator('[data-og7="service-demo-exit-stay"]').click();
      await expect(dialog).toBeHidden();
    }
  });
}
