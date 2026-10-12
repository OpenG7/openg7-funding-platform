import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import {
  type AdminSponsorshipProgress,
  type SponsorshipProgressPublication
} from '@openg7/funding-core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { ContributionActivityService } from '../../services/contribution-activity.service.js';
import { AdminIconComponent } from '../admin-ui/admin-icon.component.js';

import { AdminSponsorshipCommitmentsComponent } from './admin-sponsorship-commitments.component.js';

/** Funding organism: persisted recognition facts and explicit visibility requests. */
@Component({
  selector: 'openg7-admin-sponsorship-publication',
  standalone: true,
  imports: [
    RouterLink,
    TranslatePipe,
    AdminIconComponent,
    AdminSponsorshipCommitmentsComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-sponsorship-publication.component.html',
  styleUrls: [
    '../admin-ui/admin-controls.css',
    './admin-sponsorship-publication.component.css'
  ]
})
export class AdminSponsorshipPublicationComponent {
  readonly dossier = input.required<AdminSponsorshipProgress>();
  readonly canManageWebsite = input(false);
  readonly websiteDisabled = input(false);
  readonly websiteMessage = input('');
  readonly changeWebsiteVisibility = output<boolean>();
  readonly editWebsite = output<void>();
  readonly commitmentChanged = output<void>();
  readonly websiteState = computed(() => {
    const site = this.dossier().website;
    return !site
      ? 'unknown'
      : site.visible
        ? 'visible'
        : site.canPublish
          ? 'hidden'
          : 'blocked';
  });
  readonly activity = inject(ContributionActivityService);
  private readonly i18n = inject(FundingI18nService);
  readonly benefitsKnown = computed(
    () =>
      this.dossier().commitment?.state === 'active' &&
      Boolean(this.dossier().commitment?.offer)
  );
  readonly benefits = computed(() =>
    this.benefitsKnown()
      ? this.dossier().commitment!.offer!.benefits.map((b) => b.id)
      : []
  );
  readonly cards = computed(() => {
    const d = this.dossier();
    const rows: {
      key: string;
      channel: string;
      publication: SponsorshipProgressPublication | null;
    }[] = d.publications.map((p) => ({
      key: p.id,
      channel: p.channel,
      publication: p
    }));
    for (const channel of ['facebook', 'linkedin']) {
      if (
        this.benefits().some((b) => b === `${channel}_batch`) &&
        !rows.some((r) => r.channel === channel)
      )
        rows.push({ key: channel, channel, publication: null });
    }
    return rows;
  });
  readonly blockers = computed(() => this.dossier().publicationBlockers ?? []);
  readonly completed = computed(
    () => this.dossier().publicationCompletion?.done ?? 0
  );
  readonly publicationComplete = computed(() => {
    const completion = this.dossier().publicationCompletion;
    return (
      this.benefitsKnown() &&
      Boolean(
        completion &&
        completion.total > 0 &&
        completion.done === completion.total
      )
    );
  });
  readonly automationPath = '/admin/fundraiser/publications/automation';

  status(p: SponsorshipProgressPublication | null): string {
    if (!p) return 'waiting';
    if (p.status === 'published' || p.deliveryStatus === 'published') {
      if (p.deliveryMode === 'mock') return 'simulated';
      return this.dossier().fulfilmentEvidence?.some(
        (e) =>
          e.deliveryId === p.deliveryId &&
          e.deliveryId !== null &&
          e.channel === p.channel &&
          e.target === p.target
      )
        ? 'published'
        : 'unverified';
    }
    if (
      ['uncertain', 'failed', 'blocked', 'rejected', 'cancelled'].includes(
        p.deliveryStatus ?? ''
      )
    )
      return p.deliveryStatus!;
    if (
      ['cancelled', 'rejected'].includes(p.status) ||
      p.batchStatus === 'cancelled' ||
      p.slotStatus === 'cancelled'
    )
      return 'cancelled';
    if (p.deliveryId && p.deliveryStatus === 'approved') return 'scheduled';
    if (p.deliveryStatus === 'publishing') return 'publishing';
    return p.deliveryId ? 'review' : 'waiting';
  }
  action(p: SponsorshipProgressPublication | null): string {
    const status = this.status(p);
    if (status === 'review') return 'review';
    if (status === 'scheduled' || status === 'publishing') return 'schedule';
    if (['blocked', 'uncertain', 'failed'].includes(status)) return 'resolve';
    return 'open';
  }
  params(p?: SponsorshipProgressPublication | null): Record<string, string> {
    return {
      sponsorshipId: this.dossier().contributionId,
      ...(p?.deliveryId ? { deliveryId: p.deliveryId } : {})
    };
  }
  blockerTab(reason: string): string {
    return reason === 'media'
      ? 'media'
      : reason === 'identity'
        ? 'identity'
        : reason === 'hidden'
          ? 'publication'
          : reason === 'refund'
            ? 'refund'
            : 'overview';
  }
  date(value: string): string {
    const date = new Date(value);
    return Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
          dateStyle: 'medium',
          timeStyle: 'short'
        }).format(date)
      : '';
  }
  errorMessage(code: string): string {
    const key = 'admin.publicationAutomation.errors.' + code;
    const message = this.i18n.t(key);
    return message === key
      ? this.i18n.t('admin.dossier.publicationBridge.failureHelp')
      : message;
  }
  publicUrl(p: SponsorshipProgressPublication | null): string | null {
    if (!p?.publicUrl || this.status(p) !== 'published') return null;
    try {
      const url = new URL(p.publicUrl);
      return ['http:', 'https:'].includes(url.protocol) &&
        !url.username &&
        !url.password
        ? url.href
        : null;
    } catch {
      return null;
    }
  }
}
