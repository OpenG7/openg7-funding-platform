import { expect, test } from '@playwright/test';

// Covers the three local-development-only pages (stripe-setup-page,
// webhooks-page, api-keys-page components): routes gated by
// `canMatch: [localDevelopmentOnly]` in app.routes.ts, which only matches
// on localhost/127.0.0.1 -- exactly what playwright.config.ts's baseURL
// points at, so these are reachable in this suite even though they'd be
// unreachable in a deployed environment. All three share the same
// unauthenticated GET /api/dev/stripe-setup-status
// (StripeSetupDevService.getStatus()) and are otherwise read-only displays
// plus copy-to-clipboard/open-in-new-tab buttons. Only stripe-setup-page
// renders its loadError() state anywhere in the template, so the error
// scenario below is only exercised there.

test.describe('Docker dev stripe setup page', () => {
  test('renders the setup stages and toggles the payment mode', async ({
    page
  }) => {
    await page.goto('/dev/stripe-setup');

    await expect(page.locator('#stripe-setup-title')).toContainText(
      '/dev/stripe-setup'
    );
    await expect(
      page.getByRole('listitem').filter({ hasText: 'Connecter le compte' })
    ).toBeVisible();

    const modePanel = page.locator('.mode-panel');
    const testButton = modePanel.getByRole('button', { name: /Test/ });
    const liveButton = modePanel.getByRole('button', { name: /Live/ });

    await expect(liveButton).toHaveClass(/active/);
    await testButton.click();
    await expect(testButton).toHaveClass(/active/);
    await expect(liveButton).not.toHaveClass(/active/);
  });

  test('marks a developer command step as done and remembers it after a reload', async ({
    page
  }) => {
    await page.goto('/dev/stripe-setup');

    const firstStep = page.locator('.developer-commands li').first();
    await expect(firstStep).not.toHaveClass(/done/);

    await firstStep.locator('.command-step').click();
    await expect(firstStep).toHaveClass(/done/);

    await page.reload();
    await expect(
      page.locator('.developer-commands li').first()
    ).toHaveClass(/done/);
  });

  test('copies the webhook endpoint and opens the Stripe dashboard in a new tab', async ({
    page,
    context
  }) => {
    await page.goto('/dev/stripe-setup');

    // Clipboard content isn't asserted here: navigator.clipboard.readText()
    // needs OS-level clipboard access that's flaky across sandboxed/headless
    // environments even with permissions granted, so this only checks that
    // clicking "Copier" doesn't throw and leaves the page usable.
    await page
      .locator('.webhook-panel')
      .getByRole('button', { name: 'Copier', exact: true })
      .click();
    await expect(page.locator('#stripe-setup-title')).toBeVisible();

    const [newPage] = await Promise.all([
      context.waitForEvent('page'),
      page
        .locator('.account-panel')
        .getByRole('button', { name: 'Gerer le compte Stripe' })
        .click()
    ]);
    await newPage.waitForLoadState();
    expect(newPage.url()).toContain('dashboard.stripe.com');
    await newPage.close();
  });

  test('shows the local-diagnostic warning when the status request fails', async ({
    page
  }) => {
    await page.route('**/dev/stripe-setup-status', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: '{}'
      })
    );
    await page.goto('/dev/stripe-setup');

    await expect(
      page.getByText('Diagnostic local indisponible. Verifiez que yarn dev tourne.', {
        exact: true
      })
    ).toBeVisible();
  });
});

test.describe('Docker dev webhooks page', () => {
  test('renders the webhook status, event list, and diagnostics log', async ({
    page
  }) => {
    await page.goto('/dev/webhooks');

    await expect(page.locator('#webhooks-title')).toContainText(
      '/dev/webhooks'
    );
    await expect(
      page.getByRole('heading', { name: 'API locale' })
    ).toBeVisible();
    await expect(
      page.getByText('checkout.session.completed', { exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Journal de diagnostics' })
    ).toBeVisible();

    await page
      .getByRole('button', { name: "Revalider l'API", exact: true })
      .click();
    await expect(page.locator('#webhooks-title')).toContainText(
      '/dev/webhooks'
    );
  });

  test('copies the webhook endpoint without breaking the page', async ({
    page
  }) => {
    await page.goto('/dev/webhooks');

    await page
      .locator('.endpoint-panel')
      .getByRole('button', { name: 'Copier', exact: true })
      .click();
    await expect(page.locator('#webhooks-title')).toBeVisible();
  });
});

test.describe('Docker dev API keys page', () => {
  test('renders the key status cards, rotation steps, and permissions table', async ({
    page
  }) => {
    await page.goto('/dev/api-keys');

    await expect(page.locator('#api-keys-title')).toContainText(
      '/dev/api-keys'
    );
    await expect(
      page.getByRole('heading', { name: 'Cle secrete' })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Rotation securisee' })
    ).toBeVisible();
    await expect(
      page.getByText('checkout.sessions', { exact: true })
    ).toBeVisible();

    await page.getByRole('button', { name: 'Revalider', exact: true }).click();
    await expect(page.locator('#api-keys-title')).toContainText(
      '/dev/api-keys'
    );
  });

  test('copies the secret key command without breaking the page', async ({
    page
  }) => {
    await page.goto('/dev/api-keys');

    await page
      .locator('.command-panel article')
      .first()
      .getByRole('button', { name: 'Copier', exact: true })
      .click();
    await expect(page.locator('#api-keys-title')).toBeVisible();
  });
});
