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
  AdminEmailQueueMessageStatus,
  AdminEmailQueueResponse
} from '@openg7/funding-core';

import { AdminInspectionService } from '../../services/admin-inspection.service.js';
import { AdminConfirmationService } from '../../services/admin-confirmation.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminLayoutComponent } from '../../components/admin-layout/admin-layout.component.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';

import { AdminEmailQueueFiltersComponent } from './admin-email-queue-filters.component.js';
import { AdminEmailQueueMessagesComponent } from './admin-email-queue-messages.component.js';
import { filterEmailQueueMessages } from './admin-email-queue-presentation.js';
import type {
  EmailQueueLoadState,
  EmailQueueMessageView,
  EmailQueueRetryState,
  EmailQueueStatusFilter
} from './admin-email-queue-presentation.js';
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
  private requestGeneration = 0;
  private exactId: string | undefined;

  private readonly confirmation = inject(AdminConfirmationService);
  readonly inspection = inject(AdminInspectionService);
  private readonly admin = inject(FundingAdminService);
  private readonly route = inject(ActivatedRoute);
  get targetId(): string | undefined {
    return this.exactId;
  }

  readonly adminToken = signal('');
  readonly state = signal<EmailQueueLoadState>('idle');
  readonly errorMessage = signal(
    this.i18n.t('admin.messages.impossible_de_charger_la_file_courriel')
  );
  readonly queue = signal<AdminEmailQueueResponse | null>(null);
  readonly statusFilter = signal<EmailQueueStatusFilter>('all');
  readonly search = signal('');
  readonly retryStates = signal<Record<string, EmailQueueRetryState>>({});
  readonly retryMessages = signal<Record<string, string>>({});
  readonly messages = computed(() => this.queue()?.messages ?? []);
  readonly filteredMessages = computed(() =>
    filterEmailQueueMessages(
      this.messages(),
      this.statusFilter(),
      this.search()
    )
  );
  readonly messageViews = computed<readonly EmailQueueMessageView[]>(() =>
    this.filteredMessages().map((message) => ({
      message,
      updatedAtLabel: this.dateLabel(message.updated_at),
      statusLabel: this.statusLabel(message.status),
      templateLabel: this.templateLabel(message.template_key),
      nextAttemptAtLabel: this.dateLabel(message.next_attempt_at),
      retryState: this.retryStateFor(message.id),
      retryMessage: this.retryMessageFor(message.id)
    }))
  );

  ngOnInit(): void {
    this.adminToken.set(this.admin.getSavedAdminToken());
    this.destroyRef.onDestroy(() => {
      this.requestGeneration++;
    });
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        this.exactId = params.get('messageId') ?? undefined;
        this.queue.set(null);
        this.search.set('');
        this.statusFilter.set('all');
        void this.loadEmailQueue();
      });
  }

  async loadEmailQueue(): Promise<void> {
    if (this.destroyRef.destroyed) return;
    const generation = ++this.requestGeneration;
    this.state.set('loading');

    try {
      const result = await this.admin.getEmailQueue(
        this.adminToken(),
        this.exactId
      );
      if (generation !== this.requestGeneration) return;
      this.queue.set(result);
      this.state.set('ready');
      this.errorMessage.set('');
    } catch (error) {
      if (generation !== this.requestGeneration) return;
      this.state.set('error');
      this.errorMessage.set(this.messageFromError(error));
    }
  }

  async retryMessage(message: AdminEmailQueueMessageRecord): Promise<void> {
    if (
      message.status === 'sent' ||
      this.retryStateFor(message.id) === 'confirming' ||
      this.retryStateFor(message.id) === 'sending'
    ) {
      return;
    }

    this.setRetryState(message.id, 'confirming');
    if (
      !(await this.confirmation.confirm(
        this.i18n.t('admin.confirmation.retryEmail'),
        message.recipient_email
      ))
    ) {
      this.setRetryState(message.id, 'idle');
      return;
    }
    this.setRetryState(message.id, 'sending');
    this.setRetryMessage(message.id, '');

    try {
      const result = await this.admin.retryEmailQueueMessage(
        this.adminToken(),
        {
          messageId: message.id
        }
      );

      if (this.destroyRef.destroyed) return;
      this.requestGeneration++;
      if (result.message) {
        this.replaceMessage(result.message);
      }

      const sent = result.sent > 0 || result.message?.status === 'sent';
      const inProgress = result.message?.status === 'sending';
      this.setRetryState(
        message.id,
        sent ? 'sent' : inProgress ? 'idle' : 'error'
      );
      this.setRetryMessage(
        message.id,
        sent
          ? this.i18n.t('admin.messages.message_envoye')
          : inProgress
            ? this.i18n.t('admin.messages.courriel_deja_en_cours')
            : result.attempted > 0
              ? this.i18n.t(
                  'admin.messages.relance_tentee_le_message_reste_en_echec'
                )
              : this.i18n.t('admin.messages.aucune_tentative_effectuee')
      );
      await this.loadEmailQueue();
    } catch (error) {
      this.setRetryState(message.id, 'error');
      this.setRetryMessage(message.id, this.messageFromError(error));
    }
  }

  retryStateFor(id: string): EmailQueueRetryState {
    return this.retryStates()[id] ?? 'idle';
  }

  retryMessageFor(id: string): string {
    return this.retryMessages()[id] ?? '';
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

  private replaceMessage(message: AdminEmailQueueMessageRecord): void {
    const current = this.queue();
    if (!current?.messages.some((candidate) => candidate.id === message.id)) {
      return;
    }

    this.queue.set({
      ...current,
      messages: current.messages.map((candidate) =>
        candidate.id === message.id ? message : candidate
      )
    });
  }

  private setRetryState(id: string, state: EmailQueueRetryState): void {
    this.retryStates.update((states) => ({
      ...states,
      [id]: state
    }));
  }

  private setRetryMessage(id: string, message: string): void {
    this.retryMessages.update((messages) => ({
      ...messages,
      [id]: message
    }));
  }

  private messageFromError(error: unknown): string {
    return error instanceof Error
      ? error.message
      : this.i18n.t('admin.messages.operation_admin_impossible');
  }
}
