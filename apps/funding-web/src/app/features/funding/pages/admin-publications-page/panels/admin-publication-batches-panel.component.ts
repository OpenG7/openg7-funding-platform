import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  model,
  output,
  signal
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type {
  AdminPublicationBatchRecord,
  AdminPublicationDraftRecord,
  AdminSocialPublicationJobRecord,
  AdminSocialPublicationJobsResponse,
  PublicationBatchStatus,
  SponsorFeedChannel
} from '@openg7/funding-core';

import { AdminPublicationCalendarComponent } from '../../../components/admin-publications/admin-publication-calendar.component.js';
import type { PublicationCalendarEntry } from '../../../components/admin-publications/publication-calendar.js';
import { AdminDrawerComponent } from '../../../components/admin-ui/admin-drawer.component.js';
import { AdminConfirmationService } from '../../../services/admin-confirmation.service.js';
import { FundingAdminService } from '../../../services/funding-admin.service.js';
import { FundingI18nService } from '../../../services/funding-i18n.service.js';
import type {
  PublicationAutomationTarget,
  PublicationLoadState
} from '../publication-panels.contracts.js';
import {
  publicationBatchStatusLabel,
  publicationChannelLabel,
  publicationDateLabel,
  publicationValueFromEvent
} from '../publication-panels.helpers.js';

/** Funding organism: collective publication editing; shared loading belongs to the page. */
@Component({
  selector: 'openg7-admin-publication-batches-panel',
  standalone: true,
  imports: [
    CommonModule,
    TranslatePipe,
    AdminPublicationCalendarComponent,
    AdminDrawerComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-publication-batches-panel.component.html',
  styleUrls: [
    '../../../components/admin-ui/admin-theme.css',
    '../../../components/admin-ui/admin-controls.css',
    '../../../components/admin-ui/admin-forms.css',
    '../admin-publications-panels.css'
  ]
})
export class AdminPublicationBatchesPanelComponent {
  readonly active = input.required<boolean>();
  readonly state = input.required<PublicationLoadState>();
  readonly adminToken = input.required<string>();
  readonly batches = input.required<readonly AdminPublicationBatchRecord[]>();
  readonly drafts = input.required<readonly AdminPublicationDraftRecord[]>();
  readonly socialJobsResponse =
    input.required<AdminSocialPublicationJobsResponse | null>();
  readonly reload = input.required<() => Promise<void>>();
  readonly selectedBatchId = model<string | null>(null);
  readonly newBatchOpen = model(false);
  readonly failed = output<void>();
  readonly focusRequested = output<string>();
  readonly automationRequested = output<PublicationAutomationTarget>();
  private readonly admin = inject(FundingAdminService);
  private readonly confirmation = inject(AdminConfirmationService);
  private readonly i18n = inject(FundingI18nService);

  readonly batchActionState = signal<string | null>(null);
  readonly showBatchHistory = signal(false);
  readonly newBatchChannel = signal<SponsorFeedChannel>('facebook');
  readonly newBatchCapacity = signal('5');
  readonly batchScheduleEdits = signal<Record<string, string>>({});
  readonly selectedBatch = computed(
    () =>
      this.batches().find((batch) => batch.id === this.selectedBatchId()) ??
      null
  );
  readonly visibleBatches = computed(() =>
    this.batches().filter(
      (batch) =>
        this.showBatchHistory() ||
        batch.status === 'open' ||
        batch.status === 'scheduled' ||
        batch.id === this.selectedBatchId()
    )
  );
  readonly batchCalendarEntries = computed<readonly PublicationCalendarEntry[]>(
    () =>
      this.visibleBatches().map((batch) => ({
        id: batch.id,
        channel: batch.channel,
        status: batch.status,
        startsAt: batch.scheduledAt ?? batch.publishedAt,
        capacity: batch.capacity,
        capacityUsed: batch.capacityUsed
      }))
  );
  readonly socialJobByBatchId = computed(() => {
    const jobs = new Map<string, AdminSocialPublicationJobRecord>();
    for (const job of this.socialJobsResponse()?.jobs ?? []) {
      if (!jobs.has(job.batchId)) jobs.set(job.batchId, job);
    }
    return jobs;
  });

  async createBatch(): Promise<void> {
    if (this.batchActionState()) return;
    const capacity = Number.parseInt(this.newBatchCapacity(), 10);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 50) {
      this.failed.emit();
      return;
    }

    this.batchActionState.set('create');
    try {
      const result = await this.admin.createPublicationBatch(
        this.adminToken(),
        {
          channel: this.newBatchChannel(),
          capacity
        }
      );
      this.newBatchOpen.set(false);
      this.selectedBatchId.set(result.batch?.id ?? null);
      await this.reload()();
      if (result.batch) this.focusRequested.emit(result.batch.id);
    } catch {
      this.failed.emit();
    } finally {
      this.batchActionState.set(null);
    }
  }

  async scheduleBatch(batch: AdminPublicationBatchRecord): Promise<void> {
    if (this.batchActionState()) return;
    const scheduledAt = this.batchScheduleFor(batch.id);
    if (!scheduledAt) return;

    this.batchActionState.set(batch.id);
    try {
      await this.admin.schedulePublicationBatch(this.adminToken(), {
        batchId: batch.id,
        scheduledAt: new Date(scheduledAt).toISOString()
      });
      await this.reload()();
    } catch {
      this.failed.emit();
    } finally {
      this.batchActionState.set(null);
    }
  }

  async publishBatch(batch: AdminPublicationBatchRecord): Promise<void> {
    if (this.batchActionState()) return;
    if (
      !(await this.confirmation.confirm(
        this.i18n.t('admin.confirmation.publish'),
        batch.id
      ))
    )
      return;
    this.batchActionState.set(batch.id);
    try {
      await this.admin.publishPublicationBatch(this.adminToken(), {
        batchId: batch.id
      });
      await this.reload()();
    } catch {
      this.failed.emit();
    } finally {
      this.batchActionState.set(null);
    }
  }

  publishSocialBatch(batch: AdminPublicationBatchRecord): void {
    const drafts = this.drafts().filter((draft) => draft.batch_id === batch.id);
    const target = drafts[0]?.feed_target;
    if (!target) return;
    this.automationRequested.emit({
      batchId: batch.id,
      feedId: target + ':' + batch.channel
    });
  }

  async cancelBatch(batch: AdminPublicationBatchRecord): Promise<void> {
    if (this.batchActionState()) return;
    if (
      !(await this.confirmation.confirm(
        this.i18n.t('admin.confirmation.cancelPublication'),
        batch.id
      ))
    )
      return;
    this.batchActionState.set(batch.id);
    try {
      await this.admin.cancelPublicationBatch(this.adminToken(), {
        batchId: batch.id
      });
      await this.reload()();
    } catch {
      this.failed.emit();
    } finally {
      this.batchActionState.set(null);
    }
  }

  setNewBatchChannel(event: Event): void {
    const value = publicationValueFromEvent(event);
    this.newBatchChannel.set(value === 'linkedin' ? 'linkedin' : 'facebook');
  }

  setNewBatchCapacity(event: Event): void {
    this.newBatchCapacity.set(publicationValueFromEvent(event));
  }

  batchScheduleFor(batchId: string): string {
    return this.batchScheduleEdits()[batchId] ?? '';
  }

  setBatchSchedule(batchId: string, event: Event): void {
    const value = publicationValueFromEvent(event);
    this.batchScheduleEdits.update((edits) => ({ ...edits, [batchId]: value }));
  }

  socialPublicationModeLabel(): string {
    const labels = {
      disabled: this.i18n.t('admin.messages.desactive'),
      mock: this.i18n.t('admin.dossier.simulation'),
      live: this.i18n.t('admin.messages.connecte')
    } as const;
    return labels[this.socialJobsResponse()?.mode ?? 'disabled'];
  }

  socialPublicationConfiguredChannelsLabel(): string {
    const channels = this.socialJobsResponse()?.configuredChannels ?? [];
    return channels.length > 0
      ? channels.map((channel) => this.channelLabel(channel)).join(', ')
      : this.i18n.t('admin.messages.aucun_canal');
  }

  socialJobForBatch(batchId: string): AdminSocialPublicationJobRecord | null {
    return this.socialJobByBatchId().get(batchId) ?? null;
  }

  canPublishSocialBatch(batch: AdminPublicationBatchRecord): boolean {
    const job = this.socialJobForBatch(batch.id);
    return (
      ['open', 'scheduled'].includes(batch.status) &&
      batch.capacityUsed > 0 &&
      !['publishing', 'published', 'failed'].includes(job?.status ?? '')
    );
  }

  socialJobStatusLabel(
    status: AdminSocialPublicationJobRecord['status']
  ): string {
    const labels: Record<AdminSocialPublicationJobRecord['status'], string> = {
      pending: this.i18n.t('admin.legacy.en_attente'),
      publishing: this.i18n.t('admin.messages.envoi_en_cours'),
      published: this.i18n.t('admin.messages.publie_via_api'),
      failed: this.i18n.t('admin.messages.echec_api')
    };
    return labels[status];
  }

  channelLabel(channel: SponsorFeedChannel): string {
    return publicationChannelLabel(this.i18n, channel);
  }

  batchStatusLabel(status: PublicationBatchStatus | null): string {
    return publicationBatchStatusLabel(this.i18n, status);
  }

  dateLabel(value: string | null): string {
    return publicationDateLabel(this.i18n, value);
  }
}
