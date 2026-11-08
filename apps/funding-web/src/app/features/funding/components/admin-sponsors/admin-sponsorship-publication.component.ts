import { isPlatformBrowser } from '@angular/common';
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
  signal,
  untracked
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { AdminSponsorshipProgress } from '@openg7/funding-core';

import en from '../../../../../assets/i18n/admin-publication-monitor.en.json' with { type: 'json' };
import fr from '../../../../../assets/i18n/admin-publication-monitor.fr-CA.json' with { type: 'json' };
import { FundingAdminService } from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { FundingModerationService } from '../../services/funding-moderation.service.js';
import { AdminConfirmationService } from '../../services/admin-confirmation.service.js';
import { AdminSponsorSchedulingController } from '../../services/admin-sponsor-scheduling-controller.js';
import { AdminPublicationMonitorController } from '../../services/admin-publication-monitor.controller.js';
import {
  publicationMonitor,
  type PublicationMonitorRow
} from '../../models/admin-sponsorship-publication-monitor.js';
import { publicationBlockerTab } from '../../models/admin-sponsorship-workspace.js';
import {
  AdminIconComponent,
  type AdminIconName
} from '../admin-ui/admin-icon.component.js';
import { AdminDrawerComponent } from '../admin-ui/admin-drawer.component.js';
import { PublicationDeliveryDrawerComponent } from '../admin-publications/publication-delivery-drawer.component.js';

import {
  publicationDeskParams,
  publicationExaminationParams,
  publicationWorkshopParams
} from './publication-monitor-navigation.js';

/** Individual monitor; owner workspaces retain every business decision. */
@Component({
  selector: 'openg7-admin-sponsorship-publication',
  standalone: true,
  imports: [
    RouterLink,
    AdminIconComponent,
    AdminDrawerComponent,
    PublicationDeliveryDrawerComponent
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
  readonly commitmentChanged = output<void>();
  private readonly admin = inject(FundingAdminService);
  private readonly i18n = inject(FundingI18nService);
  private readonly router = inject(Router);
  private readonly moderation = inject(FundingModerationService);
  private readonly confirmation = inject(AdminConfirmationService);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly tracking = new AdminPublicationMonitorController(this.admin);
  readonly currentDossier = computed(
    () => this.tracking.progress() ?? this.dossier()
  );
  readonly scheduling = new AdminSponsorSchedulingController({
    admin: this.admin,
    i18n: this.i18n,
    moderate: (subject, level, initial) =>
      this.moderation.requestDecision(subject, level, initial),
    confirm: (message, title) => this.confirmation.confirm(message, title),
    changed: () => this.commitmentChanged.emit()
  });
  readonly monitor = computed(() =>
    publicationMonitor(
      this.currentDossier(),
      this.tracking.workshop(),
      this.scheduling.state(),
      this.tracking.services()
    )
  );
  readonly selectedId = signal<string | null>(null);
  readonly agreementKnown = computed(() =>
    ['ready', 'empty'].includes(this.monitor().agreementState)
  );
  readonly accessDenied = computed(
    () =>
      ['session', 'forbidden', 'not_found'].includes(this.tracking.error()) ||
      this.scheduling.error() === 'admin.privacy.forbidden'
  );
  readonly selected = computed(
    () =>
      (!this.accessDenied() &&
        this.monitor().rows.find(
          (row) => row.obligation.id === this.selectedId()
        )) ||
      null
  );
  readonly deskPath = '/admin/fundraiser/preflight';
  readonly sponsorsPath = '/admin/fundraiser/sponsors';
  readonly automationPath = '/admin/fundraiser/publications/automation';
  readonly contextBlockers = computed(() =>
    [
      ...new Set([
        ...(this.currentDossier().publicationBlockers ?? []),
        ...(this.currentDossier().website?.visible
          ? []
          : (this.currentDossier().website?.blockers ?? []))
      ])
    ].filter((code) => !['visibility_held', 'hidden'].includes(code))
  );
  readonly summaryState = computed(() => {
    if (this.tracking.error() || this.scheduling.error()) return 'unavailable';
    if (this.contextBlockers().length) return 'exception';
    return this.monitor().state;
  });
  readonly busy = computed(
    () =>
      this.tracking.loading() ||
      this.scheduling.loading() ||
      this.scheduling.busy()
  );
  private context = '';

  constructor() {
    effect(() => {
      const language = this.i18n.currentLanguage();
      untracked(() =>
        this.i18n.mergeTranslations(language, {
          admin: { publicationMonitor: language === 'en' ? en : fr }
        })
      );
    });
    effect(() => {
      const dossier = this.dossier();
      const identity = this.admin.identity();
      const context = `${dossier.contributionId}:${dossier.version}:${this.admin.sessionGeneration()}:${identity?.id ?? 'token'}:${identity?.sessionId ?? 'token'}:${identity?.role ?? 'token'}`;
      this.admin.dataRevision();
      untracked(() => {
        if (this.context !== context) {
          this.context = context;
          this.selectedId.set(null);
          this.tracking.reset();
          this.scheduling.reset();
        }
        if (this.browser) void this.refresh();
      });
    });
    if (this.browser)
      this.scheduling.delivery.browserTimezone =
        Intl.DateTimeFormat().resolvedOptions().timeZone;
    effect(() => {
      if (this.accessDenied())
        untracked(() => {
          this.selectedId.set(null);
          this.scheduling.delivery.clear();
        });
    });
    inject(DestroyRef).onDestroy(() => {
      this.tracking.dispose();
      this.scheduling.dispose();
    });
  }

  async refresh(): Promise<void> {
    const dossier = this.dossier();
    await Promise.allSettled([
      this.tracking.load(
        dossier.contributionId,
        dossier.reference,
        this.context
      ),
      this.scheduling.load(dossier.contributionId)
    ]);
  }

  t(key: string, params?: Record<string, unknown>): string {
    return this.i18n.t('admin.publicationMonitor.' + key, params);
  }

  date(value: string): string {
    const parsed = new Date(value);
    return Number.isFinite(parsed.valueOf())
      ? new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: 'America/Toronto'
        }).format(parsed)
      : '—';
  }

  icon(row: PublicationMonitorRow): AdminIconName {
    return row.obligation.channel === 'website' ? 'globe' : 'publications';
  }

  deskParams(row?: PublicationMonitorRow): Record<string, string | null> {
    return publicationDeskParams(
      this.dossier().contributionId,
      this.dossier().reference,
      row?.obligation.id
    );
  }

  workshopParams(): Record<string, string> {
    return publicationWorkshopParams(this.dossier().contributionId);
  }

  ownerParams(tab: string): Record<string, string> {
    return { sponsorshipId: this.dossier().contributionId, tab };
  }

  warning(code: string): string {
    const local = this.t('warning.' + code);
    if (local !== 'admin.publicationMonitor.warning.' + code) return local;
    for (const prefix of [
      'admin.dossier.publicationBridge.schedule.workflow.reason.',
      'admin.publicationAutomation.errors.',
      'admin.publicationWorkshop.missing.'
    ]) {
      const message = this.i18n.t(prefix + code);
      if (message !== prefix + code) return message;
    }
    return this.t('warning.other');
  }

  blockerParams(code: string): Record<string, string> {
    const row = /consent/.test(code)
      ? this.monitor().rows.find((item) => !item.evidence)
      : null;
    if (row)
      return publicationExaminationParams(
        this.dossier().contributionId,
        row.obligation.id
      );
    return this.ownerParams(
      ['commitment_needs_confirmation', 'commitment_blocked'].includes(code)
        ? 'overview'
        : /media|presentation/.test(code)
          ? 'media'
          : /identity|company|organization|contact|public_name/.test(code)
            ? 'identity'
            : publicationBlockerTab(code)
    );
  }

  blockerPath(code: string): string {
    return /consent/.test(code) &&
      this.monitor().rows.some((row) => !row.evidence)
      ? this.deskPath
      : this.sponsorsPath;
  }

  differs(row: PublicationMonitorRow): boolean {
    const content = row.queueService?.content;
    return (
      !!row.variant &&
      !!content &&
      (row.variant.title !== content.title || row.variant.body !== content.body)
    );
  }

  details(row: PublicationMonitorRow): void {
    this.selectedId.set(row.obligation.id);
  }

  async act(row: PublicationMonitorRow): Promise<void> {
    if (this.busy() || this.accessDenied()) return;
    if (row.action === 'proof' || row.action === 'details') {
      this.details(row);
      return;
    }
    if (row.action === 'refresh') {
      await this.refresh();
      return;
    }
    if (row.action === 'queue') {
      await this.router.navigate([this.deskPath], {
        queryParams: this.deskParams(row)
      });
      return;
    }
    if (row.action === 'resolve') {
      const source = row.warnings.find((code) =>
        /consent|identity|media|presentation|public_name|organization|company|contact_email|payment|refund|commitment|^review$|^review_/.test(
          code
        )
      );
      if (source) {
        if (/consent/.test(source)) {
          await this.router.navigate([this.deskPath], {
            queryParams: publicationExaminationParams(
              this.dossier().contributionId,
              row.obligation.id
            )
          });
        } else {
          await this.router.navigate([this.sponsorsPath], {
            queryParams: this.ownerParams(
              /media|presentation/.test(source)
                ? 'media'
                : /refund/.test(source)
                  ? 'billing'
                  : /payment|commitment|^review/.test(source)
                    ? 'overview'
                    : 'identity'
            )
          });
        }
        return;
      }
    }
    if (row.proposal?.adoptedAt && row.action === 'review') {
      await this.router.navigate([this.deskPath], {
        queryParams: publicationExaminationParams(
          this.dossier().contributionId,
          row.obligation.id
        )
      });
      return;
    }
    const deliveryId = this.deliveryId(row);
    if (deliveryId && ['resolve', 'schedule', 'review'].includes(row.action)) {
      await this.scheduling.open(deliveryId);
      return;
    }
    if (row.action === 'schedule') {
      if (row.obligation.channel === 'website')
        await this.router.navigate([this.sponsorsPath], {
          queryParams: this.ownerParams('media'),
          fragment: 'dossier-website-settings'
        });
      else
        await this.router.navigate([this.automationPath], {
          queryParams: this.automationParams(row)
        });
      return;
    }
    if (
      row.status !== 'obsolete' &&
      (row.proposal?.adoptedAt ||
        (!row.proposal && (row.publication || row.queueService)))
    ) {
      await this.router.navigate([this.deskPath], {
        queryParams: publicationExaminationParams(
          this.dossier().contributionId,
          row.obligation.id
        )
      });
      return;
    }
    await this.router.navigate([this.deskPath], {
      queryParams: this.workshopParams()
    });
  }

  automationParams(row: PublicationMonitorRow): Record<string, string> {
    return {
      sponsorshipId: this.dossier().contributionId,
      obligationId: row.obligation.id,
      ...(row.publication ? { draftId: row.publication.id } : {})
    };
  }

  deliveryId(row: PublicationMonitorRow): string | null {
    return (
      row.delivery?.id ??
      row.workflow?.deliveryId ??
      row.publication?.deliveryId ??
      row.evidence?.deliveryId ??
      null
    );
  }

  actionLabel(row: PublicationMonitorRow): string {
    return this.t(
      row.status === 'approved'
        ? row.obligation.channel === 'website'
          ? 'manageWebsite'
          : 'plan'
        : 'action.' + row.action
    );
  }

  safeUrl(value: string | null | undefined): string | null {
    if (!value) return null;
    try {
      const url = new URL(value);
      return ['https:', 'http:'].includes(url.protocol) &&
        !url.username &&
        !url.password
        ? url.href
        : null;
    } catch {
      return null;
    }
  }
}
