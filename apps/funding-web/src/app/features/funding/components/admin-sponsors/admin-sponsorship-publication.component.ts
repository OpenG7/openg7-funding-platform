import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  PLATFORM_ID,
  computed,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type { AdminSponsorshipProgress } from '@openg7/funding-core';

import en from '../../../../../assets/i18n/admin-publication-monitor.en.json' with { type: 'json' };
import fr from '../../../../../assets/i18n/admin-publication-monitor.fr-CA.json' with { type: 'json' };
import { FundingAdminService } from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { FundingModerationService } from '../../services/funding-moderation.service.js';
import { AdminConfirmationService } from '../../services/admin-confirmation.service.js';
import { ContributionActivityService } from '../../services/contribution-activity.service.js';
import { AdminSponsorSchedulingController } from '../../services/admin-sponsor-scheduling-controller.js';
import { AdminPublicationMonitorController } from '../../services/admin-publication-monitor.controller.js';
import {
  publicationMonitor,
  type PublicationMonitorRow
} from '../../models/admin-sponsorship-publication-monitor.js';
import { publicationBlockerTab } from '../../models/admin-sponsorship-workspace.js';
import {
  publicationWarningCodes,
  type PublicationWarningContext
} from '../../models/admin-publication-warning-presentation.js';
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
    TranslatePipe,
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
  readonly activity = inject(ContributionActivityService);
  readonly dossier = input.required<AdminSponsorshipProgress>();
  readonly commitmentChanged = output<void>();
  readonly obligationRequested = output<string>();
  readonly obligationActionsDisabled = input(false);
  private readonly admin = inject(FundingAdminService);
  private readonly i18n = inject(FundingI18nService);
  private readonly router = inject(Router);
  private readonly moderation = inject(FundingModerationService);
  private readonly confirmation = inject(AdminConfirmationService);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
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
    canManageWorker: (): boolean => this.canConfigurePreparation(),
    changed: (command): void => {
      if (command.action !== 'worker') this.commitmentChanged.emit();
    }
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

  manageObligation(row: PublicationMonitorRow): void {
    if (
      !this.admin.hasValidAdminSession() ||
      this.accessDenied() ||
      this.busy() ||
      this.obligationActionsDisabled() ||
      row.obligation.contributionId !== this.dossier().contributionId ||
      !this.monitor().rows.some(
        (current) => current.obligation.id === row.obligation.id
      )
    )
      return;
    this.selectedId.set(null);
    this.obligationRequested.emit(row.obligation.id);
  }
  readonly analysisOpen = signal(false);
  private readonly analysisPanel =
    viewChild<ElementRef<HTMLDetailsElement>>('analysisPanel');
  readonly reviewPending = computed(() =>
    ['pending', 'pending_review'].includes(this.currentDossier().reviewStatus)
  );
  readonly preflightActivationOpen = signal(false);
  private readonly preparationStatus =
    viewChild<ElementRef<HTMLElement>>('preparationStatus');
  readonly canConfigurePreparation = computed(
    () =>
      this.browser &&
      this.admin.hasValidAdminSession() &&
      (this.admin.identity()?.role ?? 'owner') === 'owner' &&
      !this.accessDenied()
  );
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
  readonly issueCodes = computed(() => {
    const codes = this.displayWarningCodes(
      [
        ...this.contextBlockers(),
        ...this.monitor().rows.flatMap((row) => row.warnings)
      ],
      {
        reviewPending: this.reviewPending(),
        hasIndependentDraft: this.monitor().rows.some(
          (row) =>
            row.obligation.channel !== 'website' &&
            Boolean(row.publication || row.delivery)
        )
      }
    );
    return codes.filter(
      (code) => !(this.reviewPending() && /^review(?:_|$)/.test(code))
    );
  });
  readonly attentionCode = computed(
    () =>
      this.issueCodes().find(
        (code) =>
          !(this.reviewPending() && /^(?:payment|refund)(?:_|$)/.test(code))
      ) ?? null
  );
  readonly additionalIssues = computed(() =>
    this.issueCodes().filter((code) => code !== this.attentionCode())
  );
  readonly busy = computed(
    () =>
      this.tracking.loading() ||
      this.scheduling.loading() ||
      this.scheduling.busy()
  );
  readonly preparationEngineState = computed(() => {
    if (this.scheduling.workerChanging() && this.scheduling.busy())
      return 'enabling';
    if (this.scheduling.loading()) return 'checking';
    if (this.scheduling.error() || !this.scheduling.state())
      return 'unavailable';
    return this.scheduling.state()?.workerEnabled ? 'enabled' : 'stopped';
  });
  readonly preparationPreflightState = computed(() => {
    if (this.tracking.loading()) return 'checking';
    if (this.tracking.error() || !this.tracking.workshop())
      return 'unavailable';
    return this.tracking.workshop()?.enabled ? 'configured' : 'disabled';
  });
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
          this.analysisOpen.set(false);
          this.preflightActivationOpen.set(false);
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
          this.preflightActivationOpen.set(false);
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

  preparationStatusIcon(state: string): AdminIconName {
    if (state === 'checking' || state === 'enabling') return 'clock';
    if (state === 'unavailable') return 'warning';
    return ['enabled', 'configured'].includes(state) ? 'check' : 'minimize';
  }

  openAnalysis(): void {
    this.analysisOpen.set(true);
    this.analysisPanel()
      ?.nativeElement.querySelector<HTMLElement>('summary')
      ?.focus();
  }

  isSourceIssue(code: string): boolean {
    return /^(?:consent|identity|media|presentation|public_name|public_consent|organization|company|contact_email|payment|refund|commitment|review)(?:_|$)/.test(
      code
    );
  }

  detailsForIssue(code: string): void {
    const row = this.monitor().rows.find((item) =>
      item.warnings.includes(code)
    );
    if (row) this.details(row);
    else this.openAnalysis();
  }

  serviceState(row: PublicationMonitorRow): string {
    if (row.status === 'disabled') return 'awaiting_preparation';
    const ordinaryPrerequisite = (code: string) =>
      /^(?:review|media|presentation|identity|consent|payment|refund)(?:_|$)/.test(
        code
      ) || ['publication_blocked', 'required_elements_missing'].includes(code);
    return this.reviewPending() &&
      row.status === 'exception' &&
      !row.delivery &&
      !row.proposal &&
      !row.evidence &&
      this.warningCodes(row).every(ordinaryPrerequisite)
      ? 'awaiting_review'
      : row.status;
  }

  async enablePreparationEngine(): Promise<void> {
    const context = this.context;
    const enabled = await this.scheduling.enableWorker();
    if (enabled && context === this.context)
      await this.tracking.load(
        this.dossier().contributionId,
        this.dossier().reference,
        context
      );
    if (
      context === this.context &&
      this.canConfigurePreparation() &&
      (enabled || this.scheduling.error())
    )
      this.preparationStatus()?.nativeElement.focus();
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

  warningCodes(row: PublicationMonitorRow): readonly string[] {
    return this.displayWarningCodes(row.warnings, {
      reviewPending: this.reviewPending(),
      channel: row.obligation.channel,
      hasIndependentDraft:
        row.obligation.channel !== 'website' &&
        Boolean(row.publication || row.delivery)
    });
  }

  private displayWarningCodes(
    codes: readonly string[],
    context: PublicationWarningContext
  ): readonly string[] {
    this.i18n.currentLanguage();
    const messages = new Set<string>();
    return publicationWarningCodes(codes, context).filter((code) => {
      const message = this.warning(code);
      if (messages.has(message)) return false;
      messages.add(message);
      return true;
    });
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
    return this.t('warning.otherWithCode', { code });
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
    return this.ownerParams(this.blockerOwnerTab(code));
  }

  blockerFragment(code: string): string | undefined {
    if (this.blockerPath(code) === this.deskPath) return undefined;
    if (code === 'presentation_missing' || code === 'public_presentation')
      return 'dossier-website-settings';
    return /commitment/.test(code)
      ? 'dossier-agreement'
      : /^review(?:_|$)/.test(code)
        ? 'dossier-review'
        : /payment|refund/.test(code)
          ? 'dossier-payment'
          : 'dossier-' + this.blockerOwnerTab(code);
  }

  private blockerOwnerTab(code: string): string {
    return /media|presentation/.test(code)
      ? 'media'
      : /identity|company|organization|contact|public_name/.test(code)
        ? 'identity'
        : /commitment|^review(?:_|$)/.test(code)
          ? 'publication'
          : /payment|refund/.test(code)
            ? 'billing'
            : publicationBlockerTab(code);
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

  async runServiceAction(row: PublicationMonitorRow): Promise<void> {
    const context = this.context;
    this.selectedId.set(null);
    await new Promise<void>((resolve) =>
      afterNextRender(() => resolve(), { injector: this.injector })
    );
    if (context !== this.context || this.accessDenied()) return;
    const current = this.monitor().rows.find(
      (item) => item.obligation.id === row.obligation.id
    );
    if (!current) return;
    const card = Array.from(
      this.host.nativeElement.querySelectorAll<HTMLElement>(
        '[data-og7="publication-service"]'
      )
    ).find((element) => element.dataset['og7Id'] === current.obligation.id);
    card
      ?.querySelector<HTMLElement>('[data-og7="publication-service-details"]')
      ?.focus();
    await this.act(current);
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
            queryParams: this.blockerParams(source),
            fragment: this.blockerFragment(source)
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
