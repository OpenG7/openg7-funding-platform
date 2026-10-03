import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { AdminSponsorHistoryProjection } from '../dist/apps/funding-web/src/app/features/funding/models/admin-sponsor-history.projection.js';

const dictionaries = Object.fromEntries(
  ['fr-CA', 'en'].map((locale) => [
    locale,
    JSON.parse(
      readFileSync(`apps/funding-web/src/assets/i18n/${locale}.json`, 'utf8')
    )
  ])
);

function presentation(locale = 'fr-CA') {
  return {
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
    formatAmount(amount, currency) {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency
      }).format(amount);
    },
    dateOnlyLabel: (value) => value || 'not-available',
    paymentStatusLabel: (status) => `payment:${status}`,
    reviewStatusLabel: (status) => `review:${status}`,
    feedStatusLabel: (status) => `feed:${status}`
  };
}

function sponsorship(overrides = {}) {
  return {
    id: 'synthetic-sponsor',
    currency: 'CAD',
    payment_status: 'paid',
    paid_at: null,
    sponsor_details_submitted_at: null,
    sponsor_review_status: 'pending_review',
    sponsor_reviewed_at: null,
    sponsor_feed_status: 'not_planned',
    sponsor_visibility_updated_at: null,
    sponsorship_refund_status: 'not_requested',
    sponsorship_refund_requested_at: null,
    sponsorship_refund_processed_at: null,
    sponsorship_refund_completed_at: null,
    sponsorship_refund_id: null,
    sponsorship_refund_amount: null,
    sponsorship_refund_reason: null,
    sponsorship_refund_note: null,
    sponsorship_refund_error: null,
    admin_audit_entries: [],
    created_at: '2026-09-01T12:00:00.000Z',
    updated_at: '2026-09-04T12:00:00.000Z',
    ...overrides
  };
}

function audit(
  id,
  action,
  metadata = {},
  createdAt = '2026-09-03T12:00:00.000Z'
) {
  return Object.freeze({
    id,
    actor: 'synthetic-owner',
    action,
    summary: null,
    metadata: Object.freeze(metadata),
    created_at: createdAt
  });
}

test('refund history preserves ascending order, stable ties, identifiers and input data', () => {
  const projector = new AdminSponsorHistoryProjection(presentation());
  const record = Object.freeze(
    sponsorship({
      sponsorship_refund_status: 'completed',
      sponsorship_refund_requested_at: '2026-09-03T12:00:00.000Z',
      sponsorship_refund_processed_at: '2026-09-02T12:00:00.000Z',
      sponsorship_refund_completed_at: '2026-09-03T12:00:00.000Z',
      sponsorship_refund_note: '  Synthetic note  '
    })
  );
  const before = structuredClone(record);
  const entries = projector.refundHistoryEntriesFor(record);
  assert.deepEqual(
    entries.map(({ id, tone }) => [id, tone]),
    [
      ['synthetic-sponsor:refund-processing', 'processing'],
      ['synthetic-sponsor:refund-requested', 'requested'],
      ['synthetic-sponsor:refund-completed', 'completed']
    ]
  );
  assert.equal(entries[1].detail, 'Note: Synthetic note');
  assert.ok(entries[0].detail.endsWith('Note:   Synthetic note  '));
  assert.equal(entries[2].detail, 'Paiement: payment:paid');
  assert.equal(
    projector.trackByRefundHistoryEntry(999, entries[0]),
    entries[0].id
  );
  assert.equal(
    projector.refundHistoryEntryClass(entries[0]),
    'refund-history-processing'
  );
  assert.deepEqual(record, before);
});

test('refund history handles absent timestamps, workflow and optional data', () => {
  const projector = new AdminSponsorHistoryProjection(presentation());
  assert.deepEqual(
    projector.refundHistoryEntriesFor(
      sponsorship({
        sponsorship_refund_requested_at: '2026-09-02T12:00:00.000Z'
      })
    ),
    []
  );
  const record = sponsorship({ sponsorship_refund_status: 'processing' });
  const [current] = projector.refundHistoryEntriesFor(record);
  assert.equal(current.id, 'synthetic-sponsor:refund-current');
  assert.equal(current.date, record.updated_at);
  assert.equal(current.tone, 'processing');
  assert.equal(current.label, 'Remboursement en cours');
  assert.equal(
    current.detail,
    presentation().t(
      'admin.messages.aucun_horodatage_detaille_expose_pour_ce_statut'
    )
  );
  assert.deepEqual(
    projector.refundAuditEntriesFor(
      sponsorship({ admin_audit_entries: undefined })
    ),
    []
  );
  assert.equal(
    projector.auditEntriesFor(sponsorship({ admin_audit_entries: undefined }))
      .length,
    1
  );
});

test('failed refund history retains fallback date priority and uncertain-result guidance', () => {
  const projector = new AdminSponsorHistoryProjection(presentation());
  for (const timestamps of [
    {},
    { sponsorship_refund_requested_at: '2026-09-02T12:00:00.000Z' },
    {
      sponsorship_refund_requested_at: '2026-09-02T12:00:00.000Z',
      sponsorship_refund_processed_at: '2026-09-03T12:00:00.000Z'
    }
  ]) {
    const record = sponsorship({
      sponsorship_refund_status: 'failed',
      ...timestamps
    });
    const failed = projector
      .refundHistoryEntriesFor(record)
      .find(({ tone }) => tone === 'failed');
    assert.equal(failed.id, 'synthetic-sponsor:refund-failed');
    assert.equal(
      failed.date,
      timestamps.sponsorship_refund_processed_at ??
        timestamps.sponsorship_refund_requested_at ??
        record.updated_at
    );
    assert.equal(
      failed.detail,
      presentation().t(
        'admin.messages.consultez_stripe_et_le_journal_admin_avant_de_relancer'
      )
    );
  }
  const record = sponsorship({
    sponsorship_refund_status: 'failed',
    sponsorship_refund_error: 'Synthetic provider failure'
  });
  assert.equal(
    projector.refundHistoryEntriesFor(record)[0].detail,
    'Synthetic provider failure'
  );
  assert.equal(
    projector.refundWorkflowTimelineLabel(record),
    'Echec: Synthetic provider failure'
  );
});

test('refund projections keep record amounts in major units and audit amounts in minor units', () => {
  const amounts = [];
  const callbacks = presentation();
  callbacks.formatAmount = (amount, currency) => {
    amounts.push([amount, currency]);
    return `${amount} ${currency}`;
  };
  const projector = new AdminSponsorHistoryProjection(callbacks);
  const record = sponsorship({
    currency: 'USD',
    sponsorship_refund_status: 'completed',
    sponsorship_refund_processed_at: '2026-09-02T12:00:00.000Z',
    sponsorship_refund_completed_at: '2026-09-03T12:00:00.000Z',
    sponsorship_refund_amount: 25.75,
    sponsorship_refund_reason: 'duplicate',
    sponsorship_refund_id: 're_synthetic',
    admin_audit_entries: [
      audit('partial', 'sponsorship_refund.stripe_partial', {
        amount: 2575,
        currency: 'USD'
      })
    ]
  });
  const history = projector.refundHistoryEntriesFor(record);
  assert.ok(
    history.every(({ detail }) => detail.includes('Montant: 25.75 USD'))
  );
  assert.ok(
    history.every(({ detail }) =>
      detail.includes('Refund Stripe: re_synthetic')
    )
  );
  assert.ok(
    history.every(({ detail }) => detail.includes('Raison: Paiement en double'))
  );
  assert.equal(
    projector.refundAuditEntriesFor(record)[0].detail,
    'Acteur: synthetic-owner - Montant: 25.75 USD'
  );
  assert.deepEqual(amounts, [
    [25.75, 'USD'],
    [25.75, 'USD'],
    [25.75, 'USD']
  ]);
});

test('refund audit filters review metadata by existing types and sorts newest first with stable ties', () => {
  const source = Object.freeze([
    audit(
      'full',
      'sponsorship_refund.stripe_full',
      {},
      '2026-09-01T12:00:00.000Z'
    ),
    audit('plain-review', 'sponsorship_review.refused'),
    audit('none', 'sponsorship_review.refused', { refundHandling: 'none' }),
    audit('wrong-types', 'sponsorship_review.refused', {
      refundWorkflowStatus: 1,
      refundHandling: true,
      hasRefundNote: 'true'
    }),
    audit('blank', 'sponsorship_review.refused', {
      refundWorkflowStatus: '  ',
      refundHandling: ''
    }),
    audit('workflow', 'sponsorship_review.refused', {
      refundWorkflowStatus: 'requested'
    }),
    audit('manual', 'sponsorship_review.refused', {
      refundHandling: 'manual_required'
    }),
    audit('note', 'sponsorship_review.refused', { hasRefundNote: true }),
    audit(
      'partial',
      'sponsorship_refund.stripe_partial',
      {},
      '2026-09-04T12:00:00.000Z'
    ),
    audit('unrelated', 'other.action', {
      hasRefundNote: true,
      refundWorkflowStatus: 'requested'
    })
  ]);
  const projector = new AdminSponsorHistoryProjection(presentation());
  const entries = projector.refundAuditEntriesFor(
    sponsorship({ admin_audit_entries: source })
  );
  assert.deepEqual(
    entries.map(({ id }) => id),
    ['partial', 'workflow', 'manual', 'note', 'full']
  );
  assert.equal(projector.trackByAuditEntry(999, entries[0]), 'partial');
  assert.equal(source[0].id, 'full');
  assert.equal(
    entries[1].detail,
    'Acteur: synthetic-owner - Suivi: Remboursement demande'
  );
  assert.ok(
    entries[2].detail.includes('Traitement: remboursement manuel demande')
  );
});

test('audit metadata ignores absent, nonfinite and mistyped values while retaining valid zero and false', () => {
  const projector = new AdminSponsorHistoryProjection(presentation('en'));
  for (const amount of [undefined, '2575', NaN, Infinity, -Infinity]) {
    const [entry] = projector.refundAuditEntriesFor(
      sponsorship({
        admin_audit_entries: [
          audit('invalid', 'sponsorship_refund.stripe_partial', {
            amount,
            currency: 'CAD',
            fullRefund: 'false',
            notificationSent: 1,
            refundId: ' '
          })
        ]
      })
    );
    assert.equal(entry.detail, 'Acteur: synthetic-owner');
  }
  const [entry] = projector.refundAuditEntriesFor(
    sponsorship({
      admin_audit_entries: [
        audit('zero', 'sponsorship_refund.stripe_partial', {
          amount: 0,
          currency: 'USD',
          fullRefund: false,
          notificationSent: false
        })
      ]
    })
  );
  assert.equal(
    entry.detail,
    'Acteur: synthetic-owner - Amount: $0.00 - Type: partial - Email not sent'
  );
});

test('refund audit retains provider references, credit-note results and notification failures', () => {
  const callbacks = presentation('en');
  const projector = new AdminSponsorHistoryProjection(callbacks);
  const [entry] = projector.refundAuditEntriesFor(
    sponsorship({
      admin_audit_entries: [
        audit('full-result', 'sponsorship_refund.stripe_full', {
          amount: 2575,
          currency: 'USD',
          fullRefund: true,
          refundId: 're_synthetic',
          refundReason: 'fraudulent',
          paymentIntentId: 'pi_synthetic',
          refundStatus: 'pending',
          refundWorkflowStatus: 'processing',
          creditNoteNumber: 'SYNTHETIC-CREDIT-001',
          creditNoteError: 'Synthetic credit-note failure',
          notificationSent: false,
          notificationError: 'Synthetic mail failure'
        })
      ]
    })
  );
  assert.equal(
    entry.label,
    callbacks.t('admin.messages.remboursement_stripe_complet_cree')
  );
  assert.equal(
    entry.detail,
    [
      'Acteur: synthetic-owner',
      'Amount: $25.75',
      callbacks.t('admin.messages.type_complet'),
      callbacks.t('admin.messages.raison_p0', {
        p0: callbacks.t('admin.legacy.paiement_frauduleux')
      }),
      'Refund: re_synthetic',
      'PaymentIntent: pi_synthetic',
      'Statut: pending',
      'Suivi: Refund in progress',
      'Avoir: SYNTHETIC-CREDIT-001',
      callbacks.t('admin.messages.erreur_avoir_p0', {
        p0: 'Synthetic credit-note failure'
      }),
      'Email not sent',
      callbacks.t('admin.messages.erreur_courriel_p0', {
        p0: 'Synthetic mail failure'
      })
    ].join(' - ')
  );
});

test('general audit combines dossier milestones and server entries without mutation or duplicate identifiers', () => {
  const projector = new AdminSponsorHistoryProjection(presentation());
  const record = Object.freeze(
    sponsorship({
      paid_at: '2026-09-02T12:00:00.000Z',
      sponsor_details_submitted_at: '2026-09-02T12:00:00.000Z',
      sponsor_reviewed_at: '2026-09-03T12:00:00.000Z',
      sponsor_review_status: 'approved',
      sponsor_visibility_updated_at: '2026-09-04T12:00:00.000Z',
      sponsor_feed_status: 'published',
      sponsorship_refund_status: 'completed',
      sponsorship_refund_requested_at: '2026-09-03T12:00:00.000Z',
      sponsorship_refund_processed_at: '2026-09-04T12:00:00.000Z',
      sponsorship_refund_completed_at: '2026-09-05T12:00:00.000Z',
      admin_audit_entries: Object.freeze([
        audit(
          'server-entry',
          'sponsorship.logo.upload',
          {},
          '2026-09-04T12:00:00.000Z'
        )
      ])
    })
  );
  const before = structuredClone(record);
  const entries = projector.auditEntriesFor(record);
  assert.deepEqual(
    entries.map(({ id }) => id),
    [
      'synthetic-sponsor:refund-workflow',
      'synthetic-sponsor:visibility',
      'server-entry',
      'synthetic-sponsor:reviewed',
      'synthetic-sponsor:paid',
      'synthetic-sponsor:details',
      'synthetic-sponsor:created'
    ]
  );
  assert.equal(entries[0].date, record.sponsorship_refund_completed_at);
  assert.equal(entries[1].detail, 'feed:published');
  assert.equal(entries[4].detail, 'payment:paid');
  assert.equal(new Set(entries.map(({ id }) => id)).size, entries.length);
  assert.deepEqual(record, before);
  assert.equal(
    projector.auditEntriesFor(
      sponsorship({ sponsorship_refund_status: 'processing' })
    ).length,
    1
  );
});

test('audit presentation retains identity allowlists, actor, unknown actions and visibility outcomes', () => {
  const callbacks = presentation('en');
  const projector = new AdminSponsorHistoryProjection(callbacks);
  const entries = projector.auditEntriesFor(
    sponsorship({
      admin_audit_entries: [
        audit('intervention', 'sponsorship.intervention.recorded', {
          note: 'Synthetic note'
        }),
        audit('details', 'sponsorship.details.update', {
          changedFields: ['contactEmail', 'amount', 42, 'companyName'],
          reason: 'contact_update'
        }),
        audit('details-invalid', 'sponsorship.details.update', {
          changedFields: 'companyName',
          reason: 'unrecognized'
        }),
        Object.freeze({
          ...audit('unknown-summary', 'unknown.action'),
          summary: 'Synthetic summary'
        }),
        audit('unknown-action', 'unknown.action'),
        audit('not-applied', 'sponsorship_website.visibility', {
          outcome: 'stale',
          visible: true
        }),
        audit('published', 'sponsorship_website.visibility', {
          outcome: 'updated',
          visible: true
        }),
        audit('hidden', 'sponsorship_website.visibility', {
          outcome: 'updated',
          visible: false
        }),
        audit('publication', 'sponsorship_publication.update', {
          feedStatus: 'planned'
        })
      ]
    })
  );
  const byId = Object.fromEntries(entries.map((entry) => [entry.id, entry]));
  const actor = callbacks.t('admin.editDossier.actor', {
    actor: 'synthetic-owner'
  });
  assert.equal(byId.intervention.detail, `${actor} · Synthetic note`);
  assert.equal(
    byId.details.detail,
    `${actor} · ${callbacks.t('admin.editDossier.fields.contactEmail')}, ${callbacks.t('admin.editDossier.fields.companyName')} · ${callbacks.t('admin.editDossier.reasons.contact_update')}`
  );
  assert.equal(byId['details-invalid'].detail, actor);
  assert.equal(byId['unknown-summary'].label, 'Synthetic summary');
  assert.equal(byId['unknown-action'].label, 'unknown.action');
  for (const [id, key] of [
    ['not-applied', 'notApplied'],
    ['published', 'published'],
    ['hidden', 'hidden']
  ]) {
    assert.equal(
      byId[id].label,
      callbacks.t(`admin.dossier.publicationBridge.site.audit.${key}`)
    );
  }
  assert.equal(
    byId.publication.detail,
    'Acteur: synthetic-owner - Publication: feed:planned'
  );
});

for (const locale of ['fr-CA', 'en']) {
  test(`refund translations and sparse timeline presentation stay available in ${locale}`, () => {
    const callbacks = presentation(locale);
    const projector = new AdminSponsorHistoryProjection(callbacks);
    const statuses = [
      'requested',
      'processing',
      'completed',
      'failed',
      'not_requested'
    ];
    const expected =
      locale === 'en'
        ? [
            'Refund requested',
            'Refund in progress',
            'Refund complete',
            'Refund failed',
            'No refund requested'
          ]
        : [
            'Remboursement demande',
            'Remboursement en cours',
            'Remboursement complete',
            'Remboursement en echec',
            'Aucun remboursement demande'
          ];
    assert.deepEqual(
      statuses.map((status) => projector.refundWorkflowStatusLabel(status)),
      expected
    );
    for (const status of statuses) {
      const record = sponsorship({ sponsorship_refund_status: status });
      assert.equal(
        projector.hasRefundWorkflow(record),
        status !== 'not_requested'
      );
      assert.equal(
        projector.refundWorkflowStatusClass(status),
        `refund-badge refund-${status.replace('_', '-')}`
      );
      assert.ok(projector.refundWorkflowTimelineLabel(record).trim());
      for (const entry of projector.refundHistoryEntriesFor(record))
        assert.ok(entry.label.trim());
    }
    assert.equal(
      projector.stripeRefundReasonLabel('duplicate'),
      callbacks.t('admin.legacy.paiement_en_double')
    );
    assert.equal(
      projector.stripeRefundReasonLabel('fraudulent'),
      callbacks.t('admin.legacy.paiement_frauduleux')
    );
    assert.equal(
      projector.stripeRefundReasonLabel('requested_by_customer'),
      callbacks.t('admin.legacy.demande_du_commanditaire')
    );
    const record = sponsorship({
      sponsorship_refund_status: 'processing',
      sponsorship_refund_requested_at: '2026-09-02T12:00:00.000Z'
    });
    assert.equal(
      projector.refundWorkflowTimelineLabel(record),
      callbacks.t('admin.messages.en_cours_depuis_p0', {
        p0: record.sponsorship_refund_requested_at
      })
    );
  });
}
