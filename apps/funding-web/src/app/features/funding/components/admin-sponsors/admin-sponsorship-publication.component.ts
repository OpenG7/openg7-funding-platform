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
  resolveSponsorshipBenefits,
  type AdminSponsorshipProgress,
  type SponsorshipProgressPublication
} from '@openg7/funding-core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { ContributionActivityService } from '../../services/contribution-activity.service.js';

/** Funding organism: persisted recognition facts and explicit visibility requests. */
@Component({
  selector: 'openg7-admin-sponsorship-publication',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
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
    () => this.dossier().currency.toUpperCase() === 'CAD'
  );
  readonly benefits = computed(() =>
    this.benefitsKnown()
      ? resolveSponsorshipBenefits(this.dossier().amountMinor / 100)
          .achievedBenefits
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
    () =>
      this.cards().filter((c) => this.status(c.publication) === 'published')
        .length
  );
  readonly automationPath = '/admin/fundraiser/publications/automation';

  status(p: SponsorshipProgressPublication | null): string {
    if (!p) return 'waiting';
    if (p.status === 'published' && p.deliveryMode !== 'mock')
      return 'published';
    if (p.deliveryStatus === 'published')
      return p.deliveryMode === 'live' ? 'published' : 'simulated';
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
