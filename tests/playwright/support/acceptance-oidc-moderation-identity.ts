import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { Browser, BrowserContext, Page } from '@playwright/test';

import { acceptanceComposeArgs } from './acceptance-database.js';
import { expect } from './test.js';

const execute = promisify(execFile);

/** Private lifecycle shared by the two people in an independent moderation review. */
export interface AcceptanceModerationIdentity {
  readonly author: Page;
  readonly reviewer: Page;
  readonly origin: string;
  readonly reviewerId: string;
}

export async function withAcceptanceModerationIdentity(
  browser: Browser,
  use: (identity: AcceptanceModerationIdentity) => Promise<void>
): Promise<void> {
  acceptanceComposeArgs();
  const origin = process.env.MODERATION_WEB_BASE_URL;
  if (!origin || new URL(origin).hostname !== '127.0.0.1')
    throw new Error(
      'Independent review requires the disposable OIDC Web origin.'
    );
  const contexts: BrowserContext[] = [];
  let bodyFailed = false;
  try {
    const ownerContext = await browser.newContext({ baseURL: origin });
    contexts.push(ownerContext);
    const authorContext = await browser.newContext({ baseURL: origin });
    contexts.push(authorContext);
    const reviewer = await ownerContext.newPage();
    const author = await authorContext.newPage();
    await ensureOidcAvailable(reviewer);
    const reviewerId = await establishPeople(author, reviewer, origin);
    await use({ author, reviewer, origin, reviewerId });
  } catch (error) {
    bodyFailed = true;
    throw error;
  } finally {
    await closeOwnedContexts(contexts, bodyFailed);
  }
}

async function ensureOidcAvailable(reviewer: Page): Promise<void> {
  const available = async () => {
    try {
      const response = await reviewer.request.get('/api/admin/auth/config');
      return response.ok() && (await response.json()).mode === 'oidc';
    } catch {
      return false;
    }
  };
  if (!(await available()))
    await execute(
      'docker',
      [
        ...acceptanceComposeArgs(),
        'exec',
        '-T',
        '-d',
        'api',
        'node',
        '/app/tests/identity/docker-moderation-server.mjs'
      ],
      { windowsHide: true, timeout: 30000 }
    );
  await expect.poll(available, { timeout: 30000 }).toBe(true);
}

async function login(page: Page, account: 'owner' | 'operator'): Promise<void> {
  await page.goto(
    '/admin/login?returnUrl=' + encodeURIComponent('/admin/fundraiser/sponsors')
  );
  await page.locator('[data-og7="identity-sign-in"]').click();
  await page.getByLabel('Compte de test').selectOption(account);
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page).toHaveURL(/\/admin\/fundraiser\/sponsors/);
}

async function establishPeople(
  author: Page,
  reviewer: Page,
  origin: string
): Promise<string> {
  await login(reviewer, 'owner');
  const access = await reviewer.request.post('/api/admin/access', {
    headers: { Origin: origin },
    data: {
      subject: 'fixture-operator',
      confirmation: 'fixture-operator',
      displayName: 'Independent acceptance operator',
      role: 'operator',
      disabled: false
    }
  });
  expect(access.ok(), await access.text()).toBe(true);
  await login(author, 'operator');
  const authorCurrent = await author.request.get('/api/admin/auth/current');
  const reviewerCurrent = await reviewer.request.get('/api/admin/auth/current');
  expect(authorCurrent.status()).toBe(200);
  expect(reviewerCurrent.status()).toBe(200);
  const authorProfile = await authorCurrent.json();
  const reviewerProfile = await reviewerCurrent.json();
  expect(authorProfile.id).toMatch(/^[a-f0-9-]{36}$/);
  expect(authorProfile.role).toBe('operator');
  expect(reviewerProfile.id).toMatch(/^[a-f0-9-]{36}$/);
  expect(reviewerProfile.role).toBe('owner');
  expect(reviewerProfile.id).not.toBe(authorProfile.id);
  return reviewerProfile.id;
}

async function closeOwnedContexts(
  contexts: BrowserContext[],
  bodyFailed: boolean
): Promise<void> {
  // Attempt every owned cleanup, including when the second creation failed.
  // A cleanup error must not replace the original journey failure.
  const closed = await Promise.allSettled(
    contexts.map((context) => context.close())
  );
  const failures = closed
    .filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    )
    .map((result) => result.reason);
  if (!bodyFailed && failures.length)
    throw new AggregateError(failures, 'Moderation context cleanup failed.');
}
