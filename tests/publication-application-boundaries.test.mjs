import assert from 'node:assert/strict';
import test from 'node:test';

import sharp from 'sharp';

import {
  sourceEqual,
  sourceMessage,
  sourceIssues,
  repairSources,
  sources
} from '../dist/apps/funding-api/src/publication-automation/sources.js';
import {
  mediaOptions,
  mediaRecord,
  resolveMedia,
  assertMediaScope,
  mediaSnapshotIssue
} from '../dist/apps/funding-api/src/publication-automation/media.js';
import { ready } from '../dist/apps/funding-api/src/publication-automation/preflight.js';
import { digest } from '../dist/apps/funding-api/src/publication-automation/policy.js';
import { preparePublicationImage } from '../dist/apps/funding-api/src/publication-image.service.js';
import { moderationQueryFixture } from './support/moderation-query-fixture.mjs';
import {
  qualifyCommercialFixture,
  fulfilmentQueryFixture
} from './support/publication-fulfilment-query-fixture.mjs';

const source = {
  id: '11111111-1111-4111-8111-111111111111',
  contribution_id: '22222222-2222-4222-8222-222222222222',
  title: 'Merci à Exemple',
  body: 'Une contribution publique.',
  disclosure_text: 'Commandite rémunérée.',
  feed_target: 'openg7',
  channel: 'facebook'
};
const eligible = {
  ...source,
  status: 'draft',
  sponsor_feed_status: 'planned',
  public_display_consent: true,
  sponsor_review_status: 'approved',
  payment_status: 'paid',
  destination_eligible: true
};
const currentFacts = {
  id: source.contribution_id,
  status: 'paid',
  public_display_consent: true,
  sponsor_review_status: 'approved',
  sponsor_feed_status: 'planned',
  destination_eligible: true,
  review_changed: false
};
const imageBytes = await sharp({
  create: { width: 2, height: 2, channels: 3, background: '#345678' }
})
  .png()
  .toBuffer();
const prepared = await preparePublicationImage(imageBytes);
const media = {
  id: '33333333-3333-4333-8333-333333333333',
  url: '/api/public/sponsor-media/33333333-3333-4333-8333-333333333333',
  alt: 'Présentation approuvée',
  key: 'private/approved-image',
  version: '2030-01-01 12:00:00.123456+00',
  hash: digest(imageBytes),
  usage: {
    state: 'confirmed',
    channels: ['website', 'facebook', 'linkedin'],
    targets: ['openg7', 'openg20'],
    transformations: ['technical'],
    credit: null,
    restrictions: null
  },
  restrictionsReviewed: false
};
const mediaSnapshot = {
  ...media,
  derivedHash: prepared.sha256,
  transform: prepared.transform
};
const feed = {
  id: 'openg7:facebook',
  configured: true,
  connection: 'ready',
  accountId: 'synthetic-account',
  mode: 'mock'
};
const delivery = {
  id: '44444444-4444-4444-8444-444444444444',
  feed_id: feed.id,
  account_id: feed.accountId,
  mode: feed.mode,
  batch_id: '55555555-5555-4555-8555-555555555555',
  approved_at: new Date('2030-01-01T12:00:00Z'),
  source_snapshot: [source],
  message: `${source.title}\n\n${source.body}\n\n${source.disclosure_text}`,
  scheduled_at: new Date('2030-01-02T12:00:00Z'),
  media_id: null,
  media_snapshot: null
};
const approvedCommercial = { rows: [{ ...delivery, status: 'approved' }] };
qualifyCommercialFixture(approvedCommercial);
delivery.obligation_snapshot = approvedCommercial.rows[0].obligation_snapshot;

function sequenceDb(...results) {
  const calls = [];
  const commercial = structuredClone(approvedCommercial);
  return {
    calls,
    async query(sql, parameters) {
      const moderation = moderationQueryFixture(sql, [source.contribution_id]);
      if (moderation) return moderation;
      calls.push({ sql, parameters });
      const fulfilment = fulfilmentQueryFixture(
        commercial,
        sql.replace(/\s+/g, ' ').trim(),
        parameters
      );
      if (fulfilment) return fulfilment;
      assert.ok(results.length, 'Unexpected extra database query');
      const rows = results.shift();
      return { rows, rowCount: rows.length };
    }
  };
}

function batchDb(rows = [eligible], batch = { status: 'open', capacity: 3 }) {
  return sequenceDb([batch], [], rows);
}

function authorizedDb({
  rows = [eligible],
  facts = [],
  batch = {},
  mediaRows
} = {}) {
  return sequenceDb(
    [{ status: 'scheduled', capacity: 3 }],
    [],
    rows,
    facts,
    [{ id: source.contribution_id, sponsor_company_name: 'Exemple' }],
    [{ status: 'scheduled', scheduled_at: delivery.scheduled_at, ...batch }],
    ...(mediaRows === undefined ? [] : [mediaRows])
  );
}

test('source snapshots preserve exact content, membership and order', () => {
  const second = { ...source, id: 'another-draft' };
  assert.equal(
    sourceEqual([source, second], [{ ...source }, { ...second }]),
    true
  );
  for (const changed of [
    [second, source],
    [source],
    [{ ...source, body: `${source.body} ` }, second],
    [{ ...source, title: source.title.toLowerCase() }, second],
    [{ ...source, private_extra: true }, second]
  ])
    assert.equal(sourceEqual([source, second], changed), false);
  assert.equal(
    sourceMessage([source, { ...second, title: '', body: 'Deuxième texte.' }]),
    `${source.title}\n\n${source.body}\n\n${source.disclosure_text}\n\nDeuxième texte.\n\n${source.disclosure_text}`
  );
});

test('source issues retain independent financial, consent, review and destination reasons', async () => {
  const rows = [
    currentFacts,
    {
      ...currentFacts,
      id: 'sponsor-z',
      status: 'refunded',
      public_display_consent: false,
      sponsor_review_status: 'rejected',
      review_changed: true,
      destination_eligible: false
    },
    { ...currentFacts, id: 'sponsor-a', sponsor_feed_status: 'hidden' },
    { ...currentFacts, id: 'sponsor-b', status: 'disputed' }
  ];
  const result = await sourceIssues(sequenceDb(rows), delivery.id);
  assert.deepEqual(result, {
    codes: [
      'CONSENT_WITHDRAWN',
      'DESTINATION_CHANGED',
      'PAYMENT_REQUIRED',
      'SOURCE_NOT_ELIGIBLE',
      'SPONSOR_REVIEW_REQUIRED'
    ],
    excludedSponsorIds: ['sponsor-a', 'sponsor-b', 'sponsor-z']
  });
  assert.deepEqual(await sourceIssues(sequenceDb([]), delivery.id), {
    codes: [],
    excludedSponsorIds: []
  });
});

test('paid sponsors awaiting review enter private preparation only when requested', async () => {
  const pending = { ...eligible, sponsor_review_status: 'pending_review' };
  await assert.rejects(
    sources(batchDb([pending]), delivery.batch_id, feed.id),
    {
      code: 'SOURCE_NOT_ELIGIBLE'
    }
  );
  assert.deepEqual(
    await sources(batchDb([pending]), delivery.batch_id, feed.id, true),
    [source]
  );
  assert.deepEqual(await sources(batchDb(), delivery.batch_id, feed.id), [
    source
  ]);
});

test('source loading rejects each invalid fact even during private preparation', async () => {
  for (const invalid of [
    { public_display_consent: false },
    { payment_status: 'refunded' },
    { sponsor_review_status: 'rejected' },
    { sponsor_feed_status: 'hidden' },
    { destination_eligible: false },
    { feed_target: 'openg20' },
    { channel: 'linkedin' },
    { status: 'published' }
  ])
    await assert.rejects(
      sources(
        batchDb([{ ...eligible, ...invalid }]),
        delivery.batch_id,
        feed.id,
        true
      ),
      { code: 'SOURCE_NOT_ELIGIBLE' }
    );
});

test('source loading blocks missing, empty, over-capacity and legacy batches', async () => {
  await assert.rejects(sources(sequenceDb([]), delivery.batch_id, feed.id), {
    code: 'BATCH_UNAVAILABLE'
  });
  await assert.rejects(
    sources(sequenceDb([{ status: 'published' }]), delivery.batch_id, feed.id),
    { code: 'BATCH_UNAVAILABLE' }
  );
  for (const rows of [[], [eligible, eligible, eligible, eligible]])
    await assert.rejects(sources(batchDb(rows), delivery.batch_id, feed.id), {
      code: 'EMPTY_BATCH'
    });
  await assert.rejects(
    sources(
      sequenceDb([{ status: 'open', capacity: 3 }], [{ id: 'legacy-job' }]),
      delivery.batch_id,
      feed.id
    ),
    { code: 'LEGACY_DELIVERY_EXISTS' }
  );
});

test('repair candidates keep their ordered prefix and exact UTF-16 text limit', async () => {
  const exact = {
    ...source,
    title: 'Exemple',
    disclosure_text: '',
    body: '😀'.repeat(1445) + 'x',
    name: 'Exemple'
  };
  const tooLarge = { ...exact, id: 'too-large', body: `${exact.body}x` };
  const smaller = { ...exact, id: 'smaller', body: 'Petit texte' };
  assert.deepEqual(
    await repairSources(
      sequenceDb(
        [{ capacity: 3, preparation_moderation_allowed: true }],
        [],
        [exact, smaller]
      ),
      delivery
    ),
    [exact]
  );
  const guarded = sequenceDb(
    [{ capacity: 3, preparation_moderation_allowed: true }],
    [],
    [smaller]
  );
  await repairSources(guarded, delivery);
  assert.ok(
    guarded.calls[2].sql.includes("AND d.status IN ('draft','approved')")
  );
  assert.ok(
    guarded.calls[2].sql.indexOf('preparation_review') <
      guarded.calls[2].sql.indexOf('LIMIT $3')
  );
  assert.deepEqual(
    await repairSources(
      sequenceDb(
        [{ capacity: 3, preparation_moderation_allowed: true }],
        [],
        [tooLarge, smaller]
      ),
      delivery
    ),
    [smaller]
  );
  const missing = sequenceDb([]);
  assert.deepEqual(await repairSources(missing, delivery), []);
  assert.equal(missing.calls.length, 1);
});

test('media selection retains its public projection and database timestamp text', async () => {
  const option = {
    id: media.id,
    url: 'https://cdn.example.test/legacy-option.webp',
    alt: media.alt,
    company: 'Exemple'
  };
  const controlled = { ...media, url: '/api/public/sponsor-media/' + media.id };
  assert.deepEqual(await mediaOptions(sequenceDb([option])), [
    { ...option, url: controlled.url }
  ]);
  assert.deepEqual(
    await mediaRecord(sequenceDb([media]), media.id),
    controlled
  );
  const bytes = imageBytes;
  const storage = {
    async readPrivateObject(key) {
      assert.equal(key, media.key);
      return bytes;
    }
  };
  assert.deepEqual(await resolveMedia(sequenceDb([media]), storage, media.id), {
    ...controlled,
    derivedHash: prepared.sha256,
    transform: prepared.transform
  });
});

test('normalizing a legacy media URL requires a fresh publication review and does not alter its snapshot', async () => {
  const snapshot = {
    ...media,
    url: 'https://cdn.example.test/legacy.webp'
  };
  const record = await mediaRecord(
    sequenceDb([{ ...media, url: snapshot.url }]),
    media.id
  );
  assert.equal(record.url, '/api/public/sponsor-media/' + media.id);
  assert.equal(mediaSnapshotIssue(media.id, snapshot, record), 'MEDIA_CHANGED');
  assert.equal(snapshot.url, 'https://cdn.example.test/legacy.webp');
});

test('media resolution distinguishes absent selection, invalid id, approval and unavailable bytes', async () => {
  assert.equal(await resolveMedia(sequenceDb(), {}, null), null);
  await assert.rejects(resolveMedia(sequenceDb(), {}, 'invalid-id'), {
    code: 'INVALID_MEDIA',
    status: 400
  });
  await assert.rejects(resolveMedia(sequenceDb([]), {}, media.id), {
    code: 'MEDIA_NOT_APPROVED'
  });
  await assert.rejects(
    resolveMedia(
      sequenceDb([media]),
      {
        async readPrivateObject() {
          return null;
        }
      },
      media.id
    ),
    { code: 'MEDIA_UNAVAILABLE' }
  );
});

test('batch media scope is applied in database selection and rejects foreign assets before reading bytes', async () => {
  const optionsDb = sequenceDb([]);
  assert.deepEqual(await mediaOptions(optionsDb, delivery.batch_id), []);
  assert.deepEqual(optionsDb.calls[0].parameters, [delivery.batch_id]);
  assert.match(
    optionsDb.calls[0].sql,
    /s\.batch_id=\$1::uuid AND s\.contribution_id=m\.contribution_id.*ORDER BY.*LIMIT 200/
  );
  const foreignDb = sequenceDb([]);
  await assert.rejects(
    resolveMedia(
      foreignDb,
      {
        readPrivateObject: async () => assert.fail('Foreign bytes are private')
      },
      media.id,
      delivery.batch_id
    ),
    { code: 'MEDIA_NOT_APPROVED' }
  );
  assert.deepEqual(foreignDb.calls[0].parameters, [
    media.id,
    delivery.batch_id
  ]);
  assert.match(
    foreignDb.calls[0].sql,
    /s\.batch_id=\$2::uuid AND s\.contribution_id=m\.contribution_id/
  );
  const ownDb = sequenceDb([media]);
  const bytes = imageBytes;
  assert.deepEqual(
    await resolveMedia(
      ownDb,
      { readPrivateObject: async () => bytes },
      media.id,
      delivery.batch_id
    ),
    mediaSnapshot
  );
  assert.deepEqual(ownDb.calls[0].parameters, [media.id, delivery.batch_id]);
});

test('scope-only approval check allows pending dossiers and skips editorial or absent media', async () => {
  const noSelection = sequenceDb();
  await assertMediaScope(noSelection, null, delivery.batch_id);
  await assertMediaScope(noSelection, media.id, null);
  assert.deepEqual(noSelection.calls, []);
  const ownDb = sequenceDb([{ id: media.id }]);
  await assertMediaScope(ownDb, media.id, delivery.batch_id);
  assert.deepEqual(ownDb.calls[0].parameters, [media.id, delivery.batch_id]);
  assert.equal(ownDb.calls[0].sql.includes('sponsor_review_status'), false);
  await assert.rejects(
    assertMediaScope(sequenceDb([]), media.id, delivery.batch_id),
    { code: 'MEDIA_NOT_APPROVED' }
  );
});

test('media metadata comparison is exact, including submillisecond timestamp versions', () => {
  const snapshot = mediaSnapshot;
  assert.equal(mediaSnapshotIssue(media.id, snapshot, { ...media }), null);
  assert.equal(mediaSnapshotIssue(null, null, undefined), null);
  assert.equal(
    mediaSnapshotIssue(media.id, snapshot, undefined),
    'MEDIA_NOT_APPROVED'
  );
  assert.equal(mediaSnapshotIssue(media.id, null, media), 'MEDIA_CHANGED');
  for (const change of [
    { version: '2030-01-01 12:00:00.123457+00' },
    { alt: `${media.alt} ` },
    { url: '/media/replacement' },
    { key: 'private/replacement' },
    { hash: digest('replacement') },
    { usage: { ...media.usage, state: 'withdrawn' } },
    { restrictionsReviewed: true }
  ])
    assert.equal(
      mediaSnapshotIssue(media.id, snapshot, { ...media, ...change }),
      'MEDIA_CHANGED'
    );
});

test('preflight checks connection and destination before loading source facts', async () => {
  for (const [changedFeed, code] of [
    [{ ...feed, configured: false }, 'CONNECTION_REQUIRED'],
    [{ ...feed, connection: 'error' }, 'CONNECTION_REQUIRED'],
    [{ ...feed, accountId: 'other-account' }, 'DESTINATION_CHANGED'],
    [{ ...feed, mode: 'live' }, 'DESTINATION_CHANGED']
  ]) {
    const db = sequenceDb();
    await assert.rejects(
      ready(db, delivery, {}, async () => [changedFeed]),
      { code }
    );
    assert.equal(db.calls.length, 0);
  }
});

test('preflight refuses changed source snapshots and revoked review independently', async () => {
  await assert.rejects(
    ready(
      authorizedDb({ rows: [{ ...eligible, body: 'Revised text' }] }),
      delivery,
      {},
      async () => [feed]
    ),
    { code: 'SOURCE_CHANGED' }
  );
  for (const changed of [
    { sponsor_review_status: 'pending_review', review_changed: true },
    { sponsor_review_status: 'approved', review_changed: true }
  ])
    await assert.rejects(
      ready(
        authorizedDb({ facts: [{ ...currentFacts, ...changed }] }),
        delivery,
        {},
        async () => [feed]
      ),
      { code: 'SPONSOR_REVIEW_REQUIRED' }
    );
});

test('preflight checks the authorized batch schedule and permits preparation without authorization', async () => {
  for (const batch of [
    { status: 'open' },
    { scheduled_at: new Date(delivery.scheduled_at.getTime() + 1) },
    { scheduled_at: null }
  ])
    await assert.rejects(
      ready(authorizedDb({ batch }), delivery, {}, async () => [feed]),
      { code: 'SOURCE_CHANGED' }
    );
  assert.equal(
    await ready(authorizedDb(), delivery, {}, async () => [feed]),
    null
  );
  assert.equal(
    await ready(
      sequenceDb(
        [{ status: 'open', capacity: 3 }],
        [],
        [eligible],
        [{ id: source.contribution_id, sponsor_company_name: 'Exemple' }]
      ),
      { ...delivery, approved_at: null },
      {},
      async () => [feed]
    ),
    null
  );
});

test('preflight refuses a complete source snapshot whose final message lost its beneficiary block', async () => {
  await assert.rejects(
    ready(
      authorizedDb(),
      {
        ...delivery,
        message: source.title
      },
      {},
      async () => [feed]
    ),
    { code: 'SOURCE_CONTENT_MISSING' }
  );
  await assert.rejects(
    ready(
      authorizedDb(),
      {
        ...delivery,
        message: '😀'.repeat(1450) + 'x'
      },
      {},
      async () => [feed]
    ),
    { code: 'INVALID_MESSAGE' }
  );
});

test('preflight blocks a previously authorized foreign image before reading bytes and permits an image from its batch', async () => {
  const bytes = imageBytes;
  const withImage = {
    ...delivery,
    media_id: media.id,
    media_snapshot: mediaSnapshot
  };
  const foreignDb = authorizedDb({ mediaRows: [] });
  await assert.rejects(
    ready(
      foreignDb,
      withImage,
      {
        readPrivateObject: async () =>
          assert.fail('A foreign asset must never be read before dispatch')
      },
      async () => [feed]
    ),
    { code: 'MEDIA_NOT_APPROVED' }
  );
  assert.deepEqual(foreignDb.calls.at(-1).parameters, [
    media.id,
    delivery.batch_id
  ]);
  const ownDb = authorizedDb({ mediaRows: [media] });
  const result = await ready(
    ownDb,
    withImage,
    { readPrivateObject: async () => bytes },
    async () => [feed]
  );
  assert.equal((await sharp(result).metadata()).format, 'jpeg');
  assert.deepEqual(ownDb.calls.at(-1).parameters, [
    media.id,
    delivery.batch_id
  ]);
});

test('preflight detects changed media bytes on either storage read before converting the approved image', async () => {
  const bytes = imageBytes;
  const snapshot = mediaSnapshot;
  const editorial = {
    ...delivery,
    batch_id: null,
    media_id: media.id,
    media_snapshot: snapshot
  };
  for (const storageReads of [
    [Buffer.from('replaced')],
    [bytes, Buffer.from('replaced')],
    [bytes, null]
  ])
    await assert.rejects(
      ready(
        sequenceDb([media]),
        editorial,
        {
          async readPrivateObject() {
            return storageReads.shift();
          }
        },
        async () => [feed]
      ),
      { code: 'MEDIA_CHANGED' }
    );
  let reads = 0;
  const jpeg = await ready(
    sequenceDb([media]),
    editorial,
    {
      async readPrivateObject(key) {
        assert.equal(key, media.key);
        reads++;
        return bytes;
      }
    },
    async () => [feed]
  );
  assert.equal(reads, 2);
  assert.equal((await sharp(jpeg).metadata()).format, 'jpeg');
});
