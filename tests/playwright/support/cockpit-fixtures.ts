import type {
  AdminCockpitMetrics,
  AdminCockpitActivity,
  AdminCockpitSystems,
  CockpitTrend
} from '@openg7/funding-core';

export const cockpitFixtures = () => {
  const now = new Date();
  const generatedAt = now.toISOString();
  const trend: CockpitTrend = {
    current: 20000,
    previous: 10000,
    percent: 100,
    series: [
      { day: '2026-09-01', value: 9000 },
      { day: '2026-09-02', value: 11000 }
    ]
  };
  const metrics: AdminCockpitMetrics = {
    available: true,
    generatedAt,
    source: 'postgresql',
    timezone: 'America/Toronto',
    period: { start: '2026-08-17', end: '2026-09-15' },
    previousPeriod: { start: '2026-07-18', end: '2026-08-16' },
    currencies: [
      {
        currency: 'CAD',
        grossMinor: 28542000,
        confirmedFeesMinor: 900000,
        missingFeeCount: 0,
        netReceivedMinor: 27642000,
        refundedMinor: 1000000,
        disputedMinor: 50000,
        netAfterRefundsMinor: 26642000,
        grossTrend: trend,
        netTrend: trend
      },
      {
        currency: 'USD',
        grossMinor: 10000,
        confirmedFeesMinor: 0,
        missingFeeCount: 1,
        netReceivedMinor: null,
        refundedMinor: 1000,
        disputedMinor: 0,
        netAfterRefundsMinor: null,
        grossTrend: { ...trend, percent: null },
        netTrend: {
          ...trend,
          current: null,
          percent: null,
          series: [{ day: '2026-09-01', value: null }]
        }
      }
    ],
    sponsorshipCount: 48,
    sponsorshipTrend: { ...trend, current: 6, previous: 3 },
    plannedPublicationCount: 12,
    warnings: []
  };
  const activity: AdminCockpitActivity = {
    available: true,
    generatedAt,
    today: generatedAt.slice(0, 10),
    todayCounts: {
      payment: 1,
      invoice: 1,
      publication: 0,
      review: 0,
      information: 1,
      refund: 0
    },
    missingSources: [],
    items: [
      {
        id: 'invoice-fixture',
        kind: 'invoice',
        occurredAt: generatedAt,
        reference: 'FAC-COCKPIT',
        adminUrl:
          '/admin/fundraiser/invoices?contributionId=11111111-1111-4111-8111-111111111111'
      }
    ]
  };
  const systems: AdminCockpitSystems = {
    generatedAt,
    systems: [
      {
        id: 'stripe',
        provider: 'Stripe',
        state: 'unknown',
        evidence: 'no_recent_observation',
        checkedAt: generatedAt,
        observedAt: null,
        validUntil: new Date(now.getTime() + 60_000).toISOString(),
        adminUrl: '/admin/fundraiser/attention?type=stripe_event_failed'
      },
      {
        id: 'email',
        provider: 'SMTP',
        state: 'degraded',
        evidence: 'pending_errors',
        checkedAt: generatedAt,
        observedAt: null,
        validUntil: new Date(now.getTime() + 60_000).toISOString(),
        adminUrl: '/admin/fundraiser/email-queue'
      },
      {
        id: 'storage',
        provider: 'Local',
        state: 'operational',
        evidence: 'storage_read',
        checkedAt: generatedAt,
        observedAt: generatedAt,
        validUntil: new Date(now.getTime() + 60_000).toISOString(),
        adminUrl: '/admin/fundraiser/setup'
      },
      {
        id: 'database',
        provider: 'PostgreSQL',
        state: 'operational',
        evidence: 'database_read',
        checkedAt: generatedAt,
        observedAt: generatedAt,
        validUntil: new Date(now.getTime() + 60_000).toISOString(),
        adminUrl: '/admin/fundraiser/setup'
      }
    ]
  };
  return { metrics, activity, systems };
};
