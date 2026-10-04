import assert from 'node:assert/strict';
import test from 'node:test';

import { CheckoutAttempts } from '../dist/apps/funding-web/src/app/features/funding/services/checkout-attempts.js';
import { CheckoutReconciliationRequiredError } from '../dist/apps/funding-web/src/app/features/funding/services/checkout-error.js';

const intent = {
  amount: 25,
  currency: 'CAD',
  projectId: 'synthetic-project',
  successUrl: 'https://funding.example.test/support?checkout=success',
  cancelUrl: 'https://funding.example.test/support?checkout=cancel',
  contributionType: 'personal_support',
  publicDisplayConsent: false,
  publicDisplayName: 'Synthetic private name',
  displayAmountConsent: false,
  nonCharityAcknowledged: true
};
const result = {
  status: 'redirected',
  checkoutId: 'cs_synthetic',
  redirectUrl: 'https://checkout.example.test/session'
};
const uuidPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function memoryStorage() {
  const entries = new Map();
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: (key) => entries.delete(key)
  };
}

test('identical concurrent attempts share one provider call and keep their key after an uncertain response', async () => {
  const attempts = new CheckoutAttempts();
  const requests = [];
  const failure = new TypeError('Synthetic lost provider response');
  let release;
  let entered;
  const started = new Promise((resolve) => (entered = resolve));
  const execute = (request) => {
    requests.push(request);
    entered();
    return new Promise((resolve, reject) => (release = () => reject(failure)));
  };
  const first = attempts.start(intent, execute);
  const duplicate = attempts.start({ ...intent }, execute);
  const reordered = Object.fromEntries(Object.entries(intent).reverse());
  const samePayload = attempts.start(reordered, execute);
  assert.equal(first, duplicate);
  assert.equal(first, samePayload);
  const rejections = [first, duplicate, samePayload].map((pending) =>
    assert.rejects(pending, (error) => error === failure)
  );
  await started;
  assert.equal(requests.length, 1);
  assert.match(requests[0].idempotencyKey, uuidPattern);
  release();
  await Promise.all(rejections);

  assert.deepEqual(
    await attempts.start(intent, async (request) => {
      requests.push(request);
      return result;
    }),
    result
  );
  assert.equal(requests[1].idempotencyKey, requests[0].idempotencyKey);
  await attempts.start(intent, async (request) => {
    requests.push(request);
    return result;
  });
  assert.notEqual(requests[2].idempotencyKey, requests[0].idempotencyKey);
});

test('uncertain attempts survive reload using only an opaque key and payload digest', async () => {
  const storage = memoryStorage();
  const requests = [];
  const beforeReload = new CheckoutAttempts(() => storage);
  await assert.rejects(
    beforeReload.start(intent, async (request) => {
      requests.push(request);
      assert.equal(
        storage.entries.size,
        1,
        'persist before requesting Checkout'
      );
      throw new TypeError('Synthetic response lost after session creation');
    })
  );
  const serialized = [...storage.entries.values()][0];
  const saved = JSON.parse(serialized);
  assert.equal(Object.keys(saved).length, 1);
  assert.match(Object.keys(saved)[0], /^[a-f0-9]{64}$/);
  assert.equal(Object.values(saved)[0], requests[0].idempotencyKey);
  for (const privateValue of [
    intent.publicDisplayName,
    intent.successUrl,
    intent.cancelUrl,
    intent.projectId
  ]) {
    assert.equal(serialized.includes(privateValue), false);
  }

  const afterReload = new CheckoutAttempts(() => storage);
  await afterReload.start(intent, async (request) => {
    requests.push(request);
    return result;
  });
  assert.equal(requests[1].idempotencyKey, requests[0].idempotencyKey);
  assert.equal(storage.entries.size, 0);
  await new CheckoutAttempts(() => storage).start(intent, async (request) => {
    requests.push(request);
    return result;
  });
  assert.notEqual(requests[2].idempotencyKey, requests[0].idempotencyKey);
});

test('changed amount, consent and return URLs create distinct attempts without losing uncertain keys', async () => {
  const storage = memoryStorage();
  const attempts = new CheckoutAttempts(() => storage);
  const keys = [];
  const fail = async (request) => {
    keys.push(request.idempotencyKey);
    throw new Error('Synthetic retryable failure');
  };
  for (const changed of [
    intent,
    { ...intent, amount: 50 },
    { ...intent, publicDisplayConsent: true },
    { ...intent, publicDisplayName: 'Another synthetic name' },
    { ...intent, successUrl: 'https://funding.example.test/en/support' }
  ]) {
    await assert.rejects(attempts.start(changed, fail));
  }
  assert.equal(new Set(keys).size, 5);
  await assert.rejects(attempts.start(intent, fail));
  assert.equal(keys.at(-1), keys[0]);
});

test('restricted or corrupted storage does not block Checkout or replace an uncertain in-memory key', async () => {
  for (const getStorage of [
    () => null,
    () => {
      throw new DOMException('Synthetic denied storage', 'SecurityError');
    },
    () => ({
      getItem: () => '{invalid',
      setItem: () => {
        throw new DOMException('Synthetic full storage', 'QuotaExceededError');
      },
      removeItem: () => {}
    }),
    () => ({
      getItem: () => JSON.stringify({ privateName: 'invalid-key' }),
      setItem: () => {},
      removeItem: () => {}
    })
  ]) {
    const attempts = new CheckoutAttempts(getStorage);
    let key;
    await assert.rejects(
      attempts.start(intent, async (request) => {
        key = request.idempotencyKey;
        throw new Error('Synthetic uncertain result');
      })
    );
    await attempts.start(intent, async (request) => {
      assert.equal(request.idempotencyKey, key);
      return result;
    });
  }
});

test('reconciliation blocks changed intents across reload without rotating the retained key or contacting the provider', async () => {
  const storage = memoryStorage();
  const attempts = new CheckoutAttempts(() => storage);
  let providerCalls = 0;
  let key;
  await assert.rejects(
    attempts.start({ ...intent, amount: 50 }, async (request) => {
      providerCalls++;
      key = request.idempotencyKey;
      throw new CheckoutReconciliationRequiredError();
    }),
    CheckoutReconciliationRequiredError
  );
  const saved = [...storage.entries];
  const pending = JSON.parse(storage.getItem('openg7.checkout-attempts.v1'));
  assert.deepEqual(Object.values(pending), [key]);
  assert.equal(attempts.requiresVerification(), true);
  for (const instance of [attempts, new CheckoutAttempts(() => storage)]) {
    assert.equal(instance.requiresVerification(), true);
    for (const changed of [
      intent,
      {
        ...intent,
        publicDisplayConsent: true,
        publicDisplayName: 'Another synthetic name'
      },
      { ...intent, successUrl: 'https://funding.example.test/en/support' }
    ]) {
      await assert.rejects(
        instance.start(changed, async () => {
          providerCalls++;
          return result;
        }),
        CheckoutReconciliationRequiredError
      );
    }
  }
  assert.equal(providerCalls, 1);
  assert.deepEqual([...storage.entries], saved);
  const serialized = JSON.stringify(saved);
  assert.equal(serialized.includes(intent.publicDisplayName), false);
  assert.equal(serialized.includes(intent.successUrl), false);
});

test('reconciliation keeps an in-memory block when browser storage cannot be read or written', async () => {
  for (const getStorage of [
    () => null,
    () => {
      throw new DOMException('Synthetic denied storage', 'SecurityError');
    },
    () => ({
      getItem: () => null,
      setItem: () => {
        throw new DOMException('Synthetic full storage', 'QuotaExceededError');
      },
      removeItem: () => {}
    })
  ]) {
    const attempts = new CheckoutAttempts(getStorage);
    await assert.rejects(
      attempts.start(intent, async () => {
        throw new CheckoutReconciliationRequiredError();
      }),
      CheckoutReconciliationRequiredError
    );
    assert.equal(attempts.requiresVerification(), true);
    await assert.rejects(
      attempts.start({ ...intent, amount: 50 }, () =>
        assert.fail('No new provider request')
      ),
      CheckoutReconciliationRequiredError
    );
  }
});
