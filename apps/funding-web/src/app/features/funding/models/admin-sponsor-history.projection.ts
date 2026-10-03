import type {
  AdminAuditLogEntry,
  AdminSponsorshipRecord,
  AdminSponsorshipRejectionRefundHandling,
  AdminSponsorshipRefundWorkflowStatus,
  AdminSponsorshipStripeRefundReason,
  SponsorFeedStatus,
  SponsorshipReviewStatus
} from '@openg7/funding-core';

import type {
  AdminSponsorHistoryPresentation,
  SponsorAuditEntry,
  SponsorRefundHistoryEntry
} from './admin-sponsor-workflow.ports.js';

/** Pure projections of server-confirmed refund and audit history. */
export class AdminSponsorHistoryProjection {
  constructor(private readonly presentation: AdminSponsorHistoryPresentation) {}

  hasRefundWorkflow(sponsorship: AdminSponsorshipRecord): boolean {
    return sponsorship.sponsorship_refund_status !== 'not_requested';
  }

  refundWorkflowStatusLabel(
    status: AdminSponsorshipRefundWorkflowStatus
  ): string {
    if (status === 'requested') {
      return this.presentation.t('admin.messages.remboursement_demande');
    }

    if (status === 'processing') {
      return this.presentation.t('admin.messages.remboursement_en_cours');
    }

    if (status === 'completed') {
      return this.presentation.t('admin.messages.remboursement_complete_');
    }

    if (status === 'failed') {
      return this.presentation.t('admin.messages.remboursement_en_echec_');
    }

    return this.presentation.t('admin.messages.aucun_remboursement_demande_');
  }

  stripeRefundReasonLabel(reason: AdminSponsorshipStripeRefundReason): string {
    if (reason === 'duplicate') {
      return this.presentation.t('admin.legacy.paiement_en_double');
    }

    if (reason === 'fraudulent') {
      return this.presentation.t('admin.legacy.paiement_frauduleux');
    }

    return this.presentation.t('admin.legacy.demande_du_commanditaire');
  }

  refundWorkflowStatusClass(
    status: AdminSponsorshipRefundWorkflowStatus
  ): string {
    return `refund-badge refund-${status.replace('_', '-')}`;
  }

  refundWorkflowTimelineLabel(sponsorship: AdminSponsorshipRecord): string {
    if (sponsorship.sponsorship_refund_status === 'completed') {
      return this.presentation.t('admin.messages.complete_le_p0', {
        p0: this.presentation.dateOnlyLabel(
          sponsorship.sponsorship_refund_completed_at
        )
      });
    }

    if (sponsorship.sponsorship_refund_status === 'processing') {
      return this.presentation.t('admin.messages.en_cours_depuis_p0', {
        p0: this.presentation.dateOnlyLabel(
          sponsorship.sponsorship_refund_processed_at ??
            sponsorship.sponsorship_refund_requested_at
        )
      });
    }

    if (sponsorship.sponsorship_refund_status === 'requested') {
      return this.presentation.t('admin.messages.demande_le_p0', {
        p0: this.presentation.dateOnlyLabel(
          sponsorship.sponsorship_refund_requested_at
        )
      });
    }

    if (sponsorship.sponsorship_refund_status === 'failed') {
      return sponsorship.sponsorship_refund_error
        ? `Echec: ${sponsorship.sponsorship_refund_error}`
        : this.presentation.t('admin.messages.derniere_tentative_en_echec');
    }

    return this.presentation.t('admin.messages.aucun_remboursement_demande');
  }

  refundHistoryEntriesFor(
    sponsorship: AdminSponsorshipRecord
  ): SponsorRefundHistoryEntry[] {
    if (!this.hasRefundWorkflow(sponsorship)) {
      return [];
    }

    const entries: SponsorRefundHistoryEntry[] = [];
    const refundNote = sponsorship.sponsorship_refund_note?.trim();

    if (sponsorship.sponsorship_refund_requested_at) {
      entries.push({
        id: `${sponsorship.id}:refund-requested`,
        date: sponsorship.sponsorship_refund_requested_at,
        label: this.presentation.t(
          'admin.messages.demande_de_remboursement_enregistree'
        ),
        detail: refundNote
          ? this.presentation.t('admin.messages.note_p0', { p0: refundNote })
          : undefined,
        tone: 'requested'
      });
    }

    if (
      sponsorship.sponsorship_refund_processed_at &&
      ['processing', 'completed', 'failed'].includes(
        sponsorship.sponsorship_refund_status
      )
    ) {
      entries.push({
        id: `${sponsorship.id}:refund-processing`,
        date: sponsorship.sponsorship_refund_processed_at,
        label: this.presentation.t(
          'admin.messages.traitement_du_remboursement_lance'
        ),
        detail: this.refundProcessingDetail(sponsorship),
        tone: 'processing'
      });
    }

    if (sponsorship.sponsorship_refund_completed_at) {
      entries.push({
        id: `${sponsorship.id}:refund-completed`,
        date: sponsorship.sponsorship_refund_completed_at,
        label: this.presentation.t('admin.messages.remboursement_complete'),
        detail: this.refundCompletionDetail(sponsorship),
        tone: 'completed'
      });
    }

    if (sponsorship.sponsorship_refund_status === 'failed') {
      entries.push({
        id: `${sponsorship.id}:refund-failed`,
        date: this.refundHistoryFallbackDate(sponsorship),
        label: this.presentation.t('admin.messages.remboursement_en_echec'),
        detail:
          sponsorship.sponsorship_refund_error ||
          this.presentation.t(
            'admin.messages.consultez_stripe_et_le_journal_admin_avant_de_relancer'
          ),
        tone: 'failed'
      });
    }

    if (entries.length === 0) {
      entries.push({
        id: `${sponsorship.id}:refund-current`,
        date: sponsorship.updated_at,
        label: this.refundWorkflowStatusLabel(
          sponsorship.sponsorship_refund_status
        ),
        detail: this.presentation.t(
          'admin.messages.aucun_horodatage_detaille_expose_pour_ce_statut'
        ),
        tone: sponsorship.sponsorship_refund_status
      });
    }

    return entries.sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
  }

  trackByRefundHistoryEntry(
    _: number,
    entry: SponsorRefundHistoryEntry
  ): string {
    return entry.id;
  }

  refundHistoryEntryClass(entry: SponsorRefundHistoryEntry): string {
    return `refund-history-${entry.tone.replace('_', '-')}`;
  }

  refundAuditEntriesFor(
    sponsorship: AdminSponsorshipRecord
  ): SponsorAuditEntry[] {
    return (sponsorship.admin_audit_entries ?? [])
      .filter((entry) => this.isRefundAuditEntry(entry))
      .map((entry) => ({
        id: entry.id,
        date: entry.created_at,
        label: this.adminAuditLabel(entry),
        detail: this.adminAuditDetail(entry)
      }))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  private refundProcessingDetail(sponsorship: AdminSponsorshipRecord): string {
    const details = [
      this.presentation.t('admin.messages.statut_traitement_en_cours')
    ];

    if (sponsorship.sponsorship_refund_amount) {
      details.push(
        this.presentation.t('admin.messages.montant_p0', {
          p0: this.presentation.formatAmount(
            sponsorship.sponsorship_refund_amount,
            sponsorship.currency
          )
        })
      );
    }

    if (sponsorship.sponsorship_refund_reason) {
      details.push(
        this.presentation.t('admin.messages.raison_p0', {
          p0: this.stripeRefundReasonLabel(
            sponsorship.sponsorship_refund_reason
          )
        })
      );
    }

    if (sponsorship.sponsorship_refund_id) {
      details.push(
        this.presentation.t('admin.messages.refund_stripe_p0', {
          p0: sponsorship.sponsorship_refund_id
        })
      );
    }

    if (sponsorship.sponsorship_refund_note) {
      details.push(
        this.presentation.t('admin.messages.note_p0', {
          p0: sponsorship.sponsorship_refund_note
        })
      );
    }

    return details.join(' - ');
  }

  private refundCompletionDetail(sponsorship: AdminSponsorshipRecord): string {
    const details = [
      this.presentation.t('admin.messages.paiement_p0', {
        p0: this.presentation.paymentStatusLabel(sponsorship.payment_status)
      })
    ];

    if (sponsorship.sponsorship_refund_amount) {
      details.push(
        this.presentation.t('admin.messages.montant_p0', {
          p0: this.presentation.formatAmount(
            sponsorship.sponsorship_refund_amount,
            sponsorship.currency
          )
        })
      );
    }

    if (sponsorship.sponsorship_refund_reason) {
      details.push(
        this.presentation.t('admin.messages.raison_p0', {
          p0: this.stripeRefundReasonLabel(
            sponsorship.sponsorship_refund_reason
          )
        })
      );
    }

    if (sponsorship.sponsorship_refund_id) {
      details.push(
        this.presentation.t('admin.messages.refund_stripe_p0', {
          p0: sponsorship.sponsorship_refund_id
        })
      );
    }

    return details.join(' - ');
  }

  private refundHistoryFallbackDate(
    sponsorship: AdminSponsorshipRecord
  ): string {
    return (
      sponsorship.sponsorship_refund_processed_at ??
      sponsorship.sponsorship_refund_requested_at ??
      sponsorship.updated_at
    );
  }

  private isRefundAuditEntry(entry: AdminAuditLogEntry): boolean {
    if (
      entry.action === 'sponsorship_refund.stripe_full' ||
      entry.action === 'sponsorship_refund.stripe_partial'
    ) {
      return true;
    }

    if (!entry.action.startsWith('sponsorship_review.')) {
      return false;
    }

    const refundHandling = this.metadataString(entry, 'refundHandling');
    return (
      this.metadataString(entry, 'refundWorkflowStatus') !== null ||
      (refundHandling !== null && refundHandling !== 'none') ||
      this.metadataBoolean(entry, 'hasRefundNote') === true
    );
  }

  auditEntriesFor(sponsorship: AdminSponsorshipRecord): SponsorAuditEntry[] {
    const entries: SponsorAuditEntry[] = [];
    entries.push({
      id: `${sponsorship.id}:created`,
      date: sponsorship.created_at,
      label: this.presentation.t('admin.messages.reception_de_la_commandite')
    });

    if (sponsorship.paid_at) {
      entries.push({
        id: `${sponsorship.id}:paid`,
        date: sponsorship.paid_at,
        label: this.presentation.t('admin.messages.paiement_confirme'),
        detail: this.presentation.paymentStatusLabel(sponsorship.payment_status)
      });
    }

    if (sponsorship.sponsor_details_submitted_at) {
      entries.push({
        id: `${sponsorship.id}:details`,
        date: sponsorship.sponsor_details_submitted_at,
        label: this.presentation.t('admin.messages.details_commanditaire_recus')
      });
    }

    if (sponsorship.sponsor_reviewed_at) {
      entries.push({
        id: `${sponsorship.id}:reviewed`,
        date: sponsorship.sponsor_reviewed_at,
        label: this.presentation.t('admin.messages.statut_de_revue_p0', {
          p0: this.presentation.reviewStatusLabel(
            sponsorship.sponsor_review_status
          )
        })
      });
    }

    if (sponsorship.sponsor_visibility_updated_at) {
      entries.push({
        id: `${sponsorship.id}:visibility`,
        date: sponsorship.sponsor_visibility_updated_at,
        label: this.presentation.t(
          'admin.messages.donnees_de_publication_mises_a_jour'
        ),
        detail: this.presentation.feedStatusLabel(
          sponsorship.sponsor_feed_status
        )
      });
    }

    if (
      sponsorship.sponsorship_refund_status !== 'not_requested' &&
      sponsorship.sponsorship_refund_requested_at
    ) {
      entries.push({
        id: `${sponsorship.id}:refund-workflow`,
        date:
          sponsorship.sponsorship_refund_completed_at ??
          sponsorship.sponsorship_refund_processed_at ??
          sponsorship.sponsorship_refund_requested_at,
        label: this.refundWorkflowStatusLabel(
          sponsorship.sponsorship_refund_status
        ),
        detail: this.refundWorkflowTimelineLabel(sponsorship)
      });
    }

    for (const entry of sponsorship.admin_audit_entries ?? []) {
      entries.push({
        id: entry.id,
        date: entry.created_at,
        label: this.adminAuditLabel(entry),
        detail: this.adminAuditDetail(entry)
      });
    }

    return entries.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  }

  trackByAuditEntry(_: number, entry: SponsorAuditEntry): string {
    return entry.id;
  }

  private metadataString(
    entry: AdminAuditLogEntry,
    key: string
  ): string | null {
    const value = entry.metadata[key];
    return typeof value === 'string' && value.trim() ? value : null;
  }

  private metadataNumber(
    entry: AdminAuditLogEntry,
    key: string
  ): number | null {
    const value = entry.metadata[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private metadataBoolean(
    entry: AdminAuditLogEntry,
    key: string
  ): boolean | null {
    const value = entry.metadata[key];
    return typeof value === 'boolean' ? value : null;
  }

  private refundHandlingAuditLabel(
    handling: AdminSponsorshipRejectionRefundHandling
  ): string {
    if (handling === 'manual_required') {
      return this.presentation.t('admin.messages.remboursement_manuel_demande');
    }

    if (handling === 'manual_completed') {
      return this.presentation.t(
        'admin.messages.remboursement_manuel_deja_traite'
      );
    }

    return this.presentation.t('admin.messages.aucun_remboursement_demande');
  }

  private adminAuditLabel(entry: AdminAuditLogEntry): string {
    if (entry.action.startsWith('sponsorship_review.')) {
      const reviewStatus =
        typeof entry.metadata.reviewStatus === 'string'
          ? (entry.metadata.reviewStatus as SponsorshipReviewStatus)
          : null;
      return reviewStatus
        ? this.presentation.t('admin.messages.decision_admin_p0', {
            p0: this.presentation.reviewStatusLabel(reviewStatus)
          })
        : this.presentation.t('admin.messages.decision_admin_enregistree');
    }

    switch (entry.action) {
      case 'sponsorship.intervention.recorded':
        return this.presentation.t('admin.interventions.saved');
      case 'sponsorship.details.update':
        return this.presentation.t('admin.editDossier.history');
      case 'sponsorship.logo.upload':
        return this.presentation.t(
          'admin.messages.logo_commanditaire_ajoute_ou_remplace'
        );
      case 'sponsorship.logo.delete':
        return this.presentation.t(
          'admin.messages.logo_commanditaire_supprime'
        );
      case 'sponsorship_refund.stripe_full':
        return this.presentation.t(
          'admin.messages.remboursement_stripe_complet_cree'
        );
      case 'sponsorship_refund.stripe_partial':
        return this.presentation.t(
          'admin.messages.remboursement_stripe_partiel_cree'
        );
      case 'sponsorship_publication.update':
        return this.presentation.t(
          'admin.messages.publication_commanditaire_mise_a_jour'
        );
      case 'sponsorship_website.visibility':
        return this.presentation.t(
          'admin.dossier.publicationBridge.site.audit.' +
            (this.metadataString(entry, 'outcome') !== 'updated'
              ? 'notApplied'
              : this.metadataBoolean(entry, 'visible')
                ? 'published'
                : 'hidden')
        );
      default:
        return entry.summary || entry.action;
    }
  }

  private adminAuditDetail(entry: AdminAuditLogEntry): string {
    if (entry.action === 'sponsorship.intervention.recorded') {
      return [
        this.presentation.t('admin.editDossier.actor', { actor: entry.actor }),
        this.metadataString(entry, 'note')
      ]
        .filter(Boolean)
        .join(' · ');
    }
    if (entry.action === 'sponsorship.details.update') {
      const fields = Array.isArray(entry.metadata.changedFields)
        ? entry.metadata.changedFields.filter(
            (field): field is string =>
              typeof field === 'string' &&
              [
                'companyName',
                'publicName',
                'contactName',
                'contactEmail',
                'websiteUrl'
              ].includes(field)
          )
        : [];
      const reason = this.metadataString(entry, 'reason');
      return [
        this.presentation.t('admin.editDossier.actor', { actor: entry.actor }),
        fields
          .map((field) =>
            this.presentation.t('admin.editDossier.fields.' + field)
          )
          .join(', '),
        reason &&
        ['correction', 'contact_update', 'organization_update'].includes(reason)
          ? this.presentation.t('admin.editDossier.reasons.' + reason)
          : ''
      ]
        .filter(Boolean)
        .join(' · ');
    }
    const details = [`Acteur: ${entry.actor}`];

    if (
      entry.action === 'sponsorship_refund.stripe_full' ||
      entry.action === 'sponsorship_refund.stripe_partial'
    ) {
      const amount = this.metadataNumber(entry, 'amount');
      const currency = this.metadataString(entry, 'currency');
      const fullRefund = this.metadataBoolean(entry, 'fullRefund');
      const refundId = this.metadataString(entry, 'refundId');
      const refundReason = this.metadataString(
        entry,
        'refundReason'
      ) as AdminSponsorshipStripeRefundReason | null;
      const paymentIntentId = this.metadataString(entry, 'paymentIntentId');
      const refundStatus = this.metadataString(entry, 'refundStatus');
      const refundWorkflowStatus = this.metadataString(
        entry,
        'refundWorkflowStatus'
      ) as AdminSponsorshipRefundWorkflowStatus | null;
      const creditNoteNumber = this.metadataString(entry, 'creditNoteNumber');
      const creditNoteError = this.metadataString(entry, 'creditNoteError');
      const notificationSent = this.metadataBoolean(entry, 'notificationSent');
      const notificationError = this.metadataString(entry, 'notificationError');

      if (amount !== null && currency) {
        details.push(
          this.presentation.t('admin.messages.montant_p0', {
            p0: this.presentation.formatAmount(amount / 100, currency)
          })
        );
      }
      if (fullRefund !== null) {
        details.push(
          fullRefund
            ? this.presentation.t('admin.messages.type_complet')
            : this.presentation.t('admin.messages.type_partiel')
        );
      }
      if (refundReason) {
        details.push(
          this.presentation.t('admin.messages.raison_p0', {
            p0: this.stripeRefundReasonLabel(refundReason)
          })
        );
      }
      if (refundId) {
        details.push(`Refund: ${refundId}`);
      }
      if (paymentIntentId) {
        details.push(`PaymentIntent: ${paymentIntentId}`);
      }
      if (refundStatus) {
        details.push(`Statut: ${refundStatus}`);
      }
      if (refundWorkflowStatus) {
        details.push(
          `Suivi: ${this.refundWorkflowStatusLabel(refundWorkflowStatus)}`
        );
      }
      if (creditNoteNumber) {
        details.push(`Avoir: ${creditNoteNumber}`);
      }
      if (creditNoteError) {
        details.push(
          this.presentation.t('admin.messages.erreur_avoir_p0', {
            p0: creditNoteError
          })
        );
      }
      if (notificationSent !== null) {
        details.push(
          notificationSent
            ? this.presentation.t('admin.messages.courriel_envoye')
            : this.presentation.t('admin.messages.courriel_non_envoye')
        );
      }
      if (notificationError) {
        details.push(
          this.presentation.t('admin.messages.erreur_courriel_p0', {
            p0: notificationError
          })
        );
      }
    }

    if (entry.action === 'sponsorship_publication.update') {
      const feedStatus =
        typeof entry.metadata.feedStatus === 'string'
          ? (entry.metadata.feedStatus as SponsorFeedStatus)
          : null;
      if (feedStatus) {
        details.push(
          `Publication: ${this.presentation.feedStatusLabel(feedStatus)}`
        );
      }
    }

    if (entry.action.startsWith('sponsorship_review.')) {
      const notificationSent = this.metadataBoolean(entry, 'notificationSent');
      const refundHandling = this.metadataString(
        entry,
        'refundHandling'
      ) as AdminSponsorshipRejectionRefundHandling | null;
      const refundWorkflowStatus = this.metadataString(
        entry,
        'refundWorkflowStatus'
      ) as AdminSponsorshipRefundWorkflowStatus | null;
      const hasRefundNote = this.metadataBoolean(entry, 'hasRefundNote');
      if (notificationSent !== null) {
        details.push(
          notificationSent
            ? this.presentation.t('admin.messages.courriel_envoye')
            : this.presentation.t('admin.messages.courriel_non_envoye')
        );
      }
      if (refundHandling && refundHandling !== 'none') {
        details.push(
          `Traitement: ${this.refundHandlingAuditLabel(refundHandling)}`
        );
      }
      if (refundWorkflowStatus) {
        details.push(
          `Suivi: ${this.refundWorkflowStatusLabel(refundWorkflowStatus)}`
        );
      }
      if (hasRefundNote) {
        details.push(
          this.presentation.t('admin.messages.note_remboursement_presente')
        );
      }
    }

    return details.join(' - ');
  }
}
