import type { Page, Route } from '@playwright/test';
import type {
  SponsorshipFollowupResponse,
  SponsorshipDraftSnapshot,
  SponsorshipModerationResponse
} from '@openg7/funding-core';

import { expect } from './test.js';

export const token = 'e2e-followup-fixture-local-only-000000000001';
export const path = '/fonds-des-batisseurs/suivi-commandite';
export const fixture = (): SponsorshipFollowupResponse => ({
  found: true,
  publicReference: 'CMD-LOCAL-101',
  paymentStatus: 'paid',
  reviewStatus: 'pending_review',
  amount: 250,
  currency: 'CAD',
  paidAt: '2026-09-18T12:00:00Z',
  sponsorshipTier: null,
  sponsorshipBenefits: ['website_mention'],
  detailsSubmitted: true,
  companyName: 'Atelier Boréal',
  contactName: 'Camille',
  contactEmail: 'camille@example.test',
  websiteUrl: 'https://example.test',
  logoUrl: null,
  message: null,
  reviewedAt: null
});
export const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body)
  });

export async function mock(
  page: Page,
  options: {
    draft?: SponsorshipDraftSnapshot;
    current?: SponsorshipFollowupResponse;
    get?: (route: Route, count: number) => Promise<void>;
    post?: (route: Route) => Promise<void>;
    moderation?: SponsorshipModerationResponse;
    correction?: (route: Route) => Promise<void>;
    reconsideration?: (route: Route) => Promise<void>;
  } = {}
) {
  let current = options.current ?? fixture();
  let reads = 0;
  let posts = 0;
  let draft: SponsorshipDraftSnapshot = options.draft ?? {
    revision: 0,
    data: null,
    updatedAt: null
  };
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/sponsorship-followup/moderation')
      return json(
        route,
        options.moderation ?? { items: [], reconsiderations: [] }
      );
    if (
      url.pathname === '/api/sponsorship-followup/reconsideration' &&
      options.reconsideration
    )
      return options.reconsideration(route);
    if (
      url.pathname === '/api/sponsorship-followup/correction' &&
      options.correction
    )
      return options.correction(route);
    if (url.pathname === '/api/sponsorship-followup/draft') {
      if (route.request().method() === 'POST')
        draft = {
          revision: draft.revision + 1,
          data: route.request().postDataJSON().data,
          updatedAt: new Date().toISOString()
        };
      await json(route, draft);
    } else if (url.pathname === '/api/sponsorship-followup') {
      reads++;
      await (options.get ? options.get(route, reads) : json(route, current));
    } else if (url.pathname === '/api/sponsorship-followup/details') {
      posts++;
      draft = {
        revision: draft.revision + 1,
        data: null,
        updatedAt: new Date().toISOString()
      };
      if (options.post) await options.post(route);
      else {
        current = {
          ...current,
          ...route.request().postDataJSON(),
          reviewStatus: 'pending_review',
          detailsSubmitted: true
        };
        await json(route, { received: true, recorded: true });
      }
    } else if (url.pathname === '/api/sponsorship-followup/media') {
      await json(route, {
        assets: [],
        limits: {
          maxUploadBytes: 8 * 1024 * 1024,
          maxSupportingImages: 3,
          acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp']
        }
      });
    } else await json(route, {}, 503);
  });
  return { posts: () => posts, reads: () => reads, draft: () => draft };
}
export async function visit(page: Page, english = false) {
  await page.goto((english ? '/en' : '') + path + '?token=' + token);
  await expect(
    page.getByRole('heading', {
      name: english ? 'Your sponsorship follow-up' : 'Suivi de votre commandite'
    })
  ).toBeVisible();
}
