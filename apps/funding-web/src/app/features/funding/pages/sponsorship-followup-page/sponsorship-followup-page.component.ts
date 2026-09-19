import { CommonModule, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  PLATFORM_ID,
  ViewChild,
  computed,
  inject,
  signal
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type { SponsorshipFollowupResponse } from '@openg7/funding-core';

import { FundingHeaderComponent } from '../../components/funding-header/funding-header.component.js';
import { SponsorshipFollowupFormComponent } from '../../components/sponsorship-followup/sponsorship-followup-form.component.js';
import { SponsorshipFollowupStatusComponent } from '../../components/sponsorship-followup/sponsorship-followup-status.component.js';
import {
  canEditSponsorshipDetails,
  followupAccessExpired,
  normalizeSponsorshipDetails,
  sameSponsorshipDetails,
  sponsorshipDetailsFromFollowup,
  SponsorshipFollowupError,
  type SponsorshipDetailsDraft
} from '../../models/sponsorship-followup-ui.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { FundingService } from '../../services/funding.service.js';

const sponsorshipFollowupSessionStorageKey =
  'openg7-sponsorship-followup-token';
const sponsorshipFollowupTokenPattern = /^[A-Za-z0-9_-]{32,128}$/;

@Component({
  selector: 'openg7-sponsorship-followup-page',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    TranslatePipe,
    FundingHeaderComponent,
    SponsorshipFollowupFormComponent,
    SponsorshipFollowupStatusComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sponsorship-followup-page.component.html',
  styleUrls: ['../../components/sponsorship-followup/sponsorship-followup.css']
})
export class SponsorshipFollowupPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly fundingService = inject(FundingService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  readonly i18n = inject(FundingI18nService);
  @ViewChild(SponsorshipFollowupFormComponent)
  private form?: SponsorshipFollowupFormComponent;

  readonly token = signal('');
  readonly followup = signal<SponsorshipFollowupResponse | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly loadError = signal<'access' | 'unavailable' | null>(null);
  readonly saveState = signal<'idle' | 'saved' | 'error' | 'unconfirmed'>(
    'idle'
  );
  readonly savedDetails = signal<SponsorshipDetailsDraft | null>(null);
  readonly busy = computed(() => this.loading() || this.saving());
  private readSequence = 0;

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => {
      this.readSequence++;
    });
    this.token.set(this.resolveInitialToken());
    this.removeTokenFromBrowserUrl();
    void this.load();
  }

  async load(): Promise<boolean> {
    if (this.busy()) return false;
    return this.readFollowup();
  }

  private async readFollowup(): Promise<boolean> {
    if (!this.token()) {
      this.clearAccess();
      return false;
    }
    const sequence = ++this.readSequence;
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const followup = await this.fundingService.getSponsorshipFollowup(
        this.token()
      );
      if (this.destroyRef.destroyed || sequence !== this.readSequence)
        return false;
      this.followup.set(followup);
      return true;
    } catch (error) {
      if (this.destroyRef.destroyed || sequence !== this.readSequence)
        return false;
      if (followupAccessExpired(error)) this.clearAccess();
      else this.loadError.set('unavailable');
      return false;
    } finally {
      if (!this.destroyRef.destroyed && sequence === this.readSequence)
        this.loading.set(false);
    }
  }

  async submit(value: SponsorshipDetailsDraft): Promise<void> {
    const current = this.followup();
    if (
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
    this.saving.set(true);
    this.saveState.set('idle');
    try {
      const result = await this.fundingService.submitSponsorshipFollowupDetails(
        { token: this.token(), ...draft }
      );
      if (this.destroyRef.destroyed) return;
      if (result.received !== true || result.recorded !== true) {
        this.saveState.set('unconfirmed');
        return;
      }
      // Only the confirmed mutation may mark this draft as saved.
      this.savedDetails.set(draft);
      this.saveState.set('saved');
      await this.readFollowup();
    } catch (error) {
      if (this.destroyRef.destroyed) return;
      this.saveState.set('error');
      // A 400 on POST can be field validation; keep the user's draft available.
      if (
        followupAccessExpired(error) &&
        !(error instanceof SponsorshipFollowupError && error.status === 400)
      )
        this.clearAccess();
    } finally {
      if (!this.destroyRef.destroyed) this.saving.set(false);
    }
  }

  focusForm(): void {
    this.form?.focusFirstField();
  }

  private clearAccess(): void {
    this.loadError.set('access');
    this.followup.set(null);
    this.savedDetails.set(null);
    this.token.set('');
    if (isPlatformBrowser(this.platformId)) {
      try {
        window.sessionStorage.removeItem(sponsorshipFollowupSessionStorageKey);
      } catch {
        /* Storage can be unavailable. */
      }
    }
  }

  private resolveInitialToken(): string {
    const tokenFromUrl = this.route.snapshot.queryParamMap.get('token');
    // An explicitly invalid link must never silently open another saved dossier.
    if (tokenFromUrl !== null) {
      if (!sponsorshipFollowupTokenPattern.test(tokenFromUrl)) return '';
      this.rememberFollowupToken(tokenFromUrl);
      return tokenFromUrl;
    }
    return this.readRememberedFollowupToken();
  }

  private rememberFollowupToken(token: string): void {
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      window.sessionStorage.setItem(
        sponsorshipFollowupSessionStorageKey,
        token
      );
    } catch {
      /* The token remains in memory for this visit. */
    }
  }

  private readRememberedFollowupToken(): string {
    if (!isPlatformBrowser(this.platformId)) return '';
    try {
      const token =
        window.sessionStorage.getItem(sponsorshipFollowupSessionStorageKey) ??
        '';
      return sponsorshipFollowupTokenPattern.test(token) ? token : '';
    } catch {
      return '';
    }
  }

  private removeTokenFromBrowserUrl(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has('token')) return;
    url.searchParams.delete('token');
    window.history.replaceState(
      window.history.state,
      '',
      url.pathname + url.search + url.hash
    );
  }
}
