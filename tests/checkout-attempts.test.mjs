import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';

import { registerHooks } from 'node:module';
import {
  CHECKOUT_ATTEMPT_LOCK_NAME,
  createCheckoutAttemptCoordinator
} from '../dist/apps/funding-web/src/app/features/funding/services/checkout-attempt-coordination.js';
import {
  CheckoutReconciliationRequiredError,
  CheckoutRecoveryUnavailableError,
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
  const before = storage.getItem('openg7.checkout-attempts.v2');
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
  assert.equal(storage.getItem('openg7.checkout-attempts.v2'), before);
});

test('an offer refusal retains the submitted UUID and terms instead of authorizing a replacement offer', async () => {
  const storage = memoryStorage();
  const attempts = new CheckoutAttempts(() => storage);
  const old = sponsorshipOffer();
  let key;
  await assert.rejects(
    attempts.start(
      sponsorshipIntent(old),
      async (request) => {
        key = request.idempotencyKey;
        throw new CheckoutOfferChangedError();
      },
      old
    ),
    CheckoutOfferChangedError
  );
  assert.equal(storage.entries.size, 2);
  assert.deepEqual(await attempts.retainedSponsorshipOffer(25000, 'CAD'), {
    state: 'retained',
    quote: old
  });
  const saved = storage.getItem('openg7.checkout-attempts.v2');
  assert.equal(Object.values(JSON.parse(saved))[0].idempotencyKey, key);
  const current = sponsorshipOffer('sponsorship-v2');
  await assert.rejects(
    attempts.start(
      sponsorshipIntent(current),
      async () =>
        assert.fail(
          'A prepare refusal cannot replace another in-flight operation.'
        ),
      current
    ),
    CheckoutReconciliationRequiredError
  );
  assert.equal(storage.getItem('openg7.checkout-attempts.v2'), saved);
  assert.equal(attempts.requiresVerification(), true);
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
    const before = storage.getItem('openg7.checkout-attempts.v2');
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
    assert.equal(storage.getItem('openg7.checkout-attempts.v2'), before);
  }
});

const uuidPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

test('an uncertain sponsorship preserves its charter evidence and blocks a changed fingerprint', async () => {
  const memory = memoryStorage();
  const attempts = new CheckoutAttempts(() => memory);
  const offer = sponsorshipOffer();
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
    ...sponsorshipIntent(offer),
    charterAcceptance: evidence
  };
  await assert.rejects(attempts.start(sponsorship, execute, offer));
  await assert.rejects(
    attempts.start(
      { ...sponsorship, charterAcceptance: { ...evidence } },
      execute,
      offer
    )
  );
  await assert.rejects(
    attempts.start(
      {
        ...sponsorship,
        charterAcceptance: { ...evidence, fingerprint: 'b'.repeat(64) }
      },
      async () =>
        assert.fail('Changed charter evidence cannot mint a new key.'),
      offer
    ),
    CheckoutReconciliationRequiredError
  );
  assert.equal(requests.length, 2);
  assert.equal(requests[0].idempotencyKey, requests[1].idempotencyKey);
  assert.deepEqual(requests[1].charterAcceptance, evidence);
  assert.equal(attempts.requiresVerification(), true);
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
  assert.equal(
    Object.values(saved)[0].idempotencyKey,
    requests[0].idempotencyKey
  );
  assert.equal(Object.values(saved)[0].expiresAt > Date.now(), true);
  assert.deepEqual(Object.keys(Object.values(saved)[0]), [
    'idempotencyKey',
    'expiresAt'
  ]);
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

test('restricted storage preserves personal support retries with the same in-memory key', async () => {
  for (const getStorage of [
    () => null,
    () => {
      throw new DOMException('Synthetic denied storage', 'SecurityError');
    }
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
  const pending = JSON.parse(storage.getItem('openg7.checkout-attempts.v2'));
  assert.deepEqual(
    Object.values(pending).map((entry) => entry.idempotencyKey),
    [key]
  );
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

test('new sponsorship cannot contact Checkout without retaining both the attempt and its exact public terms', async () => {
  const offer = sponsorshipOffer();
  for (const getStorage of [
    () => null,
    () => {
      throw new DOMException('Synthetic denied storage', 'SecurityError');
    },
    () => ({ getItem: () => null, setItem: () => {}, removeItem: () => {} }),
    () => {
      const storage = memoryStorage();
      return {
        ...storage,
        setItem: (key, value) => {
          if (key === 'openg7.checkout-offer-recovery.v1')
            throw new DOMException('Synthetic quota', 'QuotaExceededError');
          storage.setItem(key, value);
        }
      };
    }
  ]) {
    const attempts = new CheckoutAttempts(getStorage);
    await assert.rejects(
      attempts.start(
        sponsorshipIntent(offer),
        async () => {
          assert.fail('Durable retention must precede the first API request.');
        },
        offer
      ),
      CheckoutRecoveryUnavailableError
    );
    assert.equal(
      attempts.requiresVerification(),
      false,
      'No API call occurred, so storage failure is not an uncertain payment.'
    );
  }
});

test('unavailable fresh recovery has a distinct state and becomes usable after storage is restored', async () => {
  const storage = memoryStorage();
  let available = false;
  const attempts = new CheckoutAttempts(() => {
    if (!available)
      throw new DOMException('Synthetic denied storage', 'SecurityError');
    return storage;
  });
  assert.equal(
    (await attempts.retainedSponsorshipOffer(25000, 'CAD')).state,
    'unavailable'
  );
  assert.equal(attempts.requiresVerification(), false);
  available = true;
  assert.equal(
    (await attempts.retainedSponsorshipOffer(25000, 'CAD')).state,
    'none'
  );
  assert.equal(
    storage.entries.size,
    0,
    'The availability probe leaves no recovery entry.'
  );
});

test('known sponsorship retries its identical key in memory if storage becomes unavailable', async () => {
  const storage = memoryStorage();
  let available = true;
  const attempts = new CheckoutAttempts(() => {
    if (!available)
      throw new DOMException('Synthetic denied storage', 'SecurityError');
    return storage;
  });
  const offer = sponsorshipOffer();
  let original;
  await assert.rejects(
    attempts.start(
      sponsorshipIntent(offer),
      async (request) => {
        original = request;
        throw new Error('Synthetic uncertain request');
      },
      offer
    )
  );
  available = false;
  const resume = await attempts.retainedSponsorshipOffer(5000, 'CAD');
  assert.deepEqual(resume, { state: 'retained', quote: offer });
  await attempts.start(
    sponsorshipIntent(offer),
    async (request) => {
      assert.deepEqual(request, original);
      return result;
    },
    resume.quote
  );
});

test('recovery expires after a fixed 24 hours without extending retention on retry or creating a new operation', async (t) => {
  let now = Date.UTC(2026, 9, 11, 12);
  t.mock.method(Date, 'now', () => now);
  const storage = memoryStorage();
  const offer = sponsorshipOffer();
  const attempts = new CheckoutAttempts(() => storage);
  let key;
  const fail = async (request) => {
    key ??= request.idempotencyKey;
    assert.equal(request.idempotencyKey, key);
    throw new Error('Synthetic uncertain request');
  };
  await assert.rejects(attempts.start(sponsorshipIntent(offer), fail, offer));
  const originalAttempt = storage.getItem('openg7.checkout-attempts.v2');
  const originalOffer = storage.getItem('openg7.checkout-offer-recovery.v1');
  now += 23 * 60 * 60 * 1000;
  await assert.rejects(
    new CheckoutAttempts(() => storage).start(
      sponsorshipIntent(offer),
      fail,
      offer
    )
  );
  assert.equal(storage.getItem('openg7.checkout-attempts.v2'), originalAttempt);
  assert.equal(
    storage.getItem('openg7.checkout-offer-recovery.v1'),
    originalOffer
  );
  now += 60 * 60 * 1000;
  const expired = new CheckoutAttempts(() => storage);
  assert.equal(
    (await expired.retainedSponsorshipOffer(25000, 'CAD')).state,
    'verification_required'
  );
  assert.equal(storage.getItem('openg7.checkout-attempts.v2'), null);
  assert.equal(storage.getItem('openg7.checkout-offer-recovery.v1'), null);
  assert.equal(
    storage.getItem('openg7.checkout-verification-required.v1'),
    'true'
  );
  await assert.rejects(
    expired.start(
      sponsorshipIntent(offer),
      async () => {
        assert.fail(
          'An expired recovery requires verification, never a replacement UUID.'
        );
      },
      offer
    ),
    CheckoutReconciliationRequiredError
  );
});

test('legacy session attempts remain blocked across migration to local storage', async () => {
  for (const entry of [
    [
      'openg7.checkout-attempts.v1',
      JSON.stringify({
        ['a'.repeat(64)]: '00000000-0000-4000-8000-000000000001'
      })
    ],
    ['openg7.checkout-offer-recovery.v1', '{synthetic legacy recovery'],
    ['openg7.checkout-verification-required.v1', 'true']
  ]) {
    const local = memoryStorage();
    const session = memoryStorage();
    session.setItem(...entry);
    const attempts = new CheckoutAttempts(
      () => local,
      () => session
    );
    assert.equal(
      (await attempts.retainedSponsorshipOffer(25000, 'CAD')).state,
      'verification_required'
    );
    const offer = sponsorshipOffer();
    await assert.rejects(
      attempts.start(
        sponsorshipIntent(offer),
        async () => assert.fail('No blind migration'),
        offer
      ),
      CheckoutReconciliationRequiredError
    );
    assert.equal(session.getItem(entry[0]), entry[1]);
    assert.equal(
      new CheckoutAttempts(() => local).requiresVerification(),
      true
    );
  }
});

test('a previously blocked operation still prunes its expired recovery while keeping the verification block', async (t) => {
  let now = Date.UTC(2026, 9, 11, 12);
  t.mock.method(Date, 'now', () => now);
  const storage = memoryStorage();
  const offer = sponsorshipOffer();
  const attempts = new CheckoutAttempts(() => storage);
  await assert.rejects(
    attempts.start(
      sponsorshipIntent(offer),
      async () => {
        throw new CheckoutReconciliationRequiredError();
      },
      offer
    ),
    CheckoutReconciliationRequiredError
  );
  assert.notEqual(storage.getItem('openg7.checkout-offer-recovery.v1'), null);
  now += 24 * 60 * 60 * 1000;
  const expired = new CheckoutAttempts(() => storage);
  assert.equal(expired.requiresVerification(), true);
  assert.equal(
    (await expired.retainedSponsorshipOffer(25000, 'CAD')).state,
    'verification_required'
  );
  assert.equal(storage.getItem('openg7.checkout-attempts.v2'), null);
  assert.equal(storage.getItem('openg7.checkout-offer-recovery.v1'), null);
  assert.equal(
    storage.getItem('openg7.checkout-verification-required.v1'),
    'true'
  );
});

test('denied legacy storage cannot hide a local verification block or forget it when local access later fails', async () => {
  const storage = memoryStorage();
  storage.setItem('openg7.checkout-verification-required.v1', 'true');
  let readable = true;
  const attempts = new CheckoutAttempts(
    () => {
      if (!readable)
        throw new DOMException(
          'Synthetic denied local storage',
          'SecurityError'
        );
      return storage;
    },
    () => {
      throw new DOMException(
        'Synthetic denied legacy storage',
        'SecurityError'
      );
    }
  );
  assert.equal(attempts.requiresVerification(), true);
  readable = false;
  assert.equal(attempts.requiresVerification(), true);
  await assert.rejects(
    attempts.start(intent, async () =>
      assert.fail('A known block survives storage restrictions.')
    ),
    CheckoutReconciliationRequiredError
  );
});

test('corrupted durable attempts require verification before even a personal request', async () => {
  for (const invalid of [
    '{invalid',
    '[]',
    JSON.stringify({ privateName: 'invalid-key' })
  ]) {
    const storage = memoryStorage();
    storage.setItem('openg7.checkout-attempts.v2', invalid);
    const attempts = new CheckoutAttempts(() => storage);
    await assert.rejects(
      attempts.start(intent, async () =>
        assert.fail('Invalid prior recovery is not absence of an operation.')
      ),
      CheckoutReconciliationRequiredError
    );
    assert.equal(storage.getItem('openg7.checkout-attempts.v2'), invalid);
  }
});

test('charter or offer INVALID on a retained operation keeps the UUID and requires verification', async () => {
  for (const error of [
    new CheckoutOfferChangedError('SPONSORSHIP_OFFER_INVALID'),
    new CheckoutCharterChangedError('CHARTER_ACCEPTANCE_INVALID')
  ]) {
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
    const retained = storage.getItem('openg7.checkout-attempts.v2');
    await assert.rejects(
      attempts.start(
        sponsorshipIntent(offer),
        async () => {
          throw error;
        },
        offer
      ),
      CheckoutReconciliationRequiredError
    );
    assert.equal(storage.getItem('openg7.checkout-attempts.v2'), retained);
    assert.equal(attempts.requiresVerification(), true);
  }
});

test('sponsorship acceptance without its displayed terms cannot start an unrecoverable request', async () => {
  const storage = memoryStorage();
  const offer = sponsorshipOffer();
  await assert.rejects(
    new CheckoutAttempts(() => storage).start(
      sponsorshipIntent(offer),
      async () => assert.fail('Missing terms cannot create an attempt.')
    ),
    CheckoutOfferChangedError
  );
  assert.equal(storage.entries.size, 0);
});

test('two instances completing their intent digests together preserve one uncertain UUID through reload', async (t) => {
  const storage = memoryStorage();
  const offer = sponsorshipOffer();
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  const releases = [];
  let digests = 0;
  t.mock.method(crypto.subtle, 'digest', async (...args) => {
    const value = await digest(...args);
    if (++digests > 2) return value;
    return new Promise((resolve) => {
      releases.push(() => resolve(value));
      if (releases.length === 2)
        queueMicrotask(() => releases.forEach((release) => release()));
    });
  });
  const requests = [];
  const lostResponse = new TypeError('Synthetic response lost');
  const dispatch = async (request) => {
    requests.push(request);
    throw lostResponse;
  };
  const concurrent = [
    new CheckoutAttempts(() => storage),
    new CheckoutAttempts(() => storage)
  ].map((instance) =>
    assert.rejects(
      instance.start(sponsorshipIntent(offer), dispatch, offer),
      (error) => error === lostResponse
    )
  );
  await Promise.all(concurrent);
  assert.equal(requests.length, 2);
  assert.equal(
    new Set(requests.map((request) => request.idempotencyKey)).size,
    1
  );
  assert.equal(
    Object.keys(JSON.parse(storage.getItem('openg7.checkout-attempts.v2')))
      .length,
    1
  );
  assert.equal(
    Object.keys(
      JSON.parse(storage.getItem('openg7.checkout-offer-recovery.v1'))
    ).length,
    1
  );
  const saved = [...storage.entries];
  const reload = new CheckoutAttempts(() => storage);
  assert.deepEqual(await reload.retainedSponsorshipOffer(25000, 'CAD'), {
    state: 'retained',
    quote: offer
  });
  await assert.rejects(
    reload.start(sponsorshipIntent(offer), dispatch, offer),
    (error) => error === lostResponse
  );
  assert.equal(
    new Set(requests.map((request) => request.idempotencyKey)).size,
    1
  );
  assert.deepEqual([...storage.entries], saved);
});

test(
  'an API wait holds no coordination lock and a late cleanup cannot erase a newer owner',
  { timeout: 5000 },
  async () => {
    const storage = memoryStorage();
    const offer = sponsorshipOffer();
    let entered;
    let release;
    let oldKey;
    const started = new Promise((resolve) => {
      entered = resolve;
    });
    const old = new CheckoutAttempts(() => storage).start(
      sponsorshipIntent(offer),
      (request) => {
        oldKey = request.idempotencyKey;
        entered();
        return new Promise((resolve) => {
          release = () => resolve(result);
        });
      },
      offer
    );
    await started;
    try {
      await new CheckoutAttempts(() => storage).start(
        sponsorshipIntent(offer),
        async (request) => {
          assert.equal(request.idempotencyKey, oldKey);
          return result;
        },
        offer
      );
      let newKey;
      await assert.rejects(
        new CheckoutAttempts(() => storage).start(
          sponsorshipIntent(offer),
          async (request) => {
            newKey = request.idempotencyKey;
            throw new Error(
              'Synthetic new uncertain operation after known completion'
            );
          },
          offer
        )
      );
      assert.notEqual(newKey, oldKey);
      const saved = [...storage.entries];
      release();
      await old;
      assert.deepEqual([...storage.entries], saved);
      const reload = new CheckoutAttempts(() => storage);
      assert.equal(
        (await reload.retainedSponsorshipOffer(25000, 'CAD')).state,
        'retained'
      );
      await reload.start(
        sponsorshipIntent(offer),
        async (request) => {
          assert.equal(request.idempotencyKey, newKey);
          return result;
        },
        offer
      );
      assert.equal(storage.entries.size, 0);
    } finally {
      release();
    }
  }
);

test('cleanup verifies the offer owner as well as the matching attempt owner', async () => {
  const storage = memoryStorage();
  const offer = sponsorshipOffer();
  const attempts = new CheckoutAttempts(() => storage);
  const foreignKey = '00000000-0000-4000-8000-000000000099';
  await attempts.start(
    sponsorshipIntent(offer),
    async () => {
      const entries = JSON.parse(
        storage.getItem('openg7.checkout-offer-recovery.v1')
      );
      Object.values(entries)[0].idempotencyKey = foreignKey;
      storage.setItem(
        'openg7.checkout-offer-recovery.v1',
        JSON.stringify(entries)
      );
      return result;
    },
    offer
  );
  assert.equal(
    Object.keys(JSON.parse(storage.getItem('openg7.checkout-attempts.v2')))
      .length,
    1
  );
  assert.equal(
    Object.values(
      JSON.parse(storage.getItem('openg7.checkout-offer-recovery.v1'))
    )[0].idempotencyKey,
    foreignKey
  );
  const reload = new CheckoutAttempts(() => storage);
  assert.equal(
    (await reload.retainedSponsorshipOffer(25000, 'CAD')).state,
    'verification_required'
  );
  await assert.rejects(
    reload.start(
      sponsorshipIntent(offer),
      async () => assert.fail('Ambiguous owners cannot replace an operation.'),
      offer
    ),
    CheckoutReconciliationRequiredError
  );
});

test('without shared coordination new persisted operations are unavailable while exact retries stay read-only', async () => {
  const storage = memoryStorage();
  const offer = sponsorshipOffer();
  const readOnly = { run: async (operation) => operation(false) };
  const unsupported = new CheckoutAttempts(() => storage, undefined, readOnly);
  for (const [submission, quote] of [
    [sponsorshipIntent(offer), offer],
    [intent, undefined]
  ]) {
    await assert.rejects(
      unsupported.start(
        submission,
        async () => assert.fail('No uncoordinated shared write.'),
        quote
      ),
      CheckoutRecoveryUnavailableError
    );
  }
  assert.equal(storage.entries.size, 0);
  const initial = new CheckoutAttempts(() => storage);
  let knownKey;
  await assert.rejects(
    initial.start(
      sponsorshipIntent(offer),
      async (request) => {
        knownKey = request.idempotencyKey;
        throw new Error('Synthetic uncertain operation');
      },
      offer
    )
  );
  const saved = [...storage.entries];
  const retry = new CheckoutAttempts(() => storage, undefined, readOnly);
  assert.equal(
    (await retry.retainedSponsorshipOffer(25000, 'CAD')).state,
    'retained'
  );
  await retry.start(
    sponsorshipIntent(offer),
    async (request) => {
      assert.equal(request.idempotencyKey, knownKey);
      return result;
    },
    offer
  );
  assert.deepEqual([...storage.entries], saved);
  await new CheckoutAttempts(() => null, undefined, readOnly).start(
    intent,
    async () => result
  );
});

test('expired recovery blocks synchronously and is purged only when coordination becomes writable', async (t) => {
  let now = Date.UTC(2026, 9, 11, 12);
  t.mock.method(Date, 'now', () => now);
  const storage = memoryStorage();
  const offer = sponsorshipOffer();
  await assert.rejects(
    new CheckoutAttempts(() => storage).start(
      sponsorshipIntent(offer),
      async () => {
        throw new Error('Synthetic uncertainty');
      },
      offer
    )
  );
  let writable = false;
  const coordinator = { run: async (operation) => operation(writable) };
  const expired = new CheckoutAttempts(() => storage, undefined, coordinator);
  now += 24 * 60 * 60 * 1000;
  assert.equal(expired.requiresVerification(), true);
  assert.equal(
    (await expired.retainedSponsorshipOffer(25000, 'CAD')).state,
    'verification_required'
  );
  assert.notEqual(storage.getItem('openg7.checkout-attempts.v2'), null);
  assert.notEqual(storage.getItem('openg7.checkout-offer-recovery.v1'), null);
  writable = true;
  assert.equal(
    (await expired.retainedSponsorshipOffer(25000, 'CAD')).state,
    'verification_required'
  );
  assert.equal(storage.getItem('openg7.checkout-attempts.v2'), null);
  assert.equal(storage.getItem('openg7.checkout-offer-recovery.v1'), null);
  assert.equal(
    storage.getItem('openg7.checkout-verification-required.v1'),
    'true'
  );
});

test('browser coordination requires a secure Web Lock and never retries a failed callback', async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else delete globalThis.window;
  });
  const requests = [];
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      isSecureContext: true,
      navigator: {
        locks: {
          request: async (name, options, callback) => {
            requests.push([name, options]);
            return callback();
          }
        }
      }
    }
  });
  const coordinator = createCheckoutAttemptCoordinator();
  assert.equal(await coordinator.run((writable) => writable), true);
  assert.deepEqual(requests, [
    [CHECKOUT_ATTEMPT_LOCK_NAME, { mode: 'exclusive' }]
  ]);
  let invocations = 0;
  const failure = new Error('Synthetic callback error');
  await assert.rejects(
    coordinator.run(() => {
      invocations++;
      throw failure;
    }),
    (error) => error === failure
  );
  assert.equal(invocations, 1);
  window.isSecureContext = false;
  assert.equal(await coordinator.run((writable) => writable), false);
  window.isSecureContext = true;
  window.navigator.locks.request = async () => {
    throw new DOMException('Synthetic denied locks', 'SecurityError');
  };
  assert.equal(await coordinator.run((writable) => writable), false);
});

test('a parallel prepare refusal does not erase an in-flight request sharing the same UUID', async (t) => {
  for (const refusal of [
    new CheckoutOfferChangedError(),
    new CheckoutCharterChangedError('CHARTER_NOT_ACTIVE')
  ]) {
    await t.test(refusal.code, async () => {
      const storage = memoryStorage();
      const offer = sponsorshipOffer();
      const submission = sponsorshipIntent(offer);
      let entered;
      let reject;
      let key;
      const started = new Promise((resolve) => {
        entered = resolve;
      });
      const lost = new TypeError('Synthetic delayed response lost');
      const inFlight = new CheckoutAttempts(() => storage).start(
        submission,
        (request) => {
          key = request.idempotencyKey;
          entered();
          return new Promise((_, rejectRequest) => {
            reject = rejectRequest;
          });
        },
        offer
      );
      const uncertain = assert.rejects(inFlight, (error) => error === lost);
      await started;
      const saved = [...storage.entries];
      const other = new CheckoutAttempts(() => storage);
      try {
        await assert.rejects(
          other.start(
            submission,
            async (request) => {
              assert.equal(request.idempotencyKey, key);
              throw refusal;
            },
            offer
          ),
          (error) => error === refusal
        );
        assert.equal(other.requiresVerification(), false);
        assert.deepEqual([...storage.entries], saved);
      } finally {
        reject(lost);
      }
      await uncertain;
      const cold = new CheckoutAttempts(() => storage);
      assert.deepEqual(await cold.retainedSponsorshipOffer(25000, 'CAD'), {
        state: 'retained',
        quote: offer
      });
      await assert.rejects(
        cold.start(
          submission,
          async (request) => {
            assert.equal(request.idempotencyKey, key);
            throw lost;
          },
          offer
        ),
        (error) => error === lost
      );
      assert.deepEqual([...storage.entries], saved);
    });
  }
});

test('expiration during checksum verification blocks and purges under the same lock', async (t) => {
  for (const operation of ['resume', 'retry']) {
    await t.test(operation, async (t) => {
      let now = Date.UTC(2026, 9, 11, 12);
      t.mock.method(Date, 'now', () => now);
      const storage = memoryStorage();
      const offer = sponsorshipOffer();
      await assert.rejects(
        new CheckoutAttempts(() => storage).start(
          sponsorshipIntent(offer),
          async () => {
            throw new Error('Synthetic uncertain operation');
          },
          offer
        )
      );
      const storedExpiry = Object.values(
        JSON.parse(storage.getItem('openg7.checkout-attempts.v2'))
      )[0].expiresAt;
      const digest = crypto.subtle.digest.bind(crypto.subtle);
      let checksums = 0;
      t.mock.method(crypto.subtle, 'digest', async (...args) => {
        const value = await digest(...args);
        if (++checksums === (operation === 'resume' ? 1 : 2))
          now = storedExpiry;
        return value;
      });
      const boundary = new CheckoutAttempts(() => storage);
      if (operation === 'resume') {
        assert.equal(
          (await boundary.retainedSponsorshipOffer(25000, 'CAD')).state,
          'verification_required'
        );
      } else {
        await assert.rejects(
          boundary.start(
            sponsorshipIntent(offer),
            async () => assert.fail('No API after expiration.'),
            offer
          ),
          CheckoutReconciliationRequiredError
        );
      }
      assert.equal(now, storedExpiry);
      assert.equal(boundary.requiresVerification(), true);
      assert.equal(storage.getItem('openg7.checkout-attempts.v2'), null);
      assert.equal(storage.getItem('openg7.checkout-offer-recovery.v1'), null);
      assert.equal(
        storage.getItem('openg7.checkout-verification-required.v1'),
        'true'
      );
    });
  }
});

test('an expired orphaned offer is purged only after a durable verification marker', async (t) => {
  for (const denyMarker of [false, true]) {
    await t.test(
      denyMarker ? 'marker write denied' : 'marker writable',
      async (t) => {
        let now = Date.UTC(2026, 9, 12, 12);
        t.mock.method(Date, 'now', () => now);
        const storage = memoryStorage();
        const offer = sponsorshipOffer();
        const originalRemove = storage.removeItem;
        const originalSet = storage.setItem;
        let denyOfferRemoval = true;
        let markerDenied = false;
        const offerKey = 'openg7.checkout-offer-recovery.v1';
        const markerKey = 'openg7.checkout-verification-required.v1';
        storage.removeItem = (key) => {
          if (key === offerKey) {
            if (denyOfferRemoval)
              throw new DOMException(
                'Synthetic denied cleanup',
                'SecurityError'
              );
            assert.equal(storage.getItem(markerKey), 'true');
          }
          return originalRemove(key);
        };
        storage.setItem = (key, value) => {
          if (key === markerKey && markerDenied)
            throw new DOMException('Synthetic denied marker', 'SecurityError');
          return originalSet(key, value);
        };
        assert.deepEqual(
          await new CheckoutAttempts(() => storage).start(
            sponsorshipIntent(offer),
            async () => result,
            offer
          ),
          result
        );
        assert.equal(storage.getItem('openg7.checkout-attempts.v2'), null);
        const orphaned = storage.getItem(offerKey);
        assert.notEqual(orphaned, null);
        const expiry = Object.values(JSON.parse(orphaned))[0].expiresAt;
        now = expiry + 1;
        denyOfferRemoval = false;
        markerDenied = denyMarker;
        const cold = new CheckoutAttempts(() => storage);
        assert.equal(cold.requiresVerification(), true);
        assert.equal(
          (await cold.retainedSponsorshipOffer(25000, 'CAD')).state,
          'verification_required'
        );
        if (denyMarker) {
          assert.equal(storage.getItem(offerKey), orphaned);
          assert.equal(storage.getItem(markerKey), null);
          markerDenied = false;
          assert.equal(
            (await cold.retainedSponsorshipOffer(25000, 'CAD')).state,
            'verification_required'
          );
        }
        assert.equal(storage.getItem(offerKey), null);
        assert.equal(storage.getItem('openg7.checkout-attempts.v2'), null);
        assert.equal(storage.getItem(markerKey), 'true');
        assert.equal(
          new CheckoutAttempts(() => storage).requiresVerification(),
          true
        );
        await assert.rejects(
          cold.start(
            sponsorshipIntent(offer),
            async () => assert.fail('Expiry cannot authorize a new Checkout.'),
            offer
          ),
          CheckoutReconciliationRequiredError
        );
      }
    );
  }
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
