import { test, expect } from './support/test.js';

for (const language of ['fr', 'en'] as const) {
  for (const width of [390, 1280]) {
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
