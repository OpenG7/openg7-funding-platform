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
    deliveries: [{ ...initialJob, status, sponsors, ...overrides }]
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
    if (route.request().method() === 'GET')
      return route.fulfill({ json: state });
    const c = route.request().postDataJSON() as PublicationAutomationCommand;
    commands.push(c);
    if (c.action === 'worker') await options.workerResponse?.();
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
          .include('[data-og7="publication-worker"]')
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
