import type {
  AdminCockpitMetrics,
  AdminCockpitActivity,
  AdminCockpitSystems,
  AdminPlatformJourneys,
  AdminPlatformJourneyObservation,
  AdminPlatformJourneyStep,
  AdminPlatformJourneyStepId,
  CockpitTrend
} from '@openg7/funding-core';

export const cockpitFixtures = () => {
  const now = new Date();
  const generatedAt = now.toISOString();
  const observation = {
    checkedAt: generatedAt,
    observedAt: generatedAt,
    validUntil: new Date(now.getTime() + 60_000).toISOString()
  };
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
        connection: {
          state: 'operational',
          evidence: 'stripe_api_read',
          ...observation
        },
        ...observation,
        observedAt: null,
        adminUrl: '/admin/fundraiser/attention?type=stripe_event_failed'
      },
      {
        id: 'email',
        provider: 'SMTP',
        state: 'degraded',
        evidence: 'pending_errors',
        ...observation,
        observedAt: null,
        adminUrl: '/admin/fundraiser/email-queue'
      },
      {
        id: 'storage',
        provider: 'Local',
        state: 'operational',
        evidence: 'storage_read',
        ...observation,
        adminUrl: '/admin/fundraiser/setup'
      },
      {
        id: 'database',
        provider: 'PostgreSQL',
        state: 'operational',
        evidence: 'database_read',
        ...observation,
        adminUrl: '/admin/fundraiser/setup'
      },
      {
        id: 'identity',
        provider: 'Keycloak',
        state: 'operational',
        evidence: 'keycloak_readiness',
        ...observation,
        adminUrl: '/admin/fundraiser/setup'
      }
    ]
  };
  // Synthetic UI observations only: no payment, authorization or delivery is run.
  const journeyObservation: AdminPlatformJourneyObservation = {
    state: 'operational',
    environment: 'test',
    diagnostic: 'correlated_step',
    evidenceScope: 'correlated_records',
    ...observation,
    adminUrl: '/admin/fundraiser'
  };
  const step = (
    id: AdminPlatformJourneyStepId,
    overrides: Partial<AdminPlatformJourneyObservation> = {}
  ): AdminPlatformJourneyStep => ({ ...journeyObservation, id, ...overrides });
  const journeys: AdminPlatformJourneys = {
    generatedAt,
    journeys: [
      {
        ...journeyObservation,
        id: 'contribution',
        diagnostic: 'correlated_chain',
        steps: [
          step('checkout'),
          step('payment'),
          step('confirmation'),
          step('followup')
        ]
      },
      {
        ...journeyObservation,
        id: 'invoicing',
        state: 'degraded',
        diagnostic: 'processing_delayed',
        evidenceScope: 'partial_records',
        adminUrl: '/admin/fundraiser/email-queue',
        steps: [
          step('payment'),
          step('invoice'),
          step('email', {
            state: 'degraded',
            diagnostic: 'processing_delayed',
            evidenceScope: 'partial_records',
            adminUrl: '/admin/fundraiser/email-queue'
          })
        ]
      },
      {
        ...journeyObservation,
        id: 'sponsorship',
        state: 'unknown',
        diagnostic: 'awaiting_review',
        evidenceScope: 'partial_records',
        adminUrl: '/admin/fundraiser/sponsors',
        steps: [
          step('dossier'),
          step('media'),
          step('review', {
            state: 'unknown',
            diagnostic: 'awaiting_review',
            observedAt: null
          }),
          step('visibility', {
            state: 'unknown',
            diagnostic: 'no_recent_observation',
            evidenceScope: 'none',
            observedAt: null
          })
        ]
      },
      {
        ...journeyObservation,
        id: 'publication',
        state: 'unavailable',
        diagnostic: 'processing_failed',
        evidenceScope: 'partial_records',
        adminUrl: '/admin/fundraiser/publications',
        steps: [
          step('authorization'),
          step('scheduling'),
          step('delivery', {
            state: 'unavailable',
            diagnostic: 'processing_failed'
          })
        ]
      },
      {
        ...journeyObservation,
        id: 'transparency',
        state: 'unknown',
        diagnostic: 'public_observation_missing',
        evidenceScope: 'partial_records',
        adminUrl: '/admin/fundraiser/transparency',
        steps: [
          step('transactions'),
          step('calculation'),
          step('public_display', {
            state: 'unknown',
            diagnostic: 'public_observation_missing',
            evidenceScope: 'none',
            observedAt: null
          })
        ]
      },
      {
        ...journeyObservation,
        id: 'administration',
        state: 'unknown',
        diagnostic: 'partial_observation',
        evidenceScope: 'authenticated_request',
        environment: 'unknown',
        steps: [
          step('login', {
            state: 'unknown',
            diagnostic: 'source_missing',
            evidenceScope: 'none',
            environment: 'unknown',
            observedAt: null
          }),
          step('session', {
            diagnostic: 'authenticated_request',
            evidenceScope: 'authenticated_request',
            environment: 'unknown'
          }),
          step('api_access', {
            diagnostic: 'authenticated_request',
            evidenceScope: 'authenticated_request',
            environment: 'unknown'
          })
        ]
      }
    ]
  };
  return { metrics, activity, systems, journeys };
};
