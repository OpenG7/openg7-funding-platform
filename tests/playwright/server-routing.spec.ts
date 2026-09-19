import { expect, test } from '@playwright/test';

test('Nginx serves known routes and returns localized HTTP 404 documents for unknown routes', async ({
  request
}) => {
  for (const path of [
    '/fonds-des-batisseurs',
    '/en/fonds-des-batisseurs',
    '/admin/login',
    '/fonds-des-batisseurs/suivi-commandite'
  ]) {
    expect((await request.get(path)).status(), path).toBe(200);
  }
  for (const path of [
    '/missing-public-page',
    '/en/missing-public-page',
    '/admin/missing-page',
    '/404',
    '/en/404'
  ]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(404);
    expect(await response.text()).toContain('data-og7="not-found"');
    expect(await response.text()).toContain(
      path.startsWith('/en/') ? 'lang="en"' : 'lang="fr-CA"'
    );
  }
});
