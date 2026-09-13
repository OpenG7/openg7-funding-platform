import type { Pool, PoolClient } from 'pg';

interface StripeEventInput {
  readonly stripeEventId: string;
  readonly eventType: string;
  readonly payload: unknown;
}

type StripeEventProcessingResult<T> =
  | { readonly status: 'processed'; readonly value: T }
  | { readonly status: 'duplicate' | 'busy' };

/**
 * Owns one connection for the entire event. Session locks survive the short
 * transactions used by repositories and disappear when PostgreSQL loses the
 * connection. Every write uses that connection, so a disconnected owner cannot
 * continue writing through another pooled connection after a retry takes over.
 */
export const withStripeEventProcessing = async <T>(
  pool: Pool | null,
  input: StripeEventInput,
  process: (eventPool: Pool | null) => Promise<T>
): Promise<StripeEventProcessingResult<T>> => {
  if (!pool) {
    return { status: 'processed', value: await process(null) };
  }

  const client = await pool.connect();
  let locked = false;
  let claimed = false;
  let active = true;
  let connectionFailed = false;
  const onConnectionError = (): void => {
    connectionFailed = true;
  };
  client.on('error', onConnectionError);

  const query = new Proxy(client.query, {
    apply(target, _thisArgument, argumentsList) {
      if (!active || connectionFailed) {
        return Promise.reject(
          new Error('Stripe event connection is unavailable.')
        );
      }
      return Reflect.apply(target, client, argumentsList);
    }
  });
  const borrowedClient: PoolClient = new Proxy(client, {
    get(target, property) {
      if (property === 'query') return query;
      // The outer owner alone releases the connection and its advisory lock.
      if (property === 'release') return () => undefined;
      return Reflect.get(target, property);
    }
  });
  const eventPool = new Proxy(pool, {
    get(target, property) {
      if (property === 'query') return query;
      if (property === 'connect') {
        return async () => {
          if (!active || connectionFailed) {
            throw new Error('Stripe event connection is unavailable.');
          }
          return borrowedClient;
        };
      }
      return Reflect.get(target, property);
    }
  });

  try {
    const lock = await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock(
        hashtextextended('stripe-webhook:' || $1::text, 0)
      ) AS locked`,
      [input.stripeEventId]
    );
    locked = lock.rows[0]?.locked === true;
    if (!locked) return { status: 'busy' };

    const record = await client.query(
      `
        INSERT INTO stripe_events (
          stripe_event_id, event_type, payload, processing_status, processed_at
        )
        VALUES ($1, $2, $3::jsonb, 'processing', NULL)
        ON CONFLICT (stripe_event_id) DO UPDATE
        SET processing_status = 'processing', processed_at = NULL
        WHERE stripe_events.processing_status IN ('processing', 'failed')
      `,
      [input.stripeEventId, input.eventType, JSON.stringify(input.payload)]
    );
    if (record.rowCount !== 1) return { status: 'duplicate' };
    claimed = true;

    const value = await process(eventPool);
    await query(
      `UPDATE stripe_events
       SET processing_status = 'processed', processed_at = NOW()
       WHERE stripe_event_id = $1`,
      [input.stripeEventId]
    );
    return { status: 'processed', value };
  } catch (error) {
    if (claimed && !connectionFailed) {
      try {
        // A repository may have failed before rolling its transaction back.
        await client.query('ROLLBACK');
        await client.query(
          `UPDATE stripe_events SET processing_status = 'failed'
           WHERE stripe_event_id = $1`,
          [input.stripeEventId]
        );
      } catch {
        connectionFailed = true;
      }
    }
    throw error;
  } finally {
    active = false;
    if (locked && !connectionFailed) {
      try {
        const unlocked = await client.query<{ unlocked: boolean }>(
          `SELECT pg_advisory_unlock(
            hashtextextended('stripe-webhook:' || $1::text, 0)
          ) AS unlocked`,
          [input.stripeEventId]
        );
        connectionFailed = unlocked.rows[0]?.unlocked !== true;
      } catch {
        connectionFailed = true;
      }
    }
    client.release(connectionFailed);
    client.removeListener('error', onConnectionError);
  }
};
