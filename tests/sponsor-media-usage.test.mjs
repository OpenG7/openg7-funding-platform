import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeSponsorMediaUsage,
  sponsorMediaUsageIssue
} from '../dist/packages/funding-core/src/index.js';

const confirmed = (overrides = {}) => ({
  state: 'confirmed',
  channels: ['website', 'facebook'],
  targets: ['openg7'],
  transformations: ['technical', 'portrait'],
  credit: null,
  restrictions: null,
  ...overrides
});
const context = (overrides = {}) => ({
  channel: 'facebook',
  target: 'openg7',
  transformations: ['technical'],
  restrictionsReviewed: false,
  renderedCredit: null,
  ...overrides
});

test('historical image rights stay unknown and cannot authorize a website or social use', () => {
  for (const value of [undefined, null]) {
    const usage = normalizeSponsorMediaUsage(value);
    assert.equal(usage.state, 'needs_confirmation');
    assert.deepEqual(usage.channels, []);
    for (const channel of ['website', 'facebook', 'linkedin'])
      assert.equal(
        sponsorMediaUsageIssue(usage, context({ channel })),
        'MEDIA_USAGE_CONFIRMATION_REQUIRED'
      );
  }
});

test('usage normalization keeps a stable snapshot and rejects invalid or fabricated permissions', () => {
  assert.deepEqual(
    normalizeSponsorMediaUsage(
      confirmed({
        channels: ['facebook', 'website'],
        transformations: ['portrait', 'technical'],
        credit: ' Synthetic photographer '
      })
    ),
    confirmed({ credit: 'Synthetic photographer' })
  );
  for (const malformed of [
    confirmed({ state: 'approved' }),
    confirmed({ channels: ['instagram'] }),
    confirmed({ channels: ['website', 'website'] }),
    confirmed({ targets: ['foreign'] }),
    confirmed({ transformations: ['crop'] }),
    confirmed({ transformations: ['invented'] }),
    confirmed({ channels: [] }),
    confirmed({ credit: '<script>' }),
    confirmed({ restrictions: 'unsafe\u0000text' }),
    { ...confirmed(), silentApproval: true }
  ])
    assert.throws(() => normalizeSponsorMediaUsage(malformed));
});

test('channel, destination and transformation permissions are independent and withdrawal wins', () => {
  const usage = normalizeSponsorMediaUsage(confirmed());
  assert.equal(sponsorMediaUsageIssue(usage, context()), null);
  assert.equal(
    sponsorMediaUsageIssue(usage, context({ channel: 'linkedin' })),
    'MEDIA_CHANNEL_NOT_AUTHORIZED'
  );
  assert.equal(
    sponsorMediaUsageIssue(usage, context({ target: 'openg20' })),
    'MEDIA_TARGET_NOT_AUTHORIZED'
  );
  for (const transformations of [
    ['technical', 'crop'],
    ['technical', 'composite']
  ])
    assert.equal(
      sponsorMediaUsageIssue(usage, context({ transformations })),
      'MEDIA_TRANSFORMATION_NOT_AUTHORIZED'
    );
  assert.equal(
    sponsorMediaUsageIssue(
      usage,
      context({ transformations: ['technical', 'portrait'] })
    ),
    null
  );
  assert.equal(
    sponsorMediaUsageIssue(
      normalizeSponsorMediaUsage(confirmed({ state: 'withdrawn' })),
      context()
    ),
    'MEDIA_USAGE_WITHDRAWN'
  );
});

test('a free-text restriction needs explicit human review and credit must be in the final protected rendering', () => {
  const usage = normalizeSponsorMediaUsage(
    confirmed({
      restrictions: 'Use only beside the supplied company presentation.',
      credit: 'Synthetic photographer'
    })
  );
  assert.equal(
    sponsorMediaUsageIssue(usage, context()),
    'MEDIA_RESTRICTIONS_REVIEW_REQUIRED'
  );
  assert.equal(
    sponsorMediaUsageIssue(usage, context({ restrictionsReviewed: true })),
    'MEDIA_CREDIT_REQUIRED'
  );
  assert.equal(
    sponsorMediaUsageIssue(
      usage,
      context({
        restrictionsReviewed: true,
        renderedCredit: 'A different credit'
      })
    ),
    'MEDIA_CREDIT_REQUIRED'
  );
  assert.equal(
    sponsorMediaUsageIssue(
      usage,
      context({ restrictionsReviewed: true, renderedCredit: usage.credit })
    ),
    null
  );
});
