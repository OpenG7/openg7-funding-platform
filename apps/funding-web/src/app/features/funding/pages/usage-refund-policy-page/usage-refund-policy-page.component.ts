import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { FundingHeaderComponent } from '../../components/funding-header/funding-header.component.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { FundingSeoService } from '../../services/funding-seo.service.js';

interface PolicySection {
  readonly id: string;
  readonly titleKey: string;
  readonly copyKey: string;
  readonly items: readonly string[];
}

@Component({
  selector: 'openg7-usage-refund-policy-page',
  standalone: true,
  imports: [RouterLink, TranslatePipe, FundingHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './usage-refund-policy-page.component.html',
  styleUrl: './usage-refund-policy-page.component.css'
})
export class UsageRefundPolicyPageComponent {
  private readonly document = inject(DOCUMENT);
  private readonly i18n = inject(FundingI18nService);
  private readonly injector = inject(Injector);
  private readonly seo = inject(FundingSeoService);

  // Editorial revision, not a new financial eligibility rule.
  readonly revision = '2026-09-19';
  readonly contactEmail = 'contact@openg7.org';
  readonly canPrint = signal(false);
  readonly summaryItems = ['nature', 'refunds', 'visibility'] as const;
  readonly requestSteps = ['reference', 'contact', 'decision'] as const;
  readonly policyPath = computed(() =>
    this.i18n.localizedPath('/politique-utilisation-remboursement')
  );
  readonly supportPath = computed(() => this.i18n.localizedPath('/support'));
  readonly transparencyPath = computed(() =>
    this.i18n.localizedPath('/fonds-des-batisseurs/transparence')
  );

  readonly sections: readonly PolicySection[] = [
    {
      id: 'contributions',
      titleKey: 'funding.policyPage.sections.nature.title',
      copyKey: 'funding.policyPage.sections.nature.copy',
      items: [
        'funding.policyPage.sections.nature.items.nonCharity',
        'funding.policyPage.sections.nature.items.noReceipt',
        'funding.policyPage.sections.nature.items.voluntary'
      ]
    },
    {
      id: 'payments',
      titleKey: 'funding.policyPage.sections.payments.title',
      copyKey: 'funding.policyPage.sections.payments.copy',
      items: [
        'funding.policyPage.sections.payments.items.stripe',
        'funding.policyPage.sections.payments.items.currency',
        'funding.policyPage.sections.payments.items.confirmation'
      ]
    },
    {
      id: 'refunds',
      titleKey: 'funding.policyPage.sections.refunds.title',
      copyKey: 'funding.policyPage.sections.refunds.copy',
      items: [
        'funding.policyPage.sections.refunds.items.request',
        'funding.policyPage.sections.refunds.items.review',
        'funding.policyPage.sections.refunds.items.amount',
        'funding.policyPage.sections.refunds.items.destination',
        'funding.policyPage.sections.refunds.items.timing',
        'funding.policyPage.sections.refunds.items.retry'
      ]
    },
    {
      id: 'disputes',
      titleKey: 'funding.policyPage.sections.disputes.title',
      copyKey: 'funding.policyPage.sections.disputes.copy',
      items: [
        'funding.policyPage.sections.disputes.items.stripe',
        'funding.policyPage.sections.disputes.items.visibility',
        'funding.policyPage.sections.disputes.items.records'
      ]
    },
    {
      id: 'sponsorships',
      titleKey: 'funding.policyPage.sections.sponsorship.title',
      copyKey: 'funding.policyPage.sections.sponsorship.copy',
      items: [
        'funding.policyPage.sections.sponsorship.items.review',
        'funding.policyPage.sections.sponsorship.items.followup',
        'funding.policyPage.sections.sponsorship.items.noAutomaticPublication',
        'funding.policyPage.sections.sponsorship.items.refusal'
      ]
    },
    {
      id: 'visibility',
      titleKey: 'funding.policyPage.sections.visibility.title',
      copyKey: 'funding.policyPage.sections.visibility.copy',
      items: [
        'funding.policyPage.sections.visibility.items.approval',
        'funding.policyPage.sections.visibility.items.removal',
        'funding.policyPage.sections.visibility.items.feed'
      ]
    },
    {
      id: 'privacy',
      titleKey: 'funding.policyPage.sections.privacy.title',
      copyKey: 'funding.policyPage.sections.privacy.copy',
      items: [
        'funding.policyPage.sections.privacy.items.publicData',
        'funding.policyPage.sections.privacy.items.privateData',
        'funding.policyPage.sections.privacy.items.aggregate',
        'funding.policyPage.sections.privacy.items.contact'
      ]
    }
  ];

  constructor() {
    afterNextRender(() => {
      this.canPrint.set(typeof this.document.defaultView?.print === 'function');
    });
    this.seo.bind(
      {
        titleKey: 'funding.seo.policy.title',
        descriptionKey: 'funding.seo.policy.description',
        path: '/politique-utilisation-remboursement',
        imagePath:
          '/assets/fonds-des-batisseurs-canada-coffre-lumineux-1920.webp'
      },
      this.injector
    );
  }

  refundEmailHref(): string {
    return (
      'mailto:' +
      this.contactEmail +
      '?subject=' +
      encodeURIComponent(this.i18n.t('funding.policyPage.request.emailSubject'))
    );
  }

  focusSection(event: MouseEvent, id: string): void {
    if (
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    this.document.getElementById(id)?.focus({ preventScroll: true });
  }

  printPolicy(): void {
    this.document.defaultView?.print();
  }
}
