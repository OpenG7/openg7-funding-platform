import type { Page, Response } from '@playwright/test';

export function navigatePublicPageAfterNetworkChange(
  page: Page,
  url: string,
  assertRendered: () => Promise<unknown>,
  options?: { navigation?: 'goto' | 'reload' }
): Promise<Response>;
