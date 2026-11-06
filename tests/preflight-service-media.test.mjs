import assert from 'node:assert/strict';
import test from 'node:test';

import { projectServiceMedia } from '../dist/apps/funding-web/src/app/features/funding/components/admin-preflight-examination/preflight-service-media.js';

const asset = (id, change = {}) => ({
  id,
  contributionId: 'dossier',
  kind: 'supporting_image',
  version: 'asset-v1',
  sortOrder: 1,
  createdAt: '2026-11-05T12:00:00Z',
  reviewStatus: 'approved',
  readiness: { state: 'ready', reasons: [] },
  publicUrl: null,
  websiteSelected: false,
  usage: {
    state: 'confirmed',
    channels: ['website', 'facebook'],
    targets: ['openg7'],
    transformations: ['technical']
  },
  ...change
});
const assignment = (assetId, change = {}) => ({
  id: 'assignment-' + assetId,
  obligationId: 'service',
  obligationVersion: 3,
  assetId,
  assetVersion: 'asset-v1',
  stale: false,
  actor: 'synthetic-reviewer',
  createdAt: '2026-11-05T12:00:00Z',
  ...change
});
const workspace = (change = {}) => ({
  contributionId: 'dossier',
  assets: [asset('prepared'), asset('other')],
  preparationObligations: [
    { id: 'service', version: 3, channel: 'website', target: 'openg7' }
  ],
  preparationAssignments: [assignment('prepared')],
  ...change
});
const project = (data, channel = 'website') =>
  projectServiceMedia(data, 'dossier', 'service', channel, 'openg7');

test('Examiner consumes the exact dossier service assignment privately without changing website selection or publication', () => {
  const data = workspace();
  const before = JSON.stringify(data);
  const result = project(data);
  assert.equal(result.usesPreparation, true);
  assert.deepEqual(
    result.previewAssets.map((item) => item.id),
    ['prepared']
  );
  assert.equal(result.previewAssets[0].websiteSelected, false);
  assert.equal(result.previewAssets[0].publicUrl, null);
  assert.equal(JSON.stringify(data), before);
  assert.throws(
    () => project(workspace({ contributionId: 'other-dossier' })),
    /MEDIA_SCOPE_MISMATCH/
  );
  const foreign = project(
    workspace({
      assets: [asset('prepared', { contributionId: 'other-dossier' })]
    })
  );
  assert.equal(foreign.prepared[0].stale, true);
  assert.deepEqual(foreign.previewAssets, []);
});

test('stale assignments never fall back to another selected public image', () => {
  for (const change of [
    { stale: true },
    { assetVersion: 'old' },
    { obligationVersion: 2 }
  ]) {
    const result = project(
      workspace({
        assets: [
          asset('prepared'),
          asset('other', { websiteSelected: true, publicUrl: '/public/other' })
        ],
        preparationAssignments: [assignment('prepared', change)]
      })
    );
    assert.equal(result.usesPreparation, true);
    assert.equal(result.prepared[0].stale, true);
    assert.deepEqual(result.previewAssets, []);
  }
  for (const preparationObligations of [
    [],
    [{ id: 'service', version: 3, channel: 'linkedin', target: 'openg7' }]
  ])
    assert.deepEqual(
      project(workspace({ preparationObligations })).previewAssets,
      []
    );
});

test('current assignments remain reviewable but cannot render media without effective destination rights and completed review', () => {
  for (const change of [
    { reviewStatus: 'pending_review' },
    { readiness: { state: 'blocked' } },
    { usage: null },
    { usage: { state: 'withdrawn' } },
    {
      usage: {
        state: 'confirmed',
        channels: ['linkedin'],
        targets: ['openg7'],
        transformations: ['technical']
      }
    },
    {
      usage: {
        state: 'confirmed',
        channels: ['website'],
        targets: ['openg20'],
        transformations: ['technical']
      }
    },
    {
      usage: {
        state: 'confirmed',
        channels: ['website'],
        targets: ['openg7'],
        transformations: []
      }
    },
    {
      usage: {
        state: 'confirmed',
        channels: ['website'],
        targets: ['openg7'],
        transformations: ['technical'],
        restrictions: 'Check before use.'
      }
    }
  ]) {
    const result = project(workspace({ assets: [asset('prepared', change)] }));
    assert.equal(result.prepared[0].stale, false);
    assert.equal(result.prepared[0].eligible, false);
    assert.deepEqual(result.previewAssets, []);
  }
});

test('without an assignment only the existing eligible website selection is previewed; social media is not guessed', () => {
  const data = workspace({
    preparationAssignments: [],
    assets: [
      asset('selected', {
        websiteSelected: true,
        publicUrl: '/public/selected'
      }),
      asset('private'),
      asset('unselected', { publicUrl: '/public/unselected' })
    ]
  });
  assert.deepEqual(
    project(data).previewAssets.map((item) => item.id),
    ['selected']
  );
  assert.deepEqual(project(data, 'facebook').previewAssets, []);
  assert.equal(project(data).usesPreparation, false);
});

test('social previews consume only their exact service assignments and cannot mix other promised services', () => {
  const result = project(
    workspace({
      preparationObligations: [
        { id: 'service', version: 3, channel: 'facebook', target: 'openg7' }
      ],
      preparationAssignments: [
        assignment('prepared'),
        assignment('other', { obligationId: 'other-service' })
      ]
    }),
    'facebook'
  );
  assert.deepEqual(
    result.previewAssets.map((item) => item.id),
    ['prepared']
  );
  assert.equal(result.prepared.length, 1);
});
