import type { Page } from '@playwright/test';

import { expect, test } from './support/test.js';
import {
  controllerJourneysFixtures,
  controllerAssetId as assetId,
  controllerPath as path
} from './support/controller-journeys.fixtures.js';
import {
  virtualController,
  virtualFrames,
  virtualHook as hook
} from './support/virtual-controller.js';
import { sandboxPaymentFixtures } from './support/sandbox-payment.fixtures.js';

test.setTimeout(90_000);
test.use({ actionTimeout: 10_000 });
const manifest = {
  version: 1,
  enabled: true,
  stripeBasePath: '/__sandbox/stripe'
};

async function fixtures(
  page: Page,
  options: { locale?: string; status?: number; manifest?: unknown } = {}
) {
  const state = await controllerJourneysFixtures(
    page,
    'owner',
    options.locale ?? 'en',
    { hardware: 'native' }
  );
  await page.route('**/openg7-sandbox.json', (route) =>
    route.fulfill({
      status: options.status ?? 200,
      json: options.manifest ?? manifest
    })
  );
  return state;
}

async function editIdentity(page: Page) {
  await hook(page, 'edit-dossier').click();
  const field = hook(page, 'edit-dossier-form').locator('[name="companyName"]');
  await expect(field).toBeVisible();
  await field.click();
  return field;
}

for (const denied of [
  { name: 'missing manifest', status: 404, manifest: {} },
  { name: 'disabled manifest', manifest: { ...manifest, enabled: false } },
  { name: 'unknown manifest version', manifest: { ...manifest, version: 2 } },
  {
    name: 'remote Stripe path',
    manifest: { ...manifest, stripeBasePath: 'https://example.invalid/stripe' }
  },
  { name: 'unavailable manifest', status: 503, manifest: {} }
]) {
  test(`the simulation controls fail closed with ${denied.name}`, async ({
    page
  }) => {
    const state = await fixtures(page, denied);
    const loaded = page.waitForResponse('**/openg7-sandbox.json');
    await page.goto(path('identity'));
    await loaded;
    await expect(hook(page, 'edit-dossier')).toBeVisible();
    await virtualFrames(page);
    await expect(hook(page, 'sandbox-controller-open')).toHaveCount(0);
    await expect(hook(page, 'sandbox-payments-open')).toHaveCount(0);
    await expect(hook(page, 'virtual-controller')).not.toBeVisible();
    expect(state.commands).toEqual([]);
  });
}

test('a non-loopback site cannot activate the simulator even with a valid capability response available', async ({
  page
}) => {
  await fixtures(page);
  let manifestReads = 0;
  await page.route('**/openg7-sandbox.json', (route) => {
    manifestReads++;
    return route.fulfill({ json: manifest });
  });
  // Serve the same built files at a synthetic public origin without contacting that host.
  await page.route('https://funding.example.test/**', async (route) => {
    const url = new URL(route.request().url());
    if (
      url.pathname.startsWith('/api/') ||
      url.pathname === '/openg7-sandbox.json'
    )
      return route.fallback();
    const response = await page.request.get(
      'http://127.0.0.1:4179' + url.pathname + url.search
    );
    return route.fulfill({ response });
  });
  await page.goto('https://funding.example.test' + path());
  await expect(hook(page, 'edit-dossier')).toBeVisible();
  await virtualFrames(page);
  await expect(hook(page, 'sandbox-controller-open')).toHaveCount(0);
  await expect(hook(page, 'sandbox-payments-open')).toHaveCount(0);
  expect(manifestReads).toBe(0);
});

test('the shipped mouse panel exposes all Xbox inputs without replacing the browser Gamepad API', async ({
  page
}) => {
  const state = await fixtures(page);
  await page.goto(path('identity'));
  const pad = virtualController(page);
  await pad.open();
  await expect(hook(page, 'virtual-button')).toHaveCount(17);
  await expect(hook(page, 'virtual-stick')).toHaveCount(2);
  await expect(hook(page, 'virtual-trigger')).toHaveCount(2);
  expect(await pad.values('buttons')).toEqual(Array(17).fill(0));
  expect(await pad.values('axes')).toEqual([0, 0, 0, 0]);
  expect(await page.evaluate(() => navigator.getGamepads.toString())).toContain(
    '[native code]'
  );
  const field = await editIdentity(page);
  for (let index = 0; index < 17; index++) {
    if (!(await field.isVisible())) await editIdentity(page);
    await field.click();
    await pad.hold(index);
    await expect.poll(async () => (await pad.values('buttons'))[index]).toBe(1);
    expect(
      await page.evaluate(
        () =>
          !!document.activeElement?.closest('[data-og7="virtual-controller"]')
      )
    ).toBe(false);
    if ([6, 7, 8, 9, 10, 11, 16].includes(index))
      await expect(field).toBeFocused();
    if ([0, 2].includes(index))
      await expect(hook(page, 'controller-editor')).toBeVisible();
    if ([8, 9].includes(index))
      await expect(hook(page, 'controller-menu')).not.toBeVisible();
    await pad.release();
    await expect.poll(() => pad.values('buttons')).toEqual(Array(17).fill(0));
    if (
      (await hook(page, 'controller-editor').isVisible()) ||
      (await hook(page, 'controller-menu').isVisible()) ||
      (await hook(page, 'admin-guidance-panel').isVisible())
    )
      await pad.press(1);
  }
  await expect(field).toHaveValue('Xbox fixture');
  await pad.press(1);
  for (const index of [8, 9]) {
    await pad.press(index);
    await expect(hook(page, 'controller-menu')).toBeVisible();
    await pad.press(1);
  }
  expect(state.commands).toEqual([]);
});

test('quick mouse clicks retain the focused field and edit through the native modal without submitting it', async ({
  page
}) => {
  const state = await fixtures(page);
  await page.goto(path('identity'));
  const pad = virtualController(page);
  await pad.open();
  const field = await editIdentity(page);
  await pad.press(0);
  const editor = hook(page, 'controller-editor');
  await expect(editor).toBeVisible();
  expect(
    await editor.evaluate((element) =>
      element.closest('dialog')?.matches(':modal')
    )
  ).toBe(true);
  expect(
    await pad.surface.evaluate(
      (element) =>
        element.closest('dialog')?.matches('[data-og7="controller-editor"]') ===
        true
    )
  ).toBe(true);
  await pad.activate(hook(page, 'editor-clear'));
  await pad.activate(hook(page, 'editor-key', 'x'));
  await expect(hook(page, 'editor-preview')).toContainText('x');
  await pad.press(1);
  await expect(editor).not.toBeVisible();
  await expect(field).toHaveValue('Xbox fixture');
  await expect(field).toBeFocused();
  await pad.press(0);
  await expect(editor).toBeVisible();
  await pad.press(1);
  expect(state.commands).toEqual([]);
});

test('holding mouse A across a real confirmation cannot confirm until release and a fresh press', async ({
  page
}) => {
  const state = await fixtures(page);
  await page.goto('/admin/fundraiser/email-queue?messageId=' + assetId);
  const pad = virtualController(page);
  await pad.open();
  const retry = page.getByRole('button', { name: 'Retry', exact: true });
  await retry.click();
  await expect(hook(page, 'confirm-action')).toBeVisible();
  await pad.press(1);
  await expect(hook(page, 'confirm-action')).toHaveCount(0);
  await expect(retry).toBeFocused();
  try {
    await pad.hold(0);
    const confirmation = hook(page, 'confirm-action');
    await expect(confirmation).toBeVisible();
    expect(
      await confirmation.evaluate((element) =>
        element.closest('dialog')?.matches(':modal')
      )
    ).toBe(true);
    expect(
      await pad.surface.evaluate(
        (element) =>
          !!element
            .closest('dialog')
            ?.querySelector('[data-og7="confirm-action"]')
      )
    ).toBe(true);
    await virtualFrames(page, 12);
    expect((await pad.values('buttons'))[0]).toBe(1);
    expect(state.commands).toEqual([]);
  } finally {
    await pad.release();
  }
  await pad.press(1);
  expect(state.commands).toEqual([]);
  await pad.activate(retry);
  await pad.activate(hook(page, 'confirm-action'));
  await expect
    .poll(
      () =>
        state.commands.filter((item) =>
          item.path.endsWith('/email-queue/retry')
        ).length
    )
    .toBe(1);
  expect(state.commands[0]!.body.messageId).toBe(assetId);
});

test('mouse sticks expose all four axes and the unused horizontal right axis never performs a business action', async ({
  page
}) => {
  const state = await fixtures(page);
  await page.goto(path('identity'));
  const pad = virtualController(page);
  await pad.open();
  const field = await editIdentity(page);
  try {
    await pad.dragStick('left', -0.8, -0.8);
    const axes = await pad.values('axes');
    expect(axes[0]).toBeLessThan(-0.45);
    expect(axes[1]).toBeLessThan(-0.45);
  } finally {
    await pad.release();
  }
  await expect.poll(() => pad.values('axes')).toEqual([0, 0, 0, 0]);
  await field.click();
  try {
    await pad.dragStick('right', 0.8, 0);
    expect((await pad.values('axes'))[2]).toBeGreaterThan(0.45);
    await expect(field).toBeFocused();
    expect(state.commands).toEqual([]);
  } finally {
    await pad.release();
  }
  await field.click();
  await hook(page, 'virtual-stick', 'right').scrollIntoViewIfNeeded();
  const scroll = () =>
    page.evaluate(
      () =>
        scrollY +
        Array.from(document.querySelectorAll('*')).reduce(
          (sum, node) => sum + node.scrollTop,
          0
        )
    );
  const before = await scroll();
  try {
    await pad.dragStick('right', 0, 0.8);
    expect((await pad.values('axes'))[3]).toBeGreaterThan(0.45);
    await expect.poll(scroll).toBeGreaterThan(before);
  } finally {
    await pad.release();
  }
  await expect.poll(() => pad.values('axes')).toEqual([0, 0, 0, 0]);
  expect(state.commands).toEqual([]);
});

test('LT locking, release-all and closing preserve the neutral safety boundary', async ({
  page
}) => {
  const state = await fixtures(page);
  await page.goto(path('identity'));
  const pad = virtualController(page);
  await pad.open();
  const field = await editIdentity(page);
  await hook(page, 'virtual-lock-lt').click();
  expect((await pad.values('buttons'))[6]).toBe(1);
  await expect(field).toBeFocused();
  await pad.press(0);
  await expect(hook(page, 'controller-editor')).not.toBeVisible();
  await pad.neutral();
  await pad.press(0);
  await expect(hook(page, 'controller-editor')).toBeVisible();
  await pad.press(1);
  await pad.press(1);
  await hook(page, 'virtual-lock-lt').click();
  expect((await pad.values('buttons'))[6]).toBe(1);
  await pad.close();
  await pad.open();
  expect(await pad.values('buttons')).toEqual(Array(17).fill(0));
  expect(await pad.values('axes')).toEqual([0, 0, 0, 0]);
  expect(state.commands).toEqual([]);
});

test('the two mouse trigger sliders preserve analog values and release without stealing field focus', async ({
  page
}) => {
  const state = await fixtures(page);
  await page.goto(path('identity'));
  const pad = virtualController(page);
  await pad.open();
  const field = await editIdentity(page);
  for (const index of [6, 7]) {
    await field.click();
    const trigger = hook(page, 'virtual-trigger', index);
    await trigger.scrollIntoViewIfNeeded();
    const rect = await trigger.boundingBox();
    expect(rect).not.toBeNull();
    try {
      await page.mouse.move(
        rect!.x + rect!.width * 0.82,
        rect!.y + rect!.height / 2
      );
      await page.mouse.down();
      await virtualFrames(page);
      const value = (await pad.values('buttons'))[index]!;
      expect(value).toBeGreaterThan(0.6);
      expect(value).toBeLessThan(1);
      await expect(field).toBeFocused();
    } finally {
      await pad.release();
    }
    await expect.poll(() => pad.values('buttons')).toEqual(Array(17).fill(0));
  }
  expect(state.commands).toEqual([]);
});

test('all stick direction buttons use the same sampled axes and return to neutral', async ({
  page
}) => {
  const state = await fixtures(page);
  await page.goto(path('identity'));
  const pad = virtualController(page);
  await pad.open();
  const field = await editIdentity(page);
  for (const [direction, axis, value] of [
    ['left-up', 1, -1],
    ['left-down', 1, 1],
    ['left-left', 0, -1],
    ['left-right', 0, 1],
    ['right-up', 3, -1],
    ['right-down', 3, 1],
    ['right-left', 2, -1],
    ['right-right', 2, 1]
  ] as const) {
    await field.click();
    const control = hook(page, 'virtual-stick-direction', direction);
    await control.scrollIntoViewIfNeeded();
    const rect = await control.boundingBox();
    expect(rect).not.toBeNull();
    try {
      await page.mouse.move(
        rect!.x + rect!.width / 2,
        rect!.y + rect!.height / 2
      );
      await page.mouse.down();
      await virtualFrames(page);
      expect((await pad.values('axes'))[axis]).toBe(value);
    } finally {
      await pad.release();
    }
    await expect.poll(() => pad.values('axes')).toEqual([0, 0, 0, 0]);
  }
  expect(state.commands).toEqual([]);
});

test('the virtual panel survives route navigation while stale held input and reload cannot replay an action', async ({
  page
}) => {
  const state = await fixtures(page);
  await page.goto(path('identity'));
  const pad = virtualController(page);
  await pad.open();
  const contributions = page.locator(
    'openg7-admin-nav a[href="/admin/fundraiser/contributions"]'
  );
  await pad.reach(contributions);
  try {
    await pad.hold(0);
    await expect(page).toHaveURL(/\/contributions$/);
    await expect(pad.surface).toBeVisible();
    await virtualFrames(page, 10);
    expect(state.commands).toEqual([]);
  } finally {
    await pad.release();
  }
  await pad.neutral();
  await pad.close();
  await page.reload();
  await expect(hook(page, 'sandbox-controller-open')).toBeVisible();
  await expect(pad.surface).not.toBeVisible();
  expect(state.commands).toEqual([]);
});

test('a browser blur event releases mouse-held input before the virtual editor can resume', async ({
  page
}) => {
  const state = await fixtures(page);
  await page.goto(path('identity'));
  const pad = virtualController(page);
  await pad.open();
  await editIdentity(page);
  try {
    await pad.hold(0);
    await expect(hook(page, 'controller-editor')).toBeVisible();
    // Headless Chromium does not emit an OS focus change when opening another tab.
    // Exercise the public browser event boundary without calling a controller handler.
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await virtualFrames(page);
    expect(await pad.values('buttons')).toEqual(Array(17).fill(0));
    expect(await pad.values('axes')).toEqual([0, 0, 0, 0]);
    expect(state.commands).toEqual([]);
  } finally {
    await pad.release();
  }
  await pad.press(1);
  expect(state.commands).toEqual([]);
});

for (const viewport of [
  { width: 390, height: 844, locale: 'en' },
  { width: 1440, height: 1000, locale: 'fr-CA' }
]) {
  test(`the mouse controller stays usable and translated at ${viewport.width}px in ${viewport.locale}`, async ({
    page
  }, info) => {
    await fixtures(page, viewport);
    await page.setViewportSize(viewport);
    await page.goto(path('identity'));
    const pad = virtualController(page);
    await pad.open();
    await expect(pad.surface).not.toContainText('admin.controller.');
    const dock = hook(page, 'sandbox-controller-dock');
    await expect(dock).toBeVisible();
    const rect = await dock.boundingBox();
    expect(rect).not.toBeNull();
    expect(rect!.x).toBeGreaterThanOrEqual(0);
    expect(rect!.y).toBeGreaterThanOrEqual(0);
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(rect!.y + rect!.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1
      )
    ).toBe(true);
    const field = await editIdentity(page);
    await pad.press(0);
    await expect(hook(page, 'controller-editor')).toBeVisible();
    await expect(hook(page, 'controller-editor')).not.toContainText(
      'admin.controller.'
    );
    await pad.press(1);
    await expect(field).toHaveValue('Xbox fixture');
    await pad.press(1);
    await page.locator('.topbar').scrollIntoViewIfNeeded();
    const headerControls = await page
      .locator('.topbar button:visible,.topbar a[href]:visible')
      .evaluateAll((elements) =>
        elements.map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            x: rect.x,
            y: rect.y,
            right: rect.right,
            bottom: rect.bottom
          };
        })
      );
    expect(headerControls.length).toBeGreaterThan(3);
    for (const [index, rect] of headerControls.entries()) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(viewport.width + 1);
      for (const other of headerControls.slice(index + 1)) {
        const overlap =
          Math.max(
            0,
            Math.min(rect.right, other.right) - Math.max(rect.x, other.x)
          ) *
          Math.max(
            0,
            Math.min(rect.bottom, other.bottom) - Math.max(rect.y, other.y)
          );
        expect(overlap).toBeLessThanOrEqual(1);
      }
    }
    await page.screenshot({ path: info.outputPath('virtual-controller.png') });
    await pad.close();
  });
}

test('a simulated browser return cannot substitute for private payment confirmation, even after navigation', async ({
  page
}) => {
  await fixtures(page);
  const payments = await sandboxPaymentFixtures(page);
  let releaseProvider!: () => void;
  payments.providerGate = new Promise<void>((resolve) => {
    releaseProvider = resolve;
  });
  payments.privatePaid = false;
  await page.goto(path('identity'));
  const pad = virtualController(page);
  await pad.open();
  await hook(page, 'sandbox-payments-open').click();
  await expect(hook(page, 'sandbox-payment-create')).toBeDisabled();
  await hook(page, 'sandbox-payment-accept').check();
  await hook(page, 'sandbox-payment-create').click();
  try {
    await expect.poll(() => payments.providerCalls.length).toBe(1);
    await expect(hook(page, 'sandbox-payment-state')).toHaveAttribute(
      'data-state',
      'paying'
    );
    await expect(hook(page, 'sandbox-payment-create')).toBeDisabled();
    await pad.activate(
      page.locator('openg7-admin-nav a[href="/admin/fundraiser/contributions"]')
    );
    await expect(page).toHaveURL(/\/contributions$/);
    await hook(page, 'sandbox-payments-open').click();
    await expect(hook(page, 'sandbox-payment-state')).toHaveAttribute(
      'data-state',
      'paying'
    );
    const readsBeforeReturn = payments.privateReads;
    releaseProvider();
    await expect.poll(() => payments.providerCalls.length).toBe(1);
    await expect
      .poll(() => payments.privateReads)
      .toBeGreaterThan(readsBeforeReturn);
    await expect(hook(page, 'sandbox-payment-open-journey')).toHaveCount(0);
    await expect(hook(page, 'sandbox-payment-state')).toHaveAttribute(
      'data-state',
      'paying'
    );
    payments.privatePaid = true;
    const id = payments.attempts[0]!.contributionId;
    await expect(hook(page, 'sandbox-payment-state')).toHaveAttribute(
      'data-contribution-id',
      id
    );
    expect(payments.attempts[0]!.input).toMatchObject({
      amount: 25,
      currency: 'CAD',
      contributionType: 'personal_support',
      nonCharityAcknowledged: true
    });
    await hook(page, 'sandbox-payment-open-journey').click();
    await expect(page).toHaveURL(
      new RegExp('/attention\\?paymentJourney=' + id + '$')
    );
    await expect(hook(page, 'payment-journey-complete')).toHaveCount(0);
    await expect(hook(page, 'payment-journey-next')).toBeVisible();
    await hook(page, 'sandbox-payments-open').click();
    await hook(page, 'sandbox-payment-new').click();
    await expect(hook(page, 'sandbox-payment-accept')).not.toBeChecked();
    await hook(page, 'sandbox-payment-accept').check();
    await hook(page, 'sandbox-payment-create').click();
    await expect.poll(() => payments.attempts.length).toBe(2);
    await expect(hook(page, 'sandbox-payment-state')).toHaveAttribute(
      'data-contribution-id',
      payments.attempts[1]!.contributionId
    );
    expect(payments.attempts[1]!.input.idempotencyKey).not.toBe(
      payments.attempts[0]!.input.idempotencyKey
    );
    await expect(page).toHaveURL(new RegExp('paymentJourney=' + id + '$'));
    await expect(hook(page, 'payment-journey-complete')).toHaveCount(0);
  } finally {
    releaseProvider();
  }
});

test('a provider failure reconciles the same public Checkout after reload without starting another payment', async ({
  page
}) => {
  await fixtures(page);
  const payments = await sandboxPaymentFixtures(page);
  payments.providerFails = true;
  await page.goto(path());
  await virtualController(page).open();
  await hook(page, 'sandbox-payments-open').click();
  await hook(page, 'sandbox-payment-accept').check();
  await hook(page, 'sandbox-payment-create').click();
  await expect(hook(page, 'sandbox-payment-state')).toHaveAttribute(
    'data-state',
    'error'
  );
  await expect(hook(page, 'sandbox-payment-open-journey')).toHaveCount(0);
  const stored = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem('og7-admin-sandbox-checkout:v1')!)
  );
  expect(Object.keys(stored).sort()).toEqual([
    'amountMinor',
    'checkoutId',
    'kind',
    'publicConsent'
  ]);
  expect(stored.checkoutId).toBe(payments.attempts[0]!.checkoutId);
  payments.providerFails = false;
  await page.reload();
  await virtualController(page).open();
  await hook(page, 'sandbox-payments-open').click();
  await expect(hook(page, 'sandbox-payment-accept')).not.toBeChecked();
  await expect(hook(page, 'sandbox-payment-create')).toBeDisabled();
  await hook(page, 'sandbox-payment-accept').check();
  await hook(page, 'sandbox-payment-create').click();
  await expect(hook(page, 'sandbox-payment-state')).toHaveAttribute(
    'data-state',
    'confirmed'
  );
  expect(payments.attempts).toHaveLength(1);
  expect(payments.providerCalls.map((item) => item.checkoutId)).toEqual([
    stored.checkoutId,
    stored.checkoutId
  ]);
});

test('an external Checkout destination is refused before any provider request or admin journey', async ({
  page
}) => {
  await fixtures(page);
  const payments = await sandboxPaymentFixtures(page);
  payments.redirect =
    'https://provider.example.invalid/checkout/cs_test_virtual_1';
  const outbound: string[] = [];
  await page.route('https://provider.example.invalid/**', (route) => {
    outbound.push(route.request().url());
    return route.abort();
  });
  await page.goto(path());
  await virtualController(page).open();
  await hook(page, 'sandbox-payments-open').click();
  await hook(page, 'sandbox-payment-accept').check();
  await hook(page, 'sandbox-payment-create').click();
  await expect(hook(page, 'sandbox-payment-state')).toHaveAttribute(
    'data-state',
    'error'
  );
  expect(outbound).toEqual([]);
  expect(payments.providerCalls).toEqual([]);
  await expect(hook(page, 'sandbox-payment-open-journey')).toHaveCount(0);
});

test('company simulation submits the currently accepted offer and consent without granting publication', async ({
  page
}) => {
  const admin = await fixtures(page);
  const payments = await sandboxPaymentFixtures(page);
  await page.goto(path());
  await virtualController(page).open();
  await hook(page, 'sandbox-payments-open').click();
  await hook(page, 'sandbox-payment-kind').selectOption('sponsorship_interest');
  await expect(hook(page, 'sandbox-payment-state')).toHaveAttribute(
    'data-state',
    'ready'
  );
  await hook(page, 'sandbox-payment-accept').check();
  await hook(page, 'sandbox-payment-amount').selectOption('250');
  await expect(hook(page, 'sandbox-payment-accept')).not.toBeChecked();
  await expect(hook(page, 'sandbox-payment-state')).toHaveAttribute(
    'data-state',
    'ready'
  );
  await hook(page, 'sandbox-payment-accept').check();
  await hook(page, 'sandbox-payment-public-consent').uncheck();
  await expect(hook(page, 'sandbox-payment-accept')).not.toBeChecked();
  await expect(hook(page, 'sandbox-payment-create')).toBeDisabled();
  await hook(page, 'sandbox-payment-accept').check();
  await hook(page, 'sandbox-payment-create').click();
  await expect(hook(page, 'sandbox-payment-state')).toHaveAttribute(
    'data-state',
    'confirmed'
  );
  expect(payments.attempts[0]!.input).toMatchObject({
    amount: 250,
    currency: 'CAD',
    contributionType: 'sponsorship_interest',
    publicDisplayConsent: false,
    displayAmountConsent: false,
    offerAcceptance: { version: 'sponsorship-v2' }
  });
  expect(payments.attempts[0]!.input.offerAcceptance!.fingerprint).toMatch(
    /^[a-f0-9]{64}$/
  );
  await hook(page, 'sandbox-payment-open-journey').click();
  await expect(hook(page, 'payment-journey-complete')).toHaveCount(0);
  await expect(hook(page, 'payment-journey-next')).toBeVisible();
  expect(admin.commands).toEqual([]);
});

test('an expired admin session purges confirmed private scenario facts before the same account can return', async ({
  page
}) => {
  await fixtures(page);
  const payments = await sandboxPaymentFixtures(page);
  let expired = false;
  await page.route('**/api/admin/auth/current', (route) =>
    expired
      ? route.fulfill({
          status: 401,
          json: { error: 'Synthetic expired session' }
        })
      : route.fallback()
  );
  await page.goto(path());
  const pad = virtualController(page);
  await pad.open();
  await hook(page, 'sandbox-payments-open').click();
  await hook(page, 'sandbox-payment-accept').check();
  await hook(page, 'sandbox-payment-create').click();
  await expect(hook(page, 'sandbox-payment-state')).toHaveAttribute(
    'data-state',
    'confirmed'
  );
  expired = true;
  await page
    .locator('openg7-admin-nav a[href="/admin/fundraiser/audit"]')
    .click();
  await expect(page).toHaveURL(/\/admin\/login/);
  expired = false;
  await page.goBack();
  await expect(hook(page, 'sandbox-controller-open')).toBeVisible();
  if (!(await pad.surface.isVisible())) await pad.open();
  await hook(page, 'sandbox-payments-open').click();
  await expect(hook(page, 'sandbox-payment-open-journey')).toHaveCount(0);
  await expect(hook(page, 'sandbox-payment-state')).not.toHaveAttribute(
    'data-state',
    'confirmed'
  );
  await expect(hook(page, 'sandbox-payment-accept')).not.toBeChecked();
  expect(payments.attempts).toHaveLength(1);
});
