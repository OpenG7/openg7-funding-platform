import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import sharp from 'sharp';
import {
  analyzeSponsorMediaBytes,
  localTechnicalMediaAdapter
} from '../dist/apps/funding-api/src/sponsor-media-analysis/worker.js';
import {
  sponsorMediaAnalysisPrefill,
  validateSponsorMediaAnalysisSuggestion
} from '../dist/packages/funding-core/src/sponsor-media-analysis.js';
import { getSponsorMediaActions } from '../dist/packages/funding-core/src/sponsor-media-actions.js';

async function image(width = 320) {
  const bytes = await sharp({
    create: { width, height: 240, channels: 3, background: '#237096' }
  })
    .webp()
    .toBuffer();
  return { bytes, checksum: createHash('sha256').update(bytes).digest('hex') };
}
test('local analysis decodes real private bytes and explicitly abstains from visual and legal conclusions', async () => {
  const { bytes, checksum } = await image();
  const suggestion = await analyzeSponsorMediaBytes(bytes, checksum);
  assert.deepEqual(suggestion.capabilities, {
    technical: 'local',
    vision: 'not_configured',
    ocr: 'not_configured'
  });
  assert.deepEqual(suggestion.technical, {
    width: 320,
    height: 240,
    sizeBytes: bytes.length,
    mimeType: 'image/webp'
  });
  assert.equal(suggestion.altText, null);
  assert.equal(suggestion.classification, 'unknown');
  assert.deepEqual(suggestion.signals, []);
  assert.ok(suggestion.limitations.includes('HUMAN_CONTENT_REVIEW_REQUIRED'));
  assert.ok(suggestion.limitations.includes('NO_LEGAL_RIGHTS_INFERRED'));
  const small = await image(100);
  assert.deepEqual(
    (await analyzeSponsorMediaBytes(small.bytes, small.checksum)).signals,
    ['low_resolution']
  );
});
test('wrong checksums, invalid files and inflated or forged adapter capabilities never become proposals', async () => {
  const { bytes, checksum } = await image();
  await assert.rejects(analyzeSponsorMediaBytes(bytes, '0'.repeat(64)), {
    code: 'MEDIA_ANALYSIS_CHECKSUM_MISMATCH'
  });
  const invalid = Buffer.from('synthetic invalid image');
  await assert.rejects(
    analyzeSponsorMediaBytes(
      invalid,
      createHash('sha256').update(invalid).digest('hex')
    )
  );
  for (const mutate of [
    (s) => ({ ...s, usageRights: { confirmed: true } }),
    (s) => ({ ...s, level: 'N0' }),
    (s) => ({ ...s, altText: 'An invented visual description.' }),
    (s) => ({
      ...s,
      capabilities: { ...s.capabilities, vision: 'configured' }
    }),
    (s) => ({ ...s, technical: { ...s.technical, width: 500 } }),
    (s) => ({ ...s, signals: ['person_detected'] })
  ]) {
    const adapter = {
      ...localTechnicalMediaAdapter,
      async analyze(input) {
        return mutate(await localTechnicalMediaAdapter.analyze(input));
      }
    };
    await assert.rejects(analyzeSponsorMediaBytes(bytes, checksum, adapter), {
      code: 'MEDIA_ANALYSIS_SUGGESTION_INVALID'
    });
  }
});
test('an explicitly injected vision adapter proposes data for local prefill without granting legal or moderation rights', async () => {
  const { bytes, checksum } = await image();
  const adapter = {
    version: 'test_vision_v1',
    capabilities: {
      technical: 'local',
      vision: 'configured',
      ocr: 'not_configured'
    },
    async analyze(input) {
      return {
        adapterVersion: this.version,
        checksum: input.checksum,
        capabilities: this.capabilities,
        technical: input.technical,
        altText: 'A synthetic blue rectangle.',
        classification: 'illustration',
        signals: ['text_detected'],
        limitations: ['SYNTHETIC_TEST_PROVIDER', 'NO_LEGAL_RIGHTS_INFERRED']
      };
    }
  };
  const suggestion = await analyzeSponsorMediaBytes(bytes, checksum, adapter);
  assert.equal(
    validateSponsorMediaAnalysisSuggestion(
      suggestion,
      checksum,
      adapter.version
    ),
    true
  );
  const run = {
    id: 'synthetic-run',
    assetId: 'synthetic-asset',
    checksum,
    adapterVersion: adapter.version,
    state: 'succeeded',
    stale: false,
    errorCode: null,
    createdAt: '',
    finishedAt: '',
    suggestion,
    review: null
  };
  const before = structuredClone(run);
  assert.deepEqual(sponsorMediaAnalysisPrefill(run, true), {
    altText: suggestion.altText,
    classification: suggestion.classification
  });
  assert.deepEqual(run, before);
  assert.equal(sponsorMediaAnalysisPrefill(run, false), null);
  for (const changed of [
    { ...run, stale: true },
    { ...run, state: 'failed' },
    { ...run, review: { decision: 'rejected' } },
    { ...run, review: { decision: 'accepted' } }
  ])
    assert.equal(sponsorMediaAnalysisPrefill(changed, true), null);
});
test('native controls and controller share batch intentions while exact human manual review stays available', () => {
  const base = {
    selectionCount: 3,
    readyCount: 0,
    canReview: true,
    busy: false
  };
  assert.equal(
    getSponsorMediaActions(base).find((a) => a.id === 'approve').enabled,
    false
  );
  assert.equal(
    getSponsorMediaActions({ ...base, readyCount: 3 }).find(
      (a) => a.id === 'approve'
    ).enabled,
    true
  );
  assert.equal(
    getSponsorMediaActions({ ...base, reviewableCount: 3 }).find(
      (a) => a.id === 'approve'
    ).enabled,
    true
  );
  assert.equal(
    getSponsorMediaActions({ ...base, reviewableCount: 2 }).find(
      (a) => a.id === 'approve'
    ).enabled,
    false
  );
  for (const state of [
    { ...base, canReview: false },
    { ...base, busy: true },
    { ...base, selectionCount: 0 }
  ])
    assert.equal(
      getSponsorMediaActions(state).some(
        (a) =>
          ['approve', 'reject', 'delete', 'permissions', 'analyze'].includes(
            a.id
          ) && a.enabled
      ),
      false
    );
  assert.equal(
    getSponsorMediaActions({ ...base, canDelete: false }).find(
      (a) => a.id === 'delete'
    ).enabled,
    false
  );
});
