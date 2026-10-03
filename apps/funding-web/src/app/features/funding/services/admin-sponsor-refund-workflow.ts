import { signal } from '@angular/core';
import type {
  AdminSponsorshipRecord,
  AdminSponsorshipRefundResult,
  AdminSponsorshipStripeRefundReason
} from '@openg7/funding-core';

import type {
  AdminSponsorRefundPorts,
  SponsorRefundDraft
} from '../models/admin-sponsor-workflow.ports.js';

import { AdminDashboardRequestError } from './funding-admin-session.js';

/** Local refund workflow; authorization, locking and server refresh belong to the page. */
export class AdminSponsorRefundWorkflow {
  readonly activeRefundId = signal<string | null>(null);
  readonly refundDrafts = signal<Record<string, SponsorRefundDraft>>({});

  constructor(private readonly ports: AdminSponsorRefundPorts) {}

  openRefundPanel(sponsorship: AdminSponsorshipRecord): boolean {
    if (
      !this.ports.canActOn(sponsorship) ||
      !this.canRefundSponsorship(sponsorship)
    )
      return false;
    this.ensureRefundDraft(sponsorship);
    this.activeRefundId.set(sponsorship.id);
    this.ports.setReviewMessage(
      sponsorship.id,
      this.ports.t(
        'admin.messages.recopiez_p0_pour_confirmer_le_remboursement_stripe',
        { p0: this.refundConfirmationText(sponsorship) }
      )
    );
    return true;
  }

  closeRefundPanel(): boolean {
    if (this.ports.actionPending()) return false;
    this.activeRefundId.set(null);
    return true;
  }

  isRefundPanelOpen(sponsorship: AdminSponsorshipRecord): boolean {
    return this.activeRefundId() === sponsorship.id;
  }

  refundDraftFor(sponsorship: AdminSponsorshipRecord): SponsorRefundDraft {
    return (
      this.refundDrafts()[sponsorship.id] ??
      this.defaultRefundDraft(sponsorship)
    );
  }

  setRefundDraftField(
    id: string,
    field:
      | 'confirmationText'
      | 'refundAmount'
      | 'recipientEmail'
      | 'sponsorMessage'
      | 'refundNote',
    event: Event
  ): void {
    const input = event.target as HTMLInputElement | HTMLTextAreaElement;
    this.refundDrafts.update((drafts) => {
      const current = drafts[id] ?? this.emptyRefundDraft();
      return {
        ...drafts,
        [id]: {
          ...current,
          [field]: input.value
        }
      };
    });
  }

  setRefundDraftReason(id: string, event: Event): void {
    const input = event.target as HTMLSelectElement;
    const value = input.value as AdminSponsorshipStripeRefundReason;
    this.refundDrafts.update((drafts) => {
      const current = drafts[id] ?? this.emptyRefundDraft();
      return {
        ...drafts,
        [id]: {
          ...current,
          refundReason: value
        }
      };
    });
  }

  setRefundDraftBoolean(
    id: string,
    field: 'notifySponsor',
    event: Event
  ): void {
    const input = event.target as HTMLInputElement;
    this.refundDrafts.update((drafts) => {
      const current = drafts[id] ?? this.emptyRefundDraft();
      return {
        ...drafts,
        [id]: {
          ...current,
          [field]: input.checked
        }
      };
    });
  }

  canRefundSponsorship(sponsorship: AdminSponsorshipRecord): boolean {
    return (
      this.ports.canUseOwnerActions() &&
      sponsorship.payment_status === 'paid' &&
      sponsorship.sponsorship_refund_status !== 'processing' &&
      !(
        sponsorship.sponsorship_refund_status === 'completed' &&
        !sponsorship.sponsorship_refund_id
      )
    );
  }

  refundConfirmationText(sponsorship: AdminSponsorshipRecord): string {
    return sponsorship.public_reference || sponsorship.id;
  }

  refundAmountFor(sponsorship: AdminSponsorshipRecord): number | null {
    const value = this.refundDraftFor(sponsorship)
      .refundAmount.trim()
      .replace(',', '.');
    if (!value) {
      return null;
    }

    if (!/^\d+(?:\.\d{1,2})?$/.test(value)) {
      return null;
    }

    const amount = Number(value);
    if (!Number.isFinite(amount)) {
      return null;
    }

    return amount;
  }

  refundDraftAmountLabel(sponsorship: AdminSponsorshipRecord): string {
    const amount = this.refundAmountFor(sponsorship);
    return amount
      ? this.ports.formatAmount(amount, sponsorship.currency)
      : 'montant invalide';
  }

  isFullRefundDraft(sponsorship: AdminSponsorshipRecord): boolean {
    const amount = this.refundAmountFor(sponsorship);
    return (
      amount !== null &&
      Math.round(amount * 100) === Math.round(sponsorship.amount * 100)
    );
  }

  canConfirmRefund(sponsorship: AdminSponsorshipRecord): boolean {
    const draft = this.refundDraftFor(sponsorship);
    const refundAmount = this.refundAmountFor(sponsorship);
    return (
      this.canRefundSponsorship(sponsorship) &&
      refundAmount !== null &&
      refundAmount > 0 &&
      refundAmount <= sponsorship.amount &&
      draft.confirmationText.trim() ===
        this.refundConfirmationText(sponsorship) &&
      (!draft.notifySponsor ||
        (this.isValidEmailDraft(draft.recipientEmail) &&
          draft.sponsorMessage.trim().length > 0))
    );
  }

  refundValidationMessage(sponsorship: AdminSponsorshipRecord): string {
    const draft = this.refundDraftFor(sponsorship);
    if (!this.canRefundSponsorship(sponsorship)) {
      if (sponsorship.sponsorship_refund_status === 'completed') {
        return this.ports.t(
          'admin.messages.remboursement_manuel_deja_marque_comme_complete'
        );
      }

      if (sponsorship.sponsorship_refund_status === 'processing') {
        return this.ports.t(
          'admin.messages.un_remboursement_est_deja_en_cours'
        );
      }

      return this.ports.t(
        'admin.messages.remboursement_stripe_disponible_seulement_pour_un_paiement_paye'
      );
    }

    const refundAmount = this.refundAmountFor(sponsorship);
    if (refundAmount === null || refundAmount <= 0) {
      return this.ports.t(
        'admin.messages.montant_de_remboursement_obligatoire'
      );
    }

    if (refundAmount > sponsorship.amount) {
      return this.ports.t('admin.messages.montant_maximum_p0', {
        p0: this.ports.formatMoney(sponsorship)
      });
    }

    if (!draft.confirmationText.trim()) {
      return this.ports.t('admin.messages.texte_de_confirmation_obligatoire');
    }

    if (
      draft.confirmationText.trim() !== this.refundConfirmationText(sponsorship)
    ) {
      return this.ports.t(
        'admin.messages.le_texte_ne_correspond_pas_a_la_reference_demandee'
      );
    }

    if (draft.notifySponsor && !this.isValidEmailDraft(draft.recipientEmail)) {
      return this.ports.t('admin.messages.destinataire_courriel_requis');
    }

    if (draft.notifySponsor && !draft.sponsorMessage.trim()) {
      return this.ports.t(
        'admin.messages.message_au_commanditaire_obligatoire'
      );
    }

    const refundType = this.isFullRefundDraft(sponsorship)
      ? this.ports.t('admin.messages.complet')
      : this.ports.t('admin.messages.partiel');
    return draft.notifySponsor
      ? this.ports.t(
          'admin.messages.pret_a_declencher_le_remboursement_p0_et_envoyer_le_courriel',
          { p0: refundType }
        )
      : this.ports.t(
          'admin.messages.pret_a_declencher_le_remboursement_stripe_p0',
          { p0: refundType }
        );
  }

  async confirmRefund(sponsorship: AdminSponsorshipRecord): Promise<void> {
    if (!this.ports.canActOn(sponsorship)) return;
    if (!this.canConfirmRefund(sponsorship)) {
      this.ports.setReviewMessage(
        sponsorship.id,
        this.refundValidationMessage(sponsorship),
        true
      );
      return;
    }

    const draft = this.refundDraftFor(sponsorship);
    this.ports.setActionState(this.refundActionId(sponsorship.id));
    this.ports.setReviewMessage(
      sponsorship.id,
      this.ports.t('admin.messages.remboursement_stripe_en_cours')
    );

    try {
      const result = await this.ports.admin.refundSponsorship(
        this.ports.adminToken(),
        {
          contributionId: sponsorship.id,
          expectedVersion: sponsorship.version,
          confirmationText: draft.confirmationText.trim(),
          amount: this.refundAmountFor(sponsorship) ?? sponsorship.amount,
          refundReason: draft.refundReason,
          refundNote: draft.refundNote.trim() || undefined,
          notifySponsor: draft.notifySponsor,
          notificationEmail: draft.notifySponsor
            ? draft.recipientEmail.trim()
            : undefined,
          sponsorMessage: draft.notifySponsor
            ? draft.sponsorMessage.trim()
            : undefined
        }
      );
      await this.ports.reloadSponsorships();
      this.activeRefundId.set(null);
      this.ports.setReviewMessage(
        sponsorship.id,
        [
          this.refundResultLabel(result),
          this.refundNotificationResultLabel(result)
        ]
          .filter(Boolean)
          .join(' '),
        true
      );
      this.ports.pulseSelection(sponsorship.id);
    } catch (error) {
      if (
        error instanceof AdminDashboardRequestError &&
        error.code === 'SPONSORSHIP_REFUND_UNCERTAIN'
      ) {
        this.activeRefundId.set(null);
        await this.ports.reloadSponsorships();
        this.ports.setReviewMessage(
          sponsorship.id,
          this.ports.t('admin.messages.refund_awaiting_confirmation'),
          true
        );
        return;
      }
      this.ports.setReviewMessage(
        sponsorship.id,
        this.ports.messageFromError(
          error,
          this.ports.t(
            'admin.messages.action_impossible_le_remboursement_stripe_n_a_pas_pu_etre_cree'
          )
        ),
        true
      );
    } finally {
      this.ports.setActionState(null);
    }
  }

  refundActionId(id: string): string {
    return `refund:${id}`;
  }

  refundResultLabel(result: AdminSponsorshipRefundResult): string {
    const status = result.refundStatus
      ? this.ports.t('admin.messages.statut_stripe_p0', {
          p0: result.refundStatus
        })
      : '';
    const refundType = result.fullRefund
      ? this.ports.t('admin.messages.complet')
      : this.ports.t('admin.messages.partiel');
    const reason = this.ports.t('admin.messages.raison_p0', {
      p0: this.ports.stripeRefundReasonLabel(result.refundReason)
    });
    const workflow = ` Suivi: ${this.ports.refundWorkflowStatusLabel(
      result.refundWorkflowStatus
    )}.`;
    const localStatus = result.paymentStatusUpdated
      ? this.ports.t('admin.messages.commandite_marquee_comme_remboursee')
      : '';
    const creditNote = result.creditNote
      ? this.ports.t('admin.messages.avoir_cree_p0', {
          p0: result.creditNote.credit_note_number
        })
      : '';

    return this.ports.t(
      'admin.messages.remboursement_stripe_p0_cree_p1_p2_p3_p4_p5_p6',
      {
        p0: refundType,
        p1: this.ports.formatAmount(result.amount, result.currency),
        p2: reason,
        p3: status,
        p4: workflow,
        p5: localStatus,
        p6: creditNote
      }
    );
  }

  refundNotificationResultLabel(result: AdminSponsorshipRefundResult): string {
    if (!result.notification) {
      return '';
    }

    if (result.notification.sent) {
      return this.ports.t(
        'admin.messages.courriel_de_remboursement_avoir_envoye'
      );
    }

    if (result.notification.queued) {
      return this.ports.t(
        'admin.messages.courriel_de_remboursement_avoir_mis_en_file'
      );
    }

    return result.notification.error
      ? `Courriel de remboursement/avoir non envoye: ${result.notification.error}`
      : this.ports.t(
          'admin.messages.courriel_de_remboursement_avoir_non_envoye'
        );
  }

  private ensureRefundDraft(sponsorship: AdminSponsorshipRecord): void {
    this.refundDrafts.update((drafts) =>
      drafts[sponsorship.id]
        ? drafts
        : {
            ...drafts,
            [sponsorship.id]: this.defaultRefundDraft(sponsorship)
          }
    );
  }

  private defaultRefundDraft(
    sponsorship: AdminSponsorshipRecord
  ): SponsorRefundDraft {
    const sponsorName =
      sponsorship.sponsor_company_name ||
      sponsorship.public_name ||
      'votre organisation';

    return {
      confirmationText: '',
      refundAmount: sponsorship.amount.toFixed(2),
      refundReason: 'requested_by_customer',
      notifySponsor: Boolean(sponsorship.sponsor_contact_email),
      recipientEmail: sponsorship.sponsor_contact_email ?? '',
      sponsorMessage: [
        this.ports.t('admin.messages.bonjour_p0', { p0: sponsorName }),
        '',
        this.ports.t(
          'admin.messages.nous_confirmons_que_le_remboursement_stripe_de_votre_commandite_openg7_vient_d_etre_lance'
        ),
        '',
        this.ports.t(
          'admin.messages.selon_votre_institution_financiere_le_credit_peut_prendre_quelques_jours_ouvrables_avant_d_appa'
        )
      ].join('\n'),
      refundNote: ''
    };
  }

  private emptyRefundDraft(): SponsorRefundDraft {
    return {
      confirmationText: '',
      refundAmount: '',
      refundReason: 'requested_by_customer',
      notifySponsor: false,
      recipientEmail: '',
      sponsorMessage: '',
      refundNote: ''
    };
  }

  private isValidEmailDraft(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
  }
}
