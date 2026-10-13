import { createHash } from 'node:crypto';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const kinds = new Set(['checkout', 'refund']);

export class PaymentOperationConflict extends Error {}

/** Provider-side receipts are retained before losing a response, including SDK retries. */
export function createPaymentOperations() {
  const receipts = new Map();
  const keys = new Map();
  const faults = new Map();
  const refundTargets = new Map();
  const scope = (kind, id) => `${kind}:${id}`;
  return {
    configure(input) {
      if (
        !kinds.has(input.kind) ||
        !['lost', 'acknowledged'].includes(input.response) ||
        (input.refundStatus !== undefined &&
          (input.kind !== 'refund' || input.refundStatus !== 'pending'))
      )
        throw new Error('Invalid payment fault.');
      const fault = {
        response: input.response,
        refundStatus: input.refundStatus ?? 'succeeded'
      };
      if (
        input.operationId &&
        uuid.test(input.operationId) &&
        !input.paymentIntentId
      ) {
        faults.set(scope(input.kind, input.operationId), fault);
      } else if (
        input.kind === 'refund' &&
        !input.operationId &&
        typeof input.paymentIntentId === 'string' &&
        /^pi_[A-Za-z0-9_]+$/.test(input.paymentIntentId)
      ) {
        refundTargets.set(input.paymentIntentId, fault);
      } else throw new Error('A single payment operation target is required.');
    },
    execute(kind, idempotencyKey, raw, create) {
      const form = new URLSearchParams(raw);
      const operationId = form.get(
        kind === 'checkout'
          ? 'metadata[openg7CheckoutOperationId]'
          : 'metadata[openg7RefundOperationId]'
      );
      const operationKey = operationId ? scope(kind, operationId) : null;
      const key =
        typeof idempotencyKey === 'string' && idempotencyKey
          ? scope(kind, idempotencyKey)
          : null;
      const fingerprint = createHash('sha256')
        .update(
          JSON.stringify(
            [...form].sort(
              ([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv)
            )
          )
        )
        .digest('hex');
      let receipt = key ? keys.get(key) : null;
      if (receipt && receipt.fingerprint !== fingerprint)
        throw new PaymentOperationConflict(
          'An idempotency key cannot change provider parameters.'
        );
      if (!receipt && kind === 'refund' && operationKey) {
        const paymentIntentId = form.get('payment_intent');
        if (refundTargets.has(paymentIntentId)) {
          faults.set(operationKey, refundTargets.get(paymentIntentId));
          refundTargets.delete(paymentIntentId);
        }
      }
      const fault = faults.get(operationKey);
      const created = !receipt;
      if (!receipt) {
        const result = create({
          refundStatus: fault?.refundStatus ?? 'succeeded'
        });
        if (!result) return null; // Rejected requests create no provider receipt.
        receipt = {
          operationId,
          fingerprint,
          result: structuredClone(result),
          attempts: []
        };
        if (key) keys.set(key, receipt);
        if (operationKey) receipts.set(operationKey, receipt);
      }
      const lost = fault?.response === 'lost';
      receipt.attempts.push({
        created,
        response: lost ? 'lost' : 'acknowledged'
      });
      return { body: structuredClone(receipt.result), lost };
    },
    inspect(kind, operationId) {
      const receipt = receipts.get(scope(kind, operationId));
      return receipt
        ? {
            operationId,
            resourceId: receipt.result.id,
            attempts: structuredClone(receipt.attempts)
          }
        : null;
    },
    reset() {
      receipts.clear();
      keys.clear();
      faults.clear();
      refundTargets.clear();
    }
  };
}
