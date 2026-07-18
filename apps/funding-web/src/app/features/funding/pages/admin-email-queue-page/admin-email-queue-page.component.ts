import { CommonModule } from '@angular/common';
import {
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

import { AdminNavComponent } from '../../components/admin-nav/admin-nav.component.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';
type RetryState = 'idle' | 'sending' | 'sent' | 'error';
type EmailQueueStatusFilter = 'all' | AdminEmailQueueMessageStatus;

@Component({
  selector: 'openg7-admin-email-queue-page',
  standalone: true,
  imports: [CommonModule, AdminNavComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="admin-shell">
      <openg7-admin-nav />

      <section class="admin-content">
        <header class="admin-topbar">
          <div>
            <span>Administration</span>
            <h1>File courriel</h1>
          </div>
          <button
            type="button"
            (click)="loadEmailQueue()"
            [disabled]="state() === 'loading'"
          >
            Actualiser
          </button>
        </header>

        <p class="state" *ngIf="state() === 'loading'" aria-live="polite">
          Chargement de la file courriel...
        </p>
        <p
          class="state state-error"
          *ngIf="state() === 'error'"
          aria-live="polite"
        >
          {{ errorMessage() }}
        </p>

        <ng-container *ngIf="queue() as response">
          <section class="summary-grid" aria-label="Resume file courriel">
            <article>
              <span>En file</span>
              <strong>{{ response.summary.queued_count }}</strong>
              <small>Messages prets</small>
            </article>
            <article>
              <span>Envoi</span>
              <strong>{{ response.summary.sending_count }}</strong>
              <small>Verrou worker</small>
            </article>
            <article>
              <span>Envoyes</span>
              <strong>{{ response.summary.sent_count }}</strong>
              <small>Succes</small>
            </article>
            <article>
              <span>Echecs</span>
              <strong>{{ response.summary.failed_count }}</strong>
              <small
                >{{ response.summary.retryable_count }} relancable(s)</small
              >
            </article>
            <article>
              <span>Mis a jour</span>
              <strong>{{ shortDateLabel(response.last_updated_at) }}</strong>
              <small>Snapshot queue</small>
            </article>
          </section>

          <section class="filters" aria-label="Filtres file courriel">
            <label>
              Statut
              <select
                [value]="statusFilter()"
                (change)="setStatusFilter($event)"
              >
                <option value="all">Tous</option>
                <option value="failed">Echecs</option>
                <option value="queued">En file</option>
                <option value="sending">Envoi</option>
                <option value="sent">Envoyes</option>
              </select>
            </label>

            <label>
              Recherche
              <input
                type="search"
                placeholder="Destinataire, sujet, template..."
                [value]="search()"
                (input)="setSearch($event)"
              />
            </label>
          </section>

          <section class="queue-panel" aria-label="Messages courriel">
            <header>
              <div>
                <span>{{ filteredMessages().length }} message(s)</span>
                <h2>Derniers courriels</h2>
              </div>
              <small
                >Dernier echec:
                {{ dateLabel(response.summary.last_failed_at) }}</small
              >
            </header>

            <div class="table-scroll" *ngIf="filteredMessages().length > 0">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Statut</th>
                    <th>Template</th>
                    <th>Destinataire</th>
                    <th>Sujet</th>
                    <th>Tentatives</th>
                    <th>Prochaine tentative</th>
                    <th>Action</th>
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
                    <td>{{ message.recipient_email }}</td>
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
                            ? 'Relance...'
                            : 'Relancer'
                        }}
                      </button>
                      <small
                        class="retry-message"
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
              <strong>Aucun courriel trouve.</strong>
              <span
                >La file affichera les messages apres les prochains
                envois.</span
              >
            </article>
          </section>
        </ng-container>
      </section>
    </main>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .admin-shell {
        background: #f5f7fb;
        color: #172033;
        display: grid;
        font-family: 'Trebuchet MS', Arial, sans-serif;
        gap: 1rem;
        grid-template-columns: 15rem minmax(0, 1fr);
        min-height: 100vh;
        padding: 1.25rem;
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
        color: #667085;
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
        background: #18233a;
        border: 0;
        border-radius: 0.35rem;
        color: #fff;
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
        background: #ffffff;
        border: 1px solid #cdd6e3;
        color: #172033;
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
        background: #fff;
        border: 1px solid #d9e0ea;
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
        color: #526070;
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
        border: 1px solid #cdd6e3;
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
        border-bottom: 1px solid #e4e9f2;
        padding: 0.7rem 0.5rem;
        text-align: left;
        vertical-align: top;
      }

      th {
        color: #667085;
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
        background: #edf1f7;
        border-radius: 999px;
        color: #4d5d78;
        display: inline-flex;
        font-size: 0.75rem;
        font-weight: 900;
        min-height: 1.65rem;
        padding: 0 0.65rem;
        white-space: nowrap;
      }

      .status-sent {
        background: #e4f4e7;
        color: #236b34;
      }

      .status-failed {
        background: #ffe7e4;
        color: #9c2f28;
      }

      .status-queued {
        background: #fff0d7;
        color: #7a4f09;
      }

      .status-sending {
        background: #e8f1ff;
        color: #174ea6;
      }

      .retry-message {
        font-weight: 800;
        margin-top: 0.35rem;
      }

      .retry-message.success {
        color: #236b34;
      }

      .retry-message.error,
      .state-error {
        color: #9c2f28;
      }

      .empty-state {
        background: #f8fafc;
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
        .admin-shell {
          padding: 0.75rem;
        }

        .summary-grid {
          grid-template-columns: 1fr;
        }
      }
    `
  ]
})
export class AdminEmailQueuePageComponent implements OnInit {
  private readonly admin = inject(FundingAdminService);

  readonly adminToken = signal('');
  readonly state = signal<LoadState>('idle');
  readonly errorMessage = signal('Impossible de charger la file courriel.');
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
    void this.loadEmailQueue();
  }

  async loadEmailQueue(): Promise<void> {
    this.state.set('loading');

    try {
      this.queue.set(await this.admin.getEmailQueue(this.adminToken()));
      this.state.set('ready');
      this.errorMessage.set('');
    } catch (error) {
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
    if (message.status === 'sent') {
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

      this.setRetryState(message.id, result.sent > 0 ? 'sent' : 'error');
      this.setRetryMessage(
        message.id,
        result.sent > 0
          ? 'Message envoye.'
          : result.attempted > 0
            ? 'Relance tentee, le message reste en echec.'
            : 'Aucune tentative effectuee.'
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
        return 'Envoye';
      case 'failed':
        return 'Echec';
      case 'sending':
        return 'Envoi';
      default:
        return 'En file';
    }
  }

  templateLabel(templateKey: string): string {
    return templateKey.replaceAll('_', ' ');
  }

  dateLabel(value: string | null): string {
    if (!value) {
      return 'Absent';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return new Intl.DateTimeFormat('fr-CA', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date);
  }

  shortDateLabel(value: string | null): string {
    if (!value) {
      return 'Absent';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return new Intl.DateTimeFormat('fr-CA', {
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
      : 'Operation admin impossible.';
  }
}
