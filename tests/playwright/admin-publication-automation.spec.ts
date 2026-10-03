import type { Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import type {
  PublicationAutomationCommand,
  PublicationAutomationState,
  PublicationDelivery
} from '@openg7/funding-core';

import { test, expect } from './support/test.js';

const initialJob: PublicationDelivery = {
  id: '11111111-1111-4111-8111-111111111111',
  feedId: 'openg20:facebook',
  kind: 'news',
  batchId: null,
  message: 'Notre prochaine réalisation pour la communauté.',
  scheduledAt: '2030-06-03T14:00:00Z',
  mediaId: null,
  mediaUrl: null,
  mediaAlt: null,
  accountId: 'fixture-page-20',
  mode: 'mock',
  autoManaged: false,
  sponsors: [],
  version: 1,
  status: 'draft',
  attempts: 0,
  nextAttemptAt: null,
  externalPostId: null,
  externalPostUrl: null,
  errorCode: null,
  approvedAt: null,
  publishedAt: null
};
async function fixtures(
  page: Page,
  status: PublicationDelivery['status'] = 'draft',
  conflict = false,
  sponsors: PublicationDelivery['sponsors'] = [],
  overrides: Partial<PublicationDelivery> = {},
  options: {
    workerEnabled?: boolean;
    role?: 'reader' | 'operator';
    workerResponse?: () => Promise<void>;
    settingsResponse?: () => Promise<void>;
    readResponse?: () => Promise<void>;
    extraDeliveries?: PublicationDelivery[];
  } = {}
): Promise<PublicationAutomationCommand[]> {
  const commands: PublicationAutomationCommand[] = [];
  const state: PublicationAutomationState = {
    workerEnabled: options.workerEnabled ?? true,
    workerVersion: 1,
    summary: {
      awaitingApproval: 1,
      scheduled: 0,
      exceptions: status === 'uncertain' ? 1 : 0,
      publishedToday: 2
    },
    feeds: [
      'openg7:facebook',
      'openg7:linkedin',
      'openg20:facebook',
      'openg20:linkedin'
    ].map((id) => ({
      id: id as PublicationDelivery['feedId'],
      paused: true,
      autoPrepare: false,
      timezone: 'America/Toronto',
      weekdays: [2, 4],
      localTime: '10:00',
      capacity: 5,
      horizonDays: 14,
      mode: 'mock',
      accountId: 'fixture-page-20',
      configured: true,
      expiresAt: null,
      connection: 'ready',
      checkedAt: '2030-06-01T12:00:00Z'
    })),
    deliveries: [
      { ...initialJob, status, sponsors, ...overrides },
      ...(options.extraDeliveries ?? [])
    ]
  };
  await page.addInitScript((role) => {
    sessionStorage.setItem(
      'openg7-admin-session-token',
      role ? 'openg7-admin-session.cookie' : 'openg7-admin-session.ui-fixture'
    );
    sessionStorage.setItem(
      'openg7-admin-session-expires-at',
      '2099-01-01T00:00:00Z'
    );
  }, options.role);
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/current'))
      return route.fulfill({
        json: {
          id: 'fixture-account',
          sessionId: 'fixture-session',
          displayName: 'Fixture reader',
          role: options.role,
          expiresAt: '2099-01-01T00:00:00Z'
        }
      });
    if (path.endsWith('/publication-automation/media'))
      return route.fulfill({ json: [] });
    if (!path.endsWith('/publication-automation'))
      return route.fulfill({ status: 503, json: {} });
    if (route.request().method() === 'GET') {
      await options.readResponse?.();
      const params = new URL(route.request().url()).searchParams;
      return route.fulfill({
        json: {
          ...state,
          deliveries: state.deliveries.filter(
            (d) =>
              (!params.has('sponsorshipId') ||
                d.sponsors.some((s) => s.id === params.get('sponsorshipId'))) &&
              (!params.has('deliveryId') || d.id === params.get('deliveryId'))
          )
        }
      });
    }
    const c = route.request().postDataJSON() as PublicationAutomationCommand;
    commands.push(c);
    if (c.action === 'worker') await options.workerResponse?.();
    if (c.action === 'settings') await options.settingsResponse?.();
    if (conflict)
      return route.fulfill({
        status: 409,
        json: {
          code:
            c.action === 'worker'
              ? 'WORKER_VERSION_CONFLICT'
              : 'VERSION_CONFLICT'
        }
      });
    if (c.action === 'worker') {
      state.workerEnabled = c.enabled;
      state.workerVersion++;
    }
    const job = state.deliveries[0]!;
    if (c.action === 'reconcile') {
      if (c.externalPostId === 'missing-post')
        return route.fulfill({
          status: 503,
          json: { code: 'REMOTE_POST_UNVERIFIED' }
        });
      if (c.externalPostId === 'different-post')
        return route.fulfill({ status: 409, json: { code: 'POST_MISMATCH' } });
      job.status = 'published';
      job.externalPostId = c.externalPostId;
      job.externalPostUrl = 'https://social.openg7.local/verified';
      job.version++;
    }
    if (c.action === 'confirm-absent') {
      job.status = 'blocked';
      job.approvedAt = null;
      job.errorCode = 'ABSENCE_CONFIRMED';
      job.version++;
    }
    if (c.action === 'approve') {
      job.status = 'approved';
      job.sponsors.forEach((s) => {
        s.reviewStatus = 'approved';
      });
      job.version++;
    }
    if (c.action === 'reject') {
      job.status = 'rejected';
      job.version++;
    }
    if (c.action === 'edit') {
      job.message = c.message;
      job.status = 'draft';
      job.version++;
    }
    if (c.action === 'settings') {
      Object.assign(
        state.feeds.find((f) => f.id === c.settings.id)!,
        c.settings
      );
    }
    return route.fulfill({ json: { id: 'id' in c ? c.id : undefined } });
  });
  return commands;
}

for (const [language, width] of [
  ['fr-CA', 1280],
  ['en', 390]
] as const) {
  test(`feed settings separate saved configuration from preparation in ${language} at ${width}px`, async ({
    page
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(
      (locale) => localStorage.setItem('openg7.language', locale),
      language
    );
    const commands = await fixtures(page);
    await page.goto('/admin/fundraiser/publications/automation?settings=feeds');
    const english = language === 'en';
    const opener = page
      .getByRole('button', {
        name: english ? 'Settings' : 'Réglages',
        exact: true
      })
      .first();
    await opener.focus();
    await opener.press('Enter');
    const dialog = page.getByRole('dialog', {
      name: english ? 'Settings' : 'Réglages',
      exact: true
    });
    const save = dialog.getByRole('button', {
      name: english ? 'Save settings' : 'Enregistrer les réglages',
      exact: true
    });
    const prepare = dialog.getByRole('button', {
      name: english ? 'Prepare now' : 'Préparer maintenant',
      exact: true
    });
    const capacity = dialog.getByRole('spinbutton', {
      name: english ? 'Sponsors per batch' : 'Commanditaires par lot',
      exact: true
    });
    const close = dialog
      .getByRole('button', {
        name: english ? 'Close' : 'Fermer',
        exact: true
      })
      .first();
    const connectionHelp = dialog.locator('summary');
    await expect(close).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(
      dialog.getByRole('button', {
        name: english ? 'Check connection' : 'Vérifier la connexion',
        exact: true
      })
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(connectionHelp).toBeFocused();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('switch')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(connectionHelp).toBeFocused();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('switch')).toBeFocused();
    // Follow native order through weekdays and the segmented time field to Save.
    for (let step = 0; step < 30; step++) {
      if (await save.evaluate((element) => element === document.activeElement))
        break;
      await page.keyboard.press('Tab');
    }
    await expect(save).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(save).toBeFocused();
    await expect(dialog).toContainText('OPENG7');
    await expect(dialog).toContainText('Facebook');
    expect(commands).toHaveLength(0);
    await capacity.fill('0');
    await expect(save).toBeDisabled();
    await capacity.press('Enter');
    expect(commands).toHaveLength(0);
    await capacity.fill('6');
    await dialog.getByRole('switch').press('Space');
    for (const day of [english ? 'Tue' : 'Mar.', english ? 'Thu' : 'Jeu.']) {
      const checkbox = dialog.getByRole('checkbox', { name: day, exact: true });
      await checkbox.focus();
      await checkbox.press('Space');
    }
    await expect(dialog.getByRole('alert')).toContainText(
      english ? 'Choose at least one' : 'Choisissez au moins un'
    );
    await expect(save).toBeDisabled();
    const monday = dialog.getByRole('checkbox', {
      name: english ? 'Mon' : 'Lun.',
      exact: true
    });
    await monday.focus();
    await monday.press('Space');
    await expect(prepare).toBeDisabled();
    await expect(dialog).toContainText(
      english
        ? 'Save your changes before'
        : 'Enregistrez vos modifications avant'
    );
    await save.click();
    await expect(dialog).toBeVisible();
    await expect(prepare).toBeEnabled();
    expect(commands).toEqual([
      {
        action: 'settings',
        settings: expect.objectContaining({
          id: 'openg7:facebook',
          paused: true,
          autoPrepare: true,
          capacity: 6,
          weekdays: [1],
          horizonDays: 14,
          localTime: '10:00',
          timezone: 'America/Toronto'
        })
      }
    ]);
    await expect(
      dialog
        .getByRole('status')
        .filter({ hasText: english ? 'Saved.' : 'Enregistré.' })
    ).toBeVisible();
    expect(
      (await new AxeBuilder({ page }).include('dialog[open]').analyze())
        .violations
    ).toEqual([]);
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth
      )
    ).toBe(true);
    await dialog.evaluate((element) => {
      element.scrollTop = 0;
    });
    await dialog.screenshot({
      path: `test-results/feed-settings-${language}-${width}.png`
    });
    await prepare.scrollIntoViewIfNeeded();
    await dialog.screenshot({
      path: `test-results/feed-settings-actions-${language}-${width}.png`
    });
    await prepare.click();
    await expect(dialog).toContainText(
      english ? 'Preparation complete.' : 'Préparation terminée.'
    );
    expect(commands[1]).toEqual({
      action: 'prepare',
      feedId: 'openg7:facebook'
    });
    await dialog
      .getByRole('button', {
        name: english ? 'Check connection' : 'Vérifier la connexion',
        exact: true
      })
      .click();
    await expect(dialog).toContainText(
      english ? 'Check complete.' : 'Vérification terminée.'
    );
    expect(commands[2]).toEqual({ action: 'check', feedId: 'openg7:facebook' });
    await page.keyboard.press('Escape');
    await expect(opener).toBeFocused();
    await opener.press('Enter');
    await expect(capacity).toHaveValue('6');
    await expect(monday).toBeChecked();
    expect(commands).toHaveLength(3);
  });
}

test('feed settings retain edits on failure and block actions while saving', async ({
  page
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const commands = await fixtures(
    page,
    'draft',
    true,
    [],
    {},
    { settingsResponse: () => gate }
  );
  await page.goto('/admin/fundraiser/publications/automation?settings=feeds');
  await page
    .getByRole('button', { name: 'Réglages', exact: true })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'Réglages', exact: true });
  const horizon = dialog.getByRole('spinbutton', {
    name: 'Jours à préparer',
    exact: true
  });
  await horizon.fill('21');
  const save = dialog.getByRole('button', {
    name: 'Enregistrer les réglages',
    exact: true
  });
  await save.click();
  try {
    await expect(save).toBeDisabled();
    await expect(horizon).toBeDisabled();
    await dialog.locator('summary').focus();
    await page.keyboard.press('Tab');
    await expect(dialog.locator('summary')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.locator('summary')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Préparer maintenant', exact: true })
    ).toBeDisabled();
    expect(commands).toHaveLength(1);
  } finally {
    release();
  }
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(horizon).toHaveValue('21');
  await expect(save).toBeEnabled();
  await expect(
    dialog.getByRole('status').filter({ hasText: 'Enregistré.' })
  ).toHaveCount(0);
  expect(commands.map((command) => command.action)).toEqual(['settings']);
});

for (const width of [390, 1280]) {
  test(`worker switch confirms activation, persists state and stops processing at ${width}px`, async ({
    page
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const commands = await fixtures(
      page,
      'draft',
      false,
      [],
      {},
      { workerEnabled: false }
    );
    await page.goto('/admin/fundraiser/publications/automation?settings=feeds');
    const toggle = page.getByRole('switch', { name: 'Moteur automatique' });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(page.getByText(/Activer le moteur automatique/)).toBeVisible();
    expect(commands).toHaveLength(0);
    await page.keyboard.press('Escape');
    await expect(toggle).toBeEnabled();
    await expect(toggle).toBeFocused();
    expect(commands).toHaveLength(0);
    await toggle.press('Enter');
    await page.locator('[data-og7="confirm-action"]').click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(commands).toEqual([
      {
        action: 'worker',
        enabled: true,
        version: 1,
        confirmation: 'enable-worker'
      }
    ]);
    await page.reload();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(commands[1]).toEqual({
      action: 'worker',
      enabled: false,
      version: 2,
      confirmation: 'disable-worker'
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true);
    expect(
      (
        await new AxeBuilder({ page })
          .include('[data-og7="publication-automation"]')
          .analyze()
      ).violations
    ).toEqual([]);
  });
}

test('worker switch waits for the server and reports a stale decision without false success', async ({
  page
}) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const commands = await fixtures(
    page,
    'draft',
    true,
    [],
    {},
    { workerResponse: () => held }
  );
  await page.goto('/admin/fundraiser/publications/automation');
  const toggle = page.getByRole('switch', { name: 'Moteur automatique' });
  await toggle.click();
  try {
    await expect(toggle).toBeDisabled();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(commands).toHaveLength(1);
  } finally {
    release();
  }
  await expect(page.getByRole('alert')).toContainText(
    'L’état du moteur a changé'
  );
  await expect(toggle).toBeEnabled();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('status')).not.toContainText('enregistr');
});

for (const role of ['reader', 'operator'] as const) {
  test(`${role} can read the worker state but cannot change it`, async ({
    page
  }) => {
    const commands = await fixtures(
      page,
      'draft',
      false,
      [],
      {},
      { role, workerEnabled: false }
    );
    await page.goto('/admin/fundraiser/publications/automation');
    await expect(
      page.getByRole('switch', { name: 'Moteur automatique' })
    ).toBeDisabled();
    await expect(
      page.getByText('Seul un propriétaire peut activer ou arrêter le moteur.')
    ).toBeVisible();
    expect(commands).toHaveLength(0);
  });
}
test('approves the exact destination and version only after an explicit decision; edits revoke approval', async ({
  page
}) => {
  const commands = await fixtures(page);
  await page.goto('/admin/fundraiser/publications/automation');
  await expect(
    page.getByRole('heading', { name: 'Pilotage des feeds', exact: true })
  ).toBeVisible();
  await expect(
    page.locator('[data-og7="publication-automation"] article')
  ).toHaveCount(4);
  await page.locator('[data-og7-id="' + initialJob.id + '"]').click();
  const dialog = page.getByRole('dialog', { name: 'Publication finale' });
  await expect(dialog).toContainText('fixture-page-20');
  const authorize = dialog.getByRole('button', {
    name: 'Accepter et programmer'
  });
  await expect(authorize).toBeDisabled();
  await dialog.getByRole('checkbox', { name: /J’approuve/ }).check();
  await authorize.click();
  await expect(dialog).toContainText('Autorisée');
  expect(commands[0]).toEqual({
    action: 'approve',
    id: initialJob.id,
    version: 1,
    confirmation: initialJob.id
  });
  await dialog.getByRole('button', { name: 'Modifier', exact: true }).click();
  await dialog.getByLabel('Texte exact à publier').fill('Texte final modifié.');
  await dialog
    .getByRole('button', { name: 'Enregistrer le brouillon' })
    .click();
  await expect(
    dialog.getByRole('button', { name: 'Accepter et programmer' })
  ).toBeDisabled();
  expect(commands[1]).toMatchObject({
    action: 'edit',
    version: 2,
    message: 'Texte final modifié.'
  });
});
test('unsaved changes cannot be approved and stale versions never show success', async ({
  page
}) => {
  const commands = await fixtures(page, 'draft', true);
  await page.goto('/admin/fundraiser/publications/automation');
  await page.locator('[data-og7-id="' + initialJob.id + '"]').click();
  const dialog = page.getByRole('dialog', { name: 'Publication finale' });
  await dialog.getByRole('button', { name: 'Modifier', exact: true }).click();
  await dialog.getByLabel('Texte exact à publier').fill('A local change');
  await expect(
    dialog.getByRole('checkbox', { name: /J’approuve/ })
  ).toBeDisabled();
  expect(commands).toHaveLength(0);
  await dialog
    .getByRole('button', { name: 'Enregistrer le brouillon' })
    .click();
  await expect(dialog.getByRole('alert')).toContainText(
    'Cette publication a changé'
  );
  await expect(dialog.getByLabel('Texte exact à publier')).toHaveValue(
    'A local change'
  );
});
test('exceptions require investigation and never offer a blind retry', async ({
  page
}) => {
  const commands = await fixtures(page, 'uncertain');
  await page.goto('/admin/fundraiser/publications/automation');
  await page.getByRole('button', { name: 'À résoudre', exact: true }).click();
  await page.locator('[data-og7-id="' + initialJob.id + '"]').click();
  const dialog = page.getByRole('dialog', { name: 'Publication finale' });
  await expect(dialog).toContainText('Aucune relance automatique');
  await expect(
    dialog.getByRole('button', { name: 'Accepter et programmer' })
  ).toHaveCount(0);
  await expect(
    dialog.getByRole('button', { name: 'Annuler cet envoi' })
  ).toHaveCount(0);
  await dialog
    .getByText('Après vérification : la publication est absente', {
      exact: true
    })
    .click();
  await expect(
    dialog.getByRole('button', { name: 'Consigner la vérification' })
  ).toBeDisabled();
  expect(commands).toHaveLength(0);
});
for (const language of ['fr-CA', 'en'] as const) {
  for (const width of [390, 1280]) {
    test(`payment blockers explain each affected sponsor and link to their dossier in ${language} at ${width}px`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(
        (locale) => localStorage.setItem('openg7.language', locale),
        language
      );
      await fixtures(
        page,
        'blocked',
        false,
        [
          {
            id: '22222222-2222-4222-8222-222222222222',
            name: 'Atelier Remboursé',
            version: 'v2',
            reviewStatus: 'approved',
            presentationApproved: true,
            paymentStatus: 'refunded'
          },
          {
            id: '33333333-3333-4333-8333-333333333333',
            name: 'Atelier Contesté',
            version: 'v2',
            reviewStatus: 'approved',
            presentationApproved: true,
            paymentStatus: 'disputed'
          },
          {
            id: '44444444-4444-4444-8444-444444444444',
            name: 'Atelier Témoin',
            version: 'v1',
            reviewStatus: 'approved',
            presentationApproved: true,
            paymentStatus: 'paid'
          }
        ],
        { kind: 'sponsorship', errorCode: 'SOURCE_NOT_ELIGIBLE' }
      );
      await page.goto(
        '/admin/fundraiser/publications/automation?deliveryId=' + initialJob.id
      );
      const dialog = page.getByRole('dialog', {
        name: language === 'en' ? 'Final publication' : 'Publication finale'
      });
      const blockers = dialog.locator(
        '[data-og7="publication-payment-blocker"]'
      );
      await expect(blockers).toHaveCount(2);
      await expect(blockers.nth(0)).toContainText(
        language === 'en'
          ? 'The payment was refunded.'
          : 'Le paiement a été remboursé.'
      );
      await expect(blockers.nth(1)).toContainText(
        language === 'en'
          ? 'The payment is disputed.'
          : 'Le paiement fait l’objet d’une contestation.'
      );
      const refunded = blockers.getByRole('link', {
        name: 'Atelier Remboursé'
      });
      const disputed = blockers.getByRole('link', { name: 'Atelier Contesté' });
      await expect(refunded).toHaveAttribute(
        'href',
        /sponsorshipId=22222222-2222-4222-8222-222222222222&tab=refund$/
      );
      await expect(disputed).toHaveAttribute(
        'href',
        /sponsorshipId=33333333-3333-4333-8333-333333333333&tab=overview$/
      );
      expect(
        await dialog.evaluate(
          (element) => element.scrollWidth <= element.clientWidth
        )
      ).toBe(true);
      const a11y = await new AxeBuilder({ page })
        .include('dialog[open]')
        .analyze();
      expect(a11y.violations).toEqual([]);
      await dialog.screenshot({
        path: `test-results/admin-layout/payment-blockers-${language}-${width}.png`
      });
      await refunded.focus();
      await expect(refunded).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(
        /sponsorshipId=22222222-2222-4222-8222-222222222222&tab=refund$/
      );
    });
  }
}

for (const language of ['fr-CA', 'en'] as const) {
  for (const width of [390, 1280]) {
    test(`dossier revision explains the new approval and links to review in ${language} at ${width}px`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(
        (locale) => localStorage.setItem('openg7.language', locale),
        language
      );
      await fixtures(
        page,
        'blocked',
        false,
        [
          {
            id: '22222222-2222-4222-8222-222222222222',
            name: 'Atelier Révisé',
            version: 'v2',
            reviewStatus: 'approved',
            presentationApproved: true,
            paymentStatus: 'paid'
          }
        ],
        { kind: 'sponsorship', errorCode: 'SPONSOR_REVIEW_REQUIRED' }
      );
      await page.goto(
        '/admin/fundraiser/publications/automation?deliveryId=' + initialJob.id
      );
      const dialog = page.getByRole('dialog', {
        name: language === 'en' ? 'Final publication' : 'Publication finale'
      });
      const explanation = dialog.locator(
        '[data-og7="publication-review-blocker"]'
      );
      await expect(explanation).toContainText(
        language === 'en'
          ? 'Approving the dossier alone does not reauthorize this delivery.'
          : 'Accepter le dossier seul ne réautorise pas cet envoi.'
      );
      await expect(
        dialog.getByRole('button', {
          name:
            language === 'en' ? 'Accept and schedule' : 'Accepter et programmer'
        })
      ).toHaveCount(0);
      expect(
        await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)
      ).toBe(true);
      expect(
        (await new AxeBuilder({ page }).include('dialog[open]').analyze())
          .violations
      ).toEqual([]);
      const link = explanation.getByRole('link', { name: 'Atelier Révisé' });
      await link.focus();
      await expect(link).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(
        /sponsorshipId=22222222-2222-4222-8222-222222222222$/
      );
    });
  }
}

for (const language of ['fr-CA', 'en'] as const) {
  for (const width of [390, 1280]) {
    test(`media withdrawal explains reauthorization and opens the media tab in ${language} at ${width}px`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(
        (locale) => localStorage.setItem('openg7.language', locale),
        language
      );
      await fixtures(
        page,
        'blocked',
        false,
        [
          {
            id: '22222222-2222-4222-8222-222222222222',
            name: 'Atelier Visuel',
            version: 'v2',
            reviewStatus: 'approved',
            presentationApproved: true,
            paymentStatus: 'paid'
          }
        ],
        {
          kind: 'sponsorship',
          errorCode: width === 390 ? 'MEDIA_NOT_APPROVED' : 'MEDIA_CHANGED',
          mediaId: '33333333-3333-4333-8333-333333333333'
        }
      );
      let previewRequests = 0;
      await page.route(
        '**/api/admin/sponsorships/media/content/**',
        async (route) => {
          previewRequests++;
          await route.fulfill({ status: 404, json: { error: 'Not found' } });
        }
      );
      await page.goto(
        '/admin/fundraiser/publications/automation?deliveryId=' + initialJob.id
      );
      const dialog = page.getByRole('dialog', {
        name: language === 'en' ? 'Final publication' : 'Publication finale'
      });
      const explanation = dialog.locator(
        '[data-og7="publication-media-blocker"]'
      );
      await expect(explanation).toContainText(
        language === 'en'
          ? 'Each destination requires a new authorization.'
          : 'Une nouvelle autorisation est nécessaire pour chaque destination.'
      );
      await expect(dialog.getByRole('checkbox')).toHaveCount(0);
      await expect(dialog.getByRole('alert')).toHaveCount(0);
      expect(previewRequests).toBe(0);
      expect(
        await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)
      ).toBe(true);
      expect(
        (await new AxeBuilder({ page }).include('dialog[open]').analyze())
          .violations
      ).toEqual([]);
      await explanation.getByRole('link', { name: 'Atelier Visuel' }).focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(
        /sponsorshipId=22222222-2222-4222-8222-222222222222&tab=media$/
      );
    });
  }
}

test('a blocked publication without a payment fact keeps the general explanation', async ({
  page
}) => {
  await fixtures(
    page,
    'blocked',
    false,
    [
      {
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Atelier Historique',
        version: 'v1',
        reviewStatus: 'approved',
        presentationApproved: true
      }
    ],
    { errorCode: 'SOURCE_NOT_ELIGIBLE' }
  );
  await page.goto(
    '/admin/fundraiser/publications/automation?deliveryId=' + initialJob.id
  );
  const dialog = page.getByRole('dialog', { name: 'Publication finale' });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.locator('[data-og7="publication-payment-blocker"]')
  ).toHaveCount(0);
  await expect(dialog.locator('.alert')).toBeVisible();
});

for (const language of ['fr-CA', 'en'] as const) {
  for (const width of [390, 1280]) {
    test(`uncertain recovery keeps evidence and explicit decisions visible in ${language} at ${width}px`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(
        (locale) => localStorage.setItem('openg7.language', locale),
        language
      );
      const commands = await fixtures(page, 'uncertain');
      const en = language === 'en';
      await page.goto(
        '/admin/fundraiser/publications/automation?deliveryId=' + initialJob.id
      );
      const dialog = page.getByRole('dialog', {
        name: en ? 'Final publication' : 'Publication finale'
      });
      const remoteId = dialog.getByRole('textbox').first();
      const reconcile = dialog.getByRole('button', {
        name: en
          ? 'Verify and confirm publication'
          : 'Vérifier et confirmer la publication'
      });
      await expect(reconcile).toBeDisabled();
      await remoteId.fill('missing-post');
      await reconcile.click();
      await expect(dialog.getByRole('alert')).toContainText(
        en
          ? 'before concluding that it is absent'
          : 'avant de conclure à son absence'
      );
      await expect(
        dialog.getByRole('link', {
          name: en ? 'View publication' : 'Voir la publication'
        })
      ).toHaveCount(0);
      await remoteId.fill('different-post');
      await reconcile.click();
      await expect(dialog.getByRole('alert')).toContainText(
        en ? 'does not match' : 'ne correspond pas'
      );
      await remoteId.fill('verified-post');
      await reconcile.click();
      await expect(
        dialog.getByRole('link', {
          name: en ? 'View publication' : 'Voir la publication'
        })
      ).toBeVisible();
      expect(commands.filter((c) => c.action === 'reconcile')).toHaveLength(3);

      await page.unroute('**/api/**');
      const absenceCommands = await fixtures(page, 'uncertain');
      await page.reload();
      await dialog.locator('summary').click();
      const reason = dialog.locator('textarea');
      const checkbox = dialog.getByRole('checkbox');
      const confirm = dialog.getByRole('button', {
        name: en ? 'Record verification' : 'Consigner la vérification'
      });
      await expect(confirm).toBeDisabled();
      await reason.fill(
        'Checked provider history; no corresponding post was found.'
      );
      await expect(confirm).toBeDisabled();
      await checkbox.check();
      await expect(confirm).toBeEnabled();
      const a11y = await new AxeBuilder({ page })
        .include('dialog[open]')
        .analyze();
      expect(a11y.violations).toEqual([]);
      expect(
        await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)
      ).toBe(true);
      await confirm.focus();
      await page.keyboard.press('Enter');
      expect(absenceCommands).toEqual([
        {
          action: 'confirm-absent',
          id: initialJob.id,
          version: 1,
          confirmation: initialJob.id,
          reason: 'Checked provider history; no corresponding post was found.'
        }
      ]);
      await expect(
        dialog.getByRole('button', {
          name: en ? 'Edit' : 'Modifier',
          exact: true
        })
      ).toBeVisible();
      await expect(
        dialog.getByRole('button', {
          name: en ? 'Accept and schedule' : 'Accepter et programmer'
        })
      ).toHaveCount(0);
    });
  }
}

test('one explicit acceptance reviews pending sponsors and the publication together', async ({
  page
}) => {
  const sponsors: PublicationDelivery['sponsors'] = [
    {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Atelier Boréal',
      version: '2030-06-01 12:00:00+00',
      reviewStatus: 'pending_review',
      presentationApproved: true
    }
  ];
  const commands = await fixtures(page, 'draft', false, sponsors);
  await page.goto('/admin/fundraiser/publications/automation');
  await page.locator('[data-og7-id="' + initialJob.id + '"]').click();
  const dialog = page.getByRole('dialog', { name: 'Publication finale' });
  await expect(dialog.getByRole('textbox')).toHaveCount(0);
  await expect(dialog).toContainText('Atelier Boréal');
  await expect(dialog).toContainText('Leurs fiches restent privées');
  await expect(
    dialog.getByRole('button', { name: 'Accepter et programmer' })
  ).toBeDisabled();
  await dialog
    .getByRole('checkbox', { name: /J’approuve ces commanditaires/ })
    .check();
  await dialog.getByRole('button', { name: 'Accepter et programmer' }).click();
  expect(commands[0]).toMatchObject({
    action: 'approve',
    approveSponsors: [{ id: sponsors[0]!.id, version: sponsors[0]!.version }]
  });
  await expect(dialog).toContainText('Autorisée');
});

test('a missing sponsor photo blocks acceptance and links to the dossier', async ({
  page
}) => {
  await fixtures(page, 'draft', false, [
    {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Atelier Boréal',
      version: 'v1',
      reviewStatus: 'pending_review',
      presentationApproved: false
    }
  ]);
  await page.goto('/admin/fundraiser/publications/automation');
  await page.locator('[data-og7-id="' + initialJob.id + '"]').click();
  const dialog = page.getByRole('dialog', { name: 'Publication finale' });
  await expect(dialog).toContainText('Photo de présentation à fournir');
  await expect(
    dialog.getByRole('checkbox', { name: /J’approuve/ })
  ).toBeDisabled();
  await expect(
    dialog.getByRole('link', { name: 'Atelier Boréal' })
  ).toHaveAttribute('href', /sponsorshipId=22222222/);
  const a11y = await new AxeBuilder({ page }).include('dialog[open]').analyze();
  expect(a11y.violations).toEqual([]);
});

test('refusing a proposal requires a decision and moves it to history', async ({
  page
}) => {
  const commands = await fixtures(page);
  await page.goto('/admin/fundraiser/publications/automation');
  await page.locator('[data-og7-id="' + initialJob.id + '"]').click();
  const dialog = page.getByRole('dialog', { name: 'Publication finale' });
  await dialog.getByRole('button', { name: 'Refuser', exact: true }).click();
  await expect(
    page.getByText(/Ce lot restera dans l’historique/)
  ).toBeVisible();
  expect(commands).toHaveLength(0);
  await page.locator('[data-og7="confirm-action"]').click();
  await expect(dialog).toContainText('Refusée');
  expect(commands[0]).toMatchObject({
    action: 'reject',
    id: initialJob.id,
    version: 1
  });
  await dialog.getByRole('button', { name: 'Fermer', exact: true }).click();
  await expect(
    page.locator('[data-og7-id="' + initialJob.id + '"]').first()
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Historique', exact: true }).click();
  await expect(
    page.locator('[data-og7-id="' + initialJob.id + '"]').first()
  ).toContainText('Refusée');
});

test('private media uses the authenticated admin preview before acceptance', async ({
  page
}) => {
  const mediaId = '33333333-3333-4333-8333-333333333333';
  await fixtures(page, 'draft', false, [], {
    mediaId,
    mediaUrl: 'https://example.test/private.png',
    mediaAlt: 'Photo approuvée'
  });
  let previewRequests = 0;
  await page.route(
    '**/api/admin/sponsorships/media/content/' + mediaId,
    async (route) => {
      previewRequests++;
      await route.fulfill({
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
          'base64'
        )
      });
    }
  );
  await page.goto('/admin/fundraiser/publications/automation');
  await page.locator('[data-og7-id="' + initialJob.id + '"]').click();
  const dialog = page.getByRole('dialog', { name: 'Publication finale' });
  await expect(
    dialog.getByRole('img', { name: 'Photo approuvée' })
  ).toHaveAttribute('src', /^blob:/);
  expect(previewRequests).toBe(1);
  await dialog.getByRole('checkbox', { name: /J’approuve/ }).check();
  await expect(
    dialog.getByRole('button', { name: 'Accepter et programmer' })
  ).toBeEnabled();
});

test('editorial posts appear in the calendar with localized status and open their approval', async ({
  page
}) => {
  await fixtures(page);
  await page.goto('/admin/fundraiser/publications/automation');
  await page.getByRole('button', { name: 'Calendrier', exact: true }).click();
  await page.getByLabel('Choisir un mois').fill('2030-06');
  const entry = page.locator(
    '[data-og7="calendar-entry"][data-og7-id="' + initialJob.id + '"]'
  );
  await expect(entry).toContainText('Notre prochaine réalisation');
  await expect(entry).toContainText('Actualité');
  await page.screenshot({
    path: 'test-results/admin-layout/publication-automation-calendar.png',
    fullPage: true
  });
  await entry.click();
  await expect(
    page.getByRole('dialog', { name: 'Publication finale' })
  ).toBeVisible();
});

test('mobile keyboard flow, contrast and focus restoration', async ({
  page
}) => {
  await fixtures(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin/fundraiser/publications/automation');
  await expect(
    page.getByRole('heading', { name: 'Pilotage des feeds', exact: true })
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  const item = page.locator('[data-og7-id="' + initialJob.id + '"]');
  await item.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Publication finale' });
  await expect(dialog).toBeVisible();
  const a11y = await new AxeBuilder({ page }).include('dialog[open]').analyze();
  expect(a11y.violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(item).toBeFocused();
  await page.screenshot({
    path: 'test-results/admin-layout/publication-automation-mobile.png',
    fullPage: true
  });
});

for (const width of [1280, 390]) {
  test(`dossier bridge filters the engine and returns to publication at ${width}px`, async ({
    page
  }) => {
    const sponsorId = '10000000-0000-4000-8000-000000000401';
    const commands = await fixtures(
      page,
      'approved',
      false,
      [
        {
          id: sponsorId,
          name: 'Synthetic sponsor',
          version: 'v1',
          reviewStatus: 'approved',
          presentationApproved: true
        }
      ],
      { kind: 'sponsorship' },
      {
        extraDeliveries: [
          {
            ...initialJob,
            id: '22222222-2222-4222-8222-222222222222',
            message: 'Unrelated publication'
          }
        ]
      }
    );
    await page.setViewportSize({ width, height: 844 });
    await page.goto(
      `/admin/fundraiser/publications/automation?sponsorshipId=${sponsorId}`
    );
    await expect(
      page.locator('[data-og7="publication-dossier-context"]')
    ).toContainText('Publications liées à ce dossier');
    await expect(
      page.getByText('Unrelated publication', { exact: true })
    ).toHaveCount(0);
    await expect(
      page.locator(`[data-og7-id="${initialJob.id}"]`)
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Retour à l’étape 6' })
    ).toHaveAttribute(
      'href',
      `/admin/fundraiser/sponsors?sponsorshipId=${sponsorId}&tab=publication#dossier-publication`
    );
    expect(commands).toHaveLength(0);
    await page.getByRole('link', { name: 'Voir tous les dossiers' }).click();
    await expect(
      page.getByText('Unrelated publication', { exact: true })
    ).toBeVisible();
    await expect(
      page.locator('[data-og7="publication-dossier-context"]')
    ).toHaveCount(0);
    await page.goto(
      `/admin/fundraiser/publications/automation?sponsorshipId=${sponsorId}&deliveryId=${initialJob.id}`
    );
    await expect(
      page.getByRole('dialog', { name: 'Publication finale' })
    ).toBeVisible();
    expect(commands).toHaveLength(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(width);
  });
}

test('missing or mismatched delivery does not open another publication or compose a batch', async ({
  page
}) => {
  const commands = await fixtures(page);
  await page.goto(
    `/admin/fundraiser/publications/automation?sponsorshipId=10000000-0000-4000-8000-000000000401&deliveryId=${initialJob.id}&batchId=${initialJob.id}&feedId=openg20:facebook`
  );
  await expect(
    page.getByText('Cette publication est introuvable', { exact: false })
  ).toBeVisible();
  await expect(
    page.getByRole('dialog', { name: 'Publication finale' })
  ).toHaveCount(0);
  expect(commands).toHaveLength(0);
});

test('approval rereads the dossier scope and waits for server state before feedback', async ({
  page
}) => {
  const sponsorId = '10000000-0000-4000-8000-000000000401';
  let reads = 0;
  let releaseRead!: () => void;
  const reread = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  const commands = await fixtures(
    page,
    'draft',
    false,
    [
      {
        id: sponsorId,
        name: 'Synthetic scoped sponsor',
        version: 'v1',
        reviewStatus: 'approved',
        presentationApproved: true
      }
    ],
    { kind: 'sponsorship' },
    {
      extraDeliveries: [
        {
          ...initialJob,
          id: '22222222-2222-4222-8222-222222222222',
          message: 'Unrelated scoped publication'
        }
      ],
      readResponse: async () => {
        if (++reads > 1) await reread;
      }
    }
  );
  await page.goto(
    `/admin/fundraiser/publications/automation?sponsorshipId=${sponsorId}&deliveryId=${initialJob.id}`
  );
  const drawer = page.getByRole('dialog', { name: 'Publication finale' });
  await expect(drawer).toBeVisible();
  await drawer.getByRole('checkbox').check();
  try {
    await drawer
      .getByRole('button', { name: 'Accepter et programmer', exact: true })
      .click();
    await expect.poll(() => reads).toBe(2);
    expect(commands).toHaveLength(1);
    await expect(
      page.locator('[data-og7="publication-automation"]')
    ).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByText('Enregistré.', { exact: true })).toHaveCount(0);
    await expect(
      drawer.getByRole('button', {
        name: 'Accepter et programmer',
        exact: true
      })
    ).toBeDisabled();
  } finally {
    releaseRead();
  }
  await expect(
    page.locator('[data-og7="publication-automation"]')
  ).toHaveAttribute('aria-busy', 'false');
  await expect(drawer).toContainText('Autorisée');
  await expect(
    page.getByText('Unrelated scoped publication', { exact: true })
  ).toHaveCount(0);
  expect(commands).toHaveLength(1);
});
