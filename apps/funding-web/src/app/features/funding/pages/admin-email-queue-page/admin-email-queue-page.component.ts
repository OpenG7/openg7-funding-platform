import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslatePipe } from '@ngx-translate/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import {
  DestroyRef,
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal
} from '@angular/core';
import type {
  AdminEmailQueueMessageRecord,
  AdminEmailQueueMessageStatus
} from '@openg7/funding-core';

import { AdminInspectionService } from '../../services/admin-inspection.service.js';
import { AdminConfirmationService } from '../../services/admin-confirmation.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminLayoutComponent } from '../../components/admin-layout/admin-layout.component.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';

import { AdminEmailQueueController } from './admin-email-queue-controller.js';
import { AdminEmailQueueFiltersComponent } from './admin-email-queue-filters.component.js';
import { AdminEmailQueueMessagesComponent } from './admin-email-queue-messages.component.js';
import type { EmailQueueMessageView } from './admin-email-queue-presentation.js';
import { AdminEmailQueueSummaryComponent } from './admin-email-queue-summary.component.js';

@Component({
  selector: 'openg7-admin-email-queue-page',
  standalone: true,
  imports: [
    CommonModule,
    AdminLayoutComponent,
    AdminEmailQueueSummaryComponent,
    AdminEmailQueueFiltersComponent,
    AdminEmailQueueMessagesComponent,
    TranslatePipe
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <openg7-admin-layout>
      <section class="admin-content">
        <header class="admin-topbar">
          <div>
            <span>{{ 'admin.legacy.administration' | translate }}</span>
            <h1>{{ 'admin.legacy.file_courriel' | translate }}</h1>
          </div>
          <button
            type="button"
            (click)="loadEmailQueue()"
            [disabled]="state() === 'loading'"
          >
            {{ 'admin.legacy.actualiser' | translate }}
          </button>
        </header>
        @if (targetId) {
          <p class="state" data-og7="attention-object-target">
            {{ 'admin.attention.targetObject' | translate: { id: targetId } }}
          </p>
        }
        @if (targetId && state() === 'ready' && !messages().length) {
          <p role="status">{{ 'admin.attention.objectMissing' | translate }}</p>
        }

        <p class="state" *ngIf="state() === 'loading'" aria-live="polite">
          {{ 'admin.legacy.chargement_de_la_file_courriel' | translate }}
        </p>
        <p
          class="state state-error"
          *ngIf="state() === 'error'"
          aria-live="polite"
        >
          {{ errorMessage() }}
        </p>

        <ng-container *ngIf="queue() as response">
          <openg7-admin-email-queue-summary
            [summary]="response.summary"
            [updatedAtLabel]="shortDateLabel(response.last_updated_at)"
          />
          <openg7-admin-email-queue-filters
            [status]="statusFilter()"
            [search]="search()"
            (statusChange)="statusFilter.set($event)"
            (searchChange)="search.set($event)"
          />
          <openg7-admin-email-queue-messages
            [messages]="messageViews()"
            [state]="state()"
            [lastFailedAtLabel]="dateLabel(response.summary.last_failed_at)"
            (inspectRequested)="inspection.email($event)"
            (retryRequested)="retryMessage($event)"
          />
        </ng-container>
      </section>
    </openg7-admin-layout>
  `,
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-forms.css',
    './admin-email-queue-page.component.css'
  ]
})
export class AdminEmailQueuePageComponent implements OnInit {
  readonly i18n = inject(FundingI18nService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly confirmation = inject(AdminConfirmationService);
  readonly inspection = inject(AdminInspectionService);
  private readonly admin = inject(FundingAdminService);
  private readonly route = inject(ActivatedRoute);
  get targetId(): string | undefined {
    return this.controller.targetId();
  }

  readonly adminToken = signal('');
  readonly controller = new AdminEmailQueueController({
    admin: this.admin,
    token: () => this.adminToken(),
    t: (key, params) => this.i18n.t(key, params),
    confirm: (message, detail) => this.confirmation.confirm(message, detail)
  });
  readonly state = this.controller.state;
  readonly errorMessage = this.controller.errorMessage;
  readonly queue = this.controller.queue;
  readonly statusFilter = this.controller.statusFilter;
  readonly search = this.controller.search;
  readonly messages = this.controller.messages;
  readonly messageViews = computed<readonly EmailQueueMessageView[]>(() =>
    this.controller.filteredMessages().map((message) => ({
      message,
      updatedAtLabel: this.dateLabel(message.updated_at),
      statusLabel: this.statusLabel(message.status),
      templateLabel: this.templateLabel(message.template_key),
      nextAttemptAtLabel: this.dateLabel(message.next_attempt_at),
      retryState: this.controller.retryStateFor(message.id),
      retryMessage: this.controller.retryMessageFor(message.id)
    }))
  );

  ngOnInit(): void {
    this.adminToken.set(this.admin.getSavedAdminToken());
    this.destroyRef.onDestroy(() => this.controller.dispose());
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        this.controller.setTarget(params.get('messageId') ?? undefined);
        void this.loadEmailQueue();
      });
  }

  loadEmailQueue(): Promise<void> {
    return this.controller.loadEmailQueue();
  }

  retryMessage(message: AdminEmailQueueMessageRecord): Promise<void> {
    return this.controller.retryMessage(message);
  }

  statusLabel(status: AdminEmailQueueMessageStatus): string {
    switch (status) {
      case 'sent':
        return this.i18n.t('admin.messages.envoye');
      case 'failed':
        return this.i18n.t('admin.messages.echec');
      case 'sending':
        return this.i18n.t('admin.legacy.envoi');
      default:
        return this.i18n.t('admin.legacy.en_file');
    }
  }

  templateLabel(templateKey: string): string {
    return templateKey.replaceAll('_', ' ');
  }

  dateLabel(value: string | null): string {
    if (!value) {
      return this.i18n.t('admin.legacy.absent');
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date);
  }

  shortDateLabel(value: string | null): string {
    if (!value) {
      return this.i18n.t('admin.legacy.absent');
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
      dateStyle: 'medium'
    }).format(date);
  }
}
