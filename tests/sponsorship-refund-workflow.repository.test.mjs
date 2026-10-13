import assert from 'node:assert/strict';
import test from 'node:test';

import {
  updateSponsorshipRefundWorkflowStatus,
  updateSponsorshipRefundWorkflowStatusByPaymentIntent
} from '../dist/apps/funding-api/src/sponsorship-refund-workflow.repository.js';

const entryPoints = [
  {
    name: 'contribution',
    update: updateSponsorshipRefundWorkflowStatus,
    target: { contributionId: '00000000-0000-4000-8000-000000000001' },
    predicate:
      /WHERE id = \$1::uuid\s+AND contribution_type = 'sponsorship_interest'/
  },
  {
    name: 'payment intent',
    update: updateSponsorshipRefundWorkflowStatusByPaymentIntent,
    target: { stripePaymentIntentId: 'pi_synthetic_refund_workflow' },
    predicate:
      /WHERE stripe_payment_intent_id = \$1\s+AND contribution_type = 'sponsorship_interest'/
  }
];

for (const { name, update, target, predicate } of entryPoints) {
  test(`${name} refund updates preserve their target and use the caller's query port`, async () => {
    const calls = [];
    const db = {
      async query(sql, values) {
        calls.push({ sql, values });
        return { rowCount: 1 };
      }
    };
    const input = Object.freeze({
      ...target,
      refundStatus: 'failed',
      refundId: 're_synthetic_refund_workflow',
      refundNote: 'Synthetic review note',
      refundError: 'SYNTHETIC_PROVIDER_FAILURE',
      refundAmountCents: 12345,
      refundReason: 'requested_by_customer'
    });

    assert.equal(await update(db, input), true);
    assert.equal(calls.length, 1, 'No transaction or connection is taken over');
    assert.match(calls[0].sql, predicate);
    assert.ok(!calls[0].sql.includes(Object.values(target)[0]));
    assert.deepEqual(calls[0].values, [
      Object.values(target)[0],
      'failed',
      're_synthetic_refund_workflow',
      'Synthetic review note',
      'SYNTHETIC_PROVIDER_FAILURE',
      12345,
      'requested_by_customer'
    ]);
  });

  test(`${name} refund updates retain omitted, null, empty and zero field semantics`, async () => {
    for (const fields of [
      {},
      {
        refundId: null,
        refundNote: null,
        refundError: null,
        refundAmountCents: null,
        refundReason: null
      },
      { refundId: '', refundNote: '', refundError: '', refundAmountCents: 0 }
    ]) {
      const calls = [];
      assert.equal(
        await update(
          {
            async query(_sql, values) {
              calls.push(values);
              return { rowCount: 1 };
            }
          },
          { ...target, refundStatus: 'completed', ...fields }
        ),
        true
      );
      assert.deepEqual(calls, [
        [
          Object.values(target)[0],
          'completed',
          fields.refundId ?? null,
          fields.refundNote ?? null,
          fields.refundError ?? null,
          fields.refundAmountCents ?? null,
          fields.refundReason ?? null
        ]
      ]);
    }
  });

  test(`${name} refund updates report only rows matched by storage`, async () => {
    for (const [rowCount, updated] of [
      [null, false],
      [0, false],
      [1, true],
      [2, true]
    ]) {
      assert.equal(
        await update(
          {
            async query() {
              return { rowCount };
            }
          },
          { ...target, refundStatus: 'processing' }
        ),
        updated
      );
    }
  });
}
