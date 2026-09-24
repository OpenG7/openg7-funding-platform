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

type LoadState = 'idle' | 'loading' | 'ready' | 'error';
type RetryState = 'idle' | 'confirming' | 'sending' | 'sent' | 'error';
type EmailQueueStatusFilter = 'all' | AdminEmailQueueMessageStatus;

@Component({
  selector: 'openg7-admin-email-queue-page',
  standalone: true,
  imports: [CommonModule, AdminLayoutComponent, TranslatePipe],
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
          <section
            class="summary-grid"
            [attr.aria-label]="'admin.legacy.resume_file_courriel' | translate"
          >
            <article>
              <span>{{ 'admin.legacy.en_file' | translate }}</span>
              <strong>{{ response.summary.queued_count }}</strong>
              <small>{{ 'admin.legacy.messages_prets' | translate }}</small>
            </article>
            <article>
              <span>{{ 'admin.legacy.envoi' | translate }}</span>
              <strong>{{ response.summary.sending_count }}</strong>
              <small>{{ 'admin.legacy.verrou_worker' | translate }}</small>
            </article>
            <article>
              <span>{{ 'admin.legacy.envoyes' | translate }}</span>
              <strong>{{ response.summary.sent_count }}</strong>
              <small>{{ 'admin.legacy.succes' | translate }}</small>
            </article>
            <article>
              <span>{{ 'admin.legacy.echecs' | translate }}</span>
              <strong>{{ response.summary.failed_count }}</strong>
              <small>{{
                'admin.legacy.p0_relancable_s'
                  | translate: { p0: response.summary.retryable_count }
              }}</small>
            </article>
            <article>
              <span>{{ 'admin.legacy.mis_a_jour' | translate }}</span>
              <strong>{{ shortDateLabel(response.last_updated_at) }}</strong>
              <small>{{ 'admin.legacy.snapshot_queue' | translate }}</small>
            </article>
          </section>

          <section
            class="filters"
            [attr.aria-label]="'admin.legacy.filtres_file_courriel' | translate"
          >
            <label>
              {{ 'admin.legacy.statut' | translate
              }}<select
                [value]="statusFilter()"
                (change)="setStatusFilter($event)"
              >
                <option value="all">
                  {{ 'admin.legacy.tous' | translate }}
                </option>
                <option value="failed">
                  {{ 'admin.legacy.echecs' | translate }}
                </option>
                <option value="queued">
                  {{ 'admin.legacy.en_file' | translate }}
                </option>
                <option value="sending">
                  {{ 'admin.legacy.envoi' | translate }}
                </option>
                <option value="sent">
                  {{ 'admin.legacy.envoyes' | translate }}
                </option>
              </select>
            </label>

            <label>
              {{ 'admin.legacy.recherche' | translate
              }}<input
                type="search"
                [attr.placeholder]="
                  'admin.legacy.destinataire_sujet_template' | translate
                "
                [value]="search()"
                (input)="setSearch($event)"
              />
            </label>
          </section>

          <section
            class="queue-panel"
            [attr.aria-label]="'admin.legacy.messages_courriel' | translate"
          >
            <header>
              <div>
                <span>{{
                  'admin.legacy.p0_message_s'
                    | translate: { p0: filteredMessages().length }
                }}</span>
                <h2>{{ 'admin.legacy.derniers_courriels' | translate }}</h2>
              </div>
              <small>{{
                'admin.legacy.dernier_echec_p0'
                  | translate
                    : { p0: dateLabel(response.summary.last_failed_at) }
              }}</small>
            </header>

            <div class="table-scroll" *ngIf="filteredMessages().length > 0">
              <table>
                <thead>
                  <tr>
                    <th>{{ 'admin.legacy.date' | translate }}</th>
                    <th>{{ 'admin.legacy.statut' | translate }}</th>
                    <th>{{ 'admin.legacy.template' | translate }}</th>
                    <th>{{ 'admin.legacy.destinataire' | translate }}</th>
                    <th>{{ 'admin.legacy.sujet' | translate }}</th>
                    <th>{{ 'admin.legacy.tentatives' | translate }}</th>
                    <th>
                      {{ 'admin.legacy.prochaine_tentative' | translate }}
                    </th>
                    <th>{{ 'admin.legacy.action' | translate }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    *ngFor="
                      let message of filteredMessages();
                      trackBy: trackByMessage
                    "
                  >
                    <td>{{ dateLabel(message.updated_at) }}</td>
                    <td>
                      <span
                        class="status-pill"
                        [class.status-sent]="message.status === 'sent'"
                        [class.status-failed]="message.status === 'failed'"
                        [class.status-queued]="message.status === 'queued'"
                        [class.status-sending]="message.status === 'sending'"
                      >
                        {{ statusLabel(message.status) }}
                      </span>
                    </td>
                    <td>{{ templateLabel(message.template_key) }}</td>
                    <td>
                      <button
                        type="button"
                        class="secondary-action"
                        (click)="inspection.email(message)"
                      >
                        {{ message.recipient_email }}
                      </button>
                    </td>
                    <td>
                      <strong>{{ message.subject }}</strong>
                      <small *ngIf="message.last_error">
                        {{ message.last_error }}
                      </small>
                    </td>
                    <td>{{ message.attempts }} / {{ message.max_attempts }}</td>
                    <td>{{ dateLabel(message.next_attempt_at) }}</td>
                    <td>
                      <button
                        type="button"
                        class="secondary-action"
                        [disabled]="
                          message.status === 'sent' ||
                          retryStateFor(message.id) === 'sending'
                        "
                        (click)="retryMessage(message)"
                      >
                        {{
                          retryStateFor(message.id) === 'sending'
                            ? ('admin.legacy.relance' | translate)
                            : ('admin.legacy.relancer' | translate)
                        }}
                      </button>
                      <small
                        class="retry-message"
                        role="status"
                        aria-atomic="true"
                        data-og7="email-retry-result"
                        [class.error]="retryStateFor(message.id) === 'error'"
                        [class.success]="retryStateFor(message.id) === 'sent'"
                        *ngIf="retryMessageFor(message.id)"
                      >
                        {{ retryMessageFor(message.id) }}
                      </small>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <article
              class="empty-state"
              *ngIf="state() === 'ready' && filteredMessages().length === 0"
            >
              <strong>{{
                'admin.legacy.aucun_courriel_trouve' | translate
              }}</strong>
              <span>{{
                'admin.legacy.la_file_affichera_les_messages_apres_les_prochains_envois'
                  | translate
              }}</span>
            </article>
          </section>
        </ng-container>
      </section>
    </openg7-admin-layout>
  `,
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-forms.css'
  ],
  styles: [
    `
      :host {
        display: block;
      }

      .admin-content {
        display: grid;
        gap: 1rem;
        min-width: 0;
      }

      .admin-topbar,
      .summary-grid,
      .filters,
      .queue-panel,
      .state {
        margin: 0 auto;
        max-width: 88rem;
        width: 100%;
      }

      .admin-topbar,
      .queue-panel header {
        align-items: center;
        display: flex;
        gap: 1rem;
        justify-content: space-between;
      }

      .admin-topbar span,
      .summary-grid span,
      .queue-panel header span {
        color: var(--admin-muted);
        font-size: 0.78rem;
        font-weight: 800;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      h1,
      h2,
      p {
        margin: 0;
      }

      button,
      select,
      input {
        font: inherit;
      }

      button {
        background: var(--admin-panel-raised);
        border: 0;
        border-radius: 0.35rem;
        color: var(--admin-text);
        cursor: pointer;
        font-weight: 800;
        min-height: 2.5rem;
        padding: 0 0.9rem;
      }

      button:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }

      .secondary-action {
        background: var(--admin-panel);
        border: 1px solid var(--admin-border);
        color: var(--admin-text);
        min-height: 2.25rem;
      }

      .summary-grid {
        display: grid;
        gap: 0.75rem;
        grid-template-columns: repeat(5, minmax(0, 1fr));
      }

      .summary-grid article,
      .filters,
      .queue-panel,
      .state {
        background: var(--admin-panel);
        border: 1px solid var(--admin-border);
        border-radius: 0.45rem;
        padding: 1rem;
      }

      .summary-grid article {
        display: grid;
        gap: 0.25rem;
        min-height: 6.25rem;
      }

      .summary-grid strong {
        font-size: 1.55rem;
        line-height: 1.1;
      }

      .summary-grid small,
      .queue-panel small,
      .empty-state span {
        color: var(--admin-muted);
        line-height: 1.45;
      }

      .filters {
        display: grid;
        gap: 0.75rem;
        grid-template-columns: minmax(11rem, 0.3fr) minmax(0, 1fr);
      }

      label {
        display: grid;
        gap: 0.35rem;
        font-size: 0.85rem;
        font-weight: 800;
      }

      select,
      input {
        border: 1px solid var(--admin-border);
        border-radius: 0.35rem;
        padding: 0.65rem 0.75rem;
      }

      .queue-panel {
        display: grid;
        gap: 0.85rem;
      }

      .table-scroll {
        overflow-x: auto;
      }

      table {
        border-collapse: collapse;
        min-width: 78rem;
        width: 100%;
      }

      th,
      td {
        border-bottom: 1px solid var(--admin-border);
        padding: 0.7rem 0.5rem;
        text-align: left;
        vertical-align: top;
      }

      th {
        color: var(--admin-muted);
        font-size: 0.78rem;
        text-transform: uppercase;
      }

      td {
        overflow-wrap: anywhere;
      }

      td strong,
      td small {
        display: block;
      }

      .status-pill {
        align-items: center;
        background: var(--admin-panel-raised);
        border-radius: 999px;
        color: var(--admin-muted);
        display: inline-flex;
        font-size: 0.75rem;
        font-weight: 900;
        min-height: 1.65rem;
        padding: 0 0.65rem;
        white-space: nowrap;
      }

      .status-sent {
        background: var(--admin-panel-raised);
        color: var(--admin-success);
      }

      .status-failed {
        background: #422532;
        color: var(--admin-danger);
      }

      .status-queued {
        background: #3c3221;
        color: var(--admin-warning);
      }

      .status-sending {
        background: var(--admin-panel-raised);
        color: var(--admin-muted);
      }

      .retry-message {
        font-weight: 800;
        margin-top: 0.35rem;
      }

      .retry-message.success {
        color: var(--admin-success);
      }

      .retry-message.error,
      .state-error {
        color: var(--admin-danger);
      }

      .empty-state {
        background: var(--admin-panel);
        border-radius: 0.35rem;
        display: grid;
        gap: 0.25rem;
        padding: 1rem;
      }

      @media (max-width: 1080px) {
        .summary-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      @media (max-width: 860px) {
        .admin-shell,
        .filters {
          grid-template-columns: 1fr;
        }

        .admin-topbar,
        .queue-panel header {
          align-items: start;
          flex-direction: column;
        }
      }

      @media (max-width: 620px) {
        .summary-grid {
          grid-template-columns: 1fr;
        }
      }
    `
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
  readonly state = signal<LoadState>('idle');
  readonly errorMessage = signal(
    this.i18n.t('admin.messages.impossible_de_charger_la_file_courriel')
  );
  readonly queue = signal<AdminEmailQueueResponse | null>(null);
  readonly statusFilter = signal<EmailQueueStatusFilter>('all');
  readonly search = signal('');
  readonly retryStates = signal<Record<string, RetryState>>({});
  readonly retryMessages = signal<Record<string, string>>({});
  readonly messages = computed(() => this.queue()?.messages ?? []);
  readonly filteredMessages = computed(() => {
    const status = this.statusFilter();
    const search = this.search().trim().toLowerCase();

    return this.messages().filter((message) => {
      if (status !== 'all' && message.status !== status) {
        return false;
      }

      if (!search) {
        return true;
      }

      return [
        message.template_key,
        message.recipient_email,
        message.subject,
        message.status,
        message.last_error
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(search);
    });
  });

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

  setStatusFilter(event: Event): void {
    const value = (event.target as HTMLSelectElement | null)?.value ?? 'all';
    this.statusFilter.set(
      ['queued', 'sending', 'sent', 'failed'].includes(value)
        ? (value as EmailQueueStatusFilter)
        : 'all'
    );
  }

  setSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement | null)?.value ?? '');
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
    } catch (error) {
      this.setRetryState(message.id, 'error');
      this.setRetryMessage(message.id, this.messageFromError(error));
    }
  }

  retryStateFor(id: string): RetryState {
    return this.retryStates()[id] ?? 'idle';
  }

  retryMessageFor(id: string): string {
    return this.retryMessages()[id] ?? '';
  }

  trackByMessage(
    _index: number,
    message: AdminEmailQueueMessageRecord
  ): string {
    return message.id;
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
    if (!current) {
      return;
    }

    this.queue.set({
      ...current,
      messages: current.messages.map((candidate) =>
        candidate.id === message.id ? message : candidate
      ),
      last_updated_at: new Date().toISOString()
    });
  }

  private setRetryState(id: string, state: RetryState): void {
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
