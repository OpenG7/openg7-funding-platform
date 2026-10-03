import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test from 'node:test';

import { AdminSponsorHistoryProjection } from '../dist/apps/funding-web/src/app/features/funding/models/admin-sponsor-history.projection.js';

// The root tsc build emits workspace code under dist/packages, while the package
// manifest points at its separate dist directory. Resolve only this public import.
const coreUrl = new URL(
  '../dist/packages/funding-core/src/index.js',
  import.meta.url
).href;
const workspaceResolution = registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier === '@openg7/funding-core'
      ? { url: coreUrl, shortCircuit: true }
      : nextResolve(specifier, context);
  }
});
let AdminSponsorPresentationProjection;
try {
  ({ AdminSponsorPresentationProjection } =
    await import('../dist/apps/funding-web/src/app/features/funding/models/admin-sponsor-presentation.projection.js'));
} finally {
  workspaceResolution.deregister();
}

const dictionaries = Object.fromEntries(
  ['fr-CA', 'en'].map((locale) => [
    locale,
    JSON.parse(
      readFileSync(`apps/funding-web/src/assets/i18n/${locale}.json`, 'utf8')
    )
  ])
);

function fixture(initialLocale = 'fr-CA') {
  let locale = initialLocale;
  const mediaCalls = [];
  const presentation = {
    t(key, params = {}) {
      const value = key
        .split('.')
        .reduce((current, part) => current?.[part], dictionaries[locale]);
      assert.equal(
        typeof value,
        'string',
        `Missing ${locale} translation: ${key}`
      );
      return value.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name) =>
        String(params[name])
      );
    },
    currentLanguage: () => locale,
    formatAmount: (amount, currency) =>
      new Intl.NumberFormat(locale, { style: 'currency', currency }).format(
        amount
      ),
    dateOnlyLabel: (value) => value || 'not-available',
    paymentStatusLabel: (status) => `payment:${status}`,
    reviewStatusLabel: (status) => `review:${status}`,
    feedStatusLabel: (status) => `feed:${status}`,
    media: {
      sponsorMediaStatusLabel(status) {
        mediaCalls.push(['status', status]);
        return `media:${status}`;
      },
      formatMediaSize(bytes) {
        mediaCalls.push(['size', bytes]);
        return `media-bytes:${bytes}`;
      }
    }
  };
  presentation.history = new AdminSponsorHistoryProjection(presentation);
  return {
    projection: new AdminSponsorPresentationProjection(presentation),
    presentation,
    mediaCalls,
    setLocale: (next) => {
      locale = next;
    }
  };
}

function sponsorship(overrides = {}) {
  return {
    id: 'synthetic-sponsor',
    version: 'synthetic-version-3',
    amount: 250,
    currency: 'CAD',
    payment_status: 'paid',
    paid_at: null,
    created_at: '2026-09-01T12:00:00.000Z',
    sponsor_details_submitted_at: null,
    sponsor_company_name: 'Synthetic Company',
    sponsor_contact_name: null,
    sponsor_contact_email: null,
    sponsor_website_url: null,
    sponsor_logo_url: null,
    sponsor_message: null,
    sponsor_review_notes: 'Synthetic saved note',
    sponsor_review_status: 'pending_review',
    sponsor_reviewed_at: null,
    sponsor_feed_status: 'not_planned',
    sponsor_feed_target: null,
    sponsor_feed_channels: [],
    public_display_consent: false,
    public_name: null,
    public_reference: null,
    sponsorship_refund_status: 'not_requested',
    sponsorship_refund_id: null,
    ...overrides
  };
}

function overviewState(overrides = {}) {
  return {
    copyMessage: '',
    reviewNote: '',
    reviewNoteDirty: false,
    reviewNoteStateLabel: '',
    reviewNoteSaving: false,
    ...overrides
  };
}

function identityState(overrides = {}) {
  return {
    disabled: false,
    logoPreviewSource: null,
    logoMessage: '',
    mediaAssets: [],
    mediaPreviewUrls: {},
    mediaMessage: undefined,
    ...overrides
  };
}

function mediaAsset(id, overrides = {}) {
  return {
    id,
    version: `${id}-synthetic-version`,
    kind: 'supporting_image',
    reviewStatus: 'pending_review',
    altText: null,
    width: 800,
    height: 600,
    processedSizeBytes: 1024,
    ...overrides
  };
}

test('list presentation preserves processing precedence without changing financial or publication states', () => {
  const { projection } = fixture();
  const cases = [
    [
      { sponsor_review_status: 'rejected', payment_status: 'pending' },
      'blocked'
    ],
    [
      {
        sponsorship_refund_status: 'processing',
        sponsor_feed_status: 'published'
      },
      'blocked'
    ],
    ...['refunded', 'disputed', 'failed'].map((payment_status) => [
      { payment_status },
      'blocked'
    ]),
    [
      { payment_status: 'pending', sponsor_feed_status: 'published' },
      'waiting-payment'
    ],
    [{ sponsor_feed_status: 'published' }, 'action-required'],
    [
      { sponsor_review_status: 'approved', sponsor_feed_status: 'published' },
      'published'
    ],
    ...['planned', 'drafted'].map((sponsor_feed_status) => [
      { sponsor_review_status: 'approved', sponsor_feed_status },
      'publication-progress'
    ]),
    [
      {
        sponsor_review_status: 'approved',
        sponsorship_refund_status: 'requested'
      },
      'approved-ready'
    ]
  ];
  for (const [overrides, state] of cases) {
    const record = Object.freeze(sponsorship(overrides));
    const before = structuredClone(record);
    const row = projection.listRow(record);
    assert.equal(row.rowStateClass, `sponsor-row-state-${state}`);
    assert.ok(row.processingLabel.trim());
    assert.deepEqual(record, before);
  }
});

test('consent presentation remains distinct from paid status, approval and website visibility', () => {
  const { projection, presentation } = fixture();
  const record = sponsorship({
    sponsor_review_status: 'approved',
    public_name: 'Synthetic Public Name',
    sponsor_website_visible: true
  });
  const row = projection.listRow(record);
  assert.equal(row.paymentStatusLabel, 'payment:paid');
  assert.equal(row.reviewStatusLabel, 'review:approved');
  assert.equal(
    row.visibilityLabel,
    presentation.t('admin.dossier.consentMissing')
  );
  assert.equal(row.visibilityClass, 'visibility-badge visibility-hidden');
  assert.equal(
    projection.publicNameLabel(record),
    presentation.t('admin.messages.non_consenti')
  );
  const consented = {
    ...record,
    public_display_consent: true,
    sponsor_website_visible: false
  };
  assert.equal(
    projection.header(consented).visibilityLabel,
    presentation.t('admin.dossier.consentGranted')
  );
  assert.equal(projection.publicNameLabel(consented), 'Synthetic Public Name');
  assert.equal(
    projection.publicNameLabel({ ...consented, public_name: null }),
    'Consenti, nom manquant'
  );
});

test('partial dossier fields retain name, date and contact fallbacks across list and header', () => {
  const { projection, presentation } = fixture();
  const record = sponsorship({
    sponsor_company_name: '',
    sponsor_contact_name: 'Synthetic Contact'
  });
  const row = projection.listRow(record);
  const header = projection.header(record);
  assert.equal(row.initials, 'SC');
  assert.equal(header.initials, 'SC');
  assert.equal(
    row.companyName,
    presentation.t('admin.messages.entreprise_sans_nom')
  );
  assert.equal(
    row.contactEmail,
    presentation.t('admin.messages.courriel_non_fourni')
  );
  assert.equal(
    header.publicReferenceLabel,
    presentation.t('admin.legacy.non_attribuee_175')
  );
  assert.equal(header.reviewedAtLabel, 'not-available');
  assert.equal(row.submittedAtLabel, record.created_at);
  assert.equal(
    projection.header({ ...record, paid_at: '2026-09-02T12:00:00.000Z' })
      .submittedAtLabel,
    '2026-09-02T12:00:00.000Z'
  );
  assert.equal(
    projection.listRow({
      ...record,
      paid_at: '2026-09-02T12:00:00.000Z',
      sponsor_details_submitted_at: '2026-09-03T12:00:00.000Z'
    }).submittedAtLabel,
    '2026-09-03T12:00:00.000Z'
  );
  assert.equal(
    projection.initialsFor({
      ...record,
      sponsor_contact_name: '',
      public_reference: 'SYNTHETIC-001'
    }),
    'S'
  );
  assert.equal(
    projection.initialsFor({
      ...record,
      sponsor_contact_name: '',
      public_reference: null
    }),
    'O'
  );
  assert.equal(
    projection.initialsFor({
      ...record,
      sponsor_company_name: '   ',
      sponsor_contact_name: ''
    }),
    'OG'
  );
});

test('overview preserves edited notes and page messages while delegating refund history', () => {
  const { projection, presentation } = fixture();
  const record = Object.freeze(
    sponsorship({
      sponsorship_refund_status: 'failed',
      sponsorship_refund_id: 're_synthetic',
      sponsor_message: 'Synthetic sponsor message'
    })
  );
  const state = Object.freeze(
    overviewState({
      copyMessage: 'Synthetic copied message',
      reviewNote: '  Unsaved synthetic note  ',
      reviewNoteDirty: true,
      reviewNoteStateLabel: 'Synthetic save failed message',
      reviewNoteSaving: true
    })
  );
  const before = structuredClone({ record, state });
  const overview = projection.overview(record, state);
  for (const key of Object.keys(state)) assert.equal(overview[key], state[key]);
  assert.equal(overview.sponsorMessage, record.sponsor_message);
  assert.equal(overview.refundId, 're_synthetic');
  assert.equal(overview.hasRefundWorkflow, true);
  assert.equal(
    overview.refundStatusClass,
    presentation.history.refundWorkflowStatusClass('failed')
  );
  assert.equal(
    overview.refundStatusLabel,
    presentation.history.refundWorkflowStatusLabel('failed')
  );
  assert.equal(
    overview.refundWorkflowTimelineLabel,
    presentation.history.refundWorkflowTimelineLabel(record)
  );
  assert.equal(
    projection.listRow(record).refundWorkflowStatusLabel,
    overview.refundStatusLabel
  );
  assert.equal(
    projection.header(record).refundWorkflowStatusClass,
    overview.refundStatusClass
  );
  assert.deepEqual({ record, state }, before);
  const empty = projection.overview(sponsorship(), overviewState());
  assert.equal(empty.contactName, presentation.t('admin.legacy.non_fourni'));
  for (const key of [
    'contactEmail',
    'websiteUrl',
    'publicReference',
    'refundId',
    'sponsorMessage'
  ])
    assert.equal(empty[key], null);
  assert.equal(
    projection.listRow(sponsorship()).refundWorkflowStatusClass,
    null
  );
  assert.equal(
    projection.header(sponsorship()).refundWorkflowStatusLabel,
    null
  );
});

test('identity creates immutable media views with owner formatting, versions and separate busy state', () => {
  const { projection, presentation, mediaCalls } = fixture();
  const record = Object.freeze(
    sponsorship({
      sponsor_logo_url: '/api/public/sponsor-logos/synthetic-sponsor'
    })
  );
  const assets = Object.freeze([
    Object.freeze(
      mediaAsset('synthetic-logo', {
        kind: 'logo',
        reviewStatus: 'approved',
        altText: 'Synthetic logo'
      })
    ),
    Object.freeze(mediaAsset('synthetic-photo')),
    Object.freeze(
      mediaAsset('synthetic-refused-photo', { reviewStatus: 'rejected' })
    )
  ]);
  const state = Object.freeze(
    identityState({
      disabled: true,
      logoPreviewSource: 'blob:synthetic-logo-preview',
      logoMessage: 'Synthetic logo failure',
      mediaAssets: assets,
      mediaPreviewUrls: Object.freeze({
        'synthetic-photo': 'blob:synthetic-photo-preview'
      }),
      mediaMessage: 'Synthetic media message'
    })
  );
  const before = structuredClone({ record, state });
  const identity = projection.identity(record, state);
  assert.equal(
    identity.logoActionLabel,
    presentation.t('admin.messages.remplacer_le_logo')
  );
  assert.equal(identity.logoPreviewSource, state.logoPreviewSource);
  assert.equal(identity.statusMessage, state.logoMessage);
  assert.equal(identity.mediaMessage, state.mediaMessage);
  assert.equal(identity.uploadDisabled, true);
  assert.equal(identity.deleteDisabled, true);
  assert.equal(identity.mediaBusy, true);
  assert.equal(identity.approvableMediaCount, 2);
  assert.deepEqual(
    identity.mediaAssets.map(({ id, version }) => [id, version]),
    assets.map(({ id, version }) => [id, version])
  );
  assert.equal(
    identity.mediaAssets[0].kindLabel,
    presentation.t('admin.messages.logo_propose')
  );
  assert.equal(
    identity.mediaAssets[1].kindLabel,
    presentation.t('admin.messages.photo_de_presentation')
  );
  assert.equal(identity.mediaAssets[0].previewSource, null);
  assert.equal(
    identity.mediaAssets[1].previewSource,
    'blob:synthetic-photo-preview'
  );
  assert.equal(identity.mediaAssets[1].altText, '');
  assert.equal(identity.mediaAssets[1].dimensionsLabel, '800 x 600 px');
  assert.equal(
    identity.mediaAssets[1].reviewStatusLabel,
    'media:pending_review'
  );
  assert.equal(identity.mediaAssets[1].sizeLabel, 'media-bytes:1024');
  assert.equal(mediaCalls.length, assets.length * 2);
  assert.notEqual(identity.mediaAssets[0], assets[0]);
  assert.deepEqual({ record, state }, before);
});

test('identity fallbacks preserve absent versus explicitly empty media messages and logo permissions', () => {
  const { projection, presentation } = fixture();
  const identity = projection.identity(sponsorship(), identityState());
  assert.equal(
    identity.logoActionLabel,
    presentation.t('admin.messages.televerser_un_logo')
  );
  assert.equal(identity.logoPreviewSource, null);
  assert.equal(identity.uploadDisabled, false);
  assert.equal(identity.deleteDisabled, true);
  assert.equal(identity.mediaBusy, false);
  assert.equal(
    identity.statusMessage,
    presentation.t(
      'admin.messages.formats_acceptes_png_jpeg_ou_webp_max_512_kib'
    )
  );
  assert.equal(
    identity.mediaMessage,
    presentation.t(
      'admin.messages.les_decisions_media_sont_independantes_de_la_revue_de_la_commandite'
    )
  );
  assert.equal(
    projection.identity(sponsorship(), identityState({ mediaMessage: '' }))
      .mediaMessage,
    ''
  );
  assert.equal(
    projection.identity(
      sponsorship({ sponsor_logo_url: '/synthetic-logo' }),
      identityState()
    ).deleteDisabled,
    false
  );
  assert.deepEqual(identity.mediaAssets, []);
  assert.equal(identity.approvableMediaCount, 0);
});

for (const locale of ['fr-CA', 'en']) {
  test(`presentation preserves existing number, tier, channel and translated fallback labels in ${locale}`, () => {
    const { projection, presentation } = fixture(locale);
    const record = sponsorship({
      amount: 2575,
      currency: 'usd',
      sponsor_feed_target: 'openg20',
      sponsor_feed_channels: ['linkedin', 'facebook']
    });
    const expectedNumber = new Intl.NumberFormat(locale, {
      maximumFractionDigits: 0
    }).format(2575);
    assert.equal(
      projection.listRow(record).amountLabel,
      `${expectedNumber} $ USD`
    );
    assert.equal(
      projection.header(record).amountLabel,
      `${expectedNumber} $ USD`
    );
    assert.equal(
      projection.formatSummaryMoney(2575),
      `${expectedNumber} $ CAD`
    );
    assert.equal(
      projection.formatMoney({ ...record, currency: '' }),
      `${expectedNumber} $ CAD`
    );
    assert.equal(projection.feedTargetLabel(record), 'OpenG20');
    assert.equal(
      projection.feedTargetLabel({ ...record, sponsor_feed_target: 'openg7' }),
      'OpenG7'
    );
    assert.equal(
      projection.feedChannelsLabel(record),
      `LinkedIn / ${presentation.t('admin.messages.facebook')}`
    );
    assert.equal(
      projection.feedChannelsLabel(sponsorship()),
      presentation.t('admin.messages.aucun_canal')
    );
    assert.equal(
      projection.feedTargetLabel(sponsorship()),
      presentation.t('admin.legacy.aucune')
    );
    assert.equal(
      projection.sponsorshipTierLabel({ ...record, amount: 49 }),
      presentation.t('admin.messages.indetermine')
    );
    assert.equal(
      projection.sponsorshipTierLabel({ ...record, amount: 50 }),
      presentation.t('admin.messages.bronze')
    );
    assert.equal(
      projection.sponsorshipTierLabel({ ...record, amount: 250 }),
      presentation.t('admin.messages.argent')
    );
    assert.equal(
      projection.sponsorshipTierLabel({ ...record, amount: 500 }),
      'Or'
    );
    assert.equal(
      projection.tierClass({ ...record, amount: 250 }),
      locale === 'en' ? 'tier-badge tier-bronze' : 'tier-badge tier-silver'
    );
    assert.equal(
      projection.tierClass({ ...record, amount: 500 }),
      'tier-badge tier-gold'
    );
    assert.equal(
      projection.sponsorshipBenefitsLabel({ ...record, amount: 49 }),
      presentation.t(
        'admin.messages.aucun_avantage_montant_sous_le_minimum_de_commandite'
      )
    );
    assert.equal(
      projection.sponsorshipBenefitsLabel({ ...record, amount: 500 }),
      [
        presentation.t('admin.messages.mention_openg7_org'),
        presentation.t('admin.messages.lot_collectif_facebook'),
        presentation.t('admin.messages.lot_collectif_linkedin')
      ].join(', ')
    );
    assert.equal(
      projection.statusClass('pending_review'),
      'status-badge status-pending'
    );
    assert.equal(
      projection.paymentStatusClass('refunded'),
      'payment-badge payment-pending'
    );
    assert.equal(
      projection.paymentStatusClass('disputed'),
      'payment-badge payment-failed'
    );
  });
}

test('projections refresh language callbacks without retaining a previous language snapshot', () => {
  const { projection, setLocale } = fixture();
  const record = sponsorship({ sponsor_company_name: null, amount: 2575 });
  assert.equal(projection.listRow(record).companyName, 'Entreprise sans nom');
  assert.equal(
    projection.header(record).visibilityLabel,
    'Consentement absent'
  );
  setLocale('en');
  assert.equal(projection.listRow(record).companyName, 'Unnamed company');
  assert.equal(projection.header(record).visibilityLabel, 'Consent missing');
  assert.equal(projection.listRow(record).amountLabel, '2,575 $ CAD');
  setLocale('fr-CA');
  assert.equal(projection.listRow(record).companyName, 'Entreprise sans nom');
});
