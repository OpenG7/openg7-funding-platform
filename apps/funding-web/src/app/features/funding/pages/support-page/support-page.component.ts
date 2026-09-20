import { CommonModule, DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Injector,
  computed,
  inject,
  signal
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type { PublicReferenceLookupResponse } from '@openg7/funding-core';

import { FundingHeaderComponent } from '../../components/funding-header/funding-header.component.js';
import { SponsorshipAccessRecoveryComponent } from '../../components/sponsorship-followup/sponsorship-access-recovery.component.js';
import { FundingService } from '../../services/funding.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { FundingSeoService } from '../../services/funding-seo.service.js';

type ReferenceLookupState =
  'idle' | 'submitting' | 'found' | 'not_found' | 'error';
type ReferenceRecoveryState = 'idle' | 'submitting' | 'sent' | 'error';

/** Routed help page: contributor lookup, private recovery, contact and technical entry points. */
@Component({
  selector: 'openg7-support-page',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    TranslatePipe,
    FundingHeaderComponent,
    SponsorshipAccessRecoveryComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './support-page.component.html',
  styleUrls: [
    './support-page.component.css',
    '../../components/support-form.css'
  ]
})
export class SupportPageComponent {
  private readonly funding = inject(FundingService);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly requests = new Set<AbortController>();
  readonly fundingRepositoryUrl =
    'https://github.com/OpenG7/openg7-funding-platform';
  private readonly i18n = inject(FundingI18nService);
  private readonly injector = inject(Injector);
  private readonly seo = inject(FundingSeoService);

  readonly homePath = computed(() => this.i18n.localizedPath('/'));
  readonly aboutPath = computed(() =>
    this.i18n.localizedPath('/fonds-des-batisseurs/a-propos')
  );
  readonly ecosystemPath = computed(() =>
    this.i18n.localizedPath('/ecosystem')
  );
  readonly transparencyPath = computed(() =>
    this.i18n.localizedPath('/fonds-des-batisseurs/transparence')
  );
  readonly supportPath = computed(() => this.i18n.localizedPath('/support'));
  readonly followupPath = computed(() =>
    this.i18n.localizedPath('/fonds-des-batisseurs/suivi-commandite')
  );
  readonly policyPath = computed(() =>
    this.i18n.localizedPath('/politique-utilisation-remboursement')
  );
  focusHelp(id: string): void {
    const target = this.document.getElementById(id);
    if (target && !target.matches('input'))
      target.setAttribute('tabindex', '-1');
    target?.focus();
  }
  openReferenceRecovery(): void {
    const details = this.document.getElementById('reference-recovery');
    details?.setAttribute('open', '');
    this.focusHelp('reference-recovery-email');
  }

  issueUrl(kind: 'issue' | 'idea'): string {
    return (
      this.fundingRepositoryUrl +
      '/issues/new?title=' +
      encodeURIComponent(
        this.i18n.t('funding.supportPage.actions.' + kind + '.issueTitle')
      )
    );
  }

  readonly referenceLookupValue = signal<string>('');
  readonly referenceLookupState = signal<ReferenceLookupState>('idle');
  readonly referenceLookupResult = signal<PublicReferenceLookupResponse | null>(
    null
  );
  readonly referenceLookupMessageKey = signal<string | null>(null);
  readonly referenceRecoveryEmail = signal<string>('');
  readonly referenceRecoveryState = signal<ReferenceRecoveryState>('idle');
  readonly referenceRecoveryMessageKey = signal<string | null>(null);
  readonly currentYear = new Date().getFullYear();

  constructor() {
    this.destroyRef.onDestroy(() => {
      for (const controller of this.requests) controller.abort();
    });
    this.seo.bind(
      {
        titleKey: 'funding.seo.support.title',
        descriptionKey: 'funding.seo.support.description',
        path: '/support',
        imagePath:
          '/assets/fonds-des-batisseurs-canada-coffre-lumineux-1920.webp'
      },
      this.injector
    );
  }

  setReferenceLookupValue(event: Event): void {
    this.referenceLookupValue.set(this.valueFromEvent(event).toUpperCase());

    if (this.referenceLookupState() !== 'submitting') {
      this.referenceLookupState.set('idle');
      this.referenceLookupResult.set(null);
      this.referenceLookupMessageKey.set(null);
    }
  }

  async lookupReference(event: Event): Promise<void> {
    event.preventDefault();
    if (this.referenceLookupState() === 'submitting') return;

    const reference = this.referenceLookupValue().trim().toUpperCase();
    if (!/^OG7-\d{4}-[A-Z0-9]{4,8}$/.test(reference)) {
      this.referenceLookupState.set('error');
      this.referenceLookupResult.set(null);
      this.referenceLookupMessageKey.set(
        'funding.supportPage.referenceLookup.invalid'
      );
      return;
    }

    this.referenceLookupState.set('submitting');
    this.referenceLookupResult.set(null);
    this.referenceLookupMessageKey.set(null);

    try {
      const result = await this.requestWithTimeout((signal) =>
        this.funding.lookupPublicReference({ reference }, signal)
      );
      if (this.destroyRef.destroyed) return;
      this.referenceLookupResult.set(result);
      this.referenceLookupState.set(result.found ? 'found' : 'not_found');
    } catch {
      if (this.destroyRef.destroyed) return;
      this.referenceLookupState.set('error');
      this.referenceLookupResult.set(null);
      this.referenceLookupMessageKey.set(
        'funding.supportPage.referenceLookup.error'
      );
    }
  }

  setReferenceRecoveryEmail(event: Event): void {
    this.referenceRecoveryEmail.set(this.valueFromEvent(event));

    if (this.referenceRecoveryState() !== 'submitting') {
      this.referenceRecoveryState.set('idle');
      this.referenceRecoveryMessageKey.set(null);
    }
  }

  async requestReferenceRecovery(event: Event): Promise<void> {
    event.preventDefault();
    if (this.referenceRecoveryState() === 'submitting') return;

    const email = this.referenceRecoveryEmail().trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.referenceRecoveryState.set('error');
      this.referenceRecoveryMessageKey.set(
        'funding.supportPage.referenceRecovery.invalid'
      );
      return;
    }

    this.referenceRecoveryState.set('submitting');
    this.referenceRecoveryMessageKey.set(null);

    try {
      await this.requestWithTimeout((signal) =>
        this.funding.requestContributionReferenceRecovery({ email }, signal)
      );
      if (this.destroyRef.destroyed) return;
      this.referenceRecoveryState.set('sent');
      this.referenceRecoveryMessageKey.set(
        'funding.supportPage.referenceRecovery.success'
      );
    } catch {
      if (this.destroyRef.destroyed) return;
      this.referenceRecoveryState.set('error');
      this.referenceRecoveryMessageKey.set(
        'funding.supportPage.referenceRecovery.error'
      );
    }
  }

  referenceLookupIsFound(
    result: PublicReferenceLookupResponse
  ): result is Extract<PublicReferenceLookupResponse, { found: true }> {
    return result.found;
  }

  referenceLookupTypeKey(result: PublicReferenceLookupResponse): string {
    if (!result.found) {
      return '';
    }

    return result.contributionType === 'sponsorship_interest'
      ? 'funding.supportPage.referenceLookup.types.sponsorship'
      : 'funding.supportPage.referenceLookup.types.personal';
  }

  referenceLookupStatusKey(result: PublicReferenceLookupResponse): string {
    if (!result.found) {
      return '';
    }

    return `funding.supportPage.referenceLookup.status.${result.paymentStatus}`;
  }

  referenceLookupAmountLabel(result: PublicReferenceLookupResponse): string {
    if (!result.found || result.amount === null) {
      return '';
    }

    return new Intl.NumberFormat(this.i18n.currentLanguage(), {
      style: 'currency',
      currency: result.currency
    }).format(result.amount);
  }

  referenceLookupDateLabel(result: PublicReferenceLookupResponse): string {
    if (!result.found) {
      return '';
    }

    const value = result.paidAt ?? result.createdAt;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
      dateStyle: 'medium',
      timeZone: 'UTC'
    }).format(date);
  }

  referenceLookupNextStepKey(result: PublicReferenceLookupResponse): string {
    if (!result.found) {
      return '';
    }

    return `funding.supportPage.referenceLookup.nextStep.${result.nextStep}`;
  }

  private async requestWithTimeout<T>(
    request: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    const controller = new AbortController();
    this.requests.add(controller);
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      return await request(controller.signal);
    } finally {
      clearTimeout(timeout);
      this.requests.delete(controller);
    }
  }

  private valueFromEvent(event: Event): string {
    const target = event.target;
    return target instanceof HTMLInputElement ? target.value : '';
  }
}
