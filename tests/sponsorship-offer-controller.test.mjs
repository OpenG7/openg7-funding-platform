import assert from 'node:assert/strict';
import test from 'node:test';

import { SponsorshipOfferController } from '../dist/apps/funding-web/src/app/features/funding/services/sponsorship-offer-controller.js';

const quote = (amountMinor, version = 'sponsorship-v1') => ({
  version,
  fingerprint: 'a'.repeat(64),
  amountMinor,
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
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
};

test('changing formats at the same amount revokes acceptance and ignores the previous format quote', async () => {
  const previous = deferred(),
    calls = [];
  const controller = new SponsorshipOfferController({
    resume: async () => ({ state: 'none' }),
    quote: (amount, currency, signal, formats) => {
      calls.push({ amount, currency, signal, formats });
      return calls.length === 1
        ? previous.promise
        : Promise.resolve(quote(amount, 'portrait-offer'));
    }
  });
  const old = controller.load(25000, 'CAD', false, {
    facebook: 'collective_text'
  });
  await Promise.resolve();
  await controller.load(25000, 'CAD', false, {
    facebook: 'individual_portrait'
  });
  controller.accept(true);
  previous.resolve(quote(25000, 'old-text-offer'));
  await old;
  assert.equal(calls[0].signal.aborted, true);
  assert.deepEqual(calls[1].formats, { facebook: 'individual_portrait' });
  assert.equal(controller.quote().version, 'portrait-offer');
  assert.equal(controller.ready(), true);
});
test('retained explicit formats are restored while old attempts retain the absence of options', async () => {
  const controller = new SponsorshipOfferController({
    resume: async () => ({
      state: 'retained',
      quote: quote(25000),
      formats: { linkedin: 'collective_composite' }
    }),
    quote: () => assert.fail('An uncertain offer is never refreshed.')
  });
  await controller.load(5000, 'CAD');
  assert.deepEqual(controller.formats(), { linkedin: 'collective_composite' });
  assert.equal(controller.accepted(), false);
  const old = new SponsorshipOfferController({
    resume: async () => ({ state: 'retained', quote: quote(25000) }),
    quote: () => assert.fail('No default format can alter an old attempt.')
  });
  await old.load(25000, 'CAD', false, { facebook: 'individual_portrait' });
  assert.equal(old.formats(), undefined);
});

test('amount changes cancel the old quote and never accept a late result for the next amount', async () => {
  const first = deferred();
  let firstSignal;
  const controller = new SponsorshipOfferController({
    resume: async () => ({ state: 'none' }),
    quote: (amountMinor, currency, signal) => {
      assert.equal(currency, 'CAD');
      if (amountMinor === 5000) {
        firstSignal = signal;
        return first.promise;
      }
      return Promise.resolve(quote(amountMinor, 'sponsorship-v2'));
    }
  });
  const loading = controller.load(5000, 'CAD');
  await Promise.resolve();
  assert.equal(controller.state(), 'loading');
  await controller.load(25000, 'CAD');
  assert.equal(firstSignal.aborted, true);
  controller.accept(true);
  first.resolve(quote(5000));
  await loading;
  assert.equal(controller.quote().amountMinor, 25000);
  assert.equal(controller.ready(), true);
  await controller.load(null, 'CAD');
  assert.equal(controller.quote(), null);
  assert.equal(controller.ready(), false);
});

test('a restored submitted offer is shown for human confirmation without consulting a changed tariff', async () => {
  const retained = quote(25000);
  let requests = 0;
  const controller = new SponsorshipOfferController({
    resume: async () => ({ state: 'retained', quote: retained }),
    quote: async () => {
      requests++;
      return quote(25000, 'changed-tariff');
    }
  });
  await controller.load(5000, 'CAD');
  assert.deepEqual(controller.quote(), retained);
  assert.equal(controller.retained(), true);
  assert.equal(controller.ready(), false);
  controller.accept(true);
  assert.equal(controller.ready(), true);
  assert.equal(requests, 0);
});

test('a proven pre-operation refusal loads the current offer and revokes previous acceptance', async () => {
  const controller = new SponsorshipOfferController({
    resume: async () => ({ state: 'retained', quote: quote(25000) }),
    quote: async () => quote(25000, 'current-tariff')
  });
  await controller.load(25000, 'CAD');
  controller.accept(true);
  await controller.load(25000, 'CAD', true);
  assert.equal(controller.quote().version, 'current-tariff');
  assert.equal(controller.ready(), false);
  assert.equal(controller.retained(), false);
});

test('corrupted recovery blocks new quotes, and failed current reads cannot be accepted', async () => {
  let requests = 0;
  let recovery = { state: 'verification_required' };
  const controller = new SponsorshipOfferController({
    resume: async () => recovery,
    quote: async () => {
      requests++;
      throw new Error('Synthetic API unavailable');
    }
  });
  await controller.load(25000, 'CAD');
  assert.equal(controller.state(), 'verification_required');
  assert.equal(requests, 0);
  controller.accept(true);
  assert.equal(controller.ready(), false);
  recovery = { state: 'none' };
  await controller.load(25000, 'CAD');
  assert.equal(controller.state(), 'error');
  assert.equal(controller.quote(), null);
  controller.accept(true);
  assert.equal(controller.ready(), false);
});

test('unavailable recovery blocks quoting until storage is readable again', async () => {
  let recovery = { state: 'unavailable' };
  let requests = 0;
  const controller = new SponsorshipOfferController({
    resume: async () => recovery,
    quote: async (amountMinor) => {
      requests++;
      return quote(amountMinor);
    }
  });
  await controller.load(25000, 'CAD');
  assert.equal(controller.state(), 'recovery_unavailable');
  assert.equal(controller.quote(), null);
  controller.accept(true);
  assert.equal(controller.ready(), false);
  assert.equal(requests, 0);
  recovery = { state: 'none' };
  await controller.load(25000, 'CAD');
  assert.equal(controller.state(), 'ready');
  assert.equal(controller.ready(), false);
  assert.equal(requests, 1);
});

test('a new minimum prevents fresh quoting while an exact historical attempt can still be restored', async () => {
  let recovery = { state: 'none' };
  let requests = 0;
  const controller = new SponsorshipOfferController({
    resume: async () => recovery,
    quote: async (amountMinor) => {
      requests++;
      return quote(amountMinor);
    }
  });
  await controller.load(4500, 'CAD', false, undefined, false);
  assert.equal(controller.state(), 'idle');
  assert.equal(controller.quote(), null);
  assert.equal(controller.ready(), false);
  assert.equal(requests, 0);
  recovery = { state: 'retained', quote: quote(4500) };
  await controller.load(4500, 'CAD', false, undefined, false);
  assert.equal(controller.state(), 'ready');
  assert.equal(controller.quote().amountMinor, 4500);
  assert.equal(controller.retained(), true);
  controller.accept(true);
  assert.equal(controller.ready(), true);
  assert.equal(requests, 0);
  await controller.load(4500, 'CAD', true, undefined, false);
  assert.equal(controller.state(), 'idle');
  assert.equal(controller.quote(), null);
  assert.equal(controller.retained(), false);
  assert.equal(requests, 0);
});

test('dispose and stale errors do not restore or clear another offer context', async () => {
  const first = deferred();
  const controller = new SponsorshipOfferController({
    resume: async () => ({ state: 'none' }),
    quote: (amountMinor) =>
      amountMinor === 5000 ? first.promise : Promise.resolve(quote(amountMinor))
  });
  const old = controller.load(5000, 'CAD');
  await Promise.resolve();
  await controller.load(25000, 'CAD');
  first.reject(new Error('Old request failed'));
  await old;
  assert.equal(controller.state(), 'ready');
  assert.equal(controller.quote().amountMinor, 25000);
  controller.dispose();
  await controller.load(5000, 'CAD');
  assert.equal(controller.quote(), null);
  assert.equal(controller.ready(), false);
});
