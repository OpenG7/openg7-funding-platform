import { createHash, randomUUID } from 'node:crypto';

import type { RedirectCheckoutResult } from '@openg7/funding-core';
import type { Pool } from 'pg';
import type Stripe from 'stripe';

import {
  protectPrivateJson,
  revealPrivateJson
} from './private-data-protection.js';
import {
  insertCheckoutSessionRecord,
  type CheckoutSessionRecordInput
} from './contributions-write.repository.js';

export class CheckoutOperationError extends Error {
  constructor(
    readonly code: string,
    readonly status: number
  ) {
    super(code);
  }
}

export interface DurableCheckoutInput {
  readonly key: string;
  readonly requestHash: string;
  readonly prepare: (operationId: string) => {
    params: Stripe.Checkout.SessionCreateParams;
    record: Omit<
      CheckoutSessionRecordInput,
      'stripeSessionId' | 'stripePaymentIntentId'
    >;
  };
}

interface ProviderResult extends RedirectCheckoutResult {
  readonly stripePaymentIntentId: string | null;
}

interface OperationRow {
  readonly id: string;
  readonly request_hash: string;
  readonly state: string;
  readonly params: Stripe.Checkout.SessionCreateParams;
  readonly contribution_input: Omit<
    CheckoutSessionRecordInput,
    'stripeSessionId' | 'stripePaymentIntentId'
  >;
  readonly provider_result: ProviderResult | null;
  readonly retry_allowed: boolean;
}

// Stripe may prune keys after 24h. Keep a margin and never recreate an older
// unresolved operation automatically. Completed results have no retry TTL.
export const createDurableCheckoutService =
  (
    pool: Pool | null,
    stripe: {
      readonly checkout: {
        readonly sessions: Pick<Stripe['checkout']['sessions'], 'create'>;
      };
    } | null,
    persistCheckoutSession?: (
      input: CheckoutSessionRecordInput
    ) => Promise<unknown>
  ) =>
  async (input: DurableCheckoutInput): Promise<RedirectCheckoutResult> => {
    if (!pool)
      throw new CheckoutOperationError('CHECKOUT_STORAGE_UNAVAILABLE', 503);
    if (!stripe)
      throw new CheckoutOperationError('CHECKOUT_PROVIDER_UNAVAILABLE', 503);

    const keyHash = createHash('sha256').update(input.key).digest('hex');
    const db = await pool.connect().catch(() => {
      throw new CheckoutOperationError('CHECKOUT_STORAGE_UNAVAILABLE', 503);
    });
    let connectionLost = false;
    const onConnectionError = () => {
      connectionLost = true;
    };
    db.on('error', onConnectionError);
    let locked = false;
    try {
      const lock = await db.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked',
        ['checkout:' + keyHash]
      );
      locked = lock.rows[0].locked;
      if (!locked)
        throw new CheckoutOperationError('CHECKOUT_IN_PROGRESS', 409);

      let operation = (
        await db.query<OperationRow>(
          `SELECT *, first_submitted_at IS NULL OR
       first_submitted_at > NOW() - INTERVAL '23 hours' AS retry_allowed
       FROM checkout_operations WHERE key_hash=$1`,
          [keyHash]
        )
      ).rows[0];
      if (operation && operation.request_hash !== input.requestHash)
        throw new CheckoutOperationError('CHECKOUT_IDEMPOTENCY_CONFLICT', 409);

      if (!operation) {
        const id = randomUUID();
        const prepared = input.prepare(id);
        operation = (
          await db.query<OperationRow>(
            `INSERT INTO checkout_operations
         (id,key_hash,request_hash,state,params,contribution_input)
         VALUES($1,$2,$3,'prepared',$4::jsonb,$5::jsonb)
         RETURNING *, true AS retry_allowed`,
            [
              id,
              keyHash,
              input.requestHash,
              JSON.stringify(
                protectPrivateJson(prepared.params, `checkout:${id}:params`)
              ),
              JSON.stringify(
                protectPrivateJson(
                  prepared.record,
                  `checkout:${id}:contribution`
                )
              )
            ]
          )
        ).rows[0];
      }

      operation = {
        ...operation,
        params: revealPrivateJson(
          operation.params,
          `checkout:${operation.id}:params`
        ),
        contribution_input: revealPrivateJson(
          operation.contribution_input,
          `checkout:${operation.id}:contribution`
        ),
        provider_result:
          operation.provider_result === null
            ? null
            : revealPrivateJson(
                operation.provider_result,
                `checkout:${operation.id}:result`
              )
      };
      let result = operation.provider_result;
      if (!result) {
        if (!operation.retry_allowed)
          throw new CheckoutOperationError(
            'CHECKOUT_RECONCILIATION_REQUIRED',
            409
          );
        // Each query commits before contacting the provider; the session lock
        // serializes API instances without keeping a DB transaction open.
        await db.query(
          `UPDATE checkout_operations SET state='submitting',
         first_submitted_at=COALESCE(first_submitted_at,NOW()),updated_at=NOW() WHERE id=$1`,
          [operation.id]
        );
        try {
          const session = await stripe.checkout.sessions.create(
            operation.params,
            {
              idempotencyKey: 'openg7:checkout:' + operation.id,
              timeout: 10000,
              maxNetworkRetries: 1
            }
          );
          if (connectionLost)
            throw new Error('Checkout storage connection lost.');
          if (!session.url)
            throw new Error('Checkout redirect is unavailable.');
          result = {
            checkoutId: session.id,
            redirectUrl: session.url,
            status: 'redirected',
            stripePaymentIntentId:
              typeof session.payment_intent === 'string'
                ? session.payment_intent
                : (session.payment_intent?.id ?? null)
          };
          await db.query(
            `UPDATE checkout_operations SET state='created',provider_result=$2::jsonb,
           updated_at=NOW() WHERE id=$1`,
            [
              operation.id,
              JSON.stringify(
                protectPrivateJson(result, `checkout:${operation.id}:result`)
              )
            ]
          );
        } catch {
          // Do not log provider errors: they can contain private return URLs.
          await db.query(
            `UPDATE checkout_operations SET state='uncertain',updated_at=NOW()
           WHERE id=$1 AND provider_result IS NULL`,
            [operation.id]
          );
          throw new CheckoutOperationError(
            'CHECKOUT_PROVIDER_UNAVAILABLE',
            502
          );
        }
      }

      if (operation.state !== 'completed') {
        try {
          const record = {
            ...operation.contribution_input,
            stripeSessionId: result.checkoutId,
            stripePaymentIntentId: result.stripePaymentIntentId
          };
          if (persistCheckoutSession) await persistCheckoutSession(record);
          else await insertCheckoutSessionRecord(db, record);
          await db.query(
            `UPDATE checkout_operations SET state='completed',updated_at=NOW() WHERE id=$1`,
            [operation.id]
          );
        } catch {
          throw new CheckoutOperationError('CHECKOUT_PERSISTENCE_FAILED', 503);
        }
      }
      if (connectionLost)
        throw new CheckoutOperationError('CHECKOUT_STORAGE_UNAVAILABLE', 503);
      return {
        checkoutId: result.checkoutId,
        redirectUrl: result.redirectUrl,
        status: 'redirected'
      };
    } catch (error) {
      if (error instanceof CheckoutOperationError) throw error;
      throw new CheckoutOperationError('CHECKOUT_STORAGE_UNAVAILABLE', 503);
    } finally {
      if (connectionLost) {
        db.release(true);
      } else if (locked) {
        // Never return a connection with an advisory lock to the shared pool.
        try {
          await db.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [
            'checkout:' + keyHash
          ]);
          db.release();
        } catch {
          db.release(true);
        }
      } else {
        db.release();
      }
      db.off('error', onConnectionError);
    }
  };
