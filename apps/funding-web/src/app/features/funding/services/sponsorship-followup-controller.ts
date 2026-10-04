import { computed, signal } from '@angular/core';
import type { SponsorshipFollowupResponse } from '@openg7/funding-core';

import {
  canEditSponsorshipDetails,
  followupAccessExpired,
  normalizeSponsorshipDetails,
  sameSponsorshipDetails,
  sponsorshipDetailsFromFollowup,
  SponsorshipFollowupError,
  type SponsorshipDetailsDraft
} from '../models/sponsorship-followup-ui.js';

import type { FundingService } from './funding.service.js';
import type { SponsorshipDraftService } from './sponsorship-draft.service.js';
import type { SponsorshipFollowupBrowserPort } from './sponsorship-followup-browser.js';

const sponsorshipFollowupTokenPattern = /^[A-Za-z0-9_-]{32,128}$/;

export interface SponsorshipFollowupPorts {
  api: Pick<
    FundingService,
    'getSponsorshipFollowup' | 'submitSponsorshipFollowupDetails'
  >;
  drafts: Pick<
    SponsorshipDraftService,
    'revision' | 'load' | 'flush' | 'state' | 'clear'
  >;
  browser: SponsorshipFollowupBrowserPort;
}

/** One routed page's private snapshot and submissions; the API confirms changes. */
export class SponsorshipFollowupController {
  readonly token = signal('');
  readonly recoveryEntry = signal(false);
  readonly followup = signal<SponsorshipFollowupResponse | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly loadError = signal<'access' | 'unavailable' | null>(null);
  readonly saveState = signal<'idle' | 'saved' | 'error' | 'unconfirmed'>(
    'idle'
  );
  readonly savedDetails = signal<SponsorshipDetailsDraft | null>(null);
  readonly busy = computed(() => this.loading() || this.saving());
  readonly needsDetails = computed(() => {
    const current = this.followup();
    return (
      current?.paymentStatus === 'paid' &&
      current.reviewStatus === 'pending_review' &&
      !current.detailsSubmitted &&
      !this.savedDetails()
    );
  });
  readonly nextStepMessage = computed(() => {
    const current = this.followup();
    if (!current) return '';
    if (current.paymentStatus !== 'paid') {
      const status = [
        'pending',
        'failed',
        'expired',
        'refunded',
        'disputed'
      ].includes(current.paymentStatus)
        ? current.paymentStatus
        : 'unknown';
      return 'funding.followup.payment.' + status + '.copy';
    }
    if (current.reviewStatus !== 'pending_review')
      return 'funding.followup.review.' + current.reviewStatus + '.copy';
    return (
      'funding.followup.nextStep.' +
      (current.detailsSubmitted || this.savedDetails()
        ? 'submitted'
        : 'details')
    );
  });
  private readSequence = 0;
  private accessGeneration = 0;
  private disposed = false;

  constructor(private readonly ports: SponsorshipFollowupPorts) {}

  async initialize(tokenFromUrl: string | null): Promise<boolean> {
    if (this.disposed) return false;
    this.token.set(this.resolveInitialToken(tokenFromUrl));
    this.recoveryEntry.set(!this.token() && tokenFromUrl === null);
    this.ports.browser.removeUrlToken();
    return this.load();
  }

  async load(): Promise<boolean> {
    if (this.disposed || this.busy()) return false;
    return this.readFollowup();
  }

  private async readFollowup(): Promise<boolean> {
    if (this.disposed) return false;
    if (!this.token()) {
      this.clearAccess();
      return false;
    }
    const sequence = ++this.readSequence;
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const followup = await this.ports.api.getSponsorshipFollowup(
        this.token()
      );
      if (this.disposed || sequence !== this.readSequence) return false;
      this.followup.set(followup);
      if (this.ports.drafts.revision() === null)
        await this.ports.drafts.load(this.token());
      return !this.disposed && sequence === this.readSequence;
    } catch (error) {
      if (this.disposed || sequence !== this.readSequence) return false;
      if (followupAccessExpired(error)) this.clearAccess();
      else this.loadError.set('unavailable');
      return false;
    } finally {
      if (!this.disposed && sequence === this.readSequence)
        this.loading.set(false);
    }
  }

  async submit(value: SponsorshipDetailsDraft): Promise<void> {
    const current = this.followup();
    if (
      this.disposed ||
      this.busy() ||
      !current ||
      this.loadError() === 'access' ||
      current.reviewStatus === 'rejected' ||
      !canEditSponsorshipDetails(current.paymentStatus)
    )
      return;
    const draft = normalizeSponsorshipDetails(value);
    if (
      (current.detailsSubmitted || this.savedDetails()) &&
      sameSponsorshipDetails(
        draft,
        this.loadError() === 'unavailable'
          ? (this.savedDetails() ?? sponsorshipDetailsFromFollowup(current))
          : sponsorshipDetailsFromFollowup(current)
      )
    )
      return;
    const generation = this.accessGeneration;
    this.saving.set(true);
    this.saveState.set('idle');
    try {
      if (!(await this.ports.drafts.flush()) || !this.active(generation))
        return;
      const result = await this.ports.api.submitSponsorshipFollowupDetails({
        token: this.token(),
        ...draft,
        draftRevision: this.ports.drafts.revision()!
      });
      if (!this.active(generation)) return;
      if (result.received !== true || result.recorded !== true) {
        this.saveState.set('unconfirmed');
        return;
      }
      // Only the confirmed mutation may mark this draft as saved.
      this.savedDetails.set(draft);
      this.saveState.set('saved');
      await this.ports.drafts.load(this.token(), false);
      if (this.active(generation)) await this.readFollowup();
    } catch (error) {
      if (!this.active(generation)) return;
      this.saveState.set('error');
      if (
        error instanceof SponsorshipFollowupError &&
        error.code === 'draft_conflict'
      )
        this.ports.drafts.state.set('conflict');
      // A 400 on POST can be field validation; keep the user's draft available.
      if (
        followupAccessExpired(error) &&
        !(error instanceof SponsorshipFollowupError && error.status === 400)
      )
        this.clearAccess();
    } finally {
      if (!this.disposed) this.saving.set(false);
    }
  }

  async reloadDraft(): Promise<void> {
    if (this.disposed || this.busy()) return;
    const generation = this.accessGeneration;
    if ((await this.readFollowup()) && this.active(generation))
      await this.ports.drafts.load(this.token());
  }

  clearAccess(): void {
    if (this.disposed) return;
    this.readSequence++;
    this.accessGeneration++;
    this.loading.set(false);
    this.ports.drafts.clear();
    this.loadError.set('access');
    this.followup.set(null);
    this.savedDetails.set(null);
    this.token.set('');
    this.ports.browser.clearToken();
  }

  dispose(): void {
    this.disposed = true;
    this.readSequence++;
    this.accessGeneration++;
  }

  private active(generation: number): boolean {
    return !this.disposed && generation === this.accessGeneration;
  }

  private resolveInitialToken(tokenFromUrl: string | null): string {
    // An explicitly invalid link must never silently open another saved dossier.
    if (tokenFromUrl !== null) {
      if (!sponsorshipFollowupTokenPattern.test(tokenFromUrl)) return '';
      this.ports.browser.rememberToken(tokenFromUrl);
      return tokenFromUrl;
    }
    const token = this.ports.browser.getRememberedToken();
    return sponsorshipFollowupTokenPattern.test(token) ? token : '';
  }
}
