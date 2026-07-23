import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal
} from '@angular/core';
import type { AdminSetupStatusResponse } from '@openg7/funding-core';

import { AdminNavComponent } from '../../components/admin-nav/admin-nav.component.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';
type TestState = 'idle' | 'sending' | 'sent' | 'error';
type SetupEnvKey =
  | 'STRIPE_SECRET_KEY'
  | 'STRIPE_WEBHOOK_SECRET'
  | 'SMTP_ENABLED'
  | 'SMTP_HOST'
  | 'SMTP_PORT'
  | 'SMTP_SECURE'
  | 'SMTP_USER'
  | 'SMTP_PASSWORD'
  | 'MAIL_FROM_ADDRESS'
  | 'MAIL_REPLY_TO_ADDRESS'
  | 'FUNDING_ADMIN_NOTIFICATION_EMAIL'
  | 'FUNDING_SPONSORSHIP_INVOICE_PREFIX'
  | 'FUNDING_INVOICE_ISSUER_NAME'
  | 'FUNDING_INVOICE_ISSUER_EMAIL'
  | 'FUNDING_INVOICE_ISSUER_ADDRESS'
  | 'FUNDING_INVOICE_TAX_ID'
  | 'FUNDING_SPONSORSHIP_INVOICE_TAX_LABEL'
  | 'DATABASE_URL';

interface SetupEnvRow {
  readonly key: SetupEnvKey;
  readonly label: string;
  readonly note: string;
}

interface SetupTourStep {
  readonly anchor: string;
  readonly title: string;
  readonly body: string;
}

@Component({
  selector: 'openg7-admin-setup-page',
  standalone: true,
  imports: [CommonModule, AdminNavComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="admin-shell">
      <openg7-admin-nav />

      <section class="admin-content">
        <header
          class="admin-topbar"
          data-tour-anchor="overview"
          [class.tour-target]="isTourAnchor('overview')"
        >
          <div>
            <span>Configuration</span>
            <h1>Setup operationnel</h1>
          </div>
          <div class="topbar-actions">
            <button
              class="secondary-button"
              type="button"
              (click)="startTour()"
            >
              Guide
            </button>
            <button type="button" (click)="loadSetup()">Actualiser</button>
          </div>
        </header>

        <p class="state" *ngIf="state() === 'loading'" aria-live="polite">
          Verification de la configuration...
        </p>
        <p
          class="state state-error"
          *ngIf="state() === 'error'"
          aria-live="polite"
        >
          Impossible de charger le setup admin. Verifiez la session admin et l
          API.
        </p>

        <ng-container *ngIf="setup() as data">
          <section
            class="setup-readiness"
            aria-label="Etat du setup"
            data-tour-anchor="readiness"
            [class.tour-target]="isTourAnchor('readiness')"
          >
            <article [class.ready]="isStripeReady(data)">
              <span>Stripe</span>
              <strong>{{ readyLabel(isStripeReady(data)) }}</strong>
              <small>{{ stripeSummary(data) }}</small>
            </article>
            <article [class.ready]="isEmailReady(data)">
              <span>Courriel</span>
              <strong>{{ readyLabel(isEmailReady(data)) }}</strong>
              <small>{{ emailSummary(data) }}</small>
            </article>
            <article [class.ready]="isQueueReady(data)">
              <span>File</span>
              <strong>{{ readyLabel(isQueueReady(data)) }}</strong>
              <small>{{ queueSummary(data) }}</small>
            </article>
            <article [class.ready]="data.database.reachable">
              <span>Base</span>
              <strong>{{ readyLabel(data.database.reachable) }}</strong>
              <small>{{ databaseSummary(data) }}</small>
            </article>
          </section>

          <section class="setup-grid" aria-label="Details de configuration">
            <article
              class="setup-panel"
              data-tour-anchor="stripe"
              [class.tour-target]="isTourAnchor('stripe')"
            >
              <header>
                <div>
                  <span>Stripe</span>
                  <h2>Paiements et webhooks</h2>
                </div>
                <span
                  class="status-pill"
                  [class.status-ok]="isStripeReady(data)"
                  [class.status-warn]="!isStripeReady(data)"
                >
                  {{ readyLabel(isStripeReady(data)) }}
                </span>
              </header>
              <dl>
                <div>
                  <dt>Cle secrete</dt>
                  <dd>
                    {{ configuredLabel(data.stripe.secret_key_configured) }}
                  </dd>
                </div>
                <div>
                  <dt>Secret webhook</dt>
                  <dd>
                    {{ configuredLabel(data.stripe.webhook_secret_configured) }}
                  </dd>
                </div>
                <div>
                  <dt>Commandites</dt>
                  <dd>
                    {{ enabledLabel(data.stripe.business_sponsorship_enabled) }}
                  </dd>
                </div>
                <div>
                  <dt>Endpoint webhook</dt>
                  <dd>
                    <code>{{ data.stripe.webhook_endpoint }}</code>
                  </dd>
                </div>
              </dl>
              <a
                [href]="data.stripe.dashboard_url"
                target="_blank"
                rel="noreferrer"
              >
                Ouvrir Stripe Dashboard
              </a>
            </article>

            <article
              class="setup-panel"
              data-tour-anchor="email"
              [class.tour-target]="isTourAnchor('email')"
            >
              <header>
                <div>
                  <span>Courriel</span>
                  <h2>SMTP et expediteur</h2>
                </div>
                <span
                  class="status-pill"
                  [class.status-ok]="isEmailReady(data)"
                  [class.status-warn]="!isEmailReady(data)"
                >
                  {{ readyLabel(isEmailReady(data)) }}
                </span>
              </header>
              <dl>
                <div>
                  <dt>SMTP_ENABLED</dt>
                  <dd>
                    {{ enabledLabel(data.email.smtp_enabled) }}
                  </dd>
                </div>
                <div>
                  <dt>SMTP_HOST</dt>
                  <dd>{{ valueLabel(data.email.smtp_host) }}</dd>
                </div>
                <div>
                  <dt>SMTP_PORT</dt>
                  <dd>
                    {{ data.email.smtp_port }} / secure={{
                      enabledLabel(data.email.smtp_secure)
                    }}
                  </dd>
                </div>
                <div>
                  <dt>SMTP_USER</dt>
                  <dd>
                    {{ configuredLabel(data.email.smtp_user_configured) }}
                  </dd>
                </div>
                <div>
                  <dt>SMTP_PASSWORD</dt>
                  <dd>
                    {{ configuredLabel(data.email.smtp_password_configured) }}
                  </dd>
                </div>
                <div>
                  <dt>MAIL_FROM_ADDRESS</dt>
                  <dd>{{ valueLabel(data.email.from) }}</dd>
                </div>
                <div>
                  <dt>MAIL_REPLY_TO_ADDRESS</dt>
                  <dd>{{ valueLabel(data.email.reply_to) }}</dd>
                </div>
                <div>
                  <dt>Notification admin</dt>
                  <dd>{{ valueLabel(data.email.admin_notification_email) }}</dd>
                </div>
                <div>
                  <dt>Factures commandite</dt>
                  <dd>
                    {{ readyLabel(data.invoice.ready) }} -
                    {{ data.invoice.prefix }}
                  </dd>
                </div>
                <div>
                  <dt>Emetteur facture</dt>
                  <dd>{{ valueLabel(data.invoice.issuer_name) }}</dd>
                </div>
                <div>
                  <dt>Taxes facture</dt>
                  <dd>{{ data.invoice.tax_label }}</dd>
                </div>
              </dl>

              <div class="test-email">
                <label>
                  Courriel de test
                  <input
                    type="email"
                    autocomplete="email"
                    [value]="testEmail()"
                    [placeholder]="
                      data.email.admin_notification_email || 'admin@example.com'
                    "
                    (input)="setTestEmail($event)"
                  />
                </label>
                <button
                  type="button"
                  [disabled]="
                    !canSendEmailTest(data) || testState() === 'sending'
                  "
                  (click)="sendEmailTest()"
                >
                  {{
                    testState() === 'sending' ? 'Envoi...' : 'Envoyer un test'
                  }}
                </button>
              </div>
              <p class="panel-note" *ngIf="!canSendEmailTest(data)">
                Le test demande DATABASE_URL, migration 010, SMTP_ENABLED=true
                et SMTP_PASSWORD.
              </p>
              <p class="panel-note success" *ngIf="testState() === 'sent'">
                Test envoye ou mis en file avec succes.
              </p>
              <p class="panel-note error" *ngIf="testState() === 'error'">
                {{ testMessage() || 'Le test courriel a echoue.' }}
              </p>
            </article>

            <article
              class="setup-panel queue-panel"
              data-tour-anchor="queue"
              [class.tour-target]="isTourAnchor('queue')"
            >
              <header>
                <div>
                  <span>File courriel</span>
                  <h2>Envois et retries</h2>
                </div>
                <span
                  class="status-pill"
                  [class.status-ok]="isQueueReady(data)"
                  [class.status-warn]="!isQueueReady(data)"
                >
                  {{ readyLabel(isQueueReady(data)) }}
                </span>
              </header>
              <div
                class="queue-metrics"
                aria-label="Statistiques de file courriel"
              >
                <div>
                  <span>En attente</span>
                  <strong>{{ data.email.queued_count }}</strong>
                </div>
                <div>
                  <span>Envoi</span>
                  <strong>{{ data.email.sending_count }}</strong>
                </div>
                <div>
                  <span>Envoyes</span>
                  <strong>{{ data.email.sent_count }}</strong>
                </div>
                <div>
                  <span>Echecs</span>
                  <strong>{{ data.email.failed_count }}</strong>
                </div>
              </div>
              <dl>
                <div>
                  <dt>Poll interval</dt>
                  <dd>{{ data.email.queue_poll_interval_ms }} ms</dd>
                </div>
                <div>
                  <dt>Batch size</dt>
                  <dd>{{ data.email.queue_batch_size }}</dd>
                </div>
                <div>
                  <dt>Dernier echec</dt>
                  <dd>{{ dateLabel(data.email.last_failed_at) }}</dd>
                </div>
                <div>
                  <dt>Erreur</dt>
                  <dd>{{ valueLabel(data.email.last_error) }}</dd>
                </div>
              </dl>
            </article>

            <article
              class="setup-panel"
              data-tour-anchor="database"
              [class.tour-target]="isTourAnchor('database')"
            >
              <header>
                <div>
                  <span>Execution</span>
                  <h2>Base et environnement</h2>
                </div>
                <span
                  class="status-pill"
                  [class.status-ok]="data.database.reachable"
                  [class.status-warn]="!data.database.reachable"
                >
                  {{ readyLabel(data.database.reachable) }}
                </span>
              </header>
              <dl>
                <div>
                  <dt>Mode</dt>
                  <dd>{{ data.environment }}</dd>
                </div>
                <div>
                  <dt>Source transparence</dt>
                  <dd>{{ dataSourceLabel(data.data_source) }}</dd>
                </div>
                <div>
                  <dt>DATABASE_URL</dt>
                  <dd>{{ configuredLabel(data.database.configured) }}</dd>
                </div>
                <div>
                  <dt>Connexion DB</dt>
                  <dd>{{ enabledLabel(data.database.reachable) }}</dd>
                </div>
                <div>
                  <dt>Origines CORS</dt>
                  <dd>{{ originsLabel(data.allowed_origins) }}</dd>
                </div>
                <div>
                  <dt>Base publique</dt>
                  <dd>{{ valueLabel(data.public_base_url) }}</dd>
                </div>
              </dl>
            </article>
          </section>

          <section
            class="setup-table-panel"
            data-tour-anchor="env"
            [class.tour-target]="isTourAnchor('env')"
          >
            <header>
              <div>
                <span>Checklist</span>
                <h2>Cles a verifier</h2>
              </div>
              <small>Mis a jour {{ dateLabel(data.last_updated_at) }}</small>
            </header>

            <div class="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Variable</th>
                    <th>Etat</th>
                    <th>Role</th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let row of envRows; trackBy: trackByEnvRow">
                    <td>
                      <code>{{ row.key }}</code>
                    </td>
                    <td>
                      <span
                        class="status-pill compact"
                        [class.status-ok]="envConfigured(data, row.key)"
                        [class.status-warn]="!envConfigured(data, row.key)"
                      >
                        {{ configuredLabel(envConfigured(data, row.key)) }}
                      </span>
                    </td>
                    <td>{{ row.note }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </ng-container>
      </section>

      <div
        class="tour-layer"
        *ngIf="activeTourStep() as step"
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-tour-title"
      >
        <button
          class="tour-scrim"
          type="button"
          aria-label="Fermer le guide"
          (click)="endTour()"
        ></button>
        <section class="tour-card">
          <span>Etape {{ tourIndex() + 1 }} / {{ tourSteps.length }}</span>
          <h2 id="setup-tour-title">{{ step.title }}</h2>
          <p>{{ step.body }}</p>
          <div class="tour-actions">
            <button
              type="button"
              (click)="previousTourStep()"
              [disabled]="tourIndex() === 0"
            >
              Retour
            </button>
            <button
              class="primary-tour-action"
              type="button"
              (click)="nextTourStep()"
            >
              {{ isLastTourStep() ? 'Terminer' : 'Suivant' }}
            </button>
          </div>
        </section>
      </div>
    </main>
  `,
  styles: [
    `
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
      .setup-readiness,
      .setup-grid,
      .setup-table-panel,
      .state {
        margin: 0 auto;
        max-width: 76rem;
        width: 100%;
      }

      .admin-topbar {
        align-items: center;
        display: flex;
        gap: 1rem;
        justify-content: space-between;
      }

      .admin-topbar span,
      .setup-readiness span,
      .setup-panel header span,
      .setup-table-panel header span,
      .queue-metrics span,
      dt {
        color: #667085;
        font-size: 0.78rem;
        font-weight: 800;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      .admin-topbar h1,
      .setup-panel h2,
      .setup-table-panel h2,
      .tour-card h2 {
        margin: 0;
      }

      .topbar-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.6rem;
        justify-content: flex-end;
      }

      button,
      input {
        border-radius: 0.35rem;
        font: inherit;
      }

      button {
        background: #18233a;
        border: 0;
        color: #fff;
        cursor: pointer;
        font-weight: 800;
        min-height: 2.7rem;
        padding: 0 0.9rem;
      }

      button:disabled {
        cursor: not-allowed;
        opacity: 0.58;
      }

      .secondary-button,
      .tour-actions button {
        background: #fff;
        border: 1px solid #c8d2e2;
        color: #172033;
      }

      .state {
        background: #fff;
        border: 1px solid #d9e0ea;
        border-radius: 0.45rem;
        color: #4a5568;
        font-weight: 800;
        padding: 0.85rem 1rem;
      }

      .state-error,
      .panel-note.error {
        color: #b42318;
      }

      .setup-readiness {
        display: grid;
        gap: 0.8rem;
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      .setup-readiness article,
      .setup-panel,
      .setup-table-panel {
        background: #fff;
        border: 1px solid #d9e0ea;
        border-radius: 0.45rem;
        box-shadow: 0 0.75rem 1.6rem rgba(16, 24, 39, 0.08);
      }

      .setup-readiness article {
        display: grid;
        gap: 0.35rem;
        min-height: 8.4rem;
        padding: 1rem;
      }

      .setup-readiness article.ready {
        border-color: rgba(21, 127, 85, 0.45);
      }

      .setup-readiness strong {
        color: #172033;
        font-size: 1.25rem;
        line-height: 1.2;
      }

      .setup-readiness small {
        color: #5c6677;
        line-height: 1.35;
      }

      .setup-grid {
        display: grid;
        gap: 1rem;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .setup-panel {
        align-content: start;
        display: grid;
        gap: 1rem;
        min-width: 0;
        padding: 1rem;
      }

      .setup-panel header,
      .setup-table-panel header {
        align-items: start;
        display: flex;
        gap: 1rem;
        justify-content: space-between;
      }

      dl {
        display: grid;
        gap: 0.65rem;
        margin: 0;
      }

      dl div {
        display: grid;
        gap: 0.35rem;
      }

      dd {
        color: #172033;
        font-weight: 800;
        margin: 0;
        min-width: 0;
        overflow-wrap: anywhere;
      }

      code {
        background: #f0f3f8;
        border: 1px solid #d9e0ea;
        border-radius: 0.3rem;
        color: #172033;
        display: inline-block;
        max-width: 100%;
        overflow-wrap: anywhere;
        padding: 0.12rem 0.28rem;
      }

      .setup-panel a {
        color: #755118;
        font-weight: 900;
        text-decoration-thickness: 0.12rem;
        text-underline-offset: 0.18rem;
      }

      .status-pill {
        align-items: center;
        border-radius: 999px;
        display: inline-flex;
        font-size: 0.72rem;
        font-weight: 900;
        min-height: 1.8rem;
        padding: 0 0.65rem;
        white-space: nowrap;
      }

      .status-pill.compact {
        min-height: 1.55rem;
        padding: 0 0.5rem;
      }

      .status-ok {
        background: #e8f5ee;
        color: #157f55;
      }

      .status-warn {
        background: #fff5df;
        color: #946200;
      }

      .test-email {
        align-items: end;
        display: grid;
        gap: 0.65rem;
        grid-template-columns: minmax(0, 1fr) auto;
      }

      label {
        color: #4a5568;
        display: grid;
        gap: 0.35rem;
        font-size: 0.9rem;
        font-weight: 800;
      }

      input {
        border: 1px solid #c8d2e2;
        color: #172033;
        min-height: 2.7rem;
        min-width: 0;
        padding: 0 0.8rem;
        width: 100%;
      }

      .panel-note {
        color: #5c6677;
        font-size: 0.9rem;
        font-weight: 800;
        line-height: 1.35;
        margin: 0;
      }

      .panel-note.success {
        color: #157f55;
      }

      .queue-metrics {
        display: grid;
        gap: 0.6rem;
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      .queue-metrics div {
        background: #f7f9fc;
        border: 1px solid #d9e0ea;
        border-radius: 0.4rem;
        display: grid;
        gap: 0.25rem;
        min-height: 4.8rem;
        padding: 0.7rem;
      }

      .queue-metrics strong {
        color: #172033;
        font-size: 1.25rem;
      }

      .setup-table-panel {
        display: grid;
        gap: 1rem;
        padding: 1rem;
      }

      .setup-table-panel small {
        color: #667085;
        font-weight: 800;
      }

      .table-scroll {
        overflow-x: auto;
      }

      table {
        border-collapse: collapse;
        min-width: 45rem;
        width: 100%;
      }

      th,
      td {
        border-bottom: 1px solid #e3e8f0;
        padding: 0.8rem 0.65rem;
        text-align: left;
        vertical-align: top;
      }

      th {
        color: #667085;
        font-size: 0.75rem;
        font-weight: 900;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      td {
        color: #344054;
        font-weight: 700;
      }

      .tour-target {
        box-shadow:
          0 0 0 0.22rem rgba(184, 130, 36, 0.55),
          0 1rem 2.2rem rgba(16, 24, 39, 0.22);
        isolation: isolate;
        pointer-events: none;
        position: relative;
        z-index: 30;
      }

      .tour-layer {
        inset: 0;
        pointer-events: none;
        position: fixed;
        z-index: 20;
      }

      .tour-scrim {
        background: rgba(16, 24, 39, 0.5);
        border: 0;
        border-radius: 0;
        inset: 0;
        min-height: 0;
        padding: 0;
        pointer-events: auto;
        position: absolute;
        width: 100%;
      }

      .tour-card {
        background: #fff;
        border: 1px solid #d9e0ea;
        border-radius: 0.5rem;
        bottom: 1.25rem;
        box-shadow: 0 1rem 2rem rgba(16, 24, 39, 0.24);
        color: #172033;
        display: grid;
        gap: 0.75rem;
        max-width: min(28rem, calc(100vw - 2rem));
        padding: 1rem;
        pointer-events: auto;
        position: absolute;
        right: 1.25rem;
        z-index: 40;
      }

      .tour-card span {
        color: #755118;
        font-size: 0.78rem;
        font-weight: 900;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      .tour-card p {
        color: #4a5568;
        line-height: 1.45;
        margin: 0;
      }

      .tour-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.6rem;
        justify-content: flex-end;
      }

      .tour-actions .primary-tour-action {
        background: #18233a;
        border-color: #18233a;
        color: #fff;
      }

      @media (max-width: 980px) {
        .admin-shell {
          grid-template-columns: 1fr;
        }

        .setup-readiness,
        .setup-grid {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 680px) {
        .admin-shell {
          padding: 0.75rem;
        }

        .admin-topbar,
        .setup-panel header,
        .setup-table-panel header {
          align-items: stretch;
          flex-direction: column;
        }

        .topbar-actions,
        .test-email,
        .queue-metrics {
          grid-template-columns: 1fr;
        }

        .topbar-actions {
          display: grid;
        }

        .tour-card {
          bottom: 0.75rem;
          left: 0.75rem;
          right: 0.75rem;
          max-width: none;
        }
      }
    `
  ]
})
export class AdminSetupPageComponent implements OnInit {
  private readonly admin = inject(FundingAdminService);
  private readonly adminToken = signal(this.admin.getSavedAdminToken());

  readonly state = signal<LoadState>('idle');
  readonly setup = signal<AdminSetupStatusResponse | null>(null);
  readonly testEmail = signal('');
  readonly testState = signal<TestState>('idle');
  readonly testMessage = signal('');
  readonly tourIndex = signal(-1);

  readonly tourSteps: readonly SetupTourStep[] = [
    {
      anchor: 'overview',
      title: 'Vue de controle',
      body: 'Cette page regroupe les controles Stripe, courriel, file et base de donnees avant de recevoir des commandites.'
    },
    {
      anchor: 'readiness',
      title: 'Etat rapide',
      body: 'Les quatre indicateurs montrent ce qui est pret et ce qui doit encore etre complete.'
    },
    {
      anchor: 'stripe',
      title: 'Paiement Stripe',
      body: 'Verifiez la cle secrete, le secret webhook et l endpoint a copier dans Stripe Dashboard.'
    },
    {
      anchor: 'email',
      title: 'Courriel applicatif',
      body: 'Validez SMTP, l expediteur, le reply-to et l adresse de notification admin, puis envoyez un test.'
    },
    {
      anchor: 'queue',
      title: 'File et retries',
      body: 'Surveillez les messages en attente, envoyes ou echoues pour confirmer que le worker tourne.'
    },
    {
      anchor: 'database',
      title: 'Execution',
      body: 'Controlez la source de donnees, DATABASE_URL, les origines autorisees et la base publique.'
    },
    {
      anchor: 'env',
      title: 'Checklist finale',
      body: 'La table reprend les variables critiques a verifier dans l environnement de production.'
    }
  ];

  readonly activeTourStep = computed(() => {
    const index = this.tourIndex();
    return index >= 0 ? (this.tourSteps[index] ?? null) : null;
  });

  readonly envRows: readonly SetupEnvRow[] = [
    {
      key: 'STRIPE_SECRET_KEY',
      label: 'Stripe secret',
      note: 'Checkout et lecture Stripe-direct.'
    },
    {
      key: 'STRIPE_WEBHOOK_SECRET',
      label: 'Stripe webhook',
      note: 'Validation des evenements Stripe.'
    },
    {
      key: 'SMTP_ENABLED',
      label: 'SMTP active',
      note: 'Active les envois transactionnels.'
    },
    {
      key: 'SMTP_HOST',
      label: 'Serveur SMTP',
      note: 'Hote HostPapa ou fournisseur equivalent.'
    },
    {
      key: 'SMTP_PORT',
      label: 'Port SMTP',
      note: 'Port de connexion SMTP.'
    },
    {
      key: 'SMTP_SECURE',
      label: 'TLS SMTP',
      note: 'Connexion TLS implicite.'
    },
    {
      key: 'SMTP_USER',
      label: 'Utilisateur SMTP',
      note: 'Adresse complete de la boite notify.'
    },
    {
      key: 'SMTP_PASSWORD',
      label: 'Mot de passe SMTP',
      note: 'Secret prive injecte cote serveur seulement.'
    },
    {
      key: 'MAIL_FROM_ADDRESS',
      label: 'Expediteur',
      note: 'Adresse visible comme expediteur.'
    },
    {
      key: 'MAIL_REPLY_TO_ADDRESS',
      label: 'Reply-to',
      note: 'Adresse de reponse des commanditaires.'
    },
    {
      key: 'FUNDING_ADMIN_NOTIFICATION_EMAIL',
      label: 'Notification admin',
      note: 'Alerte interne quand un lot est complet.'
    },
    {
      key: 'FUNDING_SPONSORSHIP_INVOICE_PREFIX',
      label: 'Prefixe facture',
      note: 'Numerotation des factures commandite.'
    },
    {
      key: 'FUNDING_INVOICE_ISSUER_NAME',
      label: 'Emetteur facture',
      note: 'Nom legal ou public sur la facture.'
    },
    {
      key: 'FUNDING_INVOICE_ISSUER_EMAIL',
      label: 'Courriel facture',
      note: 'Courriel affiche dans le bloc emetteur.'
    },
    {
      key: 'FUNDING_INVOICE_ISSUER_ADDRESS',
      label: 'Adresse facture',
      note: 'Adresse affichee si configuree.'
    },
    {
      key: 'FUNDING_INVOICE_TAX_ID',
      label: 'Identifiant fiscal',
      note: 'Numero fiscal affiche si applicable.'
    },
    {
      key: 'FUNDING_SPONSORSHIP_INVOICE_TAX_LABEL',
      label: 'Libelle taxes',
      note: 'Texte de taxe affiche sur la facture.'
    },
    {
      key: 'DATABASE_URL',
      label: 'PostgreSQL',
      note: 'Persistance, admin et file courriel.'
    }
  ];

  ngOnInit(): void {
    void this.loadSetup();
  }

  async loadSetup(): Promise<void> {
    this.state.set('loading');
    this.testMessage.set('');

    try {
      const setup = await this.admin.getSetupStatus(this.adminToken());
      this.setup.set(setup);
      if (!this.testEmail() && setup.email.admin_notification_email) {
        this.testEmail.set(setup.email.admin_notification_email);
      }
      this.state.set('ready');
    } catch {
      this.state.set('error');
    }
  }

  async sendEmailTest(): Promise<void> {
    const setup = this.setup();
    if (!setup || !this.canSendEmailTest(setup)) {
      return;
    }

    this.testState.set('sending');
    this.testMessage.set('');

    try {
      const to =
        this.testEmail().trim() ||
        setup.email.admin_notification_email ||
        undefined;
      const result = await this.admin.sendEmailTest(this.adminToken(), { to });
      this.testMessage.set(result.error ?? '');
      this.testState.set(result.error ? 'error' : 'sent');
      await this.loadSetup();
    } catch (error) {
      this.testMessage.set(
        error instanceof Error ? error.message : 'Le test courriel a echoue.'
      );
      this.testState.set('error');
    }
  }

  setTestEmail(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    this.testEmail.set(input?.value ?? '');
    this.testState.set('idle');
    this.testMessage.set('');
  }

  startTour(): void {
    this.tourIndex.set(0);
    this.scrollTourAnchorIntoView();
  }

  nextTourStep(): void {
    if (this.isLastTourStep()) {
      this.endTour();
      return;
    }

    this.tourIndex.update((index) =>
      Math.min(index + 1, this.tourSteps.length - 1)
    );
    this.scrollTourAnchorIntoView();
  }

  previousTourStep(): void {
    this.tourIndex.update((index) => Math.max(index - 1, 0));
    this.scrollTourAnchorIntoView();
  }

  endTour(): void {
    this.tourIndex.set(-1);
  }

  isLastTourStep(): boolean {
    return this.tourIndex() === this.tourSteps.length - 1;
  }

  isTourAnchor(anchor: string): boolean {
    return this.activeTourStep()?.anchor === anchor;
  }

  isStripeReady(setup: AdminSetupStatusResponse): boolean {
    return (
      setup.stripe.secret_key_configured &&
      setup.stripe.webhook_secret_configured
    );
  }

  isEmailReady(setup: AdminSetupStatusResponse): boolean {
    return (
      setup.email.smtp_configured &&
      Boolean(setup.email.from) &&
      Boolean(setup.email.admin_notification_email)
    );
  }

  isQueueReady(setup: AdminSetupStatusResponse): boolean {
    return setup.email.queue_available && setup.database.reachable;
  }

  canSendEmailTest(setup: AdminSetupStatusResponse): boolean {
    return (
      this.isEmailReady(setup) &&
      setup.email.queue_available &&
      setup.database.reachable
    );
  }

  envConfigured(setup: AdminSetupStatusResponse, key: SetupEnvKey): boolean {
    switch (key) {
      case 'STRIPE_SECRET_KEY':
        return setup.stripe.secret_key_configured;
      case 'STRIPE_WEBHOOK_SECRET':
        return setup.stripe.webhook_secret_configured;
      case 'SMTP_ENABLED':
        return setup.email.smtp_enabled;
      case 'SMTP_HOST':
        return Boolean(setup.email.smtp_host);
      case 'SMTP_PORT':
        return setup.email.smtp_port > 0;
      case 'SMTP_SECURE':
        return setup.email.smtp_secure;
      case 'SMTP_USER':
        return setup.email.smtp_user_configured;
      case 'SMTP_PASSWORD':
        return setup.email.smtp_password_configured;
      case 'MAIL_FROM_ADDRESS':
        return Boolean(setup.email.from);
      case 'MAIL_REPLY_TO_ADDRESS':
        return Boolean(setup.email.reply_to);
      case 'FUNDING_ADMIN_NOTIFICATION_EMAIL':
        return Boolean(setup.email.admin_notification_email);
      case 'FUNDING_SPONSORSHIP_INVOICE_PREFIX':
        return Boolean(setup.invoice.prefix);
      case 'FUNDING_INVOICE_ISSUER_NAME':
        return Boolean(setup.invoice.issuer_name);
      case 'FUNDING_INVOICE_ISSUER_EMAIL':
        return Boolean(setup.invoice.issuer_email);
      case 'FUNDING_INVOICE_ISSUER_ADDRESS':
        return setup.invoice.issuer_address_configured;
      case 'FUNDING_INVOICE_TAX_ID':
        return setup.invoice.issuer_tax_id_configured;
      case 'FUNDING_SPONSORSHIP_INVOICE_TAX_LABEL':
        return Boolean(setup.invoice.tax_label);
      case 'DATABASE_URL':
        return setup.database.configured && setup.database.reachable;
    }
  }

  readyLabel(ready: boolean): string {
    return ready ? 'Pret' : 'A completer';
  }

  configuredLabel(configured: boolean): string {
    return configured ? 'Configure' : 'Manquant';
  }

  enabledLabel(enabled: boolean): string {
    return enabled ? 'Oui' : 'Non';
  }

  valueLabel(value: string | null): string {
    return value?.trim() ? value : 'Non configure';
  }

  originsLabel(origins: readonly string[]): string {
    return origins.length > 0 ? origins.join(', ') : 'Aucune origine explicite';
  }

  dataSourceLabel(source: AdminSetupStatusResponse['data_source']): string {
    switch (source) {
      case 'database':
        return 'PostgreSQL';
      case 'stripe_direct':
        return 'Stripe-direct';
      case 'empty':
        return 'Aucune source';
    }
  }

  dateLabel(iso: string | null): string {
    if (!iso) {
      return 'Jamais';
    }

    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return iso;
    }

    return new Intl.DateTimeFormat('fr-CA', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date);
  }

  stripeSummary(setup: AdminSetupStatusResponse): string {
    if (this.isStripeReady(setup)) {
      return 'Cle et webhook presents.';
    }

    return 'Cle Stripe ou secret webhook a ajouter.';
  }

  emailSummary(setup: AdminSetupStatusResponse): string {
    if (this.isEmailReady(setup)) {
      return 'SMTP et expediteur presents.';
    }

    return 'SMTP, expediteur ou notification admin a completer.';
  }

  queueSummary(setup: AdminSetupStatusResponse): string {
    if (this.isQueueReady(setup)) {
      return `${setup.email.queued_count} en attente, ${setup.email.failed_count} echec(s).`;
    }

    return 'DATABASE_URL et migration 010 requis.';
  }

  databaseSummary(setup: AdminSetupStatusResponse): string {
    if (setup.database.reachable) {
      return 'Connexion PostgreSQL active.';
    }

    return 'Base non configuree ou inaccessible.';
  }

  trackByEnvRow(_index: number, row: SetupEnvRow): string {
    return row.key;
  }

  private scrollTourAnchorIntoView(): void {
    if (typeof document === 'undefined') {
      return;
    }

    queueMicrotask(() => {
      const anchor = this.activeTourStep()?.anchor;
      if (!anchor) {
        return;
      }

      document
        .querySelector(`[data-tour-anchor="${anchor}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }
}
