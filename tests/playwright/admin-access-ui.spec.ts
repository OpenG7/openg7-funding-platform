import type { Page } from '@playwright/test';

import type { AdminAccessResponse } from '../../apps/funding-web/src/app/features/funding/services/funding-admin.service.js';

import { test, expect } from './support/test.js';

async function accessFixture(page: Page) {
  const state = {
    reads: 0,
    readStatus: 200,
    changeStatus: 200,
    signedIn: true,
    changeGate: null as Promise<void> | null,
    changes: [] as Record<string, unknown>[],
    access: {
      accounts: [
        {
          id: 'owner',
          subject: 'fixture-owner',
          displayName: 'Owner fixture',
          role: 'owner',
          disabled: false
        },
        {
          id: 'operator',
          subject: 'fixture-operator',
          displayName: 'Operator fixture',
          role: 'operator',
          disabled: false
        }
      ],
      sessions: [
        {
          id: 'operator-session',
          accountId: 'operator',
          createdAt: '2026-09-24T12:00:00Z',
          expiresAt: '2099-01-01T00:00:00Z'
        },
        {
          id: 'owner-other-session',
          accountId: 'owner',
          createdAt: '2026-09-24T13:00:00Z',
          expiresAt: '2099-01-01T00:00:00Z'
        }
      ]
    } as AdminAccessResponse,
    nextAccess: null as AdminAccessResponse | null
  };
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/config'))
      return route.fulfill({ json: { mode: 'oidc' } });
    if (path.endsWith('/auth/current'))
      return route.fulfill({
        status: state.signedIn ? 200 : 401,
        json: state.signedIn
          ? {
              id: 'owner',
              sessionId: 'current-owner-session',
              displayName: 'Owner fixture',
              role: 'owner',
              expiresAt: '2099-01-01T00:00:00Z'
            }
          : {}
      });
    if (path.endsWith('/access')) {
      if (route.request().method() === 'POST') {
        state.changes.push(route.request().postDataJSON());
        await state.changeGate;
        if (state.changeStatus === 401) state.signedIn = false;
        if (state.changeStatus === 200 && state.nextAccess) {
          state.access = state.nextAccess;
          state.nextAccess = null;
        }
        return route.fulfill({ status: state.changeStatus, json: {} });
      }
      state.reads++;
      return route.fulfill({ status: state.readStatus, json: state.access });
    }
    return route.fulfill({ status: 503, json: {} });
  });
  return state;
}

async function openAccess(page: Page, language: 'fr' | 'en') {
  await page.goto('/admin/fundraiser/access');
  if (language === 'en')
    await page
      .getByRole('button', {
        name: 'Switch administration language to English'
      })
      .click();
}

for (const language of ['fr', 'en'] as const) {
  test(`failed access changes retain the draft and return revocation focus in ${language}`, async ({
    page
  }) => {
    const state = await accessFixture(page);
    await openAccess(page, language);
    const operator = page.locator(
      '[data-og7="admin-account"][data-og7-id="operator"]'
    );
    await operator.getByRole('button').click();
    const name = page.locator('input[name="name"]');
    const role = page.getByRole('combobox');
    const confirmation = page.locator('input[name="confirmed"]');
    const save = page.getByRole('button', {
      name: language === 'fr' ? 'Enregistrer les accès' : 'Save access'
    });
    await name.fill('Retained draft fixture');
    await role.selectOption('reader');
    await confirmation.check();
    await expect(save).toBeEnabled();
    let releaseChange!: () => void;
    state.changeGate = new Promise<void>((resolve) => {
      releaseChange = resolve;
    });
    state.changeStatus = 503;
    await save.click();
    await expect.poll(() => state.changes.length).toBe(1);
    await expect(save).toBeDisabled();
    await expect(name).toBeDisabled();
    await expect(operator).toContainText('Operator fixture');
    await expect(page.locator('[data-og7="admin-session"]')).toHaveCount(2);
    expect(state.reads).toBe(1);
    releaseChange();
    await expect(page.getByRole('alert')).toContainText(
      language === 'fr'
        ? 'Impossible de terminer la demande'
        : 'Unable to complete this request'
    );
    await expect(name).toHaveValue('Retained draft fixture');
    await expect(name).toBeEnabled();
    await expect(page.locator('input[name="subject"]')).toHaveValue(
      'fixture-operator'
    );
    await expect(role).toHaveValue('reader');
    await expect(confirmation).not.toBeChecked();
    await expect(save).toBeDisabled();
    expect(state.reads).toBe(1);

    state.changeGate = null;
    state.changeStatus = 200;
    state.nextAccess = {
      ...state.access,
      accounts: state.access.accounts.map((account) =>
        account.id === 'operator'
          ? {
              ...account,
              displayName: 'Retained draft fixture',
              role: 'reader'
            }
          : account
      )
    };
    await confirmation.check();
    await expect(save).toBeEnabled();
    await save.click();
    await expect(operator).toContainText('Retained draft fixture');
    await expect(confirmation).not.toBeChecked();
    expect(state.reads).toBe(2);
    expect(state.changes[1]).toEqual(state.changes[0]);

    const revoke = page.locator(
      '[data-og7="admin-session"][data-og7-id="operator-session"] button'
    );
    const revokeText =
      language === 'fr' ? 'Révoquer la session' : 'Revoke session';
    const group = page.getByRole('group', { name: revokeText });
    state.changeStatus = 503;
    await revoke.click();
    await group.getByRole('button', { name: revokeText }).click();
    await expect(page.getByRole('alert')).toContainText(
      language === 'fr'
        ? 'Impossible de terminer la demande'
        : 'Unable to complete this request'
    );
    await expect(group).toHaveCount(0);
    await expect(revoke).toBeFocused();
    await expect(page.locator('[data-og7="admin-session"]')).toHaveCount(2);
    await expect(name).toHaveValue('Retained draft fixture');
    expect(state.reads).toBe(2);
    expect(state.changes[2]).toEqual({
      sessionId: 'operator-session',
      confirmation: 'operator-session'
    });
  });
}

for (const status of [401, 403]) {
  test(`a ${status} received during revocation clears the pending confirmation and private draft`, async ({
    page
  }) => {
    const state = await accessFixture(page);
    await openAccess(page, 'fr');
    await page
      .locator('[data-og7="admin-account"][data-og7-id="operator"] button')
      .click();
    await page.locator('input[name="name"]').fill('Private pending fixture');
    await page.locator('input[name="confirmed"]').check();
    let releaseChange!: () => void;
    state.changeGate = new Promise<void>((resolve) => {
      releaseChange = resolve;
    });
    state.changeStatus = status;
    await page
      .locator(
        '[data-og7="admin-session"][data-og7-id="operator-session"] button'
      )
      .click();
    const group = page.getByRole('group', { name: 'Révoquer la session' });
    await group.getByRole('button', { name: 'Révoquer la session' }).click();
    await expect.poll(() => state.changes.length).toBe(1);
    await expect(group.getByRole('button', { name: 'Annuler' })).toBeDisabled();
    await expect(page.locator('[data-og7="admin-session"]')).toHaveCount(2);
    releaseChange();
    if (status === 401) {
      await expect(page).toHaveURL(/\/admin\/login\?/);
      await expect(page.getByRole('status')).toContainText(
        'expiré ou a été révoquée'
      );
      expect(
        await page.evaluate(() =>
          sessionStorage.getItem('openg7-admin-session-token')
        )
      ).toBeNull();
    } else {
      await expect(page.getByRole('alert')).toContainText(
        'Cette page est réservée aux propriétaires'
      );
    }
    await expect(group).toHaveCount(0);
    await expect(page.locator('openg7-admin-access-editor')).toHaveCount(0);
    await expect(page.locator('[data-og7="admin-account"]')).toHaveCount(0);
    await expect(page.locator('[data-og7="admin-session"]')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(
      'Private pending fixture'
    );
    expect(state.reads).toBe(1);
    expect(state.changes).toEqual([
      { sessionId: 'operator-session', confirmation: 'operator-session' }
    ]);
  });
}

for (const language of ['fr', 'en'] as const) {
  for (const width of [390, 1280]) {
    test(`confirmed access changes reload accounts and sessions with keyboard focus in ${language} at ${width}px`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      const state = await accessFixture(page);
      await openAccess(page, language);
      const operator = page.locator(
        '[data-og7="admin-account"][data-og7-id="operator"]'
      );
      await operator.getByRole('button').click();
      const confirm = page.locator('input[name="confirmed"]');
      const save = page.getByRole('button', {
        name: language === 'fr' ? 'Enregistrer les accès' : 'Save access'
      });
      await expect(page.locator('input[name="subject"]')).toHaveAttribute(
        'readonly'
      );
      // check() observes the native checkbox before Angular reflects the
      // confirmation in the form. Wait for that transition before invalidating it.
      await confirm.check();
      await expect(save).toBeEnabled();
      await page.locator('input[name="name"]').fill('Updated fixture');
      await expect(confirm).not.toBeChecked();
      await expect(save).toBeDisabled();
      await confirm.check();
      await expect(save).toBeEnabled();
      await page.locator('input[name="disabled"]').check();
      await expect(confirm).not.toBeChecked();
      await expect(save).toBeDisabled();
      await confirm.check();
      await expect(save).toBeEnabled();
      await page.getByRole('combobox').selectOption('reader');
      await expect(confirm).not.toBeChecked();
      await expect(save).toBeDisabled();
      expect(state.changes).toHaveLength(0);
      state.nextAccess = {
        accounts: state.access.accounts.map((account) =>
          account.id === 'operator'
            ? {
                ...account,
                displayName: 'Updated fixture',
                role: 'reader',
                disabled: true
              }
            : account
        ),
        sessions: state.access.sessions.filter(
          (session) => session.accountId !== 'operator'
        )
      };
      await confirm.check();
      await expect(save).toBeEnabled();
      await save.click();
      await expect(operator).toContainText('Updated fixture');
      await expect(operator).toContainText(
        language === 'fr' ? 'Lecteur' : 'Reader'
      );
      await expect(confirm).not.toBeChecked();
      await expect(save).toBeDisabled();
      await expect(page.locator('[data-og7="admin-session"]')).toHaveCount(1);
      expect(state.reads).toBe(2);
      expect(state.changes).toEqual([
        {
          id: 'operator',
          subject: 'fixture-operator',
          displayName: 'Updated fixture',
          role: 'reader',
          disabled: true,
          confirmation: 'fixture-operator'
        }
      ]);

      const revoke = page.locator('[data-og7="admin-session"] button');
      const revokeText =
        language === 'fr' ? 'Révoquer la session' : 'Revoke session';
      const group = page.getByRole('group', { name: revokeText });
      await revoke.click();
      await expect(
        group.getByRole('button', { name: revokeText })
      ).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(group).toHaveCount(0);
      await expect(revoke).toBeFocused();
      expect(state.changes).toHaveLength(1);

      state.nextAccess = { ...state.access, sessions: [] };
      await revoke.click();
      await group.getByRole('button', { name: revokeText }).press('Enter');
      await expect(page.locator('[data-og7="admin-session"]')).toHaveCount(0);
      await expect(group).toHaveCount(0);
      await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
      expect(state.reads).toBe(3);
      expect(state.changes[1]).toEqual({
        sessionId: 'owner-other-session',
        confirmation: 'owner-other-session'
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
    });

    test(`access denial clears the account draft and private lists in ${language} at ${width}px`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      const state = await accessFixture(page);
      await openAccess(page, language);
      await page
        .locator('[data-og7="admin-account"][data-og7-id="operator"] button')
        .click();
      await page.locator('input[name="name"]').fill('Private draft fixture');
      await page.locator('input[name="confirmed"]').check();
      state.changeStatus = 403;
      const save = page.getByRole('button', {
        name: language === 'fr' ? 'Enregistrer les accès' : 'Save access'
      });
      await expect(save).toBeEnabled();
      await save.click();
      await expect(page.getByRole('alert')).toContainText(
        language === 'fr'
          ? 'Cette page est réservée aux propriétaires'
          : 'This page is reserved for owners'
      );
      await expect(page).toHaveURL(/\/admin\/fundraiser\/access$/);
      await expect(page.locator('openg7-admin-access-editor')).toHaveCount(0);
      await expect(page.locator('[data-og7="admin-account"]')).toHaveCount(0);
      await expect(page.locator('[data-og7="admin-session"]')).toHaveCount(0);
      await expect(page.getByText('Private draft fixture')).toHaveCount(0);
      expect(state.reads).toBe(1);
      expect(state.changes).toHaveLength(1);

      // A denied load must not remount the editor from stale private data.
      state.readStatus = 403;
      await page.reload();
      await expect(page.getByRole('alert')).toContainText(
        language === 'fr'
          ? 'Cette page est réservée aux propriétaires'
          : 'This page is reserved for owners'
      );
      await expect(page.locator('openg7-admin-access-editor')).toHaveCount(0);
      await expect(page.locator('[data-og7="admin-account"]')).toHaveCount(0);
      await expect(page.locator('[data-og7="admin-session"]')).toHaveCount(0);
      expect(state.changes).toHaveLength(1);
    });

    test(`access confirmation, role errors and expired sessions remain clear in ${language} at ${width}px`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      let signedIn = true,
        changeStatus = 200;
      const changes: Record<string, unknown>[] = [];
      await page.route('**/api/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/auth/config'))
          return route.fulfill({ json: { mode: 'oidc' } });
        if (path.endsWith('/auth/current'))
          return route.fulfill(
            signedIn
              ? {
                  json: {
                    id: 'owner',
                    sessionId: 'owner-session',
                    displayName: 'Owner fixture',
                    role: 'owner',
                    expiresAt: '2099-01-01T00:00:00Z'
                  }
                }
              : { status: 401, json: {} }
          );
        if (path.endsWith('/access')) {
          if (route.request().method() === 'POST') {
            changes.push(route.request().postDataJSON());
            if (changeStatus === 401) signedIn = false;
            return route.fulfill({
              status: changeStatus,
              json: changeStatus === 409 ? { code: 'LAST_OWNER' } : {}
            });
          }
          return route.fulfill({
            json: {
              accounts: [
                {
                  id: 'owner',
                  subject: 'fixture-owner',
                  displayName: 'Owner fixture',
                  role: 'owner',
                  disabled: false
                }
              ],
              sessions: [
                {
                  id: 'session-other',
                  accountId: 'owner',
                  createdAt: '2026-09-24T12:00:00Z'
                }
              ]
            }
          });
        }
        return route.fulfill({ status: 503, json: {} });
      });
      await page.goto('/admin/fundraiser/access');
      if (language === 'en')
        await page
          .getByRole('button', {
            name: 'Switch administration language to English'
          })
          .click();
      const edit = page.locator('[data-og7="admin-account"] button');
      await edit.click();
      const save = page.getByRole('button', {
        name: language === 'fr' ? 'Enregistrer les accès' : 'Save access'
      });
      const confirm = page.getByLabel(
        language === 'fr'
          ? 'Je confirme ce changement'
          : 'I confirm this access change'
      );
      await expect(save).toBeDisabled();
      await confirm.check();
      await expect(save).toBeEnabled();
      await page.getByRole('combobox').selectOption('reader');
      // Wait for the rendered reset before asking for a fresh confirmation.
      // Otherwise check() can see the previous checked DOM state and do nothing.
      await expect(confirm).not.toBeChecked();
      await expect(save).toBeDisabled();
      expect(changes).toHaveLength(0);
      changeStatus = 409;
      await confirm.check();
      await expect(save).toBeEnabled();
      await save.focus();
      await expect(save).toBeFocused();
      const changeResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/admin/access') &&
          response.request().method() === 'POST'
      );
      await page.keyboard.press('Enter');
      expect((await changeResponse).status()).toBe(409);
      await expect(page.getByRole('alert')).toContainText(
        language === 'fr'
          ? 'Conservez au moins un propriétaire actif'
          : 'Keep at least one enabled owner'
      );
      await expect(confirm).not.toBeChecked();
      await expect(save).toBeDisabled();
      expect(changes[0]).toMatchObject({
        subject: 'fixture-owner',
        role: 'reader',
        confirmation: 'fixture-owner'
      });
      const revokeText =
        language === 'fr' ? 'Révoquer la session' : 'Revoke session';
      await page.locator('[data-og7="admin-session"] button').click();
      const group = page.getByRole('group', { name: revokeText });
      await expect(group).toContainText('Owner fixture');
      await expect(
        group.getByRole('button', { name: revokeText })
      ).toBeFocused();
      await group
        .getByRole('button', { name: language === 'fr' ? 'Annuler' : 'Cancel' })
        .click();
      expect(changes).toHaveLength(1);
      await expect(
        page.locator('[data-og7="admin-session"] button')
      ).toBeFocused();
      changeStatus = 401;
      await page.locator('[data-og7="admin-session"] button').click();
      await group.getByRole('button', { name: revokeText }).click();
      await expect(page).toHaveURL(/\/admin\/login\?/);
      await expect(page.getByRole('status')).toContainText(
        language === 'fr'
          ? 'expiré ou a été révoquée'
          : 'expired or been revoked'
      );
      expect(changes[1]).toEqual({
        sessionId: 'session-other',
        confirmation: 'session-other'
      });
      await expect(page.locator('[data-og7="admin-access"]')).toHaveCount(0);
      expect(
        await page.evaluate(() =>
          sessionStorage.getItem('openg7-admin-session-token')
        )
      ).toBeNull();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
    });
  }
}
