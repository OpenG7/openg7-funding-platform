import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import test from 'node:test';
import { readLocalMedia } from '../scripts/lib/recovery-media-reader.mjs';
import {
  mediaReferences,
  summarizeAudit
} from '../scripts/lib/recovery-audit.mjs';

test('media audit detects absence, corrupt bytes, traversal and symlinked directories without following them', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'og7-audit-media-'));
  t.after(async () => {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    assert.ok(directory.split(sep).pop().startsWith('og7-audit-media-'));
    await rm(directory, { recursive: true, force: true });
  });
  const root = join(directory, 'media'),
    outside = join(directory, 'outside');
  await mkdir(root);
  await mkdir(outside);
  await writeFile(join(root, 'valid.webp'), 'synthetic');
  await writeFile(join(outside, 'private.txt'), 'synthetic');
  await symlink(
    outside,
    join(root, 'link'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  const reference = {
    bytes: 9,
    sha256: createHash('sha256').update('synthetic').digest('hex')
  };
  const actual = await readLocalMedia(
    [
      { ...reference, path: 'valid.webp' },
      { ...reference, path: 'missing.webp' },
      { ...reference, path: 'valid.webp', sha256: '0'.repeat(64) },
      { ...reference, path: '../outside/private.txt' },
      { ...reference, path: 'link/private.txt' }
    ],
    root
  );
  assert.deepEqual(
    actual.map((r) => r.status),
    ['verified', 'missing', 'mismatch', 'unsafe_key', 'unreadable']
  );
});

const environment = {
  SPONSOR_MEDIA_STORAGE_DRIVER: 'ovh-s3',
  SPONSOR_MEDIA_PUBLIC_BASE_URL: 'https://target.example.test/public',
  FUNDING_PUBLIC_BASE_URL: 'https://target.example.test',
  SOCIAL_PUBLICATION_WORKER_ENABLED: 'true',
  FUNDING_EMAIL_WORKER_ENABLED: 'false',
  FUNDING_ADMIN_REVIEW_REMINDER_ENABLED: 'false'
};

test('audit flags stored source URLs without fetching them, honors the database worker override and never declares activation', () => {
  const snapshot = {
    readOnly: true,
    checks: {},
    review: {},
    queues: { emails: '2' },
    workerOverride: false,
    totals: [{ currency: 'usd', payment_gross_minor: '9007199254740993' }],
    logos: [
      {
        url: 'https://private.example.test/external-logo?token=fixture-private'
      }
    ],
    media: [
      {
        id: 'fixture',
        original_storage_key: 'original.webp',
        original_size_bytes: 9,
        processed_storage_key: 'processed.webp',
        processed_size_bytes: 9,
        checksum_sha256: 'a'.repeat(64),
        public_storage_key: 'processed.webp',
        public_url:
          'https://source.example.test/processed.webp?token=fixture-private'
      }
    ]
  };
  const media = mediaReferences(snapshot, environment);
  assert.equal(media.publicUrlReview, 1);
  assert.equal(media.externalLogos, 1);
  assert.equal(
    media.references[0].sha256,
    null,
    'database checksum belongs to processed media, not the original'
  );
  const report = summarizeAudit(
    snapshot,
    media,
    media.references.map(() => ({ status: 'verified' })),
    environment
  );
  assert.equal(report.integrity, 'passed');
  assert.equal(report.workers.social, false);
  assert.equal(report.activation, 'not-authorized');
  assert.equal(report.totals[0].payment_gross_minor, '9007199254740993');
  assert.equal(
    report.findings.find((f) => f.code === 'external_logos_not_checked').count,
    '1'
  );
  assert.doesNotMatch(
    JSON.stringify(report),
    /fixture-private|private.example|original.webp|processed.webp/
  );
  assert.throws(() =>
    summarizeAudit({ ...snapshot, readOnly: false }, media, [], environment)
  );
  assert.throws(() => summarizeAudit(snapshot, media, [], environment));
  const fromSource = {
    ...environment,
    FUNDING_PUBLIC_BASE_URL: 'https://source.example.test',
    SPONSOR_MEDIA_STORAGE_DRIVER: 'local'
  };
  const absoluteApi = {
    ...snapshot,
    logos: [],
    media: [
      {
        ...snapshot.media[0],
        public_url:
          'https://source.example.test/api/public/sponsor-media/fixture'
      }
    ]
  };
  const reviewed = mediaReferences(
    absoluteApi,
    fromSource,
    'https://target.example.test'
  );
  assert.equal(
    reviewed.publicUrlReview,
    1,
    'the archived source origin must not validate its own public URLs'
  );
  assert.equal(reviewed.originReview, true);
  absoluteApi.media[0].public_url =
    'https://target.example.test/api/public/sponsor-media/fixture';
  assert.equal(
    mediaReferences(absoluteApi, environment, 'https://target.example.test')
      .publicUrlReview,
    0
  );
});
