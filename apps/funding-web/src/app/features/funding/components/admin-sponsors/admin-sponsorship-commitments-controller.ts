import { signal } from '@angular/core';
import type {
  AdminSponsorshipProgress,
  SponsorshipCommitmentRecord,
  SponsorshipCommitmentQualificationRequest,
  SponsorshipObligationAdjustmentRequest,
  SponsorshipOfferedBenefit,
  PreparationAssistanceApplyRequest
} from '@openg7/funding-core';
import {
  normalizeSponsorshipOfferSnapshot,
  normalizePreparationAssistanceDraft,
  publicationFormatCapability
} from '@openg7/funding-core';

import { AdminDashboardRequestError } from '../../services/funding-admin-session.js';
import type { PreparationAssistanceSelection } from '../admin-preparation/preparation-assistance.controller.js';

export interface CommitmentBenefitFields {
  readonly channel: string;
  readonly target: string;
  readonly quantity: string;
  readonly companyName: boolean;
  readonly presentation: boolean;
  readonly logo: boolean;
  readonly format: string;
  readonly deadlineDays: string;
  readonly durationDays: string;
}
export const emptyCommitmentBenefit = (): CommitmentBenefitFields => ({
  channel: '',
  target: '',
  quantity: '',
  companyName: false,
  presentation: false,
  logo: false,
  format: '',
  deadlineDays: '',
  durationDays: ''
});
type PendingCommand =
  | {
      readonly kind: 'qualify';
      readonly payload: SponsorshipCommitmentQualificationRequest;
      readonly assistance?: PreparationAssistanceApplyRequest;
    }
  | {
      readonly kind: 'adjust';
      readonly payload: SponsorshipObligationAdjustmentRequest;
    };
export interface AdminSponsorshipCommitmentsPorts {
  dossier(): AdminSponsorshipProgress;
  canOwn(): boolean;
  isDestroyed(): boolean;
  newRequestId(): string;
  get(id: string): Promise<{ commitment: SponsorshipCommitmentRecord | null }>;
  qualify(
    payload: SponsorshipCommitmentQualificationRequest
  ): Promise<{ commitment: SponsorshipCommitmentRecord | null }>;
  applyAssistance?(
    payload: PreparationAssistanceApplyRequest
  ): Promise<{ commitment: SponsorshipCommitmentRecord | null }>;
  adjust(
    payload: SponsorshipObligationAdjustmentRequest
  ): Promise<{ commitment: SponsorshipCommitmentRecord | null }>;
  changed(): void;
  unauthorized(): Promise<void>;
}

/** Exact confirmed commands and ephemeral uncertain retries for the selected dossier. */
export class AdminSponsorshipCommitmentsController {
  readonly data = signal<SponsorshipCommitmentRecord | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly saved = signal(false);
  readonly pending = signal<PendingCommand | null>(null);
  readonly assistance = signal<PreparationAssistanceSelection | null>(null);
  readonly assistanceStale = signal(false);
  readonly benefits = signal<readonly CommitmentBenefitFields[]>([]);
  readonly reason = signal('');
  readonly evidence = signal('');
  readonly confirmation = signal('');
  readonly selectedObligation = signal('');
  readonly adjustment = signal('');
  readonly target = signal('');
  readonly format = signal('');
  readonly waiverAcknowledged = signal(false);
  private selected = '';
  private generation = 0;
  private hasAssistanceDraft = false;
  private readonly pendingByDossier = new Map<string, PendingCommand>();
  constructor(private readonly ports: AdminSponsorshipCommitmentsPorts) {}
  select(): void {
    const d = this.ports.dossier();
    if (d.contributionId !== this.selected) {
      this.selected = d.contributionId;
      this.generation++;
      this.benefits.set([]);
      this.assistance.set(null);
      this.hasAssistanceDraft = false;
      this.assistanceStale.set(false);
      this.clearFields();
      this.error.set('');
      this.saved.set(false);
      this.loading.set(false);
      this.saving.set(false);
      this.pending.set(this.pendingByDossier.get(d.contributionId) ?? null);
      this.data.set(d.commitment ?? null);
    } else if (
      !this.saving() &&
      d.commitment &&
      d.commitment.version >= (this.data()?.version ?? 0)
    )
      this.data.set(d.commitment);
  }
  private current(generation: number): boolean {
    return (
      !this.ports.isDestroyed() &&
      generation === this.generation &&
      this.ports.dossier().contributionId === this.selected
    );
  }
  private permitted(): boolean {
    return this.ports.canOwn() && !this.ports.isDestroyed() && !this.saving();
  }
  async load(): Promise<void> {
    if (this.loading() || this.saving() || this.ports.isDestroyed()) return;
    const generation = this.generation;
    const id = this.selected;
    this.loading.set(true);
    this.error.set('');
    try {
      const response = await this.ports.get(id);
      if (!this.current(generation)) return;
      if (response.commitment && response.commitment.contributionId !== id)
        throw new Error('Wrong commercial scope.');
      const current = this.data();
      if (
        !current ||
        (response.commitment &&
          (response.commitment.id !== current.id ||
            response.commitment.version >= current.version))
      )
        this.data.set(response.commitment);
    } catch (error) {
      if (this.current(generation)) await this.failure(error, false);
    } finally {
      if (this.current(generation)) this.loading.set(false);
    }
  }
  addBenefit(): void {
    if (!this.pending() && this.benefits().length < 3)
      this.benefits.update((rows) => [...rows, emptyCommitmentBenefit()]);
  }
  removeBenefit(index: number): void {
    if (!this.pending())
      this.benefits.update((rows) => rows.filter((_, i) => i !== index));
  }
  updateBenefit<K extends keyof CommitmentBenefitFields>(
    index: number,
    key: K,
    value: CommitmentBenefitFields[K]
  ): void {
    if (this.pending()) return;
    this.benefits.update((rows) =>
      rows.map((row, i) =>
        i === index
          ? {
              ...row,
              [key]: value,
              ...(key === 'channel' && value === 'website'
                ? { format: '' }
                : {})
            }
          : row
      )
    );
  }
  chooseObligation(id: string): void {
    if (this.pending()) return;
    this.selectedObligation.set(id);
    this.adjustment.set('');
    this.target.set('');
    this.format.set('');
    this.clearFields();
    this.error.set('');
    this.saved.set(false);
  }
  async qualify(): Promise<void> {
    if (!this.permitted() || this.loading() || this.pending()) return;
    if (
      this.benefits().some(
        (row) =>
          row.durationDays.trim() &&
          (row.channel !== 'website' || row.target !== 'openg7')
      )
    ) {
      this.error.set('durationUnsupported');
      return;
    }
    const d = this.ports.dossier(),
      m = this.data();
    try {
      if (
        !m ||
        m.state !== 'needs_confirmation' ||
        d.currency !== 'CAD' ||
        this.confirmation() !== d.contributionId ||
        !this.validText(this.reason()) ||
        !this.validText(this.evidence())
      )
        throw new Error('Invalid qualification.');
      const benefits = this.benefits().map((row) => this.benefit(row));
      const offer = normalizeSponsorshipOfferSnapshot({
        version: 'historical-qualification-v1',
        amountMinor: d.amountMinor,
        currency: d.currency,
        benefits
      });
      const payload: SponsorshipCommitmentQualificationRequest = {
        requestId: this.ports.newRequestId(),
        contributionId: d.contributionId,
        expectedVersion: m.version,
        confirmation: this.confirmation(),
        reason: this.reason().trim(),
        evidenceReference: this.evidence().trim(),
        offer
      };
      const assisted = this.assistance();
      if (assisted) {
        const state = assisted.state,
          run = state.run;
        if (
          this.assistanceStale() ||
          state.stale ||
          !run?.suggestion ||
          !state.source ||
          !state.capabilities.canApply ||
          state.contributionId !== d.contributionId ||
          state.commitment.version !== m.version
        )
          throw new Error('Stale assistance.');
        const draft = normalizePreparationAssistanceDraft(
          { offer, items: assisted.items, reason: payload.reason },
          run.suggestion,
          { requireResolved: true }
        );
        this.remember({
          kind: 'qualify',
          payload,
          assistance: {
            contributionId: d.contributionId,
            requestId: payload.requestId,
            runId: run.id,
            sourceVersion: state.source.version,
            expectedCommitmentVersion: m.version,
            expectedReviewVersion: run.review?.version ?? 0,
            confirmation: this.confirmation(),
            draft
          }
        });
      } else this.remember({ kind: 'qualify', payload });
    } catch {
      this.error.set('invalid');
      return;
    }
    await this.retry();
  }
  async adjust(): Promise<void> {
    if (!this.permitted() || this.loading() || this.pending()) return;
    const m = this.data(),
      o = m?.obligations.find((o) => o.id === this.selectedObligation());
    try {
      if (
        !o ||
        ['fulfilled', 'adjusted'].includes(o.state) ||
        this.confirmation() !== o.id ||
        !this.validText(this.reason()) ||
        !['destination', 'format', 'waiver'].includes(this.adjustment())
      )
        throw new Error('Invalid adjustment.');
      const kind =
        this.adjustment() as SponsorshipObligationAdjustmentRequest['kind'];
      if (
        kind === 'destination' &&
        (!['openg7', 'openg20'].includes(this.target()) ||
          this.target() === o.target)
      )
        throw new Error('Invalid destination.');
      if (
        kind === 'format' &&
        (!publicationFormatCapability(o.channel, this.format()).available ||
          this.format() === o.format)
      )
        throw new Error('Invalid format.');
      if (kind === 'waiver' && !this.waiverAcknowledged())
        throw new Error('Waiver unconfirmed.');
      const payload: SponsorshipObligationAdjustmentRequest = {
        requestId: this.ports.newRequestId(),
        obligationId: o.id,
        expectedVersion: o.version,
        confirmation: this.confirmation(),
        reason: this.reason().trim(),
        kind,
        ...(kind === 'destination'
          ? {
              target:
                this.target() as SponsorshipObligationAdjustmentRequest['target']
            }
          : {}),
        ...(kind === 'format'
          ? {
              format:
                this.format() as SponsorshipObligationAdjustmentRequest['format']
            }
          : {})
      };
      this.remember({ kind: 'adjust', payload });
    } catch {
      this.error.set('invalid');
      return;
    }
    await this.retry();
  }
  private remember(command: PendingCommand): void {
    this.pendingByDossier.set(this.selected, command);
    this.pending.set(command);
  }
  async retry(): Promise<void> {
    const command = this.pending();
    if (!command || !this.permitted() || this.loading()) return;
    const generation = this.generation,
      id = this.selected;
    this.saving.set(true);
    this.error.set('');
    this.saved.set(false);
    try {
      const response =
        command.kind === 'qualify'
          ? command.assistance
            ? await this.applyAssistance(command.assistance)
            : await this.ports.qualify(command.payload)
          : await this.ports.adjust(command.payload);
      if (!this.current(generation)) return;
      const m = response.commitment;
      if (
        !m ||
        m.contributionId !== id ||
        m.state !== 'active' ||
        (command.kind === 'adjust' &&
          !m.obligations.some(
            (o) =>
              o.id === command.payload.obligationId &&
              o.version > command.payload.expectedVersion
          ))
      )
        throw new Error('Unconfirmed commercial response.');
      this.pendingByDossier.delete(id);
      this.pending.set(null);
      this.data.set(m);
      this.saved.set(true);
      this.clearFields();
      this.benefits.set([]);
      this.assistance.set(null);
      this.hasAssistanceDraft = false;
      this.assistanceStale.set(false);
      this.selectedObligation.set('');
      this.ports.changed();
    } catch (error) {
      if (this.current(generation)) await this.failure(error, true);
    } finally {
      if (this.current(generation)) this.saving.set(false);
    }
  }
  /** Explicitly choose a proposal; private drafts remain editable in this owning form. */
  chooseAssistance(selection: PreparationAssistanceSelection): void {
    const state = selection.state,
      run = state.run;
    if (
      !this.permitted() ||
      this.pending() ||
      state.contributionId !== this.selected ||
      state.stale ||
      !state.source ||
      !run?.suggestion
    )
      return;
    this.assistance.set(selection);
    this.hasAssistanceDraft = true;
    this.assistanceStale.set(false);
    const offer = run.review?.offer ?? run.suggestion.proposedOffer;
    if (offer)
      this.benefits.set(
        offer.benefits.map((benefit) => ({
          channel: benefit.channel,
          target: benefit.target,
          quantity: String(benefit.quantity),
          companyName: benefit.requiredElements.includes('company_name'),
          presentation: benefit.requiredElements.includes(
            'approved_presentation'
          ),
          logo: benefit.requiredElements.includes('approved_logo'),
          format: benefit.format ?? '',
          deadlineDays:
            benefit.deadlineDays === null ? '' : String(benefit.deadlineDays),
          durationDays:
            benefit.durationDays === null ? '' : String(benefit.durationDays)
        }))
      );
    if (run.review?.reason) this.reason.set(run.review.reason);
    this.evidence.set(
      `${state.source.title} · v${state.source.version} · ${state.source.id}`
    );
    this.confirmation.set('');
    this.error.set('');
  }
  updateAssistance(selection: PreparationAssistanceSelection): void {
    const previous = this.assistance();
    if (!previous) return;
    const before = previous.state,
      next = selection.state;
    if (before.contributionId !== next.contributionId) return;
    if (
      next.stale ||
      before.run?.id !== next.run?.id ||
      before.source?.version !== next.source?.version ||
      before.commitment.version !== next.commitment.version
    ) {
      this.assistanceStale.set(true);
      return;
    }
    if (
      before.run?.review?.version !== next.run?.review?.version &&
      next.run?.review
    ) {
      const current = {
        offer: this.offerDraft(),
        items: selection.items,
        reason: this.reason().trim()
      };
      const saved = {
        offer: next.run.review.offer,
        items: next.run.review.items,
        reason: next.run.review.reason
      };
      if (JSON.stringify(current) !== JSON.stringify(saved))
        this.assistanceStale.set(true);
    }
    this.assistance.set(selection);
  }
  manualQualification(): void {
    if (this.pending() || this.saving()) return;
    this.assistance.set(null);
    this.assistanceStale.set(false);
    this.confirmation.set('');
  }
  /** Revoke all private assistance context, including uncertain commands from this session. */
  invalidateAssistance(): void {
    const selectedCommand = this.pending();
    const assisted =
      this.hasAssistanceDraft ||
      Boolean(this.assistance()) ||
      (selectedCommand?.kind === 'qualify' &&
        Boolean(selectedCommand.assistance));
    for (const [id, command] of this.pendingByDossier)
      if (command.kind === 'qualify' && command.assistance)
        this.pendingByDossier.delete(id);
    this.assistance.set(null);
    this.hasAssistanceDraft = false;
    this.assistanceStale.set(false);
    if (assisted) {
      ++this.generation;
      this.pending.set(null);
      this.saving.set(false);
      this.loading.set(false);
      this.benefits.set([]);
      this.clearFields();
    }
  }
  offerDraft() {
    try {
      const d = this.ports.dossier();
      if (!this.benefits().length) return null;
      return normalizeSponsorshipOfferSnapshot({
        version: 'historical-qualification-v1',
        amountMinor: d.amountMinor,
        currency: d.currency,
        benefits: this.benefits().map((row) => this.benefit(row))
      });
    } catch {
      return null;
    }
  }
  assistanceCanApply(): boolean {
    const selected = this.assistance(),
      state = selected?.state,
      run = state?.run;
    if (
      !selected ||
      !state ||
      !run?.suggestion ||
      state.stale ||
      this.assistanceStale() ||
      !state.capabilities.canApply ||
      !this.ports.canOwn() ||
      state.commitment.version !== this.data()?.version
    )
      return false;
    try {
      normalizePreparationAssistanceDraft(
        {
          offer: this.offerDraft(),
          items: selected.items,
          reason: this.reason()
        },
        run.suggestion,
        { requireResolved: true }
      );
      return true;
    } catch {
      return false;
    }
  }
  private applyAssistance(request: PreparationAssistanceApplyRequest) {
    if (!this.ports.applyAssistance)
      throw new Error('Assistance is unavailable.');
    return this.ports.applyAssistance(request);
  }
  private validText(value: string): boolean {
    return value.trim().length > 0 && value.trim().length <= 2000;
  }
  private benefit(row: CommitmentBenefitFields): SponsorshipOfferedBenefit {
    const days = (v: string): number | null => {
      if (!v.trim()) return null;
      if (!/^[1-9]\d*$/.test(v)) throw new Error('Invalid period.');
      return Number(v);
    };
    if (
      !['website', 'facebook', 'linkedin'].includes(row.channel) ||
      !/^[1-9]\d*$/.test(row.quantity)
    )
      throw new Error('Invalid benefit.');
    if (
      row.format &&
      !publicationFormatCapability(row.channel, row.format).available
    )
      throw new Error('Unavailable format.');
    return {
      id:
        row.channel === 'website'
          ? 'website_mention'
          : row.channel === 'facebook'
            ? 'facebook_batch'
            : 'linkedin_batch',
      channel: row.channel as SponsorshipOfferedBenefit['channel'],
      target: row.target as SponsorshipOfferedBenefit['target'],
      quantity: Number(row.quantity),
      requiredElements: [
        ...(row.companyName ? ['company_name' as const] : []),
        ...(row.presentation ? ['approved_presentation' as const] : []),
        ...(row.logo ? ['approved_logo' as const] : [])
      ],
      deadlineDays: days(row.deadlineDays),
      durationDays: days(row.durationDays),
      ...(row.format
        ? { format: row.format as SponsorshipOfferedBenefit['format'] }
        : {})
    };
  }
  private clearFields(): void {
    this.reason.set('');
    this.evidence.set('');
    this.confirmation.set('');
    this.waiverAcknowledged.set(false);
  }
  private async failure(error: unknown, mutation: boolean): Promise<void> {
    const status =
      error instanceof AdminDashboardRequestError ? error.status : 0;
    if (mutation && [400, 403, 404, 409].includes(status)) {
      this.pendingByDossier.delete(this.selected);
      this.pending.set(null);
    }
    this.error.set(
      error instanceof AdminDashboardRequestError &&
        error.code === 'COMMITMENT_DURATION_UNSUPPORTED'
        ? 'durationUnsupported'
        : status === 401
          ? 'unauthorized'
          : status === 403
            ? 'ownerOnly'
            : status === 400
              ? 'invalid'
              : status === 409
                ? 'conflict'
                : mutation
                  ? 'uncertain'
                  : 'loadError'
    );
    if (status === 401 || status === 403) this.invalidateAssistance();
    if (status === 401) await this.ports.unauthorized();
  }
}
