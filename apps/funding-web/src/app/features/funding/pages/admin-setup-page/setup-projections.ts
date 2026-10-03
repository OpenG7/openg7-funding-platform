import type {
  AdminSetupStatusResponse,
  CockpitSystem
} from '@openg7/funding-core';

import type { CockpitBlockState } from '../../components/admin-cockpit/cockpit-block.js';
import {
  serviceState,
  systemExpired,
  systemState
} from '../../components/admin-cockpit/system-state.js';

export type SetupSection =
  | 'overview'
  | 'readiness'
  | 'stripe'
  | 'email'
  | 'queue'
  | 'database'
  | 'backups'
  | 'storage'
  | 'env'
  | 'activity';

export interface SetupRecommendation {
  readonly key:
    | 'database'
    | 'queue'
    | 'emailFailures'
    | 'service'
    | 'stripe'
    | 'email'
    | 'invoice'
    | 'verification'
    | 'ready';
  readonly section: SetupSection;
  readonly tone: 'warning' | 'neutral' | 'success';
  readonly url?: string;
  readonly urlAction?: 'openQueue' | 'openStripeEvents';
}

export interface SetupReadiness {
  readonly stripe: boolean;
  readonly email: boolean;
  readonly queue: boolean;
  readonly queueReadable: boolean;
  readonly canSendEmailTest: boolean;
}

export interface SetupChecklistItem {
  readonly id: 'stripe' | 'email' | 'queue' | 'database' | 'invoice';
  readonly ready: boolean;
}

export interface SetupRecommendationInput {
  readonly setup: AdminSetupStatusResponse | null;
  readonly systems: readonly CockpitSystem[];
  readonly systemsState: CockpitBlockState;
  readonly now: number;
  readonly failed: boolean;
}

export function projectReadiness(
  setup: AdminSetupStatusResponse
): SetupReadiness {
  const stripe =
    setup.stripe.secret_key_configured &&
    setup.stripe.webhook_secret_configured;
  const email =
    setup.email.smtp_configured &&
    Boolean(setup.email.from) &&
    Boolean(setup.email.admin_notification_email);
  // Older servers can return zero counters alongside a failed queue inspection.
  const queueReadable =
    setup.email.queue_available &&
    setup.database.reachable &&
    !(setup.email.last_error && !setup.email.last_failed_at);
  return {
    stripe,
    email,
    queueReadable,
    queue:
      queueReadable &&
      setup.email.failed_count === 0 &&
      !setup.email.last_error,
    canSendEmailTest: email && queueReadable
  };
}

export function projectChecklist(
  setup: AdminSetupStatusResponse | null
): readonly SetupChecklistItem[] {
  if (!setup) return [];
  const readiness = projectReadiness(setup);
  return [
    { id: 'stripe', ready: readiness.stripe },
    { id: 'email', ready: readiness.email },
    { id: 'queue', ready: readiness.queue },
    {
      id: 'database',
      ready: setup.database.configured && setup.database.reachable
    },
    { id: 'invoice', ready: setup.invoice.ready }
  ];
}

export function projectOperationalCount(
  systems: readonly CockpitSystem[],
  now: number,
  failed: boolean
): number {
  return systems.filter(
    (system) => serviceState(system, now, failed) === 'operational'
  ).length;
}

export function projectRecommendation({
  setup,
  systems,
  systemsState,
  now,
  failed
}: SetupRecommendationInput): SetupRecommendation {
  if (!setup)
    return { key: 'verification', section: 'readiness', tone: 'neutral' };
  if (!setup.database.reachable)
    return { key: 'database', section: 'database', tone: 'warning' };
  const readiness = projectReadiness(setup);
  if (!readiness.queueReadable)
    return { key: 'queue', section: 'queue', tone: 'warning' };
  if (setup.email.failed_count > 0)
    return {
      key: 'emailFailures',
      section: 'queue',
      tone: 'warning',
      url: '/admin/fundraiser/email-queue'
    };
  const problem = systems.find(
    (system) =>
      ['unavailable', 'degraded'].includes(serviceState(system, now, failed)) ||
      systemState(system, now, failed) === 'degraded'
  );
  if (problem?.id === 'stripe')
    return {
      key: 'service',
      section: 'stripe',
      tone: 'warning',
      ...(systemState(problem, now, failed) === 'degraded'
        ? {
            url: '/admin/fundraiser/attention?type=stripe_event_failed',
            urlAction: 'openStripeEvents' as const
          }
        : {})
    };
  if (problem?.id === 'email')
    return {
      key: 'service',
      section: 'email',
      tone: 'warning',
      url: '/admin/fundraiser/email-queue',
      urlAction: 'openQueue'
    };
  if (problem) return { key: 'service', section: problem.id, tone: 'warning' };
  if (!readiness.stripe)
    return { key: 'stripe', section: 'stripe', tone: 'warning' };
  if (!readiness.email)
    return { key: 'email', section: 'email', tone: 'warning' };
  if (!setup.invoice.ready)
    return { key: 'invoice', section: 'email', tone: 'warning' };
  if (
    systemsState !== 'ready' ||
    systems.length !== 4 ||
    systems.some(
      (system) =>
        system.id === 'stripe' &&
        (systemExpired(system, now, failed) ||
          ['check_failed', 'not_configured'].includes(system.evidence))
    ) ||
    projectOperationalCount(systems, now, failed) !== 4
  )
    return { key: 'verification', section: 'readiness', tone: 'neutral' };
  return { key: 'ready', section: 'activity', tone: 'success' };
}
