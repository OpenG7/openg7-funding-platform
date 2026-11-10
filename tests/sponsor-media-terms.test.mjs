import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  getSponsorMediaUsageTerms,
  normalizeSponsorMediaTermsAcceptance
} from '../dist/packages/funding-core/src/index.js';
import { readSponsorMediaFollowupUploadReceipt } from '../dist/apps/funding-api/src/sponsor-media/followup-upload-receipt.js';

test('the two displayed media terms have exact immutable SHA-256 fingerprints and explicit acceptance', () => {
  const french = getSponsorMediaUsageTerms('fr-CA');
  const english = getSponsorMediaUsageTerms('en');
  assert.equal(french.version, english.version);
  assert.notEqual(french.fingerprint, english.fingerprint);
  for (const terms of [french, english]) {
    assert.equal(
      createHash('sha256').update(terms.text).digest('hex'),
      terms.fingerprint
    );
    const { text, ...descriptor } = terms;
    const acceptance = { ...descriptor, accepted: true };
    assert.deepEqual(
      normalizeSponsorMediaTermsAcceptance(acceptance),
      acceptance
    );
    for (const invalid of [
      null,
      [],
      {},
      { ...acceptance, accepted: false },
      { ...acceptance, accepted: 'true' },
      { ...acceptance, locale: 'fr' },
      { ...acceptance, version: 'old' },
      { ...acceptance, fingerprint: 'a'.repeat(64) },
      { ...acceptance, locale: terms.locale === 'en' ? 'fr-CA' : 'en' },
      { ...acceptance, text },
      { ...acceptance, actor: 'synthetic-person' }
    ])
      assert.throws(() => normalizeSponsorMediaTermsAcceptance(invalid));
  }
});

test('private upload receipt lookup scopes the dossier, UUID, command actor and fingerprint without returning foreign results', async () => {
  const contributionId = randomUUID(),
    requestId = randomUUID(),
    fingerprint = 'a'.repeat(64);
  const result = {
    uploaded: true,
    asset: { id: randomUUID(), contributionId }
  };
  const row = {
    actor: 'sponsor-followup',
    payload_fingerprint: fingerprint,
    result
  };
  const db = (value) => ({
    query: async (sql, params) => {
      assert.match(sql, /contribution_id=\$1::uuid AND request_id=\$2::uuid/);
      assert.deepEqual(params, [contributionId, requestId]);
      return { rows: value ? [value] : [] };
    }
  });
  assert.equal(
    await readSponsorMediaFollowupUploadReceipt(
      db(null),
      contributionId,
      requestId
    ),
    null
  );
  assert.deepEqual(
    await readSponsorMediaFollowupUploadReceipt(
      db(row),
      contributionId,
      requestId,
      fingerprint
    ),
    result
  );
  for (const invalid of [
    { ...row, actor: 'synthetic-admin' },
    { ...row, payload_fingerprint: 'b'.repeat(64) },
    {
      ...row,
      result: {
        ...result,
        asset: { ...result.asset, contributionId: randomUUID() }
      }
    },
    { ...row, result: { updated: true } }
  ])
    await assert.rejects(
      readSponsorMediaFollowupUploadReceipt(
        db(invalid),
        contributionId,
        requestId,
        fingerprint
      ),
      { code: 'MEDIA_REQUEST_CONFLICT' }
    );
  await assert.rejects(
    readSponsorMediaFollowupUploadReceipt(null, contributionId, requestId),
    { code: 'MEDIA_RECEIPT_UNAVAILABLE' }
  );
});
