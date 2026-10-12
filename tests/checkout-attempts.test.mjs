import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';

import {
  CheckoutReconciliationRequiredError,
  CheckoutOfferChangedError,
  CheckoutCharterChangedError
} from '../dist/apps/funding-web/src/app/features/funding/services/checkout-error.js';

// The root build emits public workspaces under dist/, without package-local builds.
const workspaceHook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@openg7/funding-core')
      return {
        url: new URL(
          '../dist/packages/funding-core/src/index.js',
          import.meta.url
        ).href,
        shortCircuit: true
      };
    return nextResolve(specifier, context);
  }
});
const { CheckoutAttempts } =
  await import('../dist/apps/funding-web/src/app/features/funding/services/checkout-attempts.js');
workspaceHook.deregister();

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

const sponsorshipOffer = (version = 'sponsorship-v1') => {
  const snapshot = {
    version,
    amountMinor: 25000,
    currency: 'CAD',
    benefits: [
      {
        id: 'website_mention',
        channel: 'website',
        target: 'openg7',
        quantity: 1,
        requiredElements: ['company_name', 'approved_logo'],
        deadlineDays: null,
        durationDays: null
      }
    ]
  };
  return {
    ...snapshot,
    fingerprint: createHash('sha256')
      .update(JSON.stringify(snapshot))
      .digest('hex')
  };
};
const sponsorshipIntent = (offer) => ({
  ...intent,
  amount: 250,
  contributionType: 'sponsorship_interest',
  offerAcceptance: { version: offer.version, fingerprint: offer.fingerprint }
});

test('a formatted uncertain checkout restores exact options and payload, while old offers never acquire defaults', async () => {
  const storage = memoryStorage();
  const quote = sponsorshipOffer('sponsorship-v2');
  const payload = {
    ...sponsorshipIntent(quote),
    offerFormats: {
      linkedin: 'individual_portrait',
      facebook: 'collective_composite'
    }
  };
  const first = new CheckoutAttempts(() => storage);
  let captured;
  await assert.rejects(
    first.start(
      payload,
      async (request) => {
        captured = request;
        throw new Error('Synthetic uncertain provider result');
      },
      quote
    )
  );
  const reloaded = new CheckoutAttempts(() => storage),
    resume = await reloaded.retainedSponsorshipOffer(5000, 'CAD');
  assert.deepEqual(resume.formats, {
    facebook: 'collective_composite',
    linkedin: 'individual_portrait'
  });
  await reloaded.start(
    { ...payload, offerFormats: resume.formats },
    async (request) => {
      assert.deepEqual(request, captured);
      return result;
    },
    resume.quote
  );
  const oldStorage = memoryStorage(),
    old = new CheckoutAttempts(() => oldStorage);
  let original;
  await assert.rejects(
    old.start(
      sponsorshipIntent(quote),
      async (request) => {
        original = request;
        throw new Error('Synthetic uncertain old attempt');
      },
      quote
    )
  );
  const oldReloaded = new CheckoutAttempts(() => oldStorage),
    oldResume = await oldReloaded.retainedSponsorshipOffer(25000, 'CAD');
  assert.equal(Object.hasOwn(oldResume, 'formats'), false);
  await oldReloaded.start(
    sponsorshipIntent(oldResume.quote),
    async (request) => {
      assert.deepEqual(request, original);
      assert.equal(Object.hasOwn(request, 'offerFormats'), false);
      return result;
    },
    oldResume.quote
  );
});

test('uncertain sponsorship resumes the exact retained offer and UUID after reload without storing private intent fields', async () => {
  const storage = memoryStorage();
  const first = new CheckoutAttempts(() => storage);
  const offer = sponsorshipOffer();
  const submission = sponsorshipIntent(offer);
  let original;
  await assert.rejects(
    first.start(
      submission,
      async (request) => {
        original = structuredClone(request);
        throw new Error('Synthetic lost response after submission');
      },
      offer
    )
  );
  const reloaded = new CheckoutAttempts(() => storage);
  const resume = await reloaded.retainedSponsorshipOffer(25000, 'CAD');
  assert.equal(resume.state, 'retained');
  assert.deepEqual(resume.quote, offer);
  assert.deepEqual(
    (await reloaded.retainedSponsorshipOffer(5000, 'CAD')).quote,
    offer
  );
  const changedTariff = sponsorshipOffer('sponsorship-v2');
  assert.notEqual(resume.quote.fingerprint, changedTariff.fingerprint);
  const serialized = JSON.stringify([...storage.entries]);
  for (const value of [
    intent.publicDisplayName,
    intent.successUrl,
    intent.cancelUrl
  ])
    assert.equal(serialized.includes(value), false);
  await reloaded.start(
    sponsorshipIntent(resume.quote),
    async (request) => {
      assert.deepEqual(request, original);
      return result;
    },
    resume.quote
  );
  assert.equal(
    (await reloaded.retainedSponsorshipOffer(25000, 'CAD')).state,
    'none'
  );
  assert.equal(storage.entries.size, 0);
});

test('altering the resumed payment intent cannot replace the submitted sponsorship key', async () => {
  const storage = memoryStorage();
  const offer = sponsorshipOffer();
  const attempts = new CheckoutAttempts(() => storage);
  await assert.rejects(
    attempts.start(
      sponsorshipIntent(offer),
      async () => {
        throw new Error('Synthetic uncertain request');
      },
      offer
    )
  );
  const before = storage.getItem('openg7.checkout-attempts.v1');
  await assert.rejects(
    attempts.start(
      {
        ...sponsorshipIntent(offer),
        publicDisplayName: 'Changed private name'
      },
      async () => {
        assert.fail(
          'A changed uncertain intent must not create a new operation.'
        );
      },
      offer
    ),
    CheckoutReconciliationRequiredError
  );
  assert.equal(storage.getItem('openg7.checkout-attempts.v1'), before);
});

test('switching an uncertain sponsorship to personal support cannot create a different payment', async () => {
  const storage = memoryStorage();
  const offer = sponsorshipOffer();
  const attempts = new CheckoutAttempts(() => storage);
  await assert.rejects(
    attempts.start(
      sponsorshipIntent(offer),
      async () => {
        throw new Error('Synthetic lost response');
      },
      offer
    )
  );
  const before = storage.getItem('openg7.checkout-attempts.v1');
  await assert.rejects(
    attempts.start(intent, async () => {
      assert.fail(
        'Changing contribution type must not abandon an uncertain payment.'
      );
    }),
    CheckoutReconciliationRequiredError
  );
  assert.equal(storage.getItem('openg7.checkout-attempts.v1'), before);
});

test('schema-invalid replies cannot discard a previously submitted UUID but new-input validation can', async () => {
  for (const ErrorType of [
    CheckoutOfferChangedError,
    CheckoutCharterChangedError
  ]) {
    const code =
      ErrorType === CheckoutOfferChangedError
        ? 'SPONSORSHIP_OFFER_INVALID'
        : 'CHARTER_ACCEPTANCE_INVALID';
    const storage = memoryStorage();
    const offer = sponsorshipOffer();
    const first = new CheckoutAttempts(() => storage);
    await assert.rejects(
      first.start(
        sponsorshipIntent(offer),
        async () => {
          throw new Error('Synthetic lost response');
        },
        offer
      )
    );
    const before = storage.getItem('openg7.checkout-attempts.v1');
    const retained = new CheckoutAttempts(() => storage);
    await assert.rejects(
      retained.start(
        sponsorshipIntent(offer),
        async () => {
          throw new ErrorType(code);
        },
        offer
      ),
      CheckoutReconciliationRequiredError
    );
    assert.equal(retained.requiresVerification(), true);
    assert.equal(storage.getItem('openg7.checkout-attempts.v1'), before);
    const freshStorage = memoryStorage();
    const fresh = new CheckoutAttempts(() => freshStorage);
    await assert.rejects(
      fresh.start(
        sponsorshipIntent(offer),
        async () => {
          throw new ErrorType(code);
        },
        offer
      ),
      ErrorType
    );
    assert.equal(freshStorage.entries.size, 0);
  }
});

test('a proven offer refusal forgets only the unprepared attempt and permits explicit current-offer acceptance', async () => {
  const storage = memoryStorage();
  const attempts = new CheckoutAttempts(() => storage);
  const old = sponsorshipOffer();
  await assert.rejects(
    attempts.start(
      sponsorshipIntent(old),
      async () => {
        throw new CheckoutOfferChangedError();
      },
      old
    ),
    CheckoutOfferChangedError
  );
  assert.equal(storage.entries.size, 0);
  assert.equal(
    (await attempts.retainedSponsorshipOffer(25000, 'CAD')).state,
    'none'
  );
  const current = sponsorshipOffer('sponsorship-v2');
  await attempts.start(
    sponsorshipIntent(current),
    async (request) => {
      assert.deepEqual(request.offerAcceptance, {
        version: current.version,
        fingerprint: current.fingerprint
      });
      return result;
    },
    current
  );
});

test('missing, corrupted, expired or mismatched retained offer blocks payment instead of blindly rotating a pending key', async () => {
  for (const corrupt of [
    (storage) => storage.removeItem('openg7.checkout-offer-recovery.v1'),
    (storage) =>
      storage.setItem('openg7.checkout-offer-recovery.v1', '{invalid'),
    (storage) => {
      const cache = JSON.parse(
        storage.getItem('openg7.checkout-offer-recovery.v1')
      );
      Object.values(cache)[0].expiresAt = Date.now() - 1;
      storage.setItem(
        'openg7.checkout-offer-recovery.v1',
        JSON.stringify(cache)
      );
    },
    (storage) => {
      const cache = JSON.parse(
        storage.getItem('openg7.checkout-offer-recovery.v1')
      );
      Object.values(cache)[0].quote.benefits[0].quantity = 2;
      storage.setItem(
        'openg7.checkout-offer-recovery.v1',
        JSON.stringify(cache)
      );
    },
    (storage) => {
      const cache = JSON.parse(
        storage.getItem('openg7.checkout-offer-recovery.v1')
      );
      Object.values(cache)[0].idempotencyKey =
        '00000000-0000-4000-8000-000000000001';
      storage.setItem(
        'openg7.checkout-offer-recovery.v1',
        JSON.stringify(cache)
      );
    }
  ]) {
    const storage = memoryStorage();
    const offer = sponsorshipOffer();
    const first = new CheckoutAttempts(() => storage);
    await assert.rejects(
      first.start(
        sponsorshipIntent(offer),
        async () => {
          throw new Error('Synthetic uncertain request');
        },
        offer
      )
    );
    const before = storage.getItem('openg7.checkout-attempts.v1');
    corrupt(storage);
    const reloaded = new CheckoutAttempts(() => storage);
    assert.equal(
      (await reloaded.retainedSponsorshipOffer(25000, 'CAD')).state,
      'verification_required'
    );
    assert.equal(reloaded.requiresVerification(), true);
    await assert.rejects(
      reloaded.start(
        sponsorshipIntent(offer),
        async () => {
          assert.fail('An unresolved attempt must not contact Checkout again.');
        },
        offer
      ),
      CheckoutReconciliationRequiredError
    );
    assert.equal(storage.getItem('openg7.checkout-attempts.v1'), before);
  }
});

const uuidPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

test('a changed charter fingerprint requires a fresh Checkout attempt while identical evidence retries safely', async () => {
  const attempts = new CheckoutAttempts();
  const evidence = {
    accepted: true,
    policyVersion: '1.0',
    fingerprint: 'a'.repeat(64),
    locale: 'fr-CA'
  };
  const requests = [];
  const execute = async (request) => {
    requests.push(request);
    throw new TypeError('Synthetic uncertain Checkout');
  };
  const sponsorship = {
    ...intent,
    contributionType: 'sponsorship_interest',
    charterAcceptance: evidence
  };
  await assert.rejects(attempts.start(sponsorship, execute));
  await assert.rejects(
    attempts.start(
      { ...sponsorship, charterAcceptance: { ...evidence } },
      execute
    )
  );
  await assert.rejects(
    attempts.start(
      {
        ...sponsorship,
        charterAcceptance: { ...evidence, fingerprint: 'b'.repeat(64) }
      },
      execute
    )
  );
  assert.equal(requests[0].idempotencyKey, requests[1].idempotencyKey);
  assert.notEqual(requests[0].idempotencyKey, requests[2].idempotencyKey);
  assert.deepEqual(requests[2].charterAcceptance, {
    ...evidence,
    fingerprint: 'b'.repeat(64)
  });
});

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
      getItem: (key) =>
        key === 'openg7.checkout-attempts.v1' ? '{invalid' : null,
      setItem: () => {
        throw new DOMException('Synthetic full storage', 'QuotaExceededError');
      },
      removeItem: () => {}
    }),
    () => ({
      getItem: (key) =>
        key === 'openg7.checkout-attempts.v1'
          ? JSON.stringify({ privateName: 'invalid-key' })
          : null,
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
