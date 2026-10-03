import type { Page } from '@playwright/test';
import type {
  AdminPublicationBatchRecord,
  AdminPublicationDraftRecord,
  AdminPublicationSlotRecord
} from '@openg7/funding-core';

import { expect } from './support/test.js';

export const timestamp = '2030-06-01T14:00:00Z';
export const batch = (
  id: string,
  scheduledAt: string | null,
  status: AdminPublicationBatchRecord['status'] = 'scheduled'
): AdminPublicationBatchRecord => ({
  id,
  channel: id === 'first' ? 'linkedin' : 'facebook',
  capacity: 5,
  status,
  slotId: id === 'first' ? 'slot-first' : null,
  scheduledAt,
  publishedAt: status === 'published' ? timestamp : null,
  notes: null,
  assignedDraftIds: id === 'first' ? ['draft-first'] : [],
  capacityUsed: id === 'first' ? 3 : 0,
  capacityAvailable: id === 'first' ? 2 : 5,
  createdAt: timestamp,
  updatedAt: timestamp
});
export const batches = [
  batch('undated', null, 'open'),
  batch('third', '2030-06-05T14:00:00Z'),
  batch('published', '2030-06-01T14:00:00Z', 'published'),
  batch('second', '2030-06-04T14:00:00Z'),
  batch('first', '2030-06-03T14:00:00Z'),
  batch('cancelled', '2030-06-01T14:00:00Z', 'cancelled'),
  batch('fourth', '2030-06-06T14:00:00Z'),
  batch('invalid-date', 'invalid', 'scheduled')
];
export const draft: AdminPublicationDraftRecord = {
  id: 'draft-first',
  contribution_id: 'contribution-first',
  sponsor_company_name: 'Atelier Boréal',
  sponsor_website_url: null,
  sponsor_logo_url: null,
  sponsor_public_summary: null,
  feed_target: 'openg20',
  channel: 'linkedin',
  title: 'Titre initial',
  body: 'Publication de démonstration',
  disclosure_text: 'Commandite',
  status: 'scheduled',
  public_url: null,
  scheduled_at: '2030-06-03T14:00:00Z',
  approved_at: timestamp,
  published_at: null,
  review_note: null,
  batch_id: 'first',
  slot_id: 'slot-first',
  created_at: timestamp,
  updated_at: timestamp
};
export const slot: AdminPublicationSlotRecord = {
  id: 'slot-first',
  feedTarget: 'openg20',
  channel: 'linkedin',
  startsAt: '2030-06-03T14:00:00Z',
  timezone: 'Europe/Paris',
  capacity: 5,
  status: 'scheduled',
  notes: null,
  assignedBatchIds: ['first'],
  assignedDraftIds: ['draft-first'],
  capacityUsed: 3,
  capacityAvailable: 2,
  createdAt: timestamp,
  updatedAt: timestamp
};

export async function fixtures(
  page: Page,
  records = batches,
  draftRecords = [draft]
): Promise<string[]> {
  const mutations: string[] = [];
  await page.addInitScript(() => {
    sessionStorage.setItem(
      'openg7-admin-session-token',
      'openg7-admin-session.ui-fixture'
    );
    sessionStorage.setItem(
      'openg7-admin-session-expires-at',
      '2099-01-01T00:00:00Z'
    );
  });
  await page.route('**/api/**', async (route) => {
    if (route.request().method() !== 'GET') {
      mutations.push(route.request().url());
      return route.fulfill({ status: 405, json: {} });
    }
    const pathname = new URL(route.request().url()).pathname;
    const responses: Record<string, unknown> = {
      '/api/admin/publication-batches': { batches: records },
      '/api/admin/publication-drafts': { drafts: draftRecords },
      '/api/admin/publication-slots': { slots: [slot] },
      '/api/admin/sponsorships': {
        sponsorships: [],
        pagination: {
          page: 1,
          pageSize: 25,
          totalItems: 0,
          totalPages: 1,
          hasPreviousPage: false,
          hasNextPage: false
        }
      },
      '/api/admin/social-publication-jobs': {
        jobs: [],
        mode: 'disabled',
        configuredChannels: []
      }
    };
    return route.fulfill({
      status: pathname in responses ? 200 : 503,
      json: responses[pathname] ?? {}
    });
  });
  return mutations;
}

export async function preparationFixtures(page: Page) {
  const mutations = await fixtures(page);
  const reads: URLSearchParams[] = [];
  let failNextPage = false;
  const records = Array.from({ length: 26 }, (_, index) => ({
    id: `sponsor-${index + 1}`,
    sponsor_company_name: `Commandite ${String(index + 1).padStart(2, '0')}`,
    sponsor_review_status: 'approved',
    public_display_consent: index !== 24,
    sponsor_feed_target: index === 22 ? null : 'openg7',
    sponsor_feed_channels: index === 23 ? [] : ['facebook']
  }));
  await page.route('**/api/admin/sponsorships**', (route) => {
    const query = new URL(route.request().url()).searchParams;
    reads.push(query);
    const currentPage = Number(query.get('page') ?? 1);
    const pageSize = Number(query.get('pageSize') ?? 6);
    if (currentPage === 2 && failNextPage)
      return route.fulfill({ status: 503, json: {} });
    const items = records.slice(
      (currentPage - 1) * pageSize,
      currentPage * pageSize
    );
    return route.fulfill({
      json: {
        data_source: 'database',
        items,
        sponsorships: items,
        pagination: {
          page: currentPage,
          pageSize,
          totalItems: records.length,
          totalPages: Math.ceil(records.length / pageSize),
          hasPreviousPage: currentPage > 1,
          hasNextPage: currentPage * pageSize < records.length
        },
        last_updated_at: timestamp
      }
    });
  });
  return {
    reads,
    mutations,
    failSecondPage: (value: boolean) => {
      failNextPage = value;
    }
  };
}

export async function openSpace(
  page: Page,
  space: 'overview' | 'drafts' | 'batches' | 'calendar'
): Promise<void> {
  const drawer = page.locator('[data-og7="admin-drawer"][open]');
  if (await drawer.count()) await drawer.getByRole('button').first().click();
  const home = page.locator('[data-og7="publications-home"]');
  if (await home.count()) await home.click();
  if (space !== 'overview')
    await page
      .locator('[data-og7="publication-space"][data-og7-id="' + space + '"]')
      .click();
  await expect(page.locator('[data-og7="publications-page"]')).toHaveAttribute(
    'data-og7-view',
    space
  );
}
