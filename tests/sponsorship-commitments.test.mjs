import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import test from 'node:test';

import {
  createSponsorshipOfferSnapshot,
  normalizeSponsorshipOfferSnapshot,
  normalizeSponsorshipOfferFormats,
  publicationFormatCapability,
  publicSponsorshipObligations
} from '../dist/packages/funding-core/src/index.js';
import {
  quoteSponsorshipOffer,
  sponsorshipOfferFingerprint,
  validateSponsorshipOfferAcceptance
} from '../dist/apps/funding-api/src/sponsorship-commitments/offers.js';
import { loadSponsorshipCommitment } from '../dist/apps/funding-api/src/sponsorship-commitments/repository.js';
import { createSponsorshipCommitmentsHttpHandler } from '../dist/apps/funding-api/src/sponsorship-commitments/admin-http.js';
import { createPublicPaymentsHttpHandler } from '../dist/apps/funding-api/src/public-payments.http.js';
import { previewSponsorshipCommitmentAdoption } from '../dist/apps/funding-api/src/sponsorship-commitments/adoption.js';
import { adjustSponsorshipObligation } from '../dist/apps/funding-api/src/sponsorship-commitments/changes.js';
import { createSponsorshipFollowupHttpHandler } from '../dist/apps/funding-api/src/sponsorship-followup.http.js';

test('offered benefits use safe integer minor units, an explicit CAD currency and exact boundaries', () => {
  for (const [amount, ids] of [
    [5000, ['website_mention']],
    [24999, ['website_mention']],
    [25000, ['website_mention', 'facebook_batch']],
    [50000, ['website_mention', 'facebook_batch', 'linkedin_batch']]
  ]) {
    const offer = createSponsorshipOfferSnapshot(amount, 'CAD');
    assert.equal(offer.amountMinor, amount);
    assert.deepEqual(
      offer.benefits.map((b) => b.id),
      ids
    );
    assert.ok(
      offer.benefits.every(
        (b) =>
          b.quantity === 1 &&
          b.target === 'openg7' &&
          b.deadlineDays === null &&
          b.durationDays === null
      )
    );
    assert.ok(
      offer.benefits.every((b) =>
        b.requiredElements.includes('approved_presentation')
      )
    );
  }
  for (const amount of [
    4999,
    5000.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1
  ])
    assert.throws(() => createSponsorshipOfferSnapshot(amount, 'CAD'));
  for (const currency of ['USD', 'cad', ''])
    assert.throws(() => createSponsorshipOfferSnapshot(50000, currency));
});

test('a previously quoted snapshot retains terms when the current pricing changes', () => {
  const original = quoteSponsorshipOffer(50000, 'CAD');
  const altered = quoteSponsorshipOffer(50000, 'CAD', {
    minimumAmount: 50,
    presetAmounts: [50],
    benefits: {
      websiteMention: { minimumAmount: 50 },
      facebookBatch: { minimumAmount: 750 },
      linkedinBatch: { minimumAmount: 1000 }
    }
  });
  assert.notEqual(original.fingerprint, altered.fingerprint);
  assert.equal(original.benefits.length, 3);
  assert.equal(altered.benefits.length, 1);
  assert.equal(sponsorshipOfferFingerprint(original), original.fingerprint);
  const unordered = {
    currency: original.currency,
    benefits: original.benefits,
    amountMinor: original.amountMinor,
    version: original.version
  };
  assert.equal(sponsorshipOfferFingerprint(unordered), original.fingerprint);
});

test('old offer canonical JSON and fingerprint stay unchanged while new image formats are explicit', () => {
  const canonical =
    '{"version":"sponsorship-v1","amountMinor":25000,"currency":"CAD","benefits":[{"id":"facebook_batch","channel":"facebook","target":"openg7","quantity":1,"requiredElements":["company_name","approved_presentation"],"deadlineDays":null,"durationDays":null}]}';
  const old = JSON.parse(canonical);
  assert.equal(
    JSON.stringify(normalizeSponsorshipOfferSnapshot(old)),
    canonical
  );
  assert.equal(
    sponsorshipOfferFingerprint(old),
    createHash('sha256').update(canonical).digest('hex')
  );
  assert.equal(
    Object.hasOwn(normalizeSponsorshipOfferSnapshot(old).benefits[0], 'format'),
    false
  );
  const text = quoteSponsorshipOffer(50000, 'CAD');
  const portrait = quoteSponsorshipOffer(50000, 'CAD', undefined, {
    facebook: 'individual_portrait'
  });
  const composite = quoteSponsorshipOffer(50000, 'CAD', undefined, {
    facebook: 'collective_composite'
  });
  assert.equal(text.version, 'sponsorship-v2');
  assert.equal(Object.hasOwn(text.benefits[0], 'format'), false);
  assert.equal(text.benefits[1].format, 'collective_text');
  assert.equal(portrait.benefits[1].format, 'individual_portrait');
  assert.equal(portrait.benefits[2].format, 'collective_text');
  assert.equal(
    new Set([text.fingerprint, portrait.fingerprint, composite.fingerprint])
      .size,
    3
  );
  for (const [channel, format] of [
    ['facebook', 'image_collection'],
    ['website', 'individual_portrait'],
    ['unknown', 'collective_text']
  ])
    assert.equal(publicationFormatCapability(channel, format).available, false);
  assert.equal(
    publicationFormatCapability('linkedin', 'image_collection').available,
    true
  );
  const album = quoteSponsorshipOffer(50000, 'CAD', undefined, {
    linkedin: 'image_collection'
  });
  assert.equal(
    album.benefits.find((benefit) => benefit.channel === 'linkedin').format,
    'image_collection'
  );
  assert.notEqual(album.fingerprint, text.fingerprint);
  assert.equal(
    publicationFormatCapability('facebook', 'individual_portrait')
      .requiresSingleSponsor,
    true
  );
  assert.throws(
    () =>
      quoteSponsorshipOffer(50000, 'CAD', undefined, {
        facebook: 'image_collection'
      }),
    { code: 'FORMAT_UNAVAILABLE' }
  );
  assert.throws(
    () =>
      quoteSponsorshipOffer(5000, 'CAD', undefined, {
        facebook: 'individual_portrait'
      }),
    { code: 'SPONSORSHIP_OFFER_INVALID' }
  );
  for (const bad of [
    null,
    [],
    { twitter: 'collective_text' },
    { facebook: ['collective_text'] },
    { facebook: 'photo' }
  ])
    assert.throws(() => normalizeSponsorshipOfferFormats(bad));
  assert.equal(normalizeSponsorshipOfferFormats(undefined), undefined);
  assert.equal(normalizeSponsorshipOfferFormats({}), undefined);
  assert.deepEqual(
    normalizeSponsorshipOfferFormats({
      linkedin: 'collective_composite',
      facebook: 'individual_portrait'
    }),
    { facebook: 'individual_portrait', linkedin: 'collective_composite' }
  );
});

test('offer acceptance is a strict reference and historical terms reject foreign channels or unsafe quantities', () => {
  const quote = quoteSponsorshipOffer(50000, 'CAD');
  assert.deepEqual(
    validateSponsorshipOfferAcceptance({
      version: quote.version,
      fingerprint: quote.fingerprint
    }),
    { version: quote.version, fingerprint: quote.fingerprint }
  );
  for (const bad of [
    null,
    [],
    { version: quote.version, fingerprint: ['a'.repeat(64)] },
    { version: quote.version, fingerprint: quote.fingerprint, benefits: [] }
  ])
    assert.throws(() => validateSponsorshipOfferAcceptance(bad), {
      code: 'SPONSORSHIP_OFFER_INVALID'
    });
  for (const change of [
    { channel: 'twitter' },
    { quantity: 1.5 },
    { target: ['openg7'] },
    { deadlineDays: 0 }
  ])
    assert.throws(() =>
      normalizeSponsorshipOfferSnapshot({
        ...quote,
        benefits: [{ ...quote.benefits[0], ...change }]
      })
    );
});

test('malformed format adjustments reject before reading or writing a dossier', async () => {
  let reads = 0;
  const db = {
    query: async () => {
      reads++;
      throw new Error('No database access expected');
    }
  };
  const id = '00000000-0000-4000-8000-000000000045';
  const command = {
    requestId: id,
    obligationId: id,
    expectedVersion: 1,
    confirmation: id,
    reason: 'Synthetic format agreement',
    kind: 'format',
    format: 'individual_portrait'
  };
  for (const change of [
    { format: ['individual_portrait'] },
    { format: 'photo' },
    { format: undefined },
    { target: 'openg20' },
    { kind: 'waiver', format: 'collective_text' }
  ])
    await assert.rejects(
      adjustSponsorshipObligation(
        db,
        { ...command, ...change },
        'admin:00000000-0000-4000-8000-000000000041'
      ),
      { code: 'COMMITMENT_INVALID', status: 400 }
    );
  assert.equal(reads, 0);
});

test('private follow-up exposes current obligations separately from accepted terms and excludes internal reasons', async () => {
  const offer = quoteSponsorshipOffer(50000, 'CAD');
  const obligations = [
    {
      id: 'synthetic-obligation',
      contributionId: 'private-owner',
      commitmentId: 'private-commitment',
      benefitId: 'facebook_batch',
      channel: 'facebook',
      target: 'openg20',
      ordinal: 1,
      state: 'blocked',
      format: 'individual_portrait',
      version: 3,
      fulfilmentEvidenceId: null,
      blockedReason: 'payment_refunded',
      internalReason: 'Synthetic private note'
    },
    {
      id: 'synthetic-other',
      channel: 'linkedin',
      target: 'openg7',
      ordinal: 1,
      state: 'blocked',
      format: null,
      version: 1,
      fulfilmentEvidenceId: null,
      blockedReason: 'Synthetic sensitive explanation'
    }
  ];
  const projected = publicSponsorshipObligations(obligations);
  assert.equal(projected[0].format, 'individual_portrait');
  assert.equal(projected[0].blockedReason, 'payment_refunded');
  assert.equal(projected[1].blockedReason, null);
  assert.doesNotMatch(
    JSON.stringify(projected),
    /private-owner|private-commitment|Synthetic|benefitId|internalReason/
  );
  let lookups = 0;
  const token = 'synthetic-private-followup';
  const handler = createSponsorshipFollowupHttpHandler({
    publicBaseOrigin: 'https://example.invalid',
    hasDatabase: true,
    isValidFollowupToken: (value) => value === token,
    writeJson: (_request, response, status, payload) =>
      Object.assign(response, { status, payload }),
    getFreshSponsorshipFollowupByToken: async (value) => {
      assert.equal(value, token);
      lookups++;
      return {
        found: true,
        paymentStatus: 'refunded',
        commitment: {
          provenance: 'accepted_offer',
          state: 'active',
          offer,
          obligations,
          qualificationReason: 'Synthetic private agreement'
        },
        fulfilmentEvidence: []
      };
    },
    reportFailure: () => assert.fail('No failure expected')
  });
  const response = {};
  await handler(
    { method: 'GET', url: `/api/sponsorship-followup?token=${token}` },
    response
  );
  assert.equal(response.status, 200);
  assert.equal(lookups, 1);
  assert.deepEqual(response.payload.commitment.offer, offer);
  assert.deepEqual(response.payload.commitment.obligations, projected);
  assert.equal(response.payload.commitment.offer.benefits[1].target, 'openg7');
  assert.doesNotMatch(
    JSON.stringify(response.payload.commitment),
    /private-owner|private-commitment|Synthetic|qualificationReason|internalReason/
  );
  const invalid = {};
  await handler(
    { method: 'GET', url: '/api/sponsorship-followup?token=foreign' },
    invalid
  );
  assert.equal(invalid.status, 400);
  assert.equal(lookups, 1);
});

test('public quote exposes no private data and rejects non-CAD or fractional minor units', async () => {
  const handler = createPublicPaymentsHttpHandler({
    publicBaseOrigin: 'https://funding.example.test',
    businessSponsorshipEnabled: true,
    writeJson: (_r, response, status, payload) =>
      Object.assign(response, { status, payload })
  });
  for (const [query, status] of [
    ['amountMinor=25000&currency=CAD', 200],
    ['amountMinor=25000&currency=USD', 400],
    ['amountMinor=25000.5&currency=CAD', 400],
    ['amountMinor=25000&amountMinor=50000&currency=CAD', 400],
    ['amountMinor=25000&currency=CAD&facebookFormat=individual_portrait', 200],
    ['amountMinor=25000&currency=CAD&facebookFormat=image_collection', 400],
    ['amountMinor=50000&currency=CAD&linkedinFormat=image_collection', 200],
    ['amountMinor=25000&currency=CAD&facebookFormat=photo', 400],
    [
      'amountMinor=25000&currency=CAD&facebookFormat=collective_text&facebookFormat=individual_portrait',
      400
    ]
  ]) {
    const response = {};
    assert.equal(
      await handler(
        { method: 'GET', url: `/api/sponsorship-offer?${query}` },
        response
      ),
      true
    );
    assert.equal(response.status, status);
    if (status === 200)
      assert.deepEqual(Object.keys(response.payload).sort(), [
        'amountMinor',
        'benefits',
        'currency',
        'fingerprint',
        'version'
      ]);
  }
});

test('current blocking conditions do not erase qualified fulfilment or explicit adjustment history', async () => {
  const offer = createSponsorshipOfferSnapshot(50000, 'CAD');
  const db = {
    query: async (sql) =>
      sql.includes('FROM sponsorship_commitments m JOIN fund_contributions')
        ? {
            rows: [
              {
                id: 'commitment',
                contributionId: 'source',
                offerId: 'offer',
                provenance: 'accepted_offer',
                state: 'active',
                version: 1,
                offer,
                qualificationReason: null,
                blockedReason: 'payment_refunded'
              }
            ]
          }
        : {
            rows: ['pending', 'fulfilled', 'adjusted'].map((state, i) => ({
              id: `obligation-${i}`,
              commitmentId: 'commitment',
              contributionId: 'source',
              benefitId: offer.benefits[i].id,
              channel: offer.benefits[i].channel,
              target: 'openg7',
              ordinal: 1,
              state,
              blockedReason: null,
              version: 1,
              fulfilmentEvidenceId: state === 'fulfilled' ? 'proof' : null,
              requirementsMet: true
            }))
          }
  };
  const record = await loadSponsorshipCommitment(db, 'source');
  assert.deepEqual(
    record.obligations.map((o) => o.state),
    ['blocked', 'fulfilled', 'adjusted']
  );
  assert.equal(record.obligations[0].blockedReason, 'payment_refunded');
  assert.equal(record.obligations[1].fulfilmentEvidenceId, 'proof');
});

test('qualification and adjustment require server owner rights before body or database access', async () => {
  const handler = createSponsorshipCommitmentsHttpHandler({
    publicBaseOrigin: 'https://funding.example.test',
    pool: { connect: () => assert.fail('no database access') },
    readBody: () => assert.fail('no body access'),
    ensureAdminAccess: () => true,
    canOwn: () => false,
    getAdminAuditActor: () => assert.fail('no actor access'),
    writeJson: (_r, response, status, payload) =>
      Object.assign(response, { status, payload })
  });
  for (const operation of ['qualify', 'adjust']) {
    const request = Readable.from([]);
    Object.assign(request, {
      method: 'POST',
      url: `/api/admin/sponsorship-commitments/${operation}`,
      headers: { 'content-type': 'application/json' }
    });
    const response = { setHeader() {} };
    await handler(request, response);
    assert.equal(response.status, 403);
    assert.equal(response.payload.code, 'COMMITMENT_OWNER_REQUIRED');
  }
});

test('adoption inventory is bounded, classifies unknown declarations conservatively and performs no mutation', async () => {
  const ids = Array.from(
    { length: 26 },
    (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`
  );
  const calls = [];
  const db = {
    query: async (sql, values) => {
      calls.push({ sql, values });
      return {
        rows: ids.map((contributionId, i) => ({
          contributionId,
          reference: 'Synthetic',
          paymentStatus: 'paid',
          amountMinor: 50000,
          currency: 'CAD',
          commitmentId: null,
          provenance:
            i === 0
              ? 'accepted_offer'
              : i === 1
                ? 'qualified_historical'
                : null,
          offerVersion: i < 2 ? 'synthetic-version' : null,
          obligationCount: i < 2 ? 3 : 0,
          fulfilledWithEvidenceCount: 0,
          historicalDeclarationCount: i === 2 ? 2 : 0
        }))
      };
    }
  };
  const result = await previewSponsorshipCommitmentAdoption(db);
  assert.equal(result.items.length, 25);
  assert.equal(result.nextCursor, ids[24]);
  assert.deepEqual(
    result.items.slice(0, 4).map((r) => r.classification),
    [
      'accepted_snapshot',
      'qualified_historical',
      'legacy_declarations',
      'unqualified'
    ]
  );
  assert.deepEqual(calls[0].values, [null, 26]);
  assert.doesNotMatch(calls[0].sql, /INSERT|UPDATE|DELETE/);
  for (const pageSize of [1, 26, 101, NaN])
    await assert.rejects(
      previewSponsorshipCommitmentAdoption(db, { pageSize }),
      { code: 'COMMITMENT_INVALID' }
    );
  await assert.rejects(
    previewSponsorshipCommitmentAdoption(db, { cursor: 'foreign-not-an-id' }),
    { code: 'COMMITMENT_INVALID' }
  );
  assert.equal(calls.length, 1);
});

test('owner adoption preview refuses an operator or reader before any database access', async () => {
  const handler = createSponsorshipCommitmentsHttpHandler({
    publicBaseOrigin: 'https://funding.example.test',
    pool: { connect: () => assert.fail('no database access') },
    ensureAdminAccess: () => true,
    canOwn: () => false,
    writeJson: (_r, response, status, payload) =>
      Object.assign(response, { status, payload })
  });
  const response = { setHeader() {} };
  await handler(
    {
      method: 'GET',
      url: '/api/admin/sponsorship-commitments/adoption-preview',
      headers: {}
    },
    response
  );
  assert.equal(response.status, 403);
  assert.equal(response.payload.code, 'COMMITMENT_OWNER_REQUIRED');
});
