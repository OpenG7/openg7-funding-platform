import { DOCUMENT } from '@angular/common';
import {
  Injectable,
  afterNextRender,
  computed,
  effect,
  inject,
  signal
} from '@angular/core';
import { Router } from '@angular/router';
import type {
  AdminPaymentJourney,
  ContributionType,
  PublicSponsorshipCharter,
  SponsorshipOfferQuote
} from '@openg7/funding-core';

import { OPENG7_FUNDING_CONFIG } from '../config/openg7-funding.config.js';

import { AdminGuidanceService } from './admin-guidance.service.js';
import { FundingAdminService } from './funding-admin.service.js';
import { FundingI18nService } from './funding-i18n.service.js';
import { FundingService } from './funding.service.js';

interface SandboxAttempt {
  checkoutId: string;
  kind: ContributionType;
  amountMinor: number;
  publicConsent: boolean;
}
const attemptKey = 'og7-admin-sandbox-checkout:v1';
const providerPath = '/__sandbox/stripe';
const checkoutIdPattern = /^cs_test_[A-Za-z0-9_]+$/;
const scenarioPresets = {
  personal_support: {
    amounts: OPENG7_FUNDING_CONFIG.contributionAmounts,
    initialAmount: 25
  },
  sponsorship_interest: {
    amounts: OPENG7_FUNDING_CONFIG.sponsorship!.presetAmounts,
    initialAmount: 100
  }
};

/** Local sandbox orchestration: ordinary Checkout, simulated provider, then private server facts. */
@Injectable({ providedIn: 'root' })
export class AdminSandboxService {
  readonly available = signal(false);
  readonly virtualOpen = signal(false);
  readonly kind = signal<ContributionType>('personal_support');
  readonly amount = signal(scenarioPresets.personal_support.initialAmount);
  readonly publicConsent = signal(true);
  readonly accepted = signal(false);
  readonly offer = signal<SponsorshipOfferQuote | null>(null);
  readonly charter = signal<PublicSponsorshipCharter | null>(null);
  readonly preparing = signal(false);
  readonly busy = signal(false);
  readonly error = signal(false);
  private readonly journeyState = signal<AdminPaymentJourney | null>(null);
  readonly journey = this.journeyState.asReadonly();
  readonly pending = signal<SandboxAttempt | null>(null);
  readonly amounts = computed(() => scenarioPresets[this.kind()].amounts);
  readonly providerCheckoutUrl = computed(() => {
    const attempt = this.pending();
    return attempt ? this.checkoutPath(attempt.checkoutId) : null;
  });
  readonly status = computed(() =>
    this.journey()
      ? 'confirmed'
      : this.error()
        ? 'error'
        : this.busy()
          ? 'paying'
          : this.preparing()
            ? 'preparing'
            : 'ready'
  );
  readonly canCreate = computed(
    () =>
      this.available() &&
      !this.busy() &&
      !this.preparing() &&
      !this.journey() &&
      this.accepted() &&
      (!!this.pending() || this.kind() === 'personal_support' || !!this.offer())
  );
  private readonly document = inject(DOCUMENT);
  private readonly funding = inject(FundingService);
  private readonly admin = inject(FundingAdminService);
  private readonly guidance = inject(AdminGuidanceService);
  private readonly i18n = inject(FundingI18nService);
  private readonly router = inject(Router);
  private quoteGeneration = 0;

  constructor() {
    afterNextRender(() => void this.detect());
    let previous: string | undefined;
    effect(() => {
      const session = this.sessionKey();
      if (previous !== undefined && previous !== session) {
        this.journeyState.set(null);
        this.accepted.set(false);
        this.error.set(false);
        this.busy.set(false);
      }
      // The public synthetic Checkout ID remains a reconciliation checkpoint,
      // while private journey facts always require a fresh authorized read.
      previous = session;
    });
  }

  private sessionKey(): string {
    const identity = this.admin.identity();
    return JSON.stringify([
      this.admin.sessionGeneration(),
      identity?.id,
      identity?.sessionId,
      identity?.role
    ]);
  }

  private assertSession(session: string): void {
    if (session !== this.sessionKey()) throw new Error('Session changed');
  }

  private checkoutPath(checkoutId: string): string {
    return `${providerPath}/checkout/${checkoutId}`;
  }

  private async detect(): Promise<void> {
    const view = this.document.defaultView;
    if (
      !view ||
      !['localhost', '127.0.0.1', '[::1]'].includes(view.location.hostname)
    )
      return;
    try {
      const response = await fetch('/openg7-sandbox.json', {
        cache: 'no-store',
        signal: AbortSignal.timeout(5000)
      });
      if (!response.ok) return;
      const value: unknown = await response.json();
      if (!value || typeof value !== 'object' || Array.isArray(value)) return;
      const config = value as Record<string, unknown>;
      if (
        config['version'] !== 1 ||
        config['enabled'] !== true ||
        config['stripeBasePath'] !== providerPath
      )
        return;
      this.available.set(true);
      const retained: unknown = JSON.parse(
        view.sessionStorage.getItem(attemptKey) ?? 'null'
      );
      if (retained && typeof retained === 'object') {
        const attempt = retained as SandboxAttempt;
        if (
          checkoutIdPattern.test(attempt.checkoutId) &&
          ['personal_support', 'sponsorship_interest'].includes(attempt.kind) &&
          Number.isSafeInteger(attempt.amountMinor) &&
          attempt.amountMinor > 0 &&
          typeof attempt.publicConsent === 'boolean'
        ) {
          this.pending.set(attempt);
          this.kind.set(attempt.kind);
          this.amount.set(attempt.amountMinor / 100);
          this.publicConsent.set(attempt.publicConsent);
        }
      }
    } catch {
      /* No manifest means an ordinary site, with no simulator controls. */
    }
  }

  async choose(kind: ContributionType, amount?: number): Promise<void> {
    if (!this.available() || this.busy() || this.pending()) return;
    this.kind.set(kind);
    const { amounts, initialAmount } = scenarioPresets[kind];
    this.amount.set(
      amount !== undefined && amounts.includes(amount) ? amount : initialAmount
    );
    this.accepted.set(false);
    this.offer.set(null);
    this.charter.set(null);
    this.error.set(false);
    const generation = ++this.quoteGeneration;
    this.preparing.set(kind === 'sponsorship_interest');
    if (kind === 'personal_support') return;
    try {
      const [offer, charter] = await Promise.all([
        this.funding.getSponsorshipOffer(this.amount() * 100, 'CAD'),
        this.funding.getSponsorshipCharter()
      ]);
      if (generation !== this.quoteGeneration) return;
      this.offer.set(offer);
      this.charter.set(charter);
    } catch {
      if (generation === this.quoteGeneration) this.error.set(true);
    } finally {
      if (generation === this.quoteGeneration) this.preparing.set(false);
    }
  }

  async create(): Promise<void> {
    if (!this.canCreate()) return;
    const session = this.sessionKey();
    this.busy.set(true);
    this.error.set(false);
    try {
      const attempt = this.pending() ?? (await this.startAttempt(session));
      this.assertSession(session);
      this.pending.set(attempt);
      // Retain only a public synthetic checkpoint before the provider can confirm anything.
      this.document.defaultView!.sessionStorage.setItem(
        attemptKey,
        JSON.stringify(attempt)
      );
      this.assertSession(session);
      await this.confirmProvider(attempt);
      const journey = await this.readConfirmedJourney(attempt, session);
      this.assertSession(session);
      this.journeyState.set(journey);
    } catch {
      if (session === this.sessionKey()) this.error.set(true);
    } finally {
      if (session === this.sessionKey()) this.busy.set(false);
    }
  }

  private async startAttempt(session: string): Promise<SandboxAttempt> {
    const kind = this.kind();
    const amount = this.amount();
    const publicConsent = this.publicConsent();
    const quote = this.offer();
    const charter = this.charter();
    const result = await this.funding.startCheckout(
      amount,
      {
        contributionType: kind,
        publicDisplayConsent: publicConsent,
        displayAmountConsent: false,
        publicDisplayName: `Simulation OpenG7 ${kind === 'personal_support' ? 'personnelle' : 'entreprise'}`,
        nonCharityAcknowledged: true,
        ...(quote
          ? {
              offerAcceptance: {
                version: quote.version,
                fingerprint: quote.fingerprint
              }
            }
          : {}),
        ...(charter?.active
          ? {
              charterAcceptance: {
                accepted: true as const,
                policyVersion: charter.policyVersion,
                fingerprint: charter.fingerprint!,
                locale: this.i18n.currentLanguage()
              }
            }
          : {})
      },
      quote ?? undefined
    );
    this.assertSession(session);
    const destination = new URL(result.redirectUrl, this.document.baseURI);
    const location = this.document.defaultView!.location;
    if (
      result.status !== 'redirected' ||
      !checkoutIdPattern.test(result.checkoutId) ||
      destination.origin !== location.origin ||
      destination.pathname !== this.checkoutPath(result.checkoutId) ||
      destination.search ||
      destination.hash
    )
      throw new Error('Invalid sandbox provider');
    return {
      checkoutId: result.checkoutId,
      kind,
      amountMinor: amount * 100,
      publicConsent
    };
  }

  private async confirmProvider(attempt: SandboxAttempt): Promise<void> {
    const paid = await fetch(this.checkoutPath(attempt.checkoutId), {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        email: 'controller@simulation.example.test',
        action: 'success'
      }),
      signal: AbortSignal.timeout(20000)
    });
    if (!paid.ok && paid.type !== 'opaqueredirect')
      throw new Error('Simulated provider unavailable');
  }

  private async readConfirmedJourney(
    attempt: SandboxAttempt,
    session: string
  ): Promise<AdminPaymentJourney> {
    for (let retry = 0; retry < 10; retry++) {
      this.assertSession(session);
      const data = await this.admin.getContributions(
        this.admin.getSavedAdminToken()
      );
      this.assertSession(session);
      const contribution = data.contributions.find(
        (row) => row.stripe_session_id === attempt.checkoutId
      );
      if (
        contribution?.payment_status === 'paid' &&
        contribution.currency === 'CAD'
      ) {
        const result = await this.admin.getPaymentJourney(contribution.id);
        this.assertSession(session);
        if (
          result.status !== 'ok' ||
          result.journey?.contributionId !== contribution.id ||
          result.journey.paymentStatus !== 'paid' ||
          result.journey.amountMinor !== attempt.amountMinor
        )
          throw new Error('Unconfirmed payment');
        return result.journey;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error('Payment not confirmed by API');
  }

  async openJourney(): Promise<void> {
    const id = this.journey()?.contributionId;
    if (!id) return;
    this.guidance.followPayment(id);
    await this.router.navigate(['/admin/fundraiser/attention'], {
      queryParams: { paymentJourney: id }
    });
  }

  newPayment(): void {
    if ((!this.journey() && !this.pending()) || this.busy()) return;
    try {
      this.document.defaultView?.sessionStorage.removeItem(attemptKey);
    } catch {
      this.error.set(true);
      return;
    }
    this.pending.set(null);
    this.journeyState.set(null);
    this.accepted.set(false);
    this.error.set(false);
  }
}
