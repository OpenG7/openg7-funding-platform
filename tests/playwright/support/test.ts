import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  expect,
  test as base,
  type BrowserContext,
  type Page
} from '@playwright/test';

const windowsTest = base.extend<{
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

// Keep the profile-cleanup workaround on Windows. Elsewhere the native fixtures
// isolate each test's context while sharing the browser for the worker.
export const test = process.platform === 'win32' ? windowsTest : base;

export { expect };

/** Let the browser poll held and neutral input through its real animation frames. */
export async function sampledFrames(page: Page, count = 3): Promise<void> {
  await page.evaluate(
    (remaining) =>
      new Promise<void>((resolve) => {
        const frame = () => {
          if (--remaining <= 0) resolve();
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }),
    count
  );
}
