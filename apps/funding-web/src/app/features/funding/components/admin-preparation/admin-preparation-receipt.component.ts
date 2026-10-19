import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  inject,
  input,
  output,
  viewChild
} from '@angular/core';
import { Router } from '@angular/router';
import type {
  AdminPreparationCheck,
  AdminPreparationDraft,
  AdminPreparationReceiptData,
  PreparationAssistanceSummary
} from '@openg7/funding-core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminIconComponent } from '../admin-ui/admin-icon.component.js';
import { automaticAdminUrl } from '../admin-automatic/admin-automatic-run.js';

import { PreparationPilotComponent } from './preparation-pilot.component.js';
import type {
  PreparationDetailsMode,
  PreparationPilotIssue
} from './preparation-pilot.models.js';
import {
  preparationIssueDestination,
  preparationAssistanceDestination,
  preparationReturnOrigin
} from './preparation-navigation.js';
import { PreparationReturnService } from './preparation-return.service.js';

/** Shared private preparation presentation; the host owns loading and approval. */
@Component({
  selector: 'openg7-admin-preparation-receipt',
  standalone: true,
  imports: [AdminIconComponent, PreparationPilotComponent],
  templateUrl: './admin-preparation-receipt.component.html',
  styleUrls: [
    '../admin-ui/admin-controls.css',
    './admin-preparation-receipt.component.css'
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AdminPreparationReceiptComponent {
  readonly receipt = input.required<AdminPreparationReceiptData>();
  readonly idPrefix = input.required<string>();
  readonly readOnly = input(false);
  readonly detailsMode = input<PreparationDetailsMode>('hidden');
  readonly canApprove = input(false);
  readonly approving = input(false);
  readonly selectedIssueId = input<string | null>(null);
  readonly canAssist = input(false);
  readonly assistanceSummary = input<PreparationAssistanceSummary | null>(null);
  readonly assistanceBusy = input(false);
  readonly assistanceError = input('');
  readonly assistanceRefresh = output<void>();
  readonly assistanceRerun = output<string>();
  readonly selectedIssueIdChange = output<string | null>();
  readonly approve = output<AdminPreparationReceiptData>();
  readonly i18n = inject(FundingI18nService);
  private readonly router = inject(Router);
  private readonly returnNavigation = inject(PreparationReturnService);
  private readonly paper = viewChild<ElementRef<HTMLElement>>('paper');
  private readonly approvalButton =
    viewChild<ElementRef<HTMLButtonElement>>('approvalButton');
  private restoreApprovalFocus = false;

  constructor() {
    afterRenderEffect(() => {
      if (this.receipt().status !== 'approved' || !this.restoreApprovalFocus)
        return;
      this.restoreApprovalFocus = false;
      const button = this.approvalButton()?.nativeElement;
      const active = button?.ownerDocument.activeElement;
      const paper = this.paper()?.nativeElement;
      if (
        button &&
        paper &&
        (active === button ||
          active === button.ownerDocument.body ||
          active === button.ownerDocument.getElementById('admin-main') ||
          (active !== null && active !== undefined && paper.contains(active)))
      )
        paper.focus({ preventScroll: true });
    });
  }

  requestApproval(): void {
    if (!this.canApprove() || this.approving()) return;
    const button = this.approvalButton()?.nativeElement;
    this.restoreApprovalFocus =
      !!button && button.ownerDocument.activeElement === button;
    this.approve.emit(this.receipt());
  }

  openIssue(issue: PreparationPilotIssue): void {
    const url = preparationIssueDestination(issue);
    if (!url) return;
    if (this.canAssist() && url.endsWith('#dossier-agreement'))
      this.rememberOrigin(issue.id);
    void this.router.navigateByUrl(url);
  }
  openAssistance(section: 'review' | 'source'): void {
    if (!this.canAssist()) return;
    const url = preparationAssistanceDestination(
      this.receipt().contributionId,
      section
    );
    if (url) {
      this.rememberOrigin(this.selectedIssueId() ?? 'check:accepted_offer');
      void this.router.navigateByUrl(url);
    }
  }

  private rememberOrigin(issueId: string): void {
    this.returnNavigation.remember(
      preparationReturnOrigin(this.router.url, this.receipt(), issueId)
    );
  }

  openCampaigns(): void {
    if (this.detailsMode() !== 'campaigns') return;
    void this.router.navigate(['/admin/fundraiser/campaigns'], {
      queryParams: { sponsorshipId: this.receipt().contributionId }
    });
  }

  reveal(section: 'details' | 'history'): void {
    const paper = this.paper()?.nativeElement;
    const selector =
      section === 'history'
        ? '[data-og7="preparation-receipt-history"]'
        : '[data-og7="preparation-receipt-details"]';
    const disclosure = paper?.querySelector<HTMLDetailsElement>(selector);
    if (!disclosure) {
      paper?.focus({ preventScroll: true });
      return;
    }
    disclosure.open = true;
    disclosure
      .querySelector<HTMLElement>('summary')
      ?.focus({ preventScroll: true });
    disclosure.scrollIntoView({ block: 'nearest' });
  }

  t(key: string, params?: Record<string, unknown>): string {
    return this.i18n.t('admin.automatic.portfolio.receipt.' + key, params);
  }

  portfolioText(key: string, params?: Record<string, unknown>): string {
    return this.i18n.t('admin.automatic.portfolio.' + key, params);
  }

  label(group: string, code: string): string {
    const key = 'admin.automatic.portfolio.receipt.' + group + '.' + code;
    const result = this.i18n.t(key);
    return result === key ? this.t('unknownFact') : result;
  }

  amount(amountMinor: number, currency: string): string {
    const formatter = new Intl.NumberFormat(this.i18n.currentLanguage(), {
      style: 'currency',
      currency,
      currencyDisplay: 'code'
    });
    return formatter.format(
      amountMinor /
        10 ** (formatter.resolvedOptions().maximumFractionDigits ?? 2)
    );
  }

  date(value: string): string {
    return new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
      dateStyle: 'short',
      timeStyle: 'short'
    }).format(new Date(value));
  }

  adminUrl(value: string | null): string | null {
    return value ? automaticAdminUrl(value) : null;
  }

  requiredElements(elements: readonly string[]): string {
    return elements
      .map((element) => this.portfolioText('elements.' + element))
      .join(', ');
  }

  completed(checks: readonly AdminPreparationCheck[]): number {
    return checks.filter((check) => check.state === 'complete').length;
  }

  applicable(checks: readonly AdminPreparationCheck[]): number {
    return checks.filter((check) => check.state !== 'not_required').length;
  }

  draftSummary(receipt: AdminPreparationReceiptData): string {
    const count = receipt.drafts.length;
    const allPrivate = receipt.drafts.every((draft) =>
      ['private', 'draft'].includes(draft.status)
    );
    return this.t(
      'compact.' +
        (count === 0
          ? 'noDrafts'
          : allPrivate
            ? 'privateDraftsCount'
            : 'mixedDraftsCount'),
      { count }
    );
  }

  preparationDestinations(
    receipt: AdminPreparationReceiptData
  ): readonly AdminPreparationDraft['channel'][] {
    const recorded = new Set([
      ...(receipt.acceptedOffer?.benefits.map((benefit) => benefit.channel) ??
        []),
      ...receipt.drafts.map((draft) => draft.channel)
    ]);
    const channels: readonly AdminPreparationDraft['channel'][] = [
      'website',
      'facebook',
      'linkedin'
    ];
    return channels.filter((channel) => recorded.has(channel));
  }

  authorizationState(
    receipt: AdminPreparationReceiptData
  ): AdminPreparationCheck['state'] {
    const ineligible = new Set([
      'refund_pending',
      'recognition_hidden',
      'payment_unconfirmed',
      'payment_refunded',
      'payment_disputed',
      'contribution_missing',
      'commitment_needs_confirmation',
      'offer_unverified',
      'fulfilment_unverified',
      'obligation_unverified',
      'public_consent_missing',
      'sponsor_review_required',
      'moderation_review_required'
    ]);
    if (receipt.blockers.some((blocker) => ineligible.has(blocker.code)))
      return 'missing';
    const payment = receipt.checks.find(
      (check) => check.code === 'payment_confirmed'
    );
    const offer = receipt.checks.find(
      (check) => check.code === 'accepted_offer'
    );
    if (payment?.state !== 'complete' || !offer || offer.state === 'missing')
      return 'missing';
    const required = receipt.authorizations.filter(
      (check) => check.state !== 'not_required'
    );
    if (!required.length) {
      return receipt.authorizations.length > 0 ||
        receipt.balance?.contributionType === 'personal_support'
        ? 'not_required'
        : 'missing';
    }
    return required.every((check) => check.state === 'complete')
      ? 'complete'
      : 'missing';
  }

  ticketDraftState(
    receipt: AdminPreparationReceiptData
  ):
    | 'ready_private'
    | 'missing'
    | 'published'
    | 'cancelled'
    | 'rejected'
    | 'scheduled'
    | 'approved'
    | 'pending_review'
    | 'mixed' {
    if (!receipt.drafts.length) return 'missing';
    const statuses = new Set(receipt.drafts.map((draft) => draft.status));
    const common = receipt.drafts[0]?.status;
    if (statuses.size === 1) {
      if (
        common === 'published' ||
        common === 'cancelled' ||
        common === 'rejected' ||
        common === 'scheduled' ||
        common === 'approved' ||
        common === 'pending_review'
      )
        return common;
    }
    const contentBlockers = new Set([
      'website_draft_missing',
      'website_draft_outdated',
      'publication_draft_missing',
      'publication_draft_incomplete',
      'required_media_missing',
      'company_missing',
      'presentation_missing'
    ]);
    if (receipt.blockers.some((blocker) => contentBlockers.has(blocker.code)))
      return 'missing';
    return receipt.drafts.every((draft) =>
      ['private', 'draft'].includes(draft.status)
    )
      ? 'ready_private'
      : 'mixed';
  }

  ticketDraftSummary(receipt: AdminPreparationReceiptData): string {
    const state = this.ticketDraftState(receipt);
    if (!receipt.drafts.length) return this.t('ticket.noDrafts');
    if (state === 'ready_private') return this.t('ticket.readyPrivate');
    if (state === 'missing') return this.t('ticket.draftIncomplete');
    if (state === 'mixed') return this.t('ticket.mixedDrafts');
    return this.label('draftStates', state);
  }
}
