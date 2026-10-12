import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import sharp from 'sharp';

import {
  attestWebsiteMedia,
  readWebsiteMediaSources,
  assertWebsiteMediaAttested,
  assertWebsiteRequiredElements
} from '../dist/apps/funding-api/src/sponsorship-website-media.js';

const contributionId = '10000000-0000-4000-8000-000000000001';
const image = await sharp({
  create: { width: 30, height: 20, channels: 3, background: '#456789' }
})
  .webp()
  .toBuffer();
const checksum = createHash('sha256').update(image).digest('hex');
const rights = {
  state: 'confirmed',
  channels: ['website'],
  targets: ['openg7'],
  transformations: ['technical'],
  credit: 'Photo : Atelier synthétique',
  restrictions: null
};
const row = (overrides = {}) => ({
  id: '10000000-0000-4000-8000-000000000002',
  contribution_id: contributionId,
  kind: 'supporting_image',
  version: 'v1',
  checksum_sha256: checksum,
  processed_storage_key: 'synthetic-private-webp',
  processed_mime_type: 'image/webp',
  width: 30,
  height: 20,
  alt_text: 'Qualified source photograph',
  usage_rights: rights,
  usage_restrictions_reviewed: false,
  ...overrides
});
const db = (rows) => ({ query: async () => ({ rows }) });

test('website preflight reads only the exact projected photo and logo and attests their full current metadata', async () => {
  const rows = [
    row(),
    row({ id: 'unused-photo', processed_storage_key: 'unused-private-photo' }),
    row({
      id: 'logo',
      kind: 'logo',
      processed_storage_key: 'synthetic-private-logo'
    })
  ];
  const reads = [];
  const attestation = await attestWebsiteMedia(
    db(rows),
    {
      readPrivateObject: async (key) => {
        reads.push(key);
        return image;
      }
    },
    contributionId,
    'legacy-declared-logo'
  );
  assert.deepEqual(reads, ['synthetic-private-webp', 'synthetic-private-logo']);
  assert.equal(attestation.contributionId, contributionId);
  assert.equal(attestation.sources.length, 2);
  assert.equal(attestation.sources[0].checksum, checksum);
  assert.equal(attestation.sources[0].usage.credit, rights.credit);
  assertWebsiteMediaAttested(
    contributionId,
    await readWebsiteMediaSources(
      db(rows),
      contributionId,
      'legacy-declared-logo'
    ),
    attestation
  );
});

test('website preflight requires the physical storage port and fails safely for absent, changed or invalid WebP bytes', async (t) => {
  for (const scenario of [
    { label: 'missing storage', code: 'MEDIA_STORAGE_UNAVAILABLE' },
    { label: 'absent object', bytes: null, code: 'MEDIA_UNAVAILABLE' },
    {
      label: 'changed bytes',
      bytes: Buffer.from('changed'),
      code: 'MEDIA_CHANGED'
    },
    {
      label: 'storage error',
      error: new Error('private-source-detail-must-not-be-disclosed'),
      code: 'MEDIA_STORAGE_UNAVAILABLE'
    },
    {
      label: 'invalid bytes with matching checksum',
      bytes: Buffer.from('not a WebP'),
      changeHash: true,
      code: 'MEDIA_CHANGED'
    },
    {
      label: 'changed dimensions',
      bytes: image,
      override: { width: 31 },
      code: 'MEDIA_CHANGED'
    }
  ])
    await t.test(scenario.label, async () => {
      const source = row({
        ...scenario.override,
        ...(scenario.changeHash
          ? {
              checksum_sha256: createHash('sha256')
                .update(scenario.bytes)
                .digest('hex')
            }
          : {})
      });
      const storage =
        scenario.label === 'missing storage'
          ? undefined
          : {
              readPrivateObject: async () => {
                if (scenario.error) throw scenario.error;
                return scenario.bytes;
              }
            };
      await assert.rejects(
        attestWebsiteMedia(db([source]), storage, contributionId, null),
        (error) => {
          assert.equal(error.code, scenario.code);
          assert.doesNotMatch(
            error.message,
            /private-source-detail|synthetic-private/
          );
          return true;
        }
      );
    });
});

test('website media cannot reuse a foreign owner or a legacy logo without a qualified owned asset', async () => {
  await assert.rejects(
    readWebsiteMediaSources(
      db([row({ contribution_id: 'foreign-dossier' })]),
      contributionId,
      null
    ),
    { code: 'MEDIA_CHANGED' }
  );
  await assert.rejects(
    readWebsiteMediaSources(db([row()]), contributionId, 'legacy-logo-url'),
    { code: 'MEDIA_USAGE_CONFIRMATION_REQUIRED' }
  );
});

test('transaction revalidation rejects any changed selection, version, hash, key, rights or owner', async () => {
  const attestation = await attestWebsiteMedia(
    db([row()]),
    { readPrivateObject: async () => image },
    contributionId,
    null
  );
  for (const changes of [
    { id: 'other-photo' },
    { version: 'v2' },
    { checksum: 'b'.repeat(64) },
    { storageKey: 'another-private-key' },
    { contributionId: 'foreign-dossier' },
    { usage: { ...rights, credit: 'Different required credit' } },
    { restrictionsReviewed: true },
    { width: 31 },
    { alt: 'Changed public caption' }
  ])
    assert.throws(
      () =>
        assertWebsiteMediaAttested(
          contributionId,
          [{ ...attestation.sources[0], ...changes }],
          attestation
        ),
      { code: 'MEDIA_CHANGED' }
    );
  assert.throws(
    () => assertWebsiteMediaAttested(contributionId, [], attestation),
    { code: 'MEDIA_CHANGED' }
  );
  assert.throws(
    () => assertWebsiteMediaAttested(contributionId, attestation.sources, null),
    { code: 'MEDIA_CHANGED' }
  );
});

test('website commercial requirements use only the attested public selection and preserve optional logos', async () => {
  const photo = await attestWebsiteMedia(
    db([row()]),
    { readPrivateObject: async () => image },
    contributionId,
    null
  );
  assert.doesNotThrow(() =>
    assertWebsiteRequiredElements(
      contributionId,
      ['company_name', 'approved_presentation'],
      'Synthetic sponsor',
      photo.sources,
      photo
    )
  );
  assert.throws(
    () =>
      assertWebsiteRequiredElements(
        contributionId,
        ['company_name', 'approved_presentation', 'approved_logo'],
        'Synthetic sponsor',
        photo.sources,
        photo
      ),
    { code: 'REQUIRED_ELEMENTS_MISSING', status: 409 }
  );
  assert.throws(
    () =>
      assertWebsiteRequiredElements(
        contributionId,
        ['company_name'],
        '  ',
        photo.sources,
        photo
      ),
    { code: 'REQUIRED_ELEMENTS_MISSING' }
  );
  const withLogo = await attestWebsiteMedia(
    db([row(), row({ id: 'logo', kind: 'logo' })]),
    { readPrivateObject: async () => image },
    contributionId,
    null
  );
  assert.doesNotThrow(() =>
    assertWebsiteRequiredElements(
      contributionId,
      ['company_name', 'approved_presentation', 'approved_logo'],
      'Synthetic sponsor',
      withLogo.sources,
      withLogo
    )
  );
  assert.throws(
    () =>
      assertWebsiteRequiredElements(
        contributionId,
        ['approved_logo'],
        'Synthetic sponsor',
        withLogo.sources,
        photo
      ),
    { code: 'MEDIA_CHANGED' }
  );
});
