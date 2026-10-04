import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createHttpErrorHelpers,
  sponsorshipRefundConfirmationText
} from '../dist/apps/funding-api/src/business-helpers/http-errors.js';
import {
  createMediaExposureHelpers,
  sponsorLogoPublicUrlForFilename
} from '../dist/apps/funding-api/src/business-helpers/media-exposure.js';
import {
  amountToCents,
  createRequestValidationHelpers,
  hasOnlyKeys,
  isAllowedSponsorFeedChannel,
  isAllowedSponsorFeedTarget,
  isAllowedSponsorshipStripeRefundReason,
  isBoolean,
  isNonEmptySponsorText,
  isValidAdminExpectedVersion,
  isValidOptionalBoundedText,
  isValidOptionalHttpsUrl,
  isValidOptionalIsoDate,
  isValidOptionalNonEmptyBoundedText,
  isValidSponsorEmail,
  isValidUuid,
  normalizeAmount,
  SPONSOR_TEXT_MAX_LENGTH,
  SPONSOR_URL_MAX_LENGTH,
  STRIPE_METADATA_VALUE_MAX_LENGTH,
  truncateStripeMetadataValue
} from '../dist/apps/funding-api/src/business-helpers/request-validation.js';

const origin = 'https://funding.example.test';
const contributionId = '00000000-0000-4000-8000-000000000001';
const assetId = '00000000-0000-4000-8000-000000000002';
const filename = `sponsor-logo-${contributionId}-1727188800000-0123456789abcdef.png`;
const asset = {
  id: assetId,
  contributionId,
  checksumSha256: '0123456789abcdef'.repeat(4),
  originalStorageKey: 'private/synthetic-original.png',
  processedStorageKey: 'private/synthetic-processed.webp',
  publicStorageKey: 'public/synthetic.webp'
};

const mediaFixture = ({
  logoDelete,
  privateDelete,
  publicDelete,
  publicUrl
} = {}) => {
  const calls = [];
  const warnings = [];
  const helpers = createMediaExposureHelpers({
    publicBaseOrigin: origin,
    sponsorLogoStorage: {
      deleteLogo: async (name) => {
        calls.push(['logo', name]);
        return logoDelete ? logoDelete(name) : true;
      }
    },
    sponsorMediaStorage: {
      driver: 'local',
      publicUrl: (key) => {
        calls.push(['url', key]);
        return publicUrl ? publicUrl(key) : null;
      },
      deletePrivateObject: async (key) => {
        calls.push(['private', key]);
        return privateDelete ? privateDelete(key) : true;
      },
      deletePublicObject: async (key) => {
        calls.push(['public', key]);
        return publicDelete ? publicDelete(key) : true;
      }
    },
    reportWarning: (...args) => warnings.push(args)
  });
  return { ...helpers, calls, warnings };
};

test('controlled logo parsing retains aliases and URL pathname semantics', () => {
  const f = mediaFixture();
  for (const prefix of [
    '/api/public/sponsor-logos/',
    '/public/sponsor-logos/'
  ]) {
    assert.equal(
      f.getSponsorLogoFilenameFromUrl(`${prefix}${filename}`),
      filename
    );
    assert.equal(
      f.getSponsorLogoFilenameFromUrl(
        `${origin}${prefix}${filename}?download=1`
      ),
      filename
    );
    assert.equal(
      f.getSponsorLogoFilenameFromUrl(`${prefix}%73${filename.slice(1)}`),
      filename
    );
  }
  assert.equal(
    f.getSponsorLogoFilenameFromUrl(
      `https://cdn.example.test/public/sponsor-logos/${filename}`
    ),
    filename
  );
  assert.equal(f.getSponsorLogoFilenameFromUrl('/public/sponsor-logos/'), '');
  for (const url of [
    undefined,
    '',
    '/private/logo.png',
    '/public/sponsor-logos/%ZZ',
    'http://[invalid'
  ]) {
    assert.equal(f.getSponsorLogoFilenameFromUrl(url), null);
  }
  assert.equal(
    sponsorLogoPublicUrlForFilename(filename),
    `/api/public/sponsor-logos/${filename}`
  );
  assert.deepEqual(f.calls, []);
});

test('controlled logo deletion refuses unsafe decoded filenames before storage', async () => {
  const f = mediaFixture();
  for (const url of [
    null,
    '',
    '/private/logo.png',
    '/api/public/sponsor-logos/',
    '/api/public/sponsor-logos/%ZZ',
    '/api/public/sponsor-logos/%2e%2e%2fsecret.png',
    `/api/public/sponsor-logos/${filename}%2fextra`,
    `/api/public/sponsor-logos/${filename.replace('.png', '.svg')}`
  ]) {
    assert.equal(await f.deleteControlledSponsorLogoFile(url), false);
  }
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.warnings, []);
  assert.equal(
    await f.deleteControlledSponsorLogoFile(
      `/public/sponsor-logos/${filename}`
    ),
    true
  );
  assert.deepEqual(f.calls, [['logo', filename]]);
});

test('controlled logo deletion preserves false results and reports a failure once', async () => {
  const missing = mediaFixture({ logoDelete: () => false });
  assert.equal(
    await missing.deleteControlledSponsorLogoFile(
      sponsorLogoPublicUrlForFilename(filename)
    ),
    false
  );
  assert.deepEqual(missing.warnings, []);

  const error = new Error('Synthetic logo storage failure.');
  const failed = mediaFixture({ logoDelete: () => Promise.reject(error) });
  assert.equal(
    await failed.deleteControlledSponsorLogoFile(
      sponsorLogoPublicUrlForFilename(filename)
    ),
    false
  );
  assert.deepEqual(failed.calls, [['logo', filename]]);
  assert.deepEqual(failed.warnings, [
    ['Failed to delete controlled sponsor logo object.', error]
  ]);
});

test('asset routes require a complete decoded UUID under a caller-owned prefix', () => {
  const f = mediaFixture();
  const prefixes = ['/api/public/sponsor-media/', '/public/sponsor-media/'];
  for (const prefix of prefixes) {
    assert.equal(
      f.routeAssetId(`${prefix}${assetId}?token=synthetic`, ...prefixes),
      assetId
    );
    assert.equal(
      f.routeAssetId(`${prefix}%30${assetId.slice(1)}`, ...prefixes),
      assetId
    );
  }
  assert.equal(
    f.routeAssetId(
      `/public/sponsor-media/${assetId.toUpperCase()}`,
      ...prefixes
    ),
    assetId.toUpperCase()
  );
  for (const url of [
    undefined,
    '',
    `/private/sponsor-media/${assetId}`,
    '/public/sponsor-media/%ZZ',
    `/public/sponsor-media/${assetId}/content`,
    '/public/sponsor-media/%2e%2e%2fprivate',
    'http://[invalid'
  ]) {
    assert.equal(f.routeAssetId(url, ...prefixes), null);
  }
  assert.equal(f.routeAssetId(`/public/sponsor-media/${assetId}`), null);
  assert.deepEqual(f.calls, []);
});

test('media URLs always use the controlled API route regardless of storage provider output', () => {
  for (const publicUrl of [
    undefined,
    () => 'https://cdn.example.test/synthetic.webp',
    () => ''
  ]) {
    const f = mediaFixture({ publicUrl });
    assert.equal(
      f.sponsorMediaPublicUrl(assetId),
      '/api/public/sponsor-media/' + assetId
    );
    assert.deepEqual(f.calls, []);
  }
});

test('media cleanup always removes both private objects and controls the public deletion', async () => {
  for (const [includePublic, publicStorageKey, expectedPublic] of [
    [false, asset.publicStorageKey, []],
    [true, null, []],
    [true, '', []],
    [true, asset.publicStorageKey, [['public', asset.publicStorageKey]]]
  ]) {
    const f = mediaFixture();
    await f.deleteSponsorMediaObjects(
      { ...asset, publicStorageKey },
      { includePublic }
    );
    assert.deepEqual(f.calls, [
      ['private', asset.originalStorageKey],
      ['private', asset.processedStorageKey],
      ...expectedPublic
    ]);
    assert.deepEqual(f.warnings, []);
  }
});

test('partially failed cleanup waits for all objects and remains best effort', async () => {
  let finishProcessed;
  const processed = new Promise((resolve) => {
    finishProcessed = resolve;
  });
  const f = mediaFixture({
    privateDelete: (key) =>
      key === asset.originalStorageKey
        ? Promise.reject(new Error('Synthetic private failure.'))
        : processed,
    publicDelete: () => Promise.reject(new Error('Synthetic public failure.'))
  });
  let completed = false;
  const cleanup = f
    .deleteSponsorMediaObjects(asset, { includePublic: true })
    .then(() => {
      completed = true;
    });
  assert.deepEqual(f.calls, [
    ['private', asset.originalStorageKey],
    ['private', asset.processedStorageKey],
    ['public', asset.publicStorageKey]
  ]);
  await Promise.resolve();
  assert.equal(completed, false);
  assert.deepEqual(f.warnings, []);
  finishProcessed(true);
  await cleanup;
  assert.equal(completed, true);
  assert.deepEqual(f.warnings, [
    [
      'One or more sponsor media objects could not be deleted.',
      { assetId, storageDriver: 'local' }
    ]
  ]);

  const missing = mediaFixture({
    privateDelete: () => false,
    publicDelete: () => false
  });
  await missing.deleteSponsorMediaObjects(asset, { includePublic: true });
  assert.deepEqual(missing.warnings, []);
});

test('request text validation preserves optional null, blank and trimmed bounds', () => {
  assert.equal(isBoolean(false), true);
  assert.equal(isBoolean('false'), false);
  for (const value of [undefined, null, '', '   ']) {
    assert.equal(isNonEmptySponsorText(value, 3), false);
    assert.equal(isValidOptionalBoundedText(value, 3), true);
    assert.equal(
      isValidOptionalNonEmptyBoundedText(value, 3),
      value === undefined
    );
  }
  for (const check of [
    isNonEmptySponsorText,
    isValidOptionalBoundedText,
    isValidOptionalNonEmptyBoundedText
  ]) {
    assert.equal(check('  abc  ', 3), true);
    assert.equal(check('abcd', 3), false);
    assert.equal(check(123, 3), false);
  }
  assert.equal(hasOnlyKeys({ amount: 25 }, ['amount']), true);
  assert.equal(hasOnlyKeys({}, ['amount']), true);
  for (const value of [null, [], 'amount', { amount: 25, extra: true }]) {
    assert.equal(hasOnlyKeys(value, ['amount']), false);
  }
  assert.equal(isValidSponsorEmail(' sponsor@example.test '), true);
  assert.equal(
    isValidSponsorEmail(
      `sponsor@example.test${' '.repeat(SPONSOR_TEXT_MAX_LENGTH)}`
    ),
    false
  );
  assert.equal(isValidSponsorEmail('sponsor@example.test\n'), false);
  assert.equal(
    truncateStripeMetadataValue(
      'a'.repeat(STRIPE_METADATA_VALUE_MAX_LENGTH + 1)
    ),
    'a'.repeat(STRIPE_METADATA_VALUE_MAX_LENGTH)
  );
});

test('request URL, enum, date and version checks retain their existing acceptance rules', () => {
  for (const value of [
    undefined,
    null,
    '',
    ' ',
    'https://company.example.test/'
  ])
    assert.equal(isValidOptionalHttpsUrl(value), true);
  for (const value of [
    false,
    'http://company.example.test/',
    'https://localhost/',
    'https://company.example.test/' + 'a'.repeat(SPONSOR_URL_MAX_LENGTH)
  ])
    assert.equal(isValidOptionalHttpsUrl(value), false);
  const { isAllowedContributionType } = createRequestValidationHelpers({
    allowedContributionTypes: new Set(['personal'])
  });
  assert.equal(isAllowedContributionType('personal'), true);
  assert.equal(isAllowedContributionType('sponsorship_interest'), false);
  assert.equal(isAllowedContributionType(null), false);
  for (const value of [undefined, null, '', 'openg7', 'openg20'])
    assert.equal(isAllowedSponsorFeedTarget(value), true);
  for (const value of [false, 'unknown', ' openg7 '])
    assert.equal(isAllowedSponsorFeedTarget(value), false);
  for (const value of ['facebook', 'linkedin'])
    assert.equal(isAllowedSponsorFeedChannel(value), true);
  for (const value of [undefined, null, '', 'unknown'])
    assert.equal(isAllowedSponsorFeedChannel(value), false);
  for (const value of ['requested_by_customer', 'duplicate', 'fraudulent'])
    assert.equal(isAllowedSponsorshipStripeRefundReason(value), true);
  for (const value of [undefined, null, '', 'other'])
    assert.equal(isAllowedSponsorshipStripeRefundReason(value), false);
  for (const value of [
    undefined,
    null,
    '',
    '2026-10-04T12:00:00.000Z',
    'October 4, 2026'
  ])
    assert.equal(isValidOptionalIsoDate(value), true);
  for (const value of [123, 'not-a-date'])
    assert.equal(isValidOptionalIsoDate(value), false);
  assert.equal(isValidUuid(assetId), true);
  assert.equal(isValidUuid('ABCDEF12-1234-1234-1234-123456ABCDEF'), true);
  assert.equal(isValidUuid(assetId + '/content'), false);
  assert.equal(isValidAdminExpectedVersion('  version  '), true);
  assert.equal(isValidAdminExpectedVersion('a'.repeat(128)), true);
  for (const value of [undefined, null, '', '   ', 'a'.repeat(129), 123])
    assert.equal(isValidAdminExpectedVersion(value), false);
});

test('amount conversion retains decimal rounding and minor-unit conversion', () => {
  assert.equal(normalizeAmount(25.126), 25.13);
  assert.equal(normalizeAmount(25.124), 25.12);
  assert.equal(amountToCents(normalizeAmount(25.126)), 2513);
  assert.equal(amountToCents(25.125), 2513);
  assert.equal(amountToCents(0), 0);
});

const httpFixture = () => {
  const calls = [];
  const request = { headers: {} };
  const response = {};
  const helpers = createHttpErrorHelpers({
    writeJson: (...args) => calls.push(args)
  });
  return { ...helpers, calls, request, response };
};

test('media mutation failures keep transport status, error codes and messages', () => {
  for (const [status, statusCode, payload] of [
    [
      'not_editable',
      409,
      {
        code: 'SPONSORSHIP_NOT_EDITABLE',
        error: 'Sponsorship is not editable.'
      }
    ],
    [
      'conflict',
      409,
      {
        code: 'SPONSOR_MEDIA_CONCURRENT_UPDATE',
        error: 'Ce media a ete modifie. Rechargez la fiche puis reessayez.'
      }
    ],
    [
      'approved_locked',
      409,
      {
        code: 'SPONSOR_MEDIA_APPROVED',
        error: "Un media approuve doit etre retire par l'administrateur."
      }
    ],
    ['not_found', 404, { error: 'Sponsor media was not found.' }]
  ]) {
    const f = httpFixture();
    f.writeSponsorMediaMutationFailure(f.request, f.response, status);
    assert.deepEqual(f.calls, [[f.request, f.response, statusCode, payload]]);
  }
});

test('sponsorship mutation failures preserve nullable concurrency and payment details', () => {
  for (const details of [
    undefined,
    {},
    { currentVersion: null },
    { currentVersion: 'synthetic-version' }
  ]) {
    const f = httpFixture();
    f.writeSponsorshipMutationFailure(
      f.request,
      f.response,
      'conflict',
      details
    );
    assert.deepEqual(f.calls, [
      [
        f.request,
        f.response,
        409,
        {
          code: 'SPONSORSHIP_CONCURRENT_UPDATE',
          message:
            'Cette commandite a ete modifiee par un autre administrateur.',
          currentVersion: details?.currentVersion ?? null
        }
      ]
    ]);
  }
  for (const paymentStatus of [undefined, null, 'refunded', 'disputed']) {
    const f = httpFixture();
    f.writeSponsorshipMutationFailure(
      f.request,
      f.response,
      'payment_not_eligible',
      { paymentStatus }
    );
    assert.deepEqual(f.calls, [
      [
        f.request,
        f.response,
        409,
        {
          code: 'SPONSORSHIP_PAYMENT_NOT_ELIGIBLE',
          message:
            'Cette commandite ne peut pas etre publiee ou approuvee lorsque le paiement est rembourse ou conteste.',
          paymentStatus: paymentStatus ?? null
        }
      ]
    ]);
  }
  const mediaRequired = httpFixture();
  mediaRequired.writeSponsorshipMutationFailure(
    mediaRequired.request,
    mediaRequired.response,
    'media_required'
  );
  assert.deepEqual(mediaRequired.calls, [
    [
      mediaRequired.request,
      mediaRequired.response,
      409,
      {
        code: 'SPONSORSHIP_PRESENTATION_PHOTO_REQUIRED',
        message:
          "Une photo de presentation approuvee est requise avant d'approuver cette commandite."
      }
    ]
  ]);
  for (const status of ['not_found', 'updated']) {
    const f = httpFixture();
    f.writeSponsorshipMutationFailure(f.request, f.response, status);
    assert.deepEqual(f.calls, [
      [
        f.request,
        f.response,
        404,
        { error: 'Sponsorship contribution was not found.' }
      ]
    ]);
  }
});

test('refund refusal messages distinguish refunded, disputed and other payment states', () => {
  for (const [paymentStatus, message] of [
    ['refunded', 'Cette commandite est deja marquee comme remboursee.'],
    [
      'disputed',
      'Cette commandite est contestee; traitez le dossier dans Stripe.'
    ],
    [
      'pending',
      'Cette commandite ne peut pas etre remboursee automatiquement.'
    ],
    [null, 'Cette commandite ne peut pas etre remboursee automatiquement.']
  ]) {
    const f = httpFixture();
    f.writeSponsorshipRefundIneligible(f.request, f.response, paymentStatus);
    assert.deepEqual(f.calls, [
      [
        f.request,
        f.response,
        409,
        { code: 'SPONSORSHIP_REFUND_NOT_ELIGIBLE', message, paymentStatus }
      ]
    ]);
  }
  assert.equal(
    sponsorshipRefundConfirmationText({
      publicReference: 'OG7-2026-SYNTHETIC',
      id: contributionId
    }),
    'OG7-2026-SYNTHETIC'
  );
  assert.equal(
    sponsorshipRefundConfirmationText({
      publicReference: null,
      id: contributionId
    }),
    contributionId
  );
  assert.equal(
    sponsorshipRefundConfirmationText({
      publicReference: '',
      id: contributionId
    }),
    ''
  );
});
