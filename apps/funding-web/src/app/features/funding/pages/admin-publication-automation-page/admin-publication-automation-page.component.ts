import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  afterNextRender,
  computed,
  inject,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type {
  PublicationAutomationCommand,
  PublicationAutomationState,
  PublicationFeedId
} from '@openg7/funding-core';

import { FundingAdminService } from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminConfirmationService } from '../../services/admin-confirmation.service.js';
import { AdminLayoutComponent } from '../../components/admin-layout/admin-layout.component.js';
import { AdminPublicationCalendarComponent } from '../../components/admin-publications/admin-publication-calendar.component.js';
import type { PublicationCalendarEntry } from '../../components/admin-publications/publication-calendar.js';

import { PublicationAutomationSettingsController } from './publication-automation-settings.controller.js';
import { AdminPublicationAutomationSettingsComponent } from './admin-publication-automation-settings.component.js';
import { PublicationDeliveryController } from './publication-delivery-controller.js';
import { PublicationDeliveryDrawerComponent } from './publication-delivery-drawer.component.js';
import { AdminPublicationAutomationCommandWorkflow } from './admin-publication-automation-command-workflow.js';
import { PublicationAutomationReadController } from './publication-automation-read-controller.js';
import type { PublicationAutomationCommandRunner } from './publication-automation.ports.js';

@Component({
  selector: 'openg7-admin-publication-automation-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    TranslatePipe,
    AdminLayoutComponent,
    AdminPublicationCalendarComponent,
    AdminPublicationAutomationSettingsComponent,
    PublicationDeliveryDrawerComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-publication-automation-page.component.html',
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    './admin-publication-automation-page.component.css'
  ]
})
export class AdminPublicationAutomationPageComponent {
  private readonly admin = inject(FundingAdminService);
  readonly i18n = inject(FundingI18nService);
  private readonly confirmation = inject(AdminConfirmationService);
  private readonly route = inject(ActivatedRoute);
  readonly feedSettingsExpanded =
    this.route.snapshot.queryParamMap.get('settings') === 'feeds';
  private readonly readController: PublicationAutomationReadController =
    new PublicationAutomationReadController({
      api: {
        read: async (filter) =>
          (await this.admin.publicationAutomation(
            undefined,
            filter
          )) as PublicationAutomationState
      },
      clearError: () => this.error.set(''),
      showError: (error) => this.showError(error),
      busy: () => this.busy(),
      workerChanging: () => this.settingsController.workerChanging(),
      selected: () => Boolean(this.delivery.selected()),
      composing: () => this.delivery.composing(),
      settings: () => Boolean(this.settingsController.settings())
    });
  readonly state = this.readController.state;
  readonly sponsorshipId = this.readController.sponsorshipId;
  readonly deliveryId = this.readController.deliveryId;
  readonly requestedDeliveryMissing =
    this.readController.requestedDeliveryMissing;
  readonly busy = signal(false);
  readonly canManageWorker = computed(
    () => (this.admin.identity()?.role ?? 'owner') === 'owner'
  );
  readonly error = signal('');
  readonly notice = signal('');
  readonly tab = signal('review');
  readonly feedFilter = signal('');
  private readonly commands: PublicationAutomationCommandRunner = {
    run: (command, open) => this.run(command, open)
  };
  readonly settingsController = new PublicationAutomationSettingsController({
    state: this.state,
    busy: this.busy,
    error: this.error,
    notice: this.notice,
    canManageWorker: this.canManageWorker,
    commands: this.commands,
    i18n: this.i18n,
    confirmation: this.confirmation,
    clearFeedback: () => {
      this.error.set('');
      this.notice.set('');
    }
  });
  readonly delivery = new PublicationDeliveryController({
    state: this.state,
    busy: this.busy,
    error: this.error,
    commands: this.commands,
    admin: this.admin,
    i18n: this.i18n,
    confirm: (message, title) => this.confirmation.confirm(message, title),
    showError: (error) => this.showError(error),
    clearError: () => this.error.set('')
  });
  private readonly commandWorkflow =
    new AdminPublicationAutomationCommandWorkflow({
      api: {
        execute: async (command) =>
          (await this.admin.publicationAutomation(command)) as { id?: string },
        read: async (filter) =>
          (await this.admin.publicationAutomation(
            undefined,
            filter
          )) as PublicationAutomationState
      },
      state: { busy: this.busy, error: this.error, notice: this.notice },
      capture: () => this.readController.captureCommandContext(),
      isCurrent: (context) => this.readController.isCurrent(context),
      applyState: (next) => this.readController.applyConfirmedState(next),
      showError: (error) => this.showError(error),
      confirmed: (command, result, next, open) => {
        if (result.id && (open || this.delivery.selected()?.id === result.id)) {
          const job = next.deliveries.find(
            (delivery) => delivery.id === result.id
          );
          if (job) this.delivery.open(job);
        }
        this.settingsController.acceptConfirmedSettings(command);
      }
    });
  readonly visible = computed(() =>
    (this.state()?.deliveries ?? [])
      .filter(
        (d) =>
          (!this.feedFilter() || d.feedId === this.feedFilter()) &&
          (this.tab() === 'all'
            ? true
            : this.tab() === 'review'
              ? d.status === 'draft'
              : this.tab() === 'scheduled'
                ? ['approved', 'publishing'].includes(d.status)
                : this.tab() === 'exceptions'
                  ? ['blocked', 'uncertain'].includes(d.status)
                  : ['published', 'cancelled', 'rejected'].includes(d.status))
      )
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
  );
  readonly tabs = computed(() => [
    ...(this.sponsorshipId() || this.deliveryId() ? ['all'] : []),
    'review',
    'scheduled',
    'calendar',
    'exceptions',
    'history'
  ]);
  readonly calendarEntries = computed<PublicationCalendarEntry[]>(() => {
    this.i18n.trackTranslationState();
    return (this.state()?.deliveries ?? [])
      .filter((d) => !this.feedFilter() || d.feedId === this.feedFilter())
      .map((d) => ({
        id: d.id,
        channel: d.feedId.endsWith('facebook') ? 'facebook' : 'linkedin',
        status:
          d.status === 'published'
            ? 'published'
            : ['cancelled', 'rejected'].includes(d.status)
              ? 'cancelled'
              : ['approved', 'publishing'].includes(d.status)
                ? 'scheduled'
                : 'open',
        startsAt: d.scheduledAt,
        capacity: 1,
        capacityUsed: 1,
        target: d.feedId.split(':')[0].toUpperCase(),
        label: d.message.slice(0, 56),
        detail: this.i18n.t('admin.publicationAutomation.kinds.' + d.kind),
        statusLabel: this.i18n.t(
          'admin.publicationAutomation.status.' + d.status
        )
      }));
  });
  openCalendar(id: string): void {
    const job = this.state()?.deliveries.find((j) => j.id === id);
    if (job) this.delivery.open(job);
  }
  dateLabel(value: string): string {
    const date = new Date(value);
    return Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
          dateStyle: 'medium',
          timeStyle: 'short'
        }).format(date)
      : '';
  }
  constructor() {
    const destroy = inject(DestroyRef);
    destroy.onDestroy(() => {
      this.readController.dispose();
      this.delivery.dispose();
      this.settingsController.dispose();
    });
    afterNextRender(() => {
      this.delivery.browserTimezone =
        Intl.DateTimeFormat().resolvedOptions().timeZone;
      this.route.queryParamMap
        .pipe(takeUntilDestroyed(destroy))
        .subscribe((params) => {
          const context = this.readController.beginContext({
            sponsorshipId: params.get('sponsorshipId') ?? undefined,
            deliveryId: params.get('deliveryId') ?? undefined
          });
          this.delivery.close();
          this.tab.set(
            this.sponsorshipId() || this.deliveryId() ? 'all' : 'review'
          );
          void this.load().then(async (loaded) => {
            if (!loaded || !this.readController.isCurrent(context)) return;
            const deliveryId = params.get('deliveryId');
            const delivery = this.state()?.deliveries.find(
              (d) => d.id === deliveryId
            );
            if (delivery) this.delivery.open(delivery);
            const batchId = params.get('batchId');
            const feedId = params.get('feedId') as PublicationFeedId | null;
            if (
              batchId &&
              feedId &&
              !this.sponsorshipId() &&
              !deliveryId &&
              this.state()?.feeds.some((feed) => feed.id === feedId)
            )
              await this.run(
                { action: 'compose', feedId, kind: 'sponsorship', batchId },
                true
              );
          });
        });
      this.readController.startPolling();
    });
  }
  load(): Promise<boolean> {
    return this.readController.load();
  }
  private showError(error: unknown): void {
    const code = error instanceof Error ? error.message : '';
    const key = [
      'VERSION_CONFLICT',
      'WORKER_VERSION_CONFLICT',
      'SOURCE_CHANGED',
      'MEDIA_CHANGED',
      'SOURCE_NOT_ELIGIBLE',
      'SPONSOR_APPROVAL_REQUIRED',
      'SPONSOR_REVIEW_REQUIRED',
      'SPONSOR_MEDIA_REQUIRED',
      'CONNECTION_REQUIRED',
      'APPROVAL_UNAVAILABLE',
      'DESTINATION_CHANGED',
      'MEDIA_NOT_APPROVED',
      'LEGACY_DELIVERY_EXISTS',
      'INVALID_MESSAGE',
      'POST_MISMATCH',
      'REMOTE_POST_UNVERIFIED',
      'MEDIA_RECONCILIATION_REQUIRED'
    ].includes(code)
      ? code
      : 'generic';
    this.error.set(`admin.publicationAutomation.errors.${key}`);
  }
  async run(
    command: PublicationAutomationCommand,
    open = false
  ): Promise<void> {
    if (!this.readController.isDisposed())
      await this.commandWorkflow.run(command, open);
  }
}
