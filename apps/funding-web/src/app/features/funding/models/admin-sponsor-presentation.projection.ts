import {
  DEFAULT_SPONSORSHIP_PRICING_CONFIG,
  resolveSponsorshipBenefits
} from '@openg7/funding-core';
import type {
  AdminSponsorshipRecord,
  SponsorFeedStatus,
  SponsorshipReviewStatus
} from '@openg7/funding-core';

import type {
  AdminSponsorDetailHeaderView,
  AdminSponsorDetailIdentityView,
  AdminSponsorDetailOverviewView,
  AdminSponsorListRow
} from './admin-sponsors-ui.models.js';
import type {
  AdminSponsorIdentityState,
  AdminSponsorOverviewState,
  AdminSponsorPresentation
} from './admin-sponsor-workflow.ports.js';

type SponsorProcessingState =
  | 'action-required'
  | 'approved-ready'
  | 'publication-progress'
  | 'published'
  | 'blocked'
  | 'waiting-payment';

/** Pure dossier presentation; history and media retain their own formatters. */
export class AdminSponsorPresentationProjection {
  constructor(private readonly presentation: AdminSponsorPresentation) {}

  listRow(sponsorship: AdminSponsorshipRecord): AdminSponsorListRow {
    const hasRefundWorkflow =
      this.presentation.history.hasRefundWorkflow(sponsorship);
    return {
      id: sponsorship.id,
      rowStateClass: this.sponsorshipRowStateClass(sponsorship),
      processingLabel: this.sponsorshipProcessingLabel(sponsorship),
      initials: this.initialsFor(sponsorship),
      companyName:
        sponsorship.sponsor_company_name ||
        this.presentation.t('admin.messages.entreprise_sans_nom'),
      contactEmail:
        sponsorship.sponsor_contact_email ||
        this.presentation.t('admin.messages.courriel_non_fourni'),
      amountLabel: this.formatMoney(sponsorship),
      tierClass: this.tierClass(sponsorship),
      tierLabel: this.sponsorshipTierLabel(sponsorship),
      reviewStatusClass: this.statusClass(sponsorship.sponsor_review_status),
      reviewStatusLabel: this.presentation.reviewStatusLabel(
        sponsorship.sponsor_review_status
      ),
      visibilityClass: this.visibilityClass(sponsorship),
      visibilityLabel: this.visibilityLabel(sponsorship),
      feedStatusClass: this.feedStatusClass(sponsorship.sponsor_feed_status),
      feedStatusLabel: this.presentation.feedStatusLabel(
        sponsorship.sponsor_feed_status
      ),
      feedTargetLabel: this.feedTargetLabel(sponsorship),
      feedChannelsLabel: this.feedChannelsLabel(sponsorship),
      paymentStatusClass: this.paymentStatusClass(sponsorship.payment_status),
      paymentStatusLabel: this.presentation.paymentStatusLabel(
        sponsorship.payment_status
      ),
      refundWorkflowStatusClass: hasRefundWorkflow
        ? this.presentation.history.refundWorkflowStatusClass(
            sponsorship.sponsorship_refund_status
          )
        : null,
      refundWorkflowStatusLabel: hasRefundWorkflow
        ? this.presentation.history.refundWorkflowStatusLabel(
            sponsorship.sponsorship_refund_status
          )
        : null,
      paidAtLabel: this.presentation.dateOnlyLabel(sponsorship.paid_at),
      submittedAtLabel: this.presentation.dateOnlyLabel(
        this.submittedAt(sponsorship)
      )
    };
  }

  header(sponsorship: AdminSponsorshipRecord): AdminSponsorDetailHeaderView {
    const hasRefundWorkflow =
      this.presentation.history.hasRefundWorkflow(sponsorship);
    return {
      initials: this.initialsFor(sponsorship),
      companyName:
        sponsorship.sponsor_company_name ||
        this.presentation.t('admin.messages.entreprise_sans_nom'),
      amountLabel: this.formatMoney(sponsorship),
      tierLabel: this.sponsorshipTierLabel(sponsorship),
      reviewStatusClass: this.statusClass(sponsorship.sponsor_review_status),
      reviewStatusLabel: this.presentation.reviewStatusLabel(
        sponsorship.sponsor_review_status
      ),
      visibilityClass: this.visibilityClass(sponsorship),
      visibilityLabel: this.visibilityLabel(sponsorship),
      paymentStatusClass: this.paymentStatusClass(sponsorship.payment_status),
      paymentStatusLabel: this.presentation.paymentStatusLabel(
        sponsorship.payment_status
      ),
      refundWorkflowStatusClass: hasRefundWorkflow
        ? this.presentation.history.refundWorkflowStatusClass(
            sponsorship.sponsorship_refund_status
          )
        : null,
      refundWorkflowStatusLabel: hasRefundWorkflow
        ? this.presentation.history.refundWorkflowStatusLabel(
            sponsorship.sponsorship_refund_status
          )
        : null,
      publicReferenceLabel:
        sponsorship.public_reference ||
        this.presentation.t('admin.legacy.non_attribuee_175'),
      submittedAtLabel: this.presentation.dateOnlyLabel(
        this.submittedAt(sponsorship)
      ),
      reviewedAtLabel: this.presentation.dateOnlyLabel(
        sponsorship.sponsor_reviewed_at
      )
    };
  }

  overview(
    sponsorship: AdminSponsorshipRecord,
    state: AdminSponsorOverviewState
  ): AdminSponsorDetailOverviewView {
    return {
      companyName:
        sponsorship.sponsor_company_name ||
        this.presentation.t('admin.messages.entreprise_sans_nom'),
      publicNameLabel: this.publicNameLabel(sponsorship),
      contactName:
        sponsorship.sponsor_contact_name ||
        this.presentation.t('admin.legacy.non_fourni'),
      contactEmail: sponsorship.sponsor_contact_email || null,
      websiteUrl: sponsorship.sponsor_website_url || null,
      publicReference: sponsorship.public_reference || null,
      copyMessage: state.copyMessage,
      amountLabel: this.formatMoney(sponsorship),
      tierClass: this.tierClass(sponsorship),
      tierLabel: this.sponsorshipTierLabel(sponsorship),
      benefitsLabel: this.sponsorshipBenefitsLabel(sponsorship),
      paymentStatusClass: this.paymentStatusClass(sponsorship.payment_status),
      paymentStatusLabel: this.presentation.paymentStatusLabel(
        sponsorship.payment_status
      ),
      refundStatusClass: this.presentation.history.refundWorkflowStatusClass(
        sponsorship.sponsorship_refund_status
      ),
      refundStatusLabel: this.presentation.history.refundWorkflowStatusLabel(
        sponsorship.sponsorship_refund_status
      ),
      hasRefundWorkflow:
        this.presentation.history.hasRefundWorkflow(sponsorship),
      refundWorkflowTimelineLabel:
        this.presentation.history.refundWorkflowTimelineLabel(sponsorship),
      refundId: sponsorship.sponsorship_refund_id || null,
      paidAtLabel: this.presentation.dateOnlyLabel(sponsorship.paid_at),
      sponsorMessage: sponsorship.sponsor_message || null,
      reviewNote: state.reviewNote,
      reviewNoteDirty: state.reviewNoteDirty,
      reviewNoteStateLabel: state.reviewNoteStateLabel,
      reviewNoteSaving: state.reviewNoteSaving
    };
  }

  identity(
    sponsorship: AdminSponsorshipRecord,
    state: AdminSponsorIdentityState
  ): AdminSponsorDetailIdentityView {
    const mediaAssets = state.mediaAssets.map((asset) => ({
      id: asset.id,
      version: asset.version,
      kindLabel:
        asset.kind === 'logo'
          ? this.presentation.t('admin.messages.logo_propose')
          : this.presentation.t('admin.messages.photo_de_presentation'),
      reviewStatus: asset.reviewStatus,
      reviewStatusLabel: this.presentation.media.sponsorMediaStatusLabel(
        asset.reviewStatus
      ),
      previewSource: state.mediaPreviewUrls[asset.id] ?? null,
      altText: asset.altText ?? '',
      dimensionsLabel: `${asset.width} x ${asset.height} px`,
      sizeLabel: this.presentation.media.formatMediaSize(
        asset.processedSizeBytes
      )
    }));
    return {
      companyName:
        sponsorship.sponsor_company_name ||
        this.presentation.t('admin.messages.entreprise_sans_nom'),
      logoPreviewSource: state.logoPreviewSource || null,
      logoUrl: sponsorship.sponsor_logo_url || null,
      publicNameLabel: this.publicNameLabel(sponsorship),
      websiteUrl: sponsorship.sponsor_website_url || null,
      logoActionLabel: sponsorship.sponsor_logo_url
        ? this.presentation.t('admin.messages.remplacer_le_logo')
        : this.presentation.t('admin.messages.televerser_un_logo'),
      uploadDisabled: state.disabled,
      deleteDisabled: !sponsorship.sponsor_logo_url || state.disabled,
      statusMessage:
        state.logoMessage ||
        this.presentation.t(
          'admin.messages.formats_acceptes_png_jpeg_ou_webp_max_512_kib'
        ),
      mediaAssets,
      mediaMessage:
        state.mediaMessage ??
        this.presentation.t(
          'admin.messages.les_decisions_media_sont_independantes_de_la_revue_de_la_commandite'
        ),
      mediaBusy: state.disabled,
      approvableMediaCount: mediaAssets.filter(
        (asset) => asset.reviewStatus !== 'approved'
      ).length
    };
  }

  initialsFor(sponsorship: AdminSponsorshipRecord): string {
    const source =
      sponsorship.sponsor_company_name ||
      sponsorship.sponsor_contact_name ||
      sponsorship.public_reference ||
      'OG';
    const initials = source
      .split(/\s+/)
      .map((part) => part.charAt(0))
      .join('')
      .slice(0, 2)
      .toUpperCase();
    return initials || 'OG';
  }

  visibilityLabel(sponsorship: AdminSponsorshipRecord): string {
    return this.presentation.t(
      sponsorship.public_display_consent
        ? 'admin.dossier.consentGranted'
        : 'admin.dossier.consentMissing'
    );
  }

  visibilityClass(sponsorship: AdminSponsorshipRecord): string {
    return sponsorship.public_display_consent
      ? 'visibility-badge visibility-visible'
      : 'visibility-badge visibility-hidden';
  }

  feedStatusClass(status: SponsorFeedStatus): string {
    return `feed-badge feed-${status}`;
  }

  sponsorshipProcessingState(
    sponsorship: AdminSponsorshipRecord
  ): SponsorProcessingState {
    const isBlocked =
      sponsorship.sponsor_review_status === 'rejected' ||
      sponsorship.sponsorship_refund_status === 'processing' ||
      ['refunded', 'disputed', 'failed'].includes(sponsorship.payment_status);
    if (isBlocked) return 'blocked';
    if (sponsorship.payment_status !== 'paid') return 'waiting-payment';
    if (sponsorship.sponsor_review_status === 'pending_review')
      return 'action-required';
    if (sponsorship.sponsor_feed_status === 'published') return 'published';
    if (
      sponsorship.sponsor_feed_status === 'planned' ||
      sponsorship.sponsor_feed_status === 'drafted'
    )
      return 'publication-progress';
    return 'approved-ready';
  }

  sponsorshipRowStateClass(sponsorship: AdminSponsorshipRecord): string {
    return `sponsor-row-state-${this.sponsorshipProcessingState(sponsorship)}`;
  }

  sponsorshipProcessingLabel(sponsorship: AdminSponsorshipRecord): string {
    switch (this.sponsorshipProcessingState(sponsorship)) {
      case 'action-required':
        return this.presentation.t('admin.messages.traitement_requis');
      case 'approved-ready':
        return 'Approuvee, publication a planifier';
      case 'publication-progress':
        return this.presentation.t('admin.messages.publication_en_preparation');
      case 'published':
        return this.presentation.t('admin.messages.publication_terminee');
      case 'blocked':
        return this.presentation.t('admin.messages.commandite_bloquee');
      case 'waiting-payment':
        return this.presentation.t('admin.messages.paiement_en_attente');
    }
  }

  feedTargetLabel(sponsorship: AdminSponsorshipRecord): string {
    if (sponsorship.sponsor_feed_target === 'openg7') return 'OpenG7';
    if (sponsorship.sponsor_feed_target === 'openg20') return 'OpenG20';
    return this.presentation.t('admin.legacy.aucune');
  }

  feedChannelsLabel(sponsorship: AdminSponsorshipRecord): string {
    if (sponsorship.sponsor_feed_channels.length === 0)
      return this.presentation.t('admin.messages.aucun_canal');
    return sponsorship.sponsor_feed_channels
      .map((channel) =>
        channel === 'linkedin'
          ? 'LinkedIn'
          : this.presentation.t('admin.messages.facebook')
      )
      .join(' / ');
  }

  statusClass(status: SponsorshipReviewStatus): string {
    return `status-badge status-${status.replace('_review', '')}`;
  }

  paymentStatusClass(status: string): string {
    const state =
      status === 'paid'
        ? 'paid'
        : status === 'failed' || status === 'disputed'
          ? 'failed'
          : 'pending';
    return `payment-badge payment-${state}`;
  }

  formatMoney(sponsorship: AdminSponsorshipRecord): string {
    return `${new Intl.NumberFormat(this.presentation.currentLanguage(), { maximumFractionDigits: 0 }).format(sponsorship.amount)} $ ${(sponsorship.currency || 'CAD').toUpperCase()}`;
  }

  formatSummaryMoney(amount: number): string {
    return `${new Intl.NumberFormat(this.presentation.currentLanguage(), { maximumFractionDigits: 0 }).format(amount)} $ CAD`;
  }

  sponsorshipTierLabel(sponsorship: AdminSponsorshipRecord): string {
    const { tier } = resolveSponsorshipBenefits(
      sponsorship.amount,
      DEFAULT_SPONSORSHIP_PRICING_CONFIG
    );
    switch (tier) {
      case 'website_facebook_linkedin':
        return 'Or';
      case 'website_facebook':
        return this.presentation.t('admin.messages.argent');
      case 'website_only':
        return this.presentation.t('admin.messages.bronze');
      default:
        return this.presentation.t('admin.messages.indetermine');
    }
  }

  tierClass(sponsorship: AdminSponsorshipRecord): string {
    const tier = this.sponsorshipTierLabel(sponsorship).toLowerCase();
    const state =
      tier === 'or' ? 'gold' : tier === 'argent' ? 'silver' : 'bronze';
    return `tier-badge tier-${state}`;
  }

  sponsorshipBenefitsLabel(sponsorship: AdminSponsorshipRecord): string {
    const { achievedBenefits } = resolveSponsorshipBenefits(
      sponsorship.amount,
      DEFAULT_SPONSORSHIP_PRICING_CONFIG
    );
    if (achievedBenefits.length === 0)
      return this.presentation.t(
        'admin.messages.aucun_avantage_montant_sous_le_minimum_de_commandite'
      );
    const labels: Record<(typeof achievedBenefits)[number], string> = {
      website_mention: this.presentation.t('admin.messages.mention_openg7_org'),
      facebook_batch: this.presentation.t(
        'admin.messages.lot_collectif_facebook'
      ),
      linkedin_batch: this.presentation.t(
        'admin.messages.lot_collectif_linkedin'
      )
    };
    return achievedBenefits.map((benefit) => labels[benefit]).join(', ');
  }

  submittedAt(sponsorship: AdminSponsorshipRecord): string | null {
    return (
      sponsorship.sponsor_details_submitted_at ||
      sponsorship.paid_at ||
      sponsorship.created_at
    );
  }

  publicNameLabel(sponsorship: AdminSponsorshipRecord): string {
    if (!sponsorship.public_display_consent)
      return this.presentation.t('admin.messages.non_consenti');
    return sponsorship.public_name || 'Consenti, nom manquant';
  }
}
