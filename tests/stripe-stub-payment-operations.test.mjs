import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPaymentOperations,
  PaymentOperationConflict
} from './stripe-stub/payment-operations.mjs';

const checkoutId = '00000000-0000-4000-8000-000000000001';
const refundId = '00000000-0000-4000-8000-000000000002';
const nextRefundId = '00000000-0000-4000-8000-000000000003';
const checkoutForm = (amount = '2500') =>
  new URLSearchParams({
    'metadata[openg7CheckoutOperationId]': checkoutId,
    'line_items[0][price_data][unit_amount]': amount
  }).toString();
const refundForm = (operationId = refundId) =>
  new URLSearchParams({
    payment_intent: 'pi_synthetic_recovery',
    'metadata[openg7RefundOperationId]': operationId,
    amount: '50000'
  }).toString();

test('Checkout acceptance survives lost responses and SDK retries with one immutable provider receipt', () => {
  const simulator = createPaymentOperations();
  simulator.configure({
    kind: 'checkout',
    operationId: checkoutId,
    response: 'lost'
  });
  let created = 0;
  const create = () => ({
    id: 'cs_synthetic_receipt_' + ++created,
    url: 'http://127.0.0.1/checkout',
    payment_status: 'unpaid'
  });
  const execute = () =>
    simulator.execute('checkout', 'checkout-key', checkoutForm(), create);
  const first = execute();
  first.body.payment_status = 'tampered-by-consumer';
  assert.equal(first.lost, true);
  assert.deepEqual(execute(), {
    body: {
      id: 'cs_synthetic_receipt_1',
      url: 'http://127.0.0.1/checkout',
      payment_status: 'unpaid'
    },
    lost: true
  });
  simulator.configure({
    kind: 'checkout',
    operationId: checkoutId,
    response: 'acknowledged'
  });
  assert.equal(execute().lost, false);
  assert.equal(created, 1);
  assert.deepEqual(simulator.inspect('checkout', checkoutId), {
    operationId: checkoutId,
    resourceId: 'cs_synthetic_receipt_1',
    attempts: [
      { created: true, response: 'lost' },
      { created: false, response: 'lost' },
      { created: false, response: 'acknowledged' }
    ]
  });
  assert.throws(
    () =>
      simulator.execute(
        'checkout',
        'checkout-key',
        checkoutForm('5000'),
        create
      ),
    PaymentOperationConflict
  );
  assert.equal(created, 1);
});

test('a refund fault binds to its payment operation and never affects another explicit refund', () => {
  const simulator = createPaymentOperations();
  simulator.configure({
    kind: 'refund',
    paymentIntentId: 'pi_synthetic_recovery',
    response: 'lost',
    refundStatus: 'pending'
  });
  let created = 0;
  const create = ({ refundStatus }) => ({
    id: 're_synthetic_' + ++created,
    status: refundStatus
  });
  const first = simulator.execute('refund', 'refund-key', refundForm(), create);
  assert.deepEqual(first, {
    body: { id: 're_synthetic_1', status: 'pending' },
    lost: true
  });
  assert.deepEqual(
    simulator.execute('refund', 'refund-key', refundForm(), create),
    first
  );
  assert.deepEqual(
    simulator.execute(
      'refund',
      'next-refund-key',
      refundForm(nextRefundId),
      create
    ),
    {
      body: { id: 're_synthetic_2', status: 'succeeded' },
      lost: false
    }
  );
  assert.equal(created, 2);
  assert.deepEqual(
    simulator.inspect('refund', refundId).attempts.map((a) => a.created),
    [true, false]
  );
});

test('untargeted operations retain default success and rejected requests reserve no receipt', () => {
  const simulator = createPaymentOperations();
  assert.equal(
    simulator.execute('refund', 'key', refundForm(), () => null),
    null
  );
  assert.equal(simulator.inspect('refund', refundId), null);
  assert.deepEqual(
    simulator.execute('refund', 'key', refundForm(), ({ refundStatus }) => ({
      id: 're_default',
      status: refundStatus
    })),
    {
      body: { id: 're_default', status: 'succeeded' },
      lost: false
    }
  );
  simulator.reset();
  assert.equal(simulator.inspect('refund', refundId), null);
});

test('fault controls require a concrete scope and cannot target arbitrary provider mutations', () => {
  const simulator = createPaymentOperations();
  for (const invalid of [
    { kind: 'checkout', response: 'lost' },
    { kind: 'checkout', operationId: 'all', response: 'lost' },
    {
      kind: 'refund',
      operationId: refundId,
      paymentIntentId: 'pi_synthetic_recovery',
      response: 'lost'
    },
    { kind: 'charge', operationId: checkoutId, response: 'lost' },
    {
      kind: 'checkout',
      operationId: checkoutId,
      response: 'lost',
      refundStatus: 'pending'
    }
  ])
    assert.throws(() => simulator.configure(invalid));
});
