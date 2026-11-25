import type { Page } from '@playwright/test';
import type {
  EngineRoomSnapshot,
  PublicationDelivery,
  PublicationFeed
} from '@openg7/funding-core';

export const engineDeliveryId = '11111111-1111-4111-8111-111111111111';
export const engineSponsorId = '22222222-2222-4222-8222-222222222222';

export function engineSnapshot(): EngineRoomSnapshot {
  const feed: PublicationFeed = {
    id: 'openg7:facebook',
    paused: true,
    autoPrepare: false,
    mode: 'mock',
    accountId: 'sandbox-page',
    configured: true,
    connection: 'unchecked',
    checkedAt: null,
    expiresAt: null,
    timezone: 'America/Toronto',
    weekdays: [1],
    localTime: '09:00',
    capacity: 3,
    horizonDays: 7
  };
  const delivery: PublicationDelivery = {
    id: engineDeliveryId,
    feedId: feed.id,
    kind: 'sponsorship',
    batchId: null,
    message: 'Publication synthétique',
    scheduledAt: '2099-01-01T12:00:00Z',
    mediaId: null,
    mediaUrl: null,
    mediaAlt: null,
    accountId: feed.accountId!,
    mode: 'mock',
    autoManaged: true,
    sponsors: [
      {
        id: engineSponsorId,
        name: 'Entreprise synthétique',
        version: '1',
        reviewStatus: 'approved',
        presentationApproved: true
      }
    ],
    version: 1,
    status: 'draft',
    attempts: 0,
    errorCode: null,
    nextAttemptAt: null,
    externalPostId: null,
    externalPostUrl: null,
    approvedAt: null,
    publishedAt: null
  };
  return {
    observedAt: new Date().toISOString(),
    scope: {},
    publications: {
      available: true,
      workerEnabled: true,
      feeds: [
        feed,
        {
          ...feed,
          id: 'openg7:linkedin',
          accountId: 'synthetic-org',
          connection: 'ready',
          paused: false,
          mode: 'live'
        }
      ],
      deliveries: [delivery],
      partial: false
    },
    preflight: {
      connectorEnabled: true,
      localPreparationEnabled: false,
      available: true,
      connection: 'not_verified',
      lastWorkerSeenAt: null,
      pending: 2,
      quarantined: 1
    }
  };
}

export async function engineRoomFixture(page: Page) {
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
  const options = { fail: false, snapshot: engineSnapshot() };
  const reads: string[] = [];
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/') && request.method() !== 'GET')
      writes.push(request.method() + ' ' + request.url());
  });
  await page.route(/\/api\/admin\/engine-room(?:\?|$)/, async (route) => {
    const url = new URL(route.request().url());
    reads.push(url.search);
    const scope = {
      ...(url.searchParams.has('sponsorshipId')
        ? { sponsorshipId: url.searchParams.get('sponsorshipId')! }
        : {}),
      ...(url.searchParams.has('deliveryId')
        ? { deliveryId: url.searchParams.get('deliveryId')! }
        : {})
    };
    const snapshot = options.snapshot;
    return route.fulfill(
      options.fail
        ? { status: 503, json: {} }
        : {
            json: {
              ...snapshot,
              scope,
              publications: {
                ...snapshot.publications,
                feeds: Object.keys(scope).length
                  ? snapshot.publications.feeds.slice(0, 1)
                  : snapshot.publications.feeds
              }
            }
          }
    );
  });
  return { options, reads, writes };
}
