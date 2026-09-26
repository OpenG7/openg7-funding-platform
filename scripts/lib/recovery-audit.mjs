import { safeKey } from './recovery-media-reader.mjs';

// No URL is fetched. Database URLs and object keys never appear in the output report.
export function mediaReferences(snapshot, environment, expectedOrigin = null) {
  if (snapshot.media.length > 10000 || snapshot.logos.length > 10000)
    throw new Error('Media reference limit exceeded.');
  const references = [];
  let publicUrlReview = 0,
    externalLogos = 0;
  for (const asset of snapshot.media) {
    for (const [role, key, bytes, sha256] of [
      ['private', asset.original_storage_key, asset.original_size_bytes, null],
      [
        'private',
        asset.processed_storage_key,
        asset.processed_size_bytes,
        asset.checksum_sha256
      ],
      ...(asset.public_storage_key
        ? [
            [
              'public',
              asset.public_storage_key,
              asset.processed_size_bytes,
              asset.checksum_sha256
            ]
          ]
        : [])
    ])
      references.push({
        role,
        key,
        path: `media-assets/${role}/${key}`,
        bytes,
        sha256
      });
    if (asset.public_url) {
      const apiPath = '/api/public/sponsor-media/' + asset.id;
      const stored = asset.public_url;
      const expectedS3 =
        environment.SPONSOR_MEDIA_PUBLIC_BASE_URL +
        '/' +
        String(asset.public_storage_key)
          .split('/')
          .map(encodeURIComponent)
          .join('/');
      const expectedApi = expectedOrigin
        ? new URL(apiPath, expectedOrigin).href
        : null;
      if (
        ![
          apiPath,
          expectedApi,
          ...(environment.SPONSOR_MEDIA_STORAGE_DRIVER === 'ovh-s3'
            ? [expectedS3]
            : [])
        ].includes(stored)
      )
        publicUrlReview++;
    }
  }
  for (const logo of snapshot.logos) {
    try {
      const url = new URL(logo.url, environment.FUNDING_PUBLIC_BASE_URL);
      const match = /^\/(?:api\/)?public\/sponsor-logos\/(.+)$/.exec(
        url.pathname
      );
      if (!match) {
        externalLogos++;
        continue;
      }
      const key = decodeURIComponent(match[1]);
      references.push({
        role: 'private',
        key: 'sponsor-logos/' + key,
        path: key,
        bytes: null,
        sha256: null
      });
      if (
        !(logo.url.startsWith('/') && !logo.url.startsWith('//')) &&
        (!expectedOrigin || url.origin !== expectedOrigin)
      )
        publicUrlReview++;
    } catch {
      externalLogos++;
    }
  }
  if (references.length > 30000)
    throw new Error('Media object limit exceeded.');
  return {
    references,
    publicUrlReview,
    externalLogos,
    originReview:
      !expectedOrigin ||
      new URL(environment.FUNDING_PUBLIC_BASE_URL).origin !== expectedOrigin
  };
}

export function summarizeAudit(snapshot, media, results, environment) {
  if (!snapshot.readOnly || results.length !== media.references.length)
    throw new Error('Incomplete read-only evidence.');
  const findings = [];
  const add = (code, count, severity) => {
    if (BigInt(count) > 0n)
      findings.push({ code, count: String(count), severity });
  };
  for (const [code, count] of Object.entries(snapshot.checks))
    add(code, count, 'error');
  for (const [code, count] of Object.entries(snapshot.review))
    add(code, count, 'review');
  for (const [code, count] of Object.entries(snapshot.queues))
    add('queue_' + code, count, 'review');
  const statuses = [
    'verified',
    'missing',
    'mismatch',
    'unreadable',
    'unsafe_key',
    'limit'
  ];
  if (results.some((r) => !statuses.includes(r.status)))
    throw new Error('Unknown media result.');
  const objects = Object.fromEntries(
    statuses.map((status) => [
      status,
      results.filter((r) => r.status === status).length
    ])
  );
  for (const status of statuses.slice(1))
    add('media_' + status, objects[status], 'error');
  add('media_public_url_reconciliation', media.publicUrlReview, 'review');
  add(
    'application_origin_reconciliation',
    Number(media.originReview),
    'review'
  );
  add('external_logos_not_checked', media.externalLogos, 'review');
  const bool = (value, fallback) => {
    if (value === undefined || value.trim() === '') return fallback;
    if (['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase()))
      return true;
    if (['false', '0', 'no', 'off'].includes(value.trim().toLowerCase()))
      return false;
    return 'unknown';
  };
  const workers = {
    email: bool(environment.FUNDING_EMAIL_WORKER_ENABLED, true),
    reviewReminder: bool(
      environment.FUNDING_ADMIN_REVIEW_REMINDER_ENABLED,
      true
    ),
    social:
      snapshot.workerOverride ??
      environment.SOCIAL_PUBLICATION_WORKER_ENABLED === 'true',
    socialOverride: snapshot.workerOverride,
    operations: bool(environment.FUNDING_OPERATIONS_WATCHER_ENABLED, false)
  };
  for (const [name, value] of Object.entries(workers)) {
    if (name !== 'socialOverride' && value !== false)
      add('worker_' + name + '_requires_review', 1, 'review');
  }
  return {
    integrity: findings.some((f) => f.severity === 'error')
      ? 'failed'
      : 'passed',
    activation: 'not-authorized',
    readOnlyTransaction: true,
    totals: snapshot.totals,
    media: { checked: results.length, ...objects },
    queues: snapshot.queues,
    workers,
    findings,
    reconciliationRequired: [
      'stripe-provider-state',
      'email-and-social-delivery-outcomes',
      'admin-access-and-sessions',
      'public-urls-and-storage-access',
      'browser-and-pdf-checks'
    ]
  };
}

export { safeKey };
