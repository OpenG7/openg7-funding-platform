import type {
  EngineRoomSnapshot,
  PublicationAutomationState
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';
import { adminSessionHeaders, signInAsAdmin } from './support/admin-auth.js';

test.skip(
  process.env.OPENG7_E2E_ISOLATED !== '1',
  'Use the disposable acceptance runner'
);

test('engine room reads real owner observations without mutating publication settings', async ({
  page,
  request
}) => {
  const headers = await adminSessionHeaders(request);
  const read = async (): Promise<PublicationAutomationState> => {
    const response = await request.get('/api/admin/publication-automation', {
      headers
    });
    expect(response.status()).toBe(200);
    return response.json();
  };
  const before = await read();
  await signInAsAdmin(page);
  const writes: string[] = [];
  page.on('request', (req) => {
    if (
      new URL(req.url()).pathname.startsWith('/api/') &&
      req.method() !== 'GET'
    )
      writes.push(req.method() + ' ' + new URL(req.url()).pathname);
  });
  const loaded = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/admin/engine-room'
  );
  const navigation = await page.goto('/admin/fundraiser/engine-room');
  expect(navigation?.status()).toBe(200);
  const response = await loaded;
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  const snapshot: EngineRoomSnapshot = await response.json();
  expect(snapshot.publications.available).toBe(true);
  expect(snapshot.publications.workerEnabled).toBe(before.workerEnabled);
  expect(snapshot.publications.feeds.map((feed) => feed.id)).toEqual(
    before.feeds.map((feed) => feed.id)
  );
  await expect(page.locator('[data-og7="engine-feed"]')).toHaveCount(
    before.feeds.length
  );
  await page.locator('[data-og7="engine-preflight"]').click();
  await expect(page.locator('[data-og7="engine-detail"]')).toContainText(
    'Preflight'
  );
  const refresh = page.waitForResponse(
    (item) => new URL(item.url()).pathname === '/api/admin/engine-room'
  );
  await page.locator('[data-og7="engine-room-refresh"]').click();
  expect((await refresh).status()).toBe(200);
  const after = await read();
  expect(after.workerEnabled).toBe(before.workerEnabled);
  expect(after.feeds).toEqual(before.feeds);
  expect(
    after.deliveries.map((delivery) => ({
      id: delivery.id,
      status: delivery.status,
      version: delivery.version
    }))
  ).toEqual(
    before.deliveries.map((delivery) => ({
      id: delivery.id,
      status: delivery.status,
      version: delivery.version
    }))
  );
  expect(writes).toEqual([]);
});
