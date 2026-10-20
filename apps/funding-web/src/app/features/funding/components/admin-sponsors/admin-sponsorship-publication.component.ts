import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  input,
  output,
  untracked
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import {
  type AdminSponsorshipProgress,
  type PublicationPreparationCandidate,
  type PublicationPreparationEntry,
  type SponsorshipProgressPublication
} from '@openg7/funding-core';

import enSchedule from '../../../../../assets/i18n/admin-publication-schedule.en.json' with { type: 'json' };
import frSchedule from '../../../../../assets/i18n/admin-publication-schedule.fr-CA.json' with { type: 'json' };
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';
import { FundingModerationService } from '../../services/funding-moderation.service.js';
import { AdminConfirmationService } from '../../services/admin-confirmation.service.js';
import { AdminSponsorSchedulingController } from '../../services/admin-sponsor-scheduling-controller.js';
import { PublicationDeliveryDrawerComponent } from '../admin-publications/publication-delivery-drawer.component.js';
import { AdminIconComponent } from '../admin-ui/admin-icon.component.js';
import { AdminAutomaticPreparationDirective } from '../admin-automatic/admin-automatic-preparation.directive.js';
import {
  isDossierPublicationComplete,
  publicationBlockerTab,
  qualifiedPublicationEvidence
} from '../../models/admin-sponsorship-workspace.js';

import { AdminSponsorshipCommitmentsComponent } from './admin-sponsorship-commitments.component.js';
import { AdminSponsorshipPreparationComponent } from './admin-sponsorship-preparation.component.js';
import { registerSponsorPublicationTranslations } from './admin-sponsors-publication-translations.js';

interface PublicationGuidanceLink {
  readonly id:
    | 'offer'
    | 'preparation'
    | 'content'
    | 'authorization'
    | 'delivery'
    | 'evidence';
  readonly path: string;
  readonly fragment?: string;
}

/** Funding organism: persisted recognition facts and explicit visibility requests. */
@Component({
  selector: 'openg7-admin-sponsorship-publication',
  standalone: true,
  imports: [
    RouterLink,
    TranslatePipe,
    AdminIconComponent,
    AdminAutomaticPreparationDirective,
    AdminSponsorshipCommitmentsComponent,
    PublicationDeliveryDrawerComponent,
    AdminSponsorshipPreparationComponent
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
  readonly guidanceLinks: readonly PublicationGuidanceLink[] = [
    {
      id: 'offer',
      path: '/admin/fundraiser/sponsors',
      fragment: 'dossier-agreement'
    },
    {
      id: 'preparation',
      path: '/admin/fundraiser/sponsors',
      fragment: 'dossier-preparation'
    },
    {
      id: 'content',
      path: '/admin/fundraiser/sponsors',
      fragment: 'dossier-publication-content'
    },
    {
      id: 'authorization',
      path: '/admin/fundraiser/sponsors',
      fragment: 'dossier-publication-content'
    },
    { id: 'delivery', path: '/admin/fundraiser/publications/automation' },
    { id: 'evidence', path: '/admin/fundraiser/campaigns' }
  ];
  readonly blockerTab = publicationBlockerTab;
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
  private readonly i18n = inject(FundingI18nService);
  private readonly admin = inject(FundingAdminService);
  private readonly moderation = inject(FundingModerationService);
  private readonly confirmation = inject(AdminConfirmationService);
  readonly scheduling = new AdminSponsorSchedulingController({
    admin: this.admin,
    i18n: this.i18n,
    moderate: (subject, level, initial) =>
      this.moderation.requestDecision(subject, level, initial),
    confirm: (message, title) => this.confirmation.confirm(message, title),
    changed: () => this.commitmentChanged.emit()
  });

  constructor() {
    registerSponsorPublicationTranslations();
    const browser = isPlatformBrowser(inject(PLATFORM_ID));
    effect(() => {
      const language = this.i18n.currentLanguage();
      untracked(() => {
        const { adminOverrides, ...schedule } =
          language === 'en' ? enSchedule : frSchedule;
        this.i18n.mergeTranslations(language, adminOverrides);
        this.i18n.mergeTranslations(language, {
          admin: {
            dossier: {
              publicationBridge: {
                schedule
              }
            }
          }
        });
      });
    });
    if (browser)
      this.scheduling.delivery.browserTimezone =
        Intl.DateTimeFormat().resolvedOptions().timeZone;
    effect(() => {
      const dossier = this.dossier();
      if (browser)
        untracked(() => void this.scheduling.load(dossier.contributionId));
    });
    inject(DestroyRef).onDestroy(() => this.scheduling.dispose());
  }
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
      target: string;
      publication: SponsorshipProgressPublication | null;
      source: PublicationPreparationEntry | null;
      candidate: PublicationPreparationCandidate | null;
    }[] = d.publications.map((p) => ({
      key: p.id,
      channel: p.channel,
      target: p.target,
      publication: p,
      source: null,
      candidate: null
    }));
    for (const source of this.scheduling.entries()) {
      const existing = rows.find((row) => row.key === source.draftId);
      if (existing) existing.source = source;
      else
        rows.push({
          key: source.draftId,
          channel: source.feedId.split(':')[1],
          target: source.feedId.split(':')[0],
          publication: null,
          source,
          candidate: null
        });
    }
    for (const candidate of this.scheduling.candidates()) {
      rows.push({
        key: `candidate:${candidate.obligationId}`,
        channel: candidate.feedId.split(':')[1],
        target: candidate.feedId.split(':')[0],
        publication: null,
        source: null,
        candidate
      });
    }
    for (const row of rows) {
      const deliveryId = row.publication?.deliveryId ?? row.source?.deliveryId;
      const delivery = this.scheduling
        .state()
        ?.deliveries.find((job) => job.id === deliveryId);
      if (delivery)
        row.publication = {
          id: row.key,
          channel: row.channel,
          target: row.target,
          status: row.publication?.status ?? 'draft',
          batchStatus: row.publication?.batchStatus ?? null,
          slotStatus: row.publication?.slotStatus ?? null,
          deliveryId: delivery.id,
          deliveryStatus: delivery.status,
          deliveryMode: delivery.mode,
          deliveryError: delivery.errorCode,
          feedPaused: this.scheduling
            .state()
            ?.feeds.find((feed) => feed.id === delivery.feedId)?.paused,
          publicUrl: delivery.externalPostUrl,
          scheduledAt: delivery.scheduledAt,
          publishedAt: delivery.publishedAt
        };
    }
    for (const benefit of d.commitment?.offer?.benefits ?? []) {
      if (
        this.benefitsKnown() &&
        benefit.channel !== 'website' &&
        !rows.some(
          (r) => r.channel === benefit.channel && r.target === benefit.target
        )
      )
        rows.push({
          key: `${benefit.target}:${benefit.channel}`,
          channel: benefit.channel,
          target: benefit.target,
          publication: null,
          source: null,
          candidate: null
        });
    }
    return rows;
  });
  readonly publicationCompletion = computed(() => {
    const completion = this.dossier().publicationCompletion;
    if (!completion) return null;
    const qualified =
      this.dossier().commitment?.obligations.filter((obligation) =>
        Boolean(this.evidence(obligation.id))
      ).length ?? 0;
    return { ...completion, done: Math.min(completion.done, qualified) };
  });
  readonly publicationComplete = computed(() =>
    isDossierPublicationComplete(this.dossier())
  );
  readonly automationPath = '/admin/fundraiser/publications/automation';

  evidence(obligationId: string) {
    return qualifiedPublicationEvidence(this.dossier(), obligationId);
  }

  publicationDateLabel(reasonOrDeliveryStatus: string): string {
    return [
      'approved',
      'publishing',
      'failed',
      'uncertain',
      'published',
      'publication_scheduled',
      'publication_publishing',
      'publication_retry_pending',
      'publication_paused',
      'publication_worker_disabled',
      'publication_failed',
      'publication_uncertain'
    ].includes(reasonOrDeliveryStatus)
      ? 'admin.dossier.publicationBridge.schedule.workflow.scheduledFor'
      : 'admin.dossier.publicationBridge.proposedDate';
  }

  deliveryId(
    publication: SponsorshipProgressPublication | null,
    source: PublicationPreparationEntry | null
  ): string | null {
    return publication?.deliveryId ?? source?.deliveryId ?? null;
  }

  canPrepare(
    source: PublicationPreparationEntry | PublicationPreparationCandidate
  ): boolean {
    return source.nextOpportunity?.action === 'PREPARE_FEED';
  }

  canEdit(deliveryId: string): boolean {
    const delivery = this.scheduling
      .state()
      ?.deliveries.find((job) => job.id === deliveryId);
    return (
      !!delivery && ['draft', 'approved', 'blocked'].includes(delivery.status)
    );
  }

  status(p: SponsorshipProgressPublication | null): string {
    if (!p) return 'waiting';
    if (p.deliveryStatus === 'uncertain') return 'uncertain';
    if (p.deliveryMode === 'mock' && p.deliveryStatus === 'published')
      return 'simulated';
    const proven = this.dossier().fulfilmentEvidence?.some(
      (e) =>
        this.evidence(e.obligationId)?.id === e.id &&
        e.deliveryId === p.deliveryId &&
        e.deliveryId !== null &&
        e.channel === p.channel &&
        e.target === p.target
    );
    if (proven) return 'published';
    if (p.deliveryStatus === 'published')
      return p.deliveryMode === 'mock' ? 'simulated' : 'unverified';
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
    if (p.deliveryId) return 'review';
    if (p.status === 'published') return 'unverified';
    if (['draft', 'pending_review', 'approved', 'scheduled'].includes(p.status))
      return 'prepared';
    return 'waiting';
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
  guidanceParams(link: PublicationGuidanceLink): Record<string, string> {
    return {
      sponsorshipId: this.dossier().contributionId,
      ...(link.fragment ? { tab: 'publication' } : {})
    };
  }
  date(value: string): string {
    const date = new Date(value);
    return Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: 'America/Toronto'
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
    return this.safePublicUrl(p.publicUrl);
  }

  private safePublicUrl(value: string | null | undefined): string | null {
    if (!value) return null;
    try {
      const url = new URL(value);
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
