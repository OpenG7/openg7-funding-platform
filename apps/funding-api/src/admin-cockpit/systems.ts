import type { AdminCockpitSystems, CockpitSystem } from '@openg7/funding-core';
import type { Pool } from 'pg';

import { readSnapshot } from './read.js';

export const SYSTEM_CACHE_MS = 60_000;
export const OBSERVATION_MAX_AGE_MS = 15 * 60_000;
type Observation = {
  readonly lastSuccess: string | null;
  readonly issues: number;
};
export interface SystemHealthPorts {
  readonly stripeConfigured: boolean;
  readonly emailConfigured: boolean;
  readonly storageProvider: 'Local' | 'OVH S3';
  readonly databaseConfigured: boolean;
  readonly database: () => Promise<void>;
  readonly stripe: () => Promise<Observation>;
  readonly email: () => Promise<Observation>;
  readonly storage: (signal: AbortSignal) => Promise<void>;
}

/** Bounded and single-flight, so repeated dashboard reads do not multiply probes. */
export const createCockpitSystemsReader = (
  ports: SystemHealthPorts,
  clock: () => Date = () => new Date(),
  timeoutMs = 2500
) => {
  let cached: AdminCockpitSystems | undefined;
  let pending: Promise<AdminCockpitSystems> | undefined;
  const bounded = async <T>(
    read: (signal: AbortSignal) => Promise<T>
  ): Promise<T> => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        read(controller.signal),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('Health timeout'));
          }, timeoutMs);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  return async (): Promise<AdminCockpitSystems> => {
    const now = clock();
    if (
      cached &&
      now.getTime() >= Date.parse(cached.generatedAt) &&
      cached.systems.every((s) => now.getTime() < Date.parse(s.validUntil))
    )
      return cached;
    if (pending) return pending;
    pending = (async () => {
      const specs = [
        {
          id: 'stripe',
          provider: 'Stripe',
          configured: ports.stripeConfigured,
          read: ports.stripe,
          evidence: 'recent_webhook',
          url: '/admin/fundraiser/attention?type=stripe_event_failed'
        },
        {
          id: 'email',
          provider: 'SMTP',
          configured: ports.emailConfigured,
          read: ports.email,
          evidence: 'recent_email',
          url: '/admin/fundraiser/email-queue'
        },
        {
          id: 'storage',
          provider: ports.storageProvider,
          configured: true,
          read: ports.storage,
          evidence: 'storage_read',
          url: '/admin/fundraiser/setup'
        },
        {
          id: 'database',
          provider: 'PostgreSQL',
          configured: ports.databaseConfigured,
          read: ports.database,
          evidence: 'database_read',
          url: '/admin/fundraiser/setup'
        }
      ] as const;
      const systems = await Promise.all(
        specs.map(async (spec): Promise<CockpitSystem> => {
          const base: CockpitSystem = {
            id: spec.id,
            provider: spec.provider,
            adminUrl: spec.url,
            checkedAt: now.toISOString(),
            observedAt: null,
            validUntil: new Date(now.getTime() + SYSTEM_CACHE_MS).toISOString(),
            state: 'not_configured',
            evidence: 'not_configured'
          };
          if (!spec.configured) return base;
          try {
            const observation = await bounded<void | Observation>(spec.read);
            if (!observation)
              return {
                ...base,
                state: 'operational',
                evidence: spec.evidence,
                observedAt: now.toISOString()
              };
            const timestamp = observation.lastSuccess
              ? Date.parse(observation.lastSuccess)
              : NaN;
            const fresh =
              Number.isFinite(timestamp) &&
              timestamp <= now.getTime() &&
              now.getTime() - timestamp < OBSERVATION_MAX_AGE_MS;
            return {
              ...base,
              observedAt: Number.isFinite(timestamp)
                ? new Date(timestamp).toISOString()
                : null,
              state:
                observation.issues > 0
                  ? 'degraded'
                  : fresh
                    ? 'operational'
                    : 'unknown',
              evidence:
                observation.issues > 0
                  ? 'pending_errors'
                  : fresh
                    ? spec.evidence
                    : 'no_recent_observation',
              validUntil: new Date(
                Math.min(
                  now.getTime() + SYSTEM_CACHE_MS,
                  fresh ? timestamp + OBSERVATION_MAX_AGE_MS : Infinity
                )
              ).toISOString()
            };
          } catch {
            return {
              ...base,
              state:
                spec.id === 'stripe' || spec.id === 'email'
                  ? 'unknown'
                  : 'unavailable',
              evidence: 'check_failed'
            };
          }
        })
      );
      cached = { generatedAt: now.toISOString(), systems };
      return cached;
    })();
    try {
      return await pending;
    } finally {
      pending = undefined;
    }
  };
};

export const readSystemObservation = async (
  pool: Pool | null,
  kind: 'stripe' | 'email'
): Promise<Observation> => {
  if (!pool) throw new Error('Observation database unavailable');
  return readSnapshot(pool, async (client) => {
    const query =
      kind === 'stripe'
        ? `SELECT max(processed_at) FILTER (WHERE processing_status = 'processed' AND event_type IN ('payment_intent.succeeded', 'charge.updated', 'checkout.session.completed', 'charge.refunded'))::text AS success,
        count(*) FILTER (WHERE processing_status = 'failed' OR (processing_status = 'processing' AND received_at < now() - interval '15 minutes'))::integer AS issues FROM stripe_events`
        : `SELECT max(sent_at) FILTER (WHERE status = 'sent')::text AS success,
        count(*) FILTER (WHERE status = 'failed' OR (status = 'sending' AND updated_at < now() - interval '15 minutes')
          OR (status = 'queued' AND next_attempt_at < now() - interval '15 minutes'))::integer AS issues FROM email_messages`;
    const result = await client.query<{
      success: string | null;
      issues: number;
    }>(query);
    return {
      lastSuccess: result.rows[0]?.success ?? null,
      issues: result.rows[0]?.issues ?? 0
    };
  });
};
