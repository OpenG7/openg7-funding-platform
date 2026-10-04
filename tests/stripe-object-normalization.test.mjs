import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildBalanceData,
  resolveBalanceTransaction,
  resolveCharge,
  resolvePaymentIntent,
  resolvePaymentIntentId
} from '../dist/apps/funding-api/src/stripe-object-normalization.js';

test('payment intent references accept identifiers and expanded objects without altering them', () => {
  const paymentIntent = Object.freeze({
    id: 'pi_normalization_fixture',
    created: 1735689600,
    amount: 1500,
    currency: 'cad',
    metadata: Object.freeze({ publicDisplayConsent: 'false' })
  });

  assert.equal(
    resolvePaymentIntentId('pi_normalization_fixture'),
    'pi_normalization_fixture'
  );
  assert.equal(
    resolvePaymentIntentId(paymentIntent),
    'pi_normalization_fixture'
  );
  for (const value of [null, undefined, '']) {
    assert.equal(resolvePaymentIntentId(value), null);
  }
  assert.equal(paymentIntent.metadata.publicDisplayConsent, 'false');
});

test('missing or expanded balances never request a Stripe object', async () => {
  const stripe = {
    balanceTransactions: {
      retrieve() {
        assert.fail('Expanded and absent balances must not trigger retrieval');
      }
    }
  };
  for (const value of [null, undefined, '']) {
    assert.equal(await resolveBalanceTransaction(stripe, value), null);
  }

  const balanceTransaction = Object.freeze({
    id: 'txn_expanded_fixture',
    amount: 1500,
    fee: 75,
    net: 1425,
    currency: 'cad'
  });
  assert.equal(
    await resolveBalanceTransaction(stripe, balanceTransaction),
    balanceTransaction
  );
});

test('balance identifiers retrieve exactly their object and retain provider errors for retry', async () => {
  const failure = new Error('Simulated balance retrieval failure');
  const balanceTransaction = { id: 'txn_retrieved_fixture' };
  const calls = [];
  const stripe = {
    balanceTransactions: {
      async retrieve(...args) {
        calls.push(args);
        if (calls.length === 1) {
          throw failure;
        }
        return balanceTransaction;
      }
    }
  };

  await assert.rejects(
    resolveBalanceTransaction(stripe, 'txn_retrieved_fixture'),
    (error) => error === failure
  );
  assert.equal(
    await resolveBalanceTransaction(stripe, 'txn_retrieved_fixture'),
    balanceTransaction
  );
  assert.deepEqual(calls, [
    ['txn_retrieved_fixture'],
    ['txn_retrieved_fixture']
  ]);
});

test('absent and expanded payment intents and charges preserve partial objects without retrieval', async () => {
  const stripe = {
    paymentIntents: {
      retrieve() {
        assert.fail('Expanded and absent intents must not trigger retrieval');
      }
    },
    charges: {
      retrieve() {
        assert.fail('Expanded and absent charges must not trigger retrieval');
      }
    }
  };
  const chargeOptions = { expand: ['balance_transaction'] };

  for (const value of [null, undefined, '']) {
    assert.equal(await resolvePaymentIntent(stripe, value), null);
    assert.equal(await resolveCharge(stripe, value, chargeOptions), null);
  }
  for (const paymentIntent of [
    Object.freeze({ id: 'pi_partial_fixture' }),
    Object.freeze({
      id: 'pi_expanded_fixture',
      latest_charge: Object.freeze({ id: 'ch_nested_fixture' })
    })
  ]) {
    assert.equal(
      await resolvePaymentIntent(stripe, paymentIntent),
      paymentIntent
    );
  }
  for (const charge of [
    Object.freeze({ id: 'ch_partial_fixture' }),
    Object.freeze({
      id: 'ch_expanded_fixture',
      balance_transaction: Object.freeze({ id: 'txn_nested_fixture' })
    })
  ]) {
    assert.equal(await resolveCharge(stripe, charge, chargeOptions), charge);
  }
});

test('payment intent identifiers retain balance expansion and provider errors for retry', async () => {
  const failure = new Error('Simulated payment intent retrieval failure');
  const paymentIntent = Object.freeze({ id: 'pi_retrieved_fixture' });
  const calls = [];
  const stripe = {
    paymentIntents: {
      async retrieve(...args) {
        calls.push(args);
        if (calls.length === 1) throw failure;
        return paymentIntent;
      }
    }
  };

  await assert.rejects(
    resolvePaymentIntent(stripe, paymentIntent.id),
    (error) => error === failure
  );
  assert.equal(
    await resolvePaymentIntent(stripe, paymentIntent.id),
    paymentIntent
  );
  assert.deepEqual(calls, [
    [paymentIntent.id, { expand: ['latest_charge.balance_transaction'] }],
    [paymentIntent.id, { expand: ['latest_charge.balance_transaction'] }]
  ]);
});

test('charge identifiers use the explicit consumer expansion policy and preserve provider errors', async () => {
  for (const options of [
    { expand: ['balance_transaction', 'payment_intent'] },
    { expand: ['balance_transaction'] }
  ]) {
    const failure = new Error('Simulated charge retrieval failure');
    const charge = Object.freeze({ id: 'ch_retrieved_fixture' });
    const calls = [];
    const stripe = {
      charges: {
        async retrieve(...args) {
          calls.push(args);
          assert.equal(args[1], options);
          if (calls.length === 1) throw failure;
          return charge;
        }
      }
    };

    await assert.rejects(
      resolveCharge(stripe, charge.id, options),
      (error) => error === failure
    );
    assert.equal(await resolveCharge(stripe, charge.id, options), charge);
    assert.deepEqual(calls, [
      [charge.id, options],
      [charge.id, options]
    ]);
  }
});

test('absent balances preserve each consumer fallback amount and currency', () => {
  for (const amount of [0, 1500, -1500]) {
    assert.deepEqual(buildBalanceData(null, amount, 'CAD'), {
      stripeBalanceTransactionId: null,
      amount,
      fee: 0,
      net: amount,
      currency: 'CAD'
    });
  }
});

test('confirmed balance facts take precedence over fallback values without recalculation', () => {
  const balanceTransaction = Object.freeze({
    id: 'txn_authoritative_fixture',
    amount: -1000,
    fee: 37,
    net: -1037,
    currency: 'usd',
    created: 1735689600
  });

  assert.deepEqual(buildBalanceData(balanceTransaction, 2500, 'cad'), {
    stripeBalanceTransactionId: 'txn_authoritative_fixture',
    amount: -1000,
    fee: 37,
    net: -1037,
    currency: 'usd'
  });
});

test('partial expanded balances keep unknown provider fields instead of substituting fallback facts', () => {
  const balanceTransaction = Object.freeze({
    id: 'txn_partial_fixture',
    amount: 0,
    currency: 'cad'
  });

  assert.deepEqual(buildBalanceData(balanceTransaction, 1500, 'usd'), {
    stripeBalanceTransactionId: 'txn_partial_fixture',
    amount: 0,
    fee: undefined,
    net: undefined,
    currency: 'cad'
  });
});
