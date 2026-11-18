import assert from 'node:assert/strict';
import { test } from 'node:test';

import { moderationPreviewFields } from '../dist/apps/funding-web/src/app/features/funding/components/admin-moderation/funding-moderation-preview.js';

function find(fields, key) {
  const found = fields.find((field) => field.key === key);
  assert.ok(found, `Missing preview field: ${key}`);
  return found;
}

test('sponsorship preview preserves exact editorial text without changing the snapshot', () => {
  const message = '  First paragraph.\n\n<script>synthetic text</script>\n';
  const snapshot = Object.freeze({
    companyName: 'Synthetic Company',
    publicName: 'Synthetic Public Name',
    message,
    website: 'https://example.org',
    publicSummary: null,
    publicSlug: '',
    logoUrl: null,
    documentedConsentRecordId: 'synthetic-consent',
    unexpectedPrivateField: 'retained in exact evidence only'
  });

  const fields = moderationPreviewFields(snapshot, 'sponsorship');

  assert.equal(fields[0].key, 'publicName');
  assert.equal(find(fields, 'message').value, message);
  assert.equal(find(fields, 'message').multiline, true);
  assert.equal(
    find(fields, 'companyName').labelKey,
    'admin.moderation.fields.companyName'
  );
  assert.equal(find(fields, 'publicSummary').value, null);
  assert.equal(find(fields, 'publicSlug').value, null);
  assert.equal(
    fields.some((field) => field.key === 'unexpectedPrivateField'),
    false
  );
  assert.equal(
    fields.some((field) => field.key === 'documentedConsentRecordId'),
    false
  );
  assert.equal(snapshot.message, message);
  assert.equal(
    snapshot.unexpectedPrivateField,
    'retained in exact evidence only'
  );
});

test('media preview exposes usage and exact scalar values while leaving hashes in evidence', () => {
  const usage = Object.freeze({
    allowed: false,
    restriction: '  Keep the original caption.  ',
    approvedChannels: Object.freeze(['website', 'linkedin']),
    sourceHash: 'synthetic-source-hash'
  });
  const snapshot = Object.freeze({
    contributionId: 'synthetic-sponsor',
    kind: 'photo',
    altText: null,
    width: 0,
    height: 720,
    usage,
    effectiveRule: Object.freeze({
      scope: 'asset',
      version: 'synthetic-version'
    }),
    deletedAt: null,
    checksum: 'synthetic-checksum',
    storageKey: 'not-part-of-the-overview',
    usageAcceptanceId: 'synthetic-acceptance'
  });

  const fields = moderationPreviewFields(snapshot, 'media');

  assert.equal(find(fields, 'width').value, '0');
  assert.equal(find(fields, 'height').value, '720');
  assert.equal(find(fields, 'altText').value, null);
  const usageFields = find(fields, 'usage').children;
  assert.equal(find(usageFields, 'allowed').value, 'false');
  assert.equal(find(usageFields, 'allowed').labelKey, null);
  assert.equal(find(usageFields, 'restriction').value, usage.restriction);
  const channels = find(usageFields, 'approvedChannels').children;
  assert.deepEqual(
    channels.map((field) => [field.number, field.value]),
    [
      [1, 'website'],
      [2, 'linkedin']
    ]
  );
  assert.equal(
    usageFields.some((field) => field.key === 'sourceHash'),
    false
  );
  for (const key of [
    'contributionId',
    'checksum',
    'storageKey',
    'usageAcceptanceId'
  ]) {
    assert.equal(
      fields.some((field) => field.key === key),
      false
    );
  }
  assert.equal(snapshot.usage, usage);
});

test('publication draft preview keeps title, body, disclosure, destination and nested sponsor', () => {
  const snapshot = {
    contributionId: 'synthetic-sponsor',
    title: 'Synthetic title',
    body: 'First line.\r\nSecond line.\n',
    disclosure: 'Synthetic sponsorship disclosure',
    feedTarget: 'openg7',
    channel: 'linkedin',
    sponsor: {
      companyName: 'Synthetic Company',
      message: '  Exact sponsor presentation. ',
      publicSummary: null,
      documentedConsentRecordId: 'synthetic-consent'
    },
    obligationId: 'synthetic-obligation'
  };

  const fields = moderationPreviewFields(snapshot, 'publication_draft');

  assert.deepEqual(
    fields.map((field) => field.key),
    ['title', 'body', 'disclosure', 'feedTarget', 'channel', 'sponsor']
  );
  assert.equal(find(fields, 'body').value, snapshot.body);
  assert.equal(find(fields, 'body').multiline, true);
  assert.equal(find(fields, 'feedTarget').value, 'openg7');
  const sponsor = find(fields, 'sponsor').children;
  assert.equal(find(sponsor, 'message').value, snapshot.sponsor.message);
  assert.equal(find(sponsor, 'publicSummary').value, null);
  assert.equal(
    sponsor.some((field) => field.key === 'documentedConsentRecordId'),
    false
  );
});

test('publication delivery preview identifies each source and preserves its nested editorial content', () => {
  const snapshot = {
    message: '  Exact final message.\n',
    feedId: 'synthetic-feed',
    accountId: 'synthetic-account',
    mode: 'scheduled',
    media: {
      kind: 'photo',
      altText: 'Synthetic photo',
      checksum: 'synthetic-hash'
    },
    sources: [
      {
        id: 'synthetic-draft',
        contributionId: 'synthetic-sponsor',
        content: {
          title: 'Synthetic source title',
          body: '  Exact source body.\n',
          disclosure: 'Synthetic source disclosure',
          sponsor: {
            publicName: 'Synthetic Public Name',
            message: 'Exact source presentation'
          }
        }
      }
    ],
    preparedMedia: {
      version: 'synthetic-version',
      usage: { rule: 'Synthetic rule' },
      derivedHash: 'synthetic-hash'
    },
    visual: {
      format: 'image_collection',
      photoSelections: [
        { position: 0, crop: { x: 0, y: 0.5 }, reviewed: true }
      ],
      derivedMedia: {
        kind: 'derived',
        alt: '  Exact alt.\n',
        transform: { fit: 'contain' },
        hash: 'synthetic-hash',
        sources: [
          {
            contributionId: 'synthetic-photo-sponsor',
            name: 'Synthetic Photo Sponsor',
            media: { kind: 'photo', alt: 'Exact photo source alt' }
          }
        ]
      }
    }
  };

  const fields = moderationPreviewFields(snapshot, 'publication_delivery');

  assert.equal(find(fields, 'message').value, snapshot.message);
  assert.equal(find(fields, 'accountId').value, 'synthetic-account');
  assert.equal(
    find(fields, 'media').children.some((field) => field.key === 'checksum'),
    false
  );
  const source = find(fields, 'sources').children[0];
  assert.equal(source.number, 1);
  assert.equal(source.labelKey, null);
  assert.equal(find(source.children, 'id').value, 'synthetic-draft');
  assert.equal(
    find(source.children, 'contributionId').value,
    'synthetic-sponsor'
  );
  const content = find(source.children, 'content').children;
  assert.equal(find(content, 'body').value, snapshot.sources[0].content.body);
  assert.equal(
    find(find(content, 'sponsor').children, 'message').value,
    'Exact source presentation'
  );
  const visual = find(fields, 'visual').children;
  assert.equal(find(visual, 'format').labelKey, null);
  const selection = find(visual, 'photoSelections').children[0].children;
  assert.equal(find(selection, 'position').value, '0');
  assert.equal(find(selection, 'reviewed').value, 'true');
  assert.equal(find(find(selection, 'crop').children, 'y').value, '0.5');
  const derived = find(visual, 'derivedMedia').children;
  assert.equal(find(derived, 'alt').value, snapshot.visual.derivedMedia.alt);
  assert.equal(find(derived, 'alt').multiline, true);
  assert.equal(
    derived.some((field) => field.key === 'hash'),
    false
  );
  const visualSource = find(derived, 'sources').children[0].children;
  assert.equal(find(visualSource, 'name').value, 'Synthetic Photo Sponsor');
  assert.equal(
    find(find(visualSource, 'media').children, 'alt').value,
    'Exact photo source alt'
  );
});

test('unknown top-level facts stay in exact evidence and empty collections keep their distinction', () => {
  assert.deepEqual(
    moderationPreviewFields({ futureField: 'synthetic' }, 'sponsorship'),
    []
  );
  const fields = moderationPreviewFields(
    { sources: [], media: {}, visual: null },
    'publication_delivery'
  );
  assert.equal(find(fields, 'sources').value, '[]');
  assert.equal(find(fields, 'media').value, '{}');
  assert.equal(find(fields, 'visual').value, null);
});
