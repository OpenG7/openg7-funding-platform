import { signal } from '@angular/core';
import type {
  AdminSponsorshipRecord,
  AdminSponsorshipRefundWorkflowStatus,
  AdminSponsorshipRejectionRefundHandling,
  AdminSponsorshipReviewResult,
  SponsorshipReviewStatus
} from '@openg7/funding-core';

import type {
  AdminSponsorReviewPorts,
  SponsorRejectionDraft
} from '../models/admin-sponsor-workflow.ports.js';

/** Local review forms; the page owns permissions, selection, locking and refresh. */
export class AdminSponsorReviewWorkflow {
  readonly reviewNotes = signal<Record<string, string>>({});
  readonly activeRejectionId = signal<string | null>(null);
  readonly reviewMessages = signal<Record<string, string>>({});
  readonly noteMessages = signal<Record<string, string>>({});
  readonly rejectionDrafts = signal<Record<string, SponsorRejectionDraft>>({});

  private readonly reviewMessageTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private disposed = false;

  constructor(private readonly ports: AdminSponsorReviewPorts) {}

  reconcile(
    previous: readonly AdminSponsorshipRecord[],
    next: readonly AdminSponsorshipRecord[],
    preserveDrafts: boolean
  ): void {
    if (this.disposed) return;
    const beforeById = new Map(previous.map((item) => [item.id, item]));
    const notes = this.reviewNotes();
    this.reviewNotes.set(
      Object.fromEntries(
        next.map((item) => {
          const before = beforeById.get(item.id);
          const draft = notes[item.id];
          return [
            item.id,
            preserveDrafts &&
            before &&
            draft !== undefined &&
            draft !== (before.sponsor_review_note ?? '')
              ? draft
              : (item.sponsor_review_note ?? '')
          ];
        })
      )
    );
    // Rejection forms survive ordinary refreshes, cancellation and request errors.
    // Conflict reconciliation updates defaults while retaining every local edit.
    if (!preserveDrafts) return;
    this.rejectionDrafts.update((drafts) => {
      const reconciled = { ...drafts };
      for (const item of next) {
        const before = beforeById.get(item.id);
        const draft = drafts[item.id];
        if (!before || !draft) continue;
        const baseline = this.defaultRejectionDraft(before);
        const refreshed = this.defaultRejectionDraft(item);
        const edits = Object.fromEntries(
          Object.entries(draft).filter(
            ([key, value]) =>
              value !== baseline[key as keyof SponsorRejectionDraft]
          )
        );
        reconciled[item.id] = { ...refreshed, ...edits };
      }
      return reconciled;
    });
  }

  async review(
    sponsorship: AdminSponsorshipRecord,
    reviewStatus: SponsorshipReviewStatus
  ): Promise<void> {
    if (
      this.disposed ||
      !this.ports.canActOn(sponsorship) ||
      reviewStatus === sponsorship.sponsor_review_status
    )
      return;
    if (reviewStatus === 'rejected') {
      this.ports.openRejectionPanel(sponsorship);
      return;
    }
    if (
      reviewStatus === 'approved' &&
      !this.canApproveSponsorship(sponsorship)
    ) {
      this.setReviewMessage(
        sponsorship.id,
        this.ports.paymentEligibilityMessage(sponsorship) ||
          this.ports.t(
            'admin.messages.action_impossible_le_paiement_n_est_pas_admissible'
          ),
        true
      );
      return;
    }
    const revision = this.ports.selectionRevision();
    const reviewNote = this.reviewNoteFor(sponsorship.id).trim();
    if (
      reviewStatus === 'pending_review' &&
      !(await this.ports.confirm(
        this.ports.t('admin.messages.remettre_ce_dossier_en_attente')
      ))
    )
      return;
    if (
      !this.isCurrent(sponsorship.id, revision) ||
      !this.ports.canActOn(sponsorship)
    )
      return;
    const approvalAttempt = this.ports.beginApprovalFeedback(
      reviewStatus === 'approved' ? sponsorship.id : null
    );
    this.ports.setActionState(this.reviewActionId(sponsorship.id));
    const pendingMessage = this.ports.t('admin.messages.action_en_cours_p0', {
      p0: this.reviewActionName(reviewStatus)
    });
    this.setReviewMessage(sponsorship.id, pendingMessage);
    try {
      const result = await this.ports.admin.reviewSponsorship(
        this.ports.adminToken(),
        {
          contributionId: sponsorship.id,
          reviewStatus,
          reviewNote: reviewNote || undefined,
          expectedVersion: sponsorship.version
        }
      );
      if (this.disposed) return;
      if (!result.updated)
        throw new Error('Sponsorship review was not updated.');
      await this.ports.reloadSponsorships();
      if (!this.isCurrent(sponsorship.id, revision)) {
        this.clearReviewMessage(sponsorship.id, pendingMessage);
        return;
      }
      if (approvalAttempt)
        this.ports.finishApprovalFeedback(approvalAttempt, 'success');
      this.setReviewMessage(
        sponsorship.id,
        this.reviewSuccessMessage(reviewStatus),
        true
      );
      this.ports.pulseSelection(sponsorship.id);
    } catch (error) {
      if (this.disposed) return;
      const message = this.ports.messageFromError(
        error,
        this.ports.t(
          'admin.messages.action_impossible_la_revue_n_a_pas_pu_etre_enregistree'
        )
      );
      if (!this.isCurrent(sponsorship.id, revision)) {
        this.clearReviewMessage(sponsorship.id, pendingMessage);
        return;
      }
      if (approvalAttempt)
        this.ports.finishApprovalFeedback(approvalAttempt, 'error');
      this.setReviewMessage(sponsorship.id, message, true);
    } finally {
      this.ports.setActionState(null);
    }
  }

  openRejectionPanel(sponsorship: AdminSponsorshipRecord): boolean {
    if (this.disposed || !this.ports.canActOn(sponsorship)) return false;
    this.ensureRejectionDraft(sponsorship);
    this.activeRejectionId.set(sponsorship.id);
    this.setReviewMessage(
      sponsorship.id,
      this.ports.t(
        'admin.messages.completez_la_raison_le_message_et_le_traitement_du_remboursement'
      )
    );
    return true;
  }

  closeRejectionPanel(): boolean {
    if (this.disposed || this.ports.actionPending()) return false;
    this.activeRejectionId.set(null);
    return true;
  }

  isRejectionPanelOpen(sponsorship: AdminSponsorshipRecord): boolean {
    return this.activeRejectionId() === sponsorship.id;
  }

  rejectionDraftFor(
    sponsorship: AdminSponsorshipRecord
  ): SponsorRejectionDraft {
    return (
      this.rejectionDrafts()[sponsorship.id] ??
      this.defaultRejectionDraft(sponsorship)
    );
  }

  setRejectionDraftField(
    id: string,
    field: 'recipientEmail' | 'sponsorMessage' | 'refundNote',
    event: Event
  ): void {
    const input = event.target as HTMLInputElement | HTMLTextAreaElement;
    this.rejectionDrafts.update((drafts) => ({
      ...drafts,
      [id]: {
        ...(drafts[id] ?? this.emptyRejectionDraft()),
        [field]: input.value
      }
    }));
  }

  setRejectionDraftBoolean(
    id: string,
    field: 'notifySponsor',
    event: Event
  ): void {
    const input = event.target as HTMLInputElement;
    this.rejectionDrafts.update((drafts) => ({
      ...drafts,
      [id]: {
        ...(drafts[id] ?? this.emptyRejectionDraft()),
        [field]: input.checked
      }
    }));
  }

  setRejectionRefundHandling(id: string, event: Event): void {
    const input = event.target as HTMLSelectElement;
    const value = input.value as AdminSponsorshipRejectionRefundHandling;
    this.rejectionDrafts.update((drafts) => ({
      ...drafts,
      [id]: {
        ...(drafts[id] ?? this.emptyRejectionDraft()),
        refundHandling: value
      }
    }));
  }

  canConfirmRejection(sponsorship: AdminSponsorshipRecord): boolean {
    const draft = this.rejectionDraftFor(sponsorship);
    return (
      Boolean(this.reviewNoteFor(sponsorship.id).trim()) &&
      (!draft.notifySponsor ||
        (this.isValidEmailDraft(draft.recipientEmail) &&
          draft.sponsorMessage.trim().length > 0))
    );
  }

  rejectionValidationMessage(sponsorship: AdminSponsorshipRecord): string {
    const draft = this.rejectionDraftFor(sponsorship);
    if (!this.reviewNoteFor(sponsorship.id).trim())
      return this.ports.t('admin.messages.raison_interne_obligatoire');
    if (draft.notifySponsor && !this.isValidEmailDraft(draft.recipientEmail))
      return this.ports.t('admin.messages.destinataire_courriel_requis');
    if (draft.notifySponsor && !draft.sponsorMessage.trim())
      return this.ports.t(
        'admin.messages.message_au_commanditaire_obligatoire'
      );
    return this.ports.t(
      draft.notifySponsor
        ? 'admin.messages.pret_a_refuser_et_envoyer_le_courriel'
        : 'admin.messages.pret_a_refuser_sans_courriel'
    );
  }

  async confirmRejection(sponsorship: AdminSponsorshipRecord): Promise<void> {
    if (this.disposed || !this.ports.canActOn(sponsorship)) return;
    if (!this.canConfirmRejection(sponsorship)) {
      this.setReviewMessage(
        sponsorship.id,
        this.rejectionValidationMessage(sponsorship),
        true
      );
      return;
    }
    const revision = this.ports.selectionRevision();
    const draft = this.rejectionDraftFor(sponsorship);
    const reviewNote = this.reviewNoteFor(sponsorship.id).trim();
    this.ports.setActionState(this.reviewActionId(sponsorship.id));
    const pendingMessage = this.ports.t('admin.messages.action_en_cours_refus');
    this.setReviewMessage(sponsorship.id, pendingMessage);
    try {
      const result = await this.ports.admin.reviewSponsorship(
        this.ports.adminToken(),
        {
          contributionId: sponsorship.id,
          reviewStatus: 'rejected',
          reviewNote,
          expectedVersion: sponsorship.version,
          notifySponsor: draft.notifySponsor,
          notificationEmail: draft.notifySponsor
            ? draft.recipientEmail.trim()
            : undefined,
          sponsorMessage: draft.notifySponsor
            ? draft.sponsorMessage.trim()
            : undefined,
          refundHandling: draft.refundHandling,
          refundNote: draft.refundNote.trim() || undefined
        }
      );
      if (this.disposed) return;
      await this.ports.reloadSponsorships();
      if (!this.isCurrent(sponsorship.id, revision)) {
        this.clearReviewMessage(sponsorship.id, pendingMessage);
        return;
      }
      this.activeRejectionId.set(null);
      this.setReviewMessage(
        sponsorship.id,
        [
          this.reviewSuccessMessage('rejected'),
          this.rejectionNotificationResultLabel(result),
          this.rejectionRefundResultLabel(
            result.refundHandling,
            result.refundWorkflowStatus
          )
        ]
          .filter(Boolean)
          .join(' '),
        true
      );
      this.ports.pulseSelection(sponsorship.id);
    } catch (error) {
      if (this.disposed) return;
      const message = this.ports.messageFromError(
        error,
        this.ports.t(
          'admin.messages.action_impossible_le_refus_n_a_pas_pu_etre_enregistre'
        )
      );
      if (!this.isCurrent(sponsorship.id, revision)) {
        this.clearReviewMessage(sponsorship.id, pendingMessage);
        return;
      }
      this.setReviewMessage(sponsorship.id, message, true);
    } finally {
      this.ports.setActionState(null);
    }
  }

  async saveReviewNote(sponsorship: AdminSponsorshipRecord): Promise<void> {
    if (
      this.disposed ||
      !this.ports.canActOn(sponsorship) ||
      !this.isReviewNoteDirty(sponsorship)
    )
      return;
    const revision = this.ports.selectionRevision();
    this.ports.setActionState(this.noteActionId(sponsorship.id));
    const pendingMessage = this.ports.t(
      'admin.messages.enregistrement_en_cours'
    );
    this.setNoteMessage(sponsorship.id, pendingMessage);
    try {
      await this.ports.admin.reviewSponsorship(this.ports.adminToken(), {
        contributionId: sponsorship.id,
        reviewStatus: sponsorship.sponsor_review_status,
        reviewNote: this.reviewNoteFor(sponsorship.id).trim() || undefined,
        expectedVersion: sponsorship.version
      });
      if (this.disposed) return;
      await this.ports.reloadSponsorships();
      if (!this.isCurrent(sponsorship.id, revision)) {
        if (this.noteMessages()[sponsorship.id] === pendingMessage)
          this.setNoteMessage(sponsorship.id, '');
        return;
      }
      this.setNoteMessage(
        sponsorship.id,
        this.ports.t('admin.dossier.noteEditor.saved')
      );
    } catch (error) {
      if (this.disposed) return;
      const message = this.ports.messageFromError(
        error,
        this.ports.t('admin.messages.la_note_n_a_pas_pu_etre_enregistree')
      );
      if (!this.isCurrent(sponsorship.id, revision)) {
        if (this.noteMessages()[sponsorship.id] === pendingMessage)
          this.setNoteMessage(sponsorship.id, '');
        return;
      }
      this.setNoteMessage(sponsorship.id, message);
    } finally {
      this.ports.setActionState(null);
    }
  }

  setReviewNote(id: string, event: Event): void {
    const input = event.target as HTMLInputElement | HTMLTextAreaElement | null;
    this.setReviewNoteValue(id, input?.value ?? '');
  }

  setReviewNoteValue(id: string, value: string): void {
    this.reviewNotes.update((notes) => ({ ...notes, [id]: value }));
    this.setNoteMessage(id, '');
  }

  reviewNoteFor(id: string): string {
    return this.reviewNotes()[id] ?? '';
  }

  reviewActionId(id: string): string {
    return `review:${id}`;
  }

  noteActionId(id: string): string {
    return `note:${id}`;
  }

  reviewMessageFor(id: string): string {
    return this.reviewMessages()[id] ?? '';
  }

  canApproveSponsorship(sponsorship: AdminSponsorshipRecord): boolean {
    return (
      this.ports.canManage() &&
      sponsorship.sponsor_review_status !== 'approved' &&
      sponsorship.payment_status === 'paid' &&
      !['requested', 'processing'].includes(
        sponsorship.sponsorship_refund_status
      )
    );
  }

  reviewActionName(status: SponsorshipReviewStatus): string {
    return this.ports.t(
      status === 'approved'
        ? 'admin.messages.acceptation'
        : status === 'rejected'
          ? 'admin.messages.refus'
          : 'admin.messages.remise_en_attente'
    );
  }

  reviewSuccessMessage(status: SponsorshipReviewStatus): string {
    return this.ports.t(
      status === 'approved'
        ? 'admin.messages.action_confirmee_commandite_acceptee'
        : status === 'rejected'
          ? 'admin.messages.action_confirmee_commandite_refusee'
          : 'admin.messages.action_confirmee_commandite_remise_en_attente'
    );
  }

  rejectionNotificationResultLabel(
    result: AdminSponsorshipReviewResult
  ): string {
    if (!result.notification)
      return this.ports.t('admin.messages.aucun_courriel_envoye');
    if (result.notification.sent)
      return this.ports.t('admin.messages.courriel_envoye_au_commanditaire');
    if (result.notification.queued)
      return this.ports.t('admin.messages.courriel_mis_en_file');
    return result.notification.error
      ? this.ports.t('admin.messages.courriel_non_envoye_p0', {
          p0: result.notification.error
        })
      : this.ports.t('admin.messages.courriel_non_envoye_');
  }

  rejectionRefundResultLabel(
    handling: AdminSponsorshipRejectionRefundHandling | undefined,
    workflowStatus?: AdminSponsorshipRefundWorkflowStatus
  ): string {
    const workflow = workflowStatus
      ? ` Suivi: ${this.ports.refundWorkflowStatusLabel(workflowStatus)}.`
      : '';
    if (handling === 'manual_required')
      return this.ports.t(
        'admin.messages.remboursement_a_traiter_manuellement_p0',
        { p0: workflow }
      );
    if (handling === 'manual_completed')
      return this.ports.t(
        'admin.messages.remboursement_marque_comme_deja_traite_p0',
        { p0: workflow }
      );
    return '';
  }

  isReviewNoteDirty(sponsorship: AdminSponsorshipRecord): boolean {
    return (
      this.reviewNoteFor(sponsorship.id).trim() !==
      (sponsorship.sponsor_review_note ?? '').trim()
    );
  }

  reviewNoteStateLabel(sponsorship: AdminSponsorshipRecord): string {
    return (
      this.noteMessages()[sponsorship.id] ||
      this.ports.t(
        'admin.dossier.noteEditor.' +
          (this.isReviewNoteDirty(sponsorship)
            ? 'unsaved'
            : sponsorship.sponsor_review_note?.trim()
              ? 'saved'
              : 'empty')
      )
    );
  }

  setReviewMessage(id: string, message: string, autoHide = false): void {
    if (this.disposed) return;
    this.clearReviewMessageTimer(id);
    this.reviewMessages.update((messages) => ({ ...messages, [id]: message }));
    if (autoHide)
      this.reviewMessageTimers.set(
        id,
        setTimeout(() => {
          this.clearReviewMessage(id, message);
        }, 3000)
      );
  }

  dispose(): void {
    this.disposed = true;
    for (const timer of this.reviewMessageTimers.values()) clearTimeout(timer);
    this.reviewMessageTimers.clear();
  }

  private isCurrent(id: string, revision: number): boolean {
    return (
      !this.disposed &&
      this.ports.selectionRevision() === revision &&
      this.ports.isCurrentSelection(id)
    );
  }

  private ensureRejectionDraft(sponsorship: AdminSponsorshipRecord): void {
    this.rejectionDrafts.update((drafts) =>
      drafts[sponsorship.id]
        ? drafts
        : {
            ...drafts,
            [sponsorship.id]: this.defaultRejectionDraft(sponsorship)
          }
    );
  }

  private defaultRejectionDraft(
    sponsorship: AdminSponsorshipRecord
  ): SponsorRejectionDraft {
    const sponsorName =
      sponsorship.sponsor_company_name ||
      sponsorship.public_name ||
      'votre organisation';
    return {
      notifySponsor: Boolean(sponsorship.sponsor_contact_email),
      recipientEmail: sponsorship.sponsor_contact_email ?? '',
      sponsorMessage: [
        this.ports.t('admin.messages.bonjour_p0', { p0: sponsorName }),
        '',
        this.ports.t(
          'admin.messages.apres_revision_nous_ne_pouvons_pas_accepter_cette_commandite_openg7_pour_le_moment'
        ),
        '',
        this.ports.t(
          'admin.messages.merci_de_votre_comprehension_vous_pouvez_repondre_a_ce_courriel_si_vous_souhaitez_clarifier_la_'
        )
      ].join('\n'),
      refundHandling: 'none',
      refundNote: ''
    };
  }

  private emptyRejectionDraft(): SponsorRejectionDraft {
    return {
      notifySponsor: false,
      recipientEmail: '',
      sponsorMessage: '',
      refundHandling: 'none',
      refundNote: ''
    };
  }

  private isValidEmailDraft(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
  }

  private clearReviewMessage(id: string, expectedMessage?: string): void {
    if (this.disposed) return;
    if (
      expectedMessage !== undefined &&
      this.reviewMessages()[id] !== expectedMessage
    )
      return;
    this.clearReviewMessageTimer(id);
    this.reviewMessages.update((messages) => {
      const remaining = { ...messages };
      delete remaining[id];
      return remaining;
    });
  }

  private clearReviewMessageTimer(id: string): void {
    const timer = this.reviewMessageTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.reviewMessageTimers.delete(id);
    }
  }

  private setNoteMessage(id: string, message: string): void {
    if (this.disposed) return;
    this.noteMessages.update((messages) => ({ ...messages, [id]: message }));
  }
}
