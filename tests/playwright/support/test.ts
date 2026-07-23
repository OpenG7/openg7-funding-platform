import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  expect,
  test as base,
  type BrowserContext,
  type Page
} from '@playwright/test';

export const test = base.extend<{
  context: BrowserContext;
  page: Page;
}>({
  context: async (
    { browserName, contextOptions, launchOptions, playwright },
    use
  ) => {
    // Windows can hang when Playwright removes the auto-created Chromium
    // profile directory after a successful test. Supplying the profile keeps
    // that directory out of Playwright's blocking temp cleanup path.
    const userDataDir = await mkdtemp(
      path.join(tmpdir(), `openg7-playwright-${browserName}-profile-`)
    );
    const context = await playwright[browserName].launchPersistentContext(
      userDataDir,
      {
        ...launchOptions,
        ...contextOptions
      }
    );

    await use(context);
    await context.close();
  },

  page: async ({ context }, use) => {
    const page = context.pages()[0] ?? (await context.newPage());
    await use(page);
  }
});

export { expect };
