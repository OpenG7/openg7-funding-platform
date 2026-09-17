import { TranslatePipe } from '@ngx-translate/core';
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

import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminLayoutComponent } from '../../components/admin-layout/admin-layout.component.js';
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
  | 'FUNDING_ADMIN_REVIEW_REMINDER_ENABLED'
  | 'FUNDING_ADMIN_REVIEW_REMINDER_MIN_AGE_DAYS'
  | 'FUNDING_ADMIN_REVIEW_REMINDER_POLL_INTERVAL_MS'
  | 'FUNDING_ADMIN_REVIEW_REMINDER_MAX_ITEMS'
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
  imports: [TranslatePipe, CommonModule, AdminLayoutComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <openg7-admin-layout>
      <section class="admin-content">
        <header
          class="admin-topbar"
          data-tour-anchor="overview"
          [class.tour-target]="isTourAnchor('overview')"
        >
          <div>
            <span>{{ 'admin.legacy.configuration' | translate }}</span>
            <h1>{{ 'admin.legacy.setup_operationnel' | translate }}</h1>
          </div>
          <div class="topbar-actions">
            <button
              class="secondary-button"
              type="button"
              (click)="startTour()"
            >
              {{ 'admin.legacy.guide' | translate }}
            </button>
            <button type="button" (click)="loadSetup()">
              {{ 'admin.legacy.actualiser' | translate }}
            </button>
          </div>
        </header>

        <p class="state" *ngIf="state() === 'loading'" aria-live="polite">
          {{ 'admin.legacy.verification_de_la_configuration' | translate }}
        </p>
        <p
          class="state state-error"
          *ngIf="state() === 'error'"
          aria-live="polite"
        >
          {{
            'admin.legacy.impossible_de_charger_le_setup_admin_verifiez_la_session_admin_et'
              | translate
          }}
        </p>

        <ng-container *ngIf="setup() as data">
          <section
            class="setup-readiness"
            [attr.aria-label]="'admin.legacy.etat_du_setup' | translate"
            data-tour-anchor="readiness"
            [class.tour-target]="isTourAnchor('readiness')"
          >
            <article [class.ready]="isStripeReady(data)">
              <span>Stripe</span>
              <strong>{{ readyLabel(isStripeReady(data)) }}</strong>
              <small>{{ stripeSummary(data) }}</small>
            </article>
            <article [class.ready]="isEmailReady(data)">
              <span>{{ 'admin.legacy.courriel' | translate }}</span>
              <strong>{{ readyLabel(isEmailReady(data)) }}</strong>
              <small>{{ emailSummary(data) }}</small>
            </article>
            <article [class.ready]="isQueueReady(data)">
              <span>{{ 'admin.legacy.file' | translate }}</span>
              <strong>{{ readyLabel(isQueueReady(data)) }}</strong>
              <small>{{ queueSummary(data) }}</small>
            </article>
            <article [class.ready]="data.database.reachable">
              <span>{{ 'admin.legacy.base' | translate }}</span>
              <strong>{{ readyLabel(data.database.reachable) }}</strong>
              <small>{{ databaseSummary(data) }}</small>
            </article>
          </section>

          <section
            class="setup-grid"
            [attr.aria-label]="
              'admin.legacy.details_de_configuration' | translate
            "
          >
            <article
              class="setup-panel"
              data-tour-anchor="stripe"
              [class.tour-target]="isTourAnchor('stripe')"
            >
              <header>
                <div>
                  <span>Stripe</span>
                  <h2>
                    {{ 'admin.legacy.paiements_et_webhooks' | translate }}
                  </h2>
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
                  <dt>{{ 'admin.legacy.cle_secrete' | translate }}</dt>
                  <dd>
                    {{ configuredLabel(data.stripe.secret_key_configured) }}
                  </dd>
                </div>
                <div>
                  <dt>{{ 'admin.legacy.secret_webhook' | translate }}</dt>
                  <dd>
                    {{ configuredLabel(data.stripe.webhook_secret_configured) }}
                  </dd>
                </div>
                <div>
                  <dt>{{ 'admin.legacy.commandites' | translate }}</dt>
                  <dd>
                    {{ enabledLabel(data.stripe.business_sponsorship_enabled) }}
                  </dd>
                </div>
                <div>
                  <dt>{{ 'admin.legacy.endpoint_webhook' | translate }}</dt>
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
                {{ 'admin.legacy.ouvrir_stripe_dashboard' | translate }}</a
              >
            </article>

            <article
              class="setup-panel"
              data-tour-anchor="email"
              [class.tour-target]="isTourAnchor('email')"
            >
              <header>
                <div>
                  <span>{{ 'admin.legacy.courriel' | translate }}</span>
                  <h2>{{ 'admin.legacy.smtp_et_expediteur' | translate }}</h2>
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
                  <dt>{{ 'admin.legacy.smtp_enabled' | translate }}</dt>
                  <dd>
                    {{ enabledLabel(data.email.smtp_enabled) }}
                  </dd>
                </div>
                <div>
                  <dt>{{ 'admin.legacy.smtp_host' | translate }}</dt>
                  <dd>{{ valueLabel(data.email.smtp_host) }}</dd>
                </div>
                <div>
                  <dt>{{ 'admin.legacy.smtp_port' | translate }}</dt>
                  <dd>
                    {{
                      'admin.legacy.p0_secure_p1'
                        | translate
                          : {
                              p0: data.email.smtp_port,
                              p1: enabledLabel(data.email.smtp_secure)
                            }
                    }}
                  </dd>
                </div>
                <div>
                  <dt>{{ 'admin.legacy.smtp_user' | translate }}</dt>
                  <dd>
                    {{ configuredLabel(data.email.smtp_user_configured) }}
                  </dd>
                </div>
                <div>
                  <dt>{{ 'admin.legacy.smtp_password' | translate }}</dt>
                  <dd>
                    {{ configuredLabel(data.email.smtp_password_configured) }}
                  </dd>
                </div>
                <div>
                  <dt>{{ 'admin.legacy.mail_from_address' | translate }}</dt>
                  <dd>{{ valueLabel(data.email.from) }}</dd>
                </div>
                <div>
                  <dt>
                    {{ 'admin.legacy.mail_reply_to_address' | translate }}
                  </dt>
                  <dd>{{ valueLabel(data.email.reply_to) }}</dd>
                </div>
                <div>
                  <dt>{{ 'admin.legacy.notification_admin' | translate }}</dt>
                  <dd>{{ valueLabel(data.email.admin_notification_email) }}</dd>
                </div>
                <div>
                  <dt>{{ 'admin.legacy.rappel_approbation' | translate }}</dt>
                  <dd>
                    {{
                      'admin.legacy.p0_apres_p1_jour_s'
                        | translate
                          : {
                              p0: enabledLabel(
                                data.email.admin_review_reminder_enabled
                              ),
                              p1: data.email.admin_review_reminder_min_age_days
                            }
                    }}
                  </dd>
                </div>
                <div>
                  <dt>{{ 'admin.legacy.verification_rappel' | translate }}</dt>
                  <dd>
                    {{
                      'admin.legacy.p0_ms_p1_dossier_s'
                        | translate
                          : {
                              p0: data.email
                                .admin_review_reminder_poll_interval_ms,
                              p1: data.email.admin_review_reminder_max_items
                            }
                    }}
                  </dd>
                </div>
                <div>
                  <dt>{{ 'admin.legacy.factures_commandite' | translate }}</dt>
                  <dd>
                    {{ readyLabel(data.invoice.ready) }} -
                    {{ data.invoice.prefix }}
                  </dd>
                </div>
                <div>
                  <dt>{{ 'admin.legacy.emetteur_facture' | translate }}</dt>
                  <dd>{{ valueLabel(data.invoice.issuer_name) }}</dd>
                </div>
                <div>
                  <dt>{{ 'admin.legacy.taxes_facture' | translate }}</dt>
                  <dd>{{ data.invoice.tax_label }}</dd>
                </div>
              </dl>

              <div class="test-email">
                <label>
                  {{ 'admin.legacy.courriel_de_test' | translate
                  }}<input
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
                    testState() === 'sending'
                      ? ('admin.legacy.envoi_195' | translate)
                      : ('admin.legacy.envoyer_un_test' | translate)
                  }}
                </button>
              </div>
              <p class="panel-note" *ngIf="!canSendEmailTest(data)">
                {{
                  'admin.legacy.le_test_demande_database_url_migration_010_smtp_enabled_true_et_s'
                    | translate
                }}
              </p>
              <p class="panel-note success" *ngIf="testState() === 'sent'">
                {{
                  'admin.legacy.test_envoye_ou_mis_en_file_avec_succes'
                    | translate
                }}
              </p>
              <p class="panel-note error" *ngIf="testState() === 'error'">
                {{
                  testMessage() ||
                    ('admin.legacy.le_test_courriel_a_echoue' | translate)
                }}
              </p>
            </article>

            <article
              class="setup-panel queue-panel"
              data-tour-anchor="queue"
              [class.tour-target]="isTourAnchor('queue')"
            >
              <header>
                <div>
                  <span>{{ 'admin.legacy.file_courriel' | translate }}</span>
                  <h2>{{ 'admin.legacy.envois_et_retries' | translate }}</h2>
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
                [attr.aria-label]="
                  'admin.legacy.statistiques_de_file_courriel' | translate
                "
              >
                <div>
                  <span>{{ 'admin.legacy.en_attente' | translate }}</span>
                  <strong>{{ data.email.queued_count }}</strong>
                </div>
                <div>
                  <span>{{ 'admin.legacy.envoi' | translate }}</span>
                  <strong>{{ data.email.sending_count }}</strong>
                </div>
                <div>
                  <span>{{ 'admin.legacy.envoyes' | translate }}</span>
                  <strong>{{ data.email.sent_count }}</strong>
                </div>
                <div>
                  <span>{{ 'admin.legacy.echecs' | translate }}</span>
                  <strong>{{ data.email.failed_count }}</strong>
                </div>
              </div>
              <dl>
                <div>
                  <dt>{{ 'admin.legacy.poll_interval' | translate }}</dt>
                  <dd>
                    {{
                      'admin.legacy.p0_ms'
                        | translate: { p0: data.email.queue_poll_interval_ms }
                    }}
                  </dd>
                </div>
                <div>
                  <dt>{{ 'admin.legacy.batch_size' | translate }}</dt>
                  <dd>{{ data.email.queue_batch_size }}</dd>
                </div>
                <div>
                  <dt>{{ 'admin.legacy.dernier_echec' | translate }}</dt>
                  <dd>{{ dateLabel(data.email.last_failed_at) }}</dd>
                </div>
                <div>
                  <dt>{{ 'admin.legacy.erreur' | translate }}</dt>
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
                  <span>{{ 'admin.legacy.execution' | translate }}</span>
                  <h2>
                    {{ 'admin.legacy.base_et_environnement' | translate }}
                  </h2>
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
                  <dt>{{ 'admin.legacy.mode' | translate }}</dt>
                  <dd>{{ data.environment }}</dd>
                </div>
                <div>
                  <dt>{{ 'admin.legacy.source_transparence' | translate }}</dt>
                  <dd>{{ dataSourceLabel(data.data_source) }}</dd>
                </div>
                <div>
                  <dt>{{ 'admin.legacy.database_url' | translate }}</dt>
                  <dd>{{ configuredLabel(data.database.configured) }}</dd>
                </div>
                <div>
                  <dt>{{ 'admin.legacy.connexion_db' | translate }}</dt>
                  <dd>{{ enabledLabel(data.database.reachable) }}</dd>
                </div>
                <div>
                  <dt>{{ 'admin.legacy.origines_cors' | translate }}</dt>
                  <dd>{{ originsLabel(data.allowed_origins) }}</dd>
                </div>
                <div>
                  <dt>{{ 'admin.legacy.base_publique' | translate }}</dt>
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
                <span>{{ 'admin.legacy.checklist' | translate }}</span>
                <h2>{{ 'admin.legacy.cles_a_verifier' | translate }}</h2>
              </div>
              <small>{{
                'admin.legacy.mis_a_jour_p0'
                  | translate: { p0: dateLabel(data.last_updated_at) }
              }}</small>
            </header>

            <div class="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{{ 'admin.legacy.variable' | translate }}</th>
                    <th>{{ 'admin.legacy.etat' | translate }}</th>
                    <th>{{ 'admin.legacy.role' | translate }}</th>
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
          [attr.aria-label]="'admin.legacy.fermer_le_guide' | translate"
          (click)="endTour()"
        ></button>
        <section class="tour-card">
          <span>{{
            'admin.legacy.etape_p0_p1'
              | translate: { p0: tourIndex() + 1, p1: tourSteps.length }
          }}</span>
          <h2 id="setup-tour-title">{{ step.title }}</h2>
          <p>{{ step.body }}</p>
          <div class="tour-actions">
            <button
              type="button"
              (click)="previousTourStep()"
              [disabled]="tourIndex() === 0"
            >
              {{ 'admin.legacy.retour' | translate }}
            </button>
            <button
              class="primary-tour-action"
              type="button"
              (click)="nextTourStep()"
            >
              {{
                isLastTourStep()
                  ? ('admin.legacy.terminer' | translate)
                  : ('admin.legacy.suivant' | translate)
              }}
            </button>
          </div>
        </section>
      </div>
    </openg7-admin-layout>
  `,
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-forms.css'
  ],
  styles: [
    `
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
        color: var(--admin-muted);
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
        background: var(--admin-panel-raised);
        border: 0;
        color: var(--admin-text);
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
        background: var(--admin-panel);
        border: 1px solid var(--admin-border);
        color: var(--admin-text);
      }

      .state {
        background: var(--admin-panel);
        border: 1px solid var(--admin-border);
        border-radius: 0.45rem;
        color: var(--admin-muted);
        font-weight: 800;
        padding: 0.85rem 1rem;
      }

      .state-error,
      .panel-note.error {
        color: var(--admin-danger);
      }

      .setup-readiness {
        display: grid;
        gap: 0.8rem;
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      .setup-readiness article,
      .setup-panel,
      .setup-table-panel {
        background: var(--admin-panel);
        border: 1px solid var(--admin-border);
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
        color: var(--admin-text);
        font-size: 1.25rem;
        line-height: 1.2;
      }

      .setup-readiness small {
        color: var(--admin-muted);
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
        color: var(--admin-text);
        font-weight: 800;
        margin: 0;
        min-width: 0;
        overflow-wrap: anywhere;
      }

      code {
        background: var(--admin-panel-raised);
        border: 1px solid var(--admin-border);
        border-radius: 0.3rem;
        color: var(--admin-text);
        display: inline-block;
        max-width: 100%;
        overflow-wrap: anywhere;
        padding: 0.12rem 0.28rem;
      }

      .setup-panel a {
        color: var(--admin-warning);
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
        background: var(--admin-panel-raised);
        color: var(--admin-success);
      }

      .status-warn {
        background: #3c3221;
        color: var(--admin-warning);
      }

      .test-email {
        align-items: end;
        display: grid;
        gap: 0.65rem;
        grid-template-columns: minmax(0, 1fr) auto;
      }

      label {
        color: var(--admin-muted);
        display: grid;
        gap: 0.35rem;
        font-size: 0.9rem;
        font-weight: 800;
      }

      input {
        border: 1px solid var(--admin-border);
        color: var(--admin-text);
        min-height: 2.7rem;
        min-width: 0;
        padding: 0 0.8rem;
        width: 100%;
      }

      .panel-note {
        color: var(--admin-muted);
        font-size: 0.9rem;
        font-weight: 800;
        line-height: 1.35;
        margin: 0;
      }

      .panel-note.success {
        color: var(--admin-success);
      }

      .queue-metrics {
        display: grid;
        gap: 0.6rem;
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      .queue-metrics div {
        background: var(--admin-panel-raised);
        border: 1px solid var(--admin-border);
        border-radius: 0.4rem;
        display: grid;
        gap: 0.25rem;
        min-height: 4.8rem;
        padding: 0.7rem;
      }

      .queue-metrics strong {
        color: var(--admin-text);
        font-size: 1.25rem;
      }

      .setup-table-panel {
        display: grid;
        gap: 1rem;
        padding: 1rem;
      }

      .setup-table-panel small {
        color: var(--admin-muted);
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
        border-bottom: 1px solid var(--admin-border);
        padding: 0.8rem 0.65rem;
        text-align: left;
        vertical-align: top;
      }

      th {
        color: var(--admin-muted);
        font-size: 0.75rem;
        font-weight: 900;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      td {
        color: var(--admin-muted);
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
        background: var(--admin-panel);
        border: 1px solid var(--admin-border);
        border-radius: 0.5rem;
        bottom: 1.25rem;
        box-shadow: 0 1rem 2rem rgba(16, 24, 39, 0.24);
        color: var(--admin-text);
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
        color: var(--admin-warning);
        font-size: 0.78rem;
        font-weight: 900;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      .tour-card p {
        color: var(--admin-muted);
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
        background: var(--admin-panel-raised);
        border-color: var(--admin-border);
        color: var(--admin-text);
      }

      @media (max-width: 980px) {
        .setup-readiness,
        .setup-grid {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 680px) {
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
  readonly i18n = inject(FundingI18nService);
  private readonly admin = inject(FundingAdminService);
  private readonly adminToken = signal(this.admin.getSavedAdminToken());

  readonly state = signal<LoadState>('idle');
  readonly setup = signal<AdminSetupStatusResponse | null>(null);
  readonly testEmail = signal('');
  readonly testState = signal<TestState>('idle');
  readonly testMessage = signal('');
  readonly tourIndex = signal(-1);

  get tourSteps(): readonly SetupTourStep[] {
    return [
      {
        anchor: 'overview',
        title: this.i18n.t('admin.messages.vue_de_controle'),
        body: this.i18n.t(
          'admin.messages.cette_page_regroupe_les_controles_stripe_courriel_file_et_base_de_donnees_avant_de_recevoir_des'
        )
      },
      {
        anchor: 'readiness',
        title: this.i18n.t('admin.messages.etat_rapide'),
        body: this.i18n.t(
          'admin.messages.les_quatre_indicateurs_montrent_ce_qui_est_pret_et_ce_qui_doit_encore_etre_complete'
        )
      },
      {
        anchor: 'stripe',
        title: this.i18n.t('admin.messages.paiement_stripe'),
        body: this.i18n.t(
          'admin.messages.verifiez_la_cle_secrete_le_secret_webhook_et_l_endpoint_a_copier_dans_stripe_dashboard'
        )
      },
      {
        anchor: 'email',
        title: this.i18n.t('admin.messages.courriel_applicatif'),
        body: this.i18n.t(
          'admin.messages.validez_smtp_l_expediteur_le_reply_to_et_l_adresse_de_notification_admin_puis_envoyez_un_test'
        )
      },
      {
        anchor: 'queue',
        title: this.i18n.t('admin.messages.file_et_retries'),
        body: this.i18n.t(
          'admin.messages.surveillez_les_messages_en_attente_envoyes_ou_echoues_pour_confirmer_que_le_worker_tourne'
        )
      },
      {
        anchor: 'database',
        title: this.i18n.t('admin.legacy.execution'),
        body: this.i18n.t(
          'admin.messages.controlez_la_source_de_donnees_database_url_les_origines_autorisees_et_la_base_publique'
        )
      },
      {
        anchor: 'env',
        title: this.i18n.t('admin.messages.checklist_finale'),
        body: this.i18n.t(
          'admin.messages.la_table_reprend_les_variables_critiques_a_verifier_dans_l_environnement_de_production'
        )
      }
    ];
  }

  readonly activeTourStep = computed(() => {
    const index = this.tourIndex();
    return index >= 0 ? (this.tourSteps[index] ?? null) : null;
  });

  get envRows(): readonly SetupEnvRow[] {
    return [
      {
        key: 'STRIPE_SECRET_KEY',
        label: this.i18n.t('admin.messages.stripe_secret'),
        note: this.i18n.t('admin.messages.checkout_et_lecture_stripe_direct')
      },
      {
        key: 'STRIPE_WEBHOOK_SECRET',
        label: this.i18n.t('admin.messages.stripe_webhook'),
        note: this.i18n.t('admin.messages.validation_des_evenements_stripe')
      },
      {
        key: 'SMTP_ENABLED',
        label: 'SMTP active',
        note: this.i18n.t('admin.messages.active_les_envois_transactionnels')
      },
      {
        key: 'SMTP_HOST',
        label: this.i18n.t('admin.messages.serveur_smtp'),
        note: this.i18n.t(
          'admin.messages.hote_hostpapa_ou_fournisseur_equivalent'
        )
      },
      {
        key: 'SMTP_PORT',
        label: this.i18n.t('admin.messages.port_smtp'),
        note: this.i18n.t('admin.messages.port_de_connexion_smtp')
      },
      {
        key: 'SMTP_SECURE',
        label: 'TLS SMTP',
        note: this.i18n.t('admin.messages.connexion_tls_implicite')
      },
      {
        key: 'SMTP_USER',
        label: this.i18n.t('admin.messages.utilisateur_smtp'),
        note: this.i18n.t('admin.messages.adresse_complete_de_la_boite_notify')
      },
      {
        key: 'SMTP_PASSWORD',
        label: this.i18n.t('admin.messages.mot_de_passe_smtp'),
        note: this.i18n.t(
          'admin.messages.secret_prive_injecte_cote_serveur_seulement'
        )
      },
      {
        key: 'MAIL_FROM_ADDRESS',
        label: this.i18n.t('admin.messages.expediteur'),
        note: this.i18n.t('admin.messages.adresse_visible_comme_expediteur')
      },
      {
        key: 'MAIL_REPLY_TO_ADDRESS',
        label: 'Reply-to',
        note: this.i18n.t(
          'admin.messages.adresse_de_reponse_des_commanditaires'
        )
      },
      {
        key: 'FUNDING_ADMIN_NOTIFICATION_EMAIL',
        label: this.i18n.t('admin.legacy.notification_admin'),
        note: this.i18n.t('admin.messages.alertes_internes_et_rappels_admin')
      },
      {
        key: 'FUNDING_ADMIN_REVIEW_REMINDER_ENABLED',
        label: this.i18n.t('admin.legacy.rappel_approbation'),
        note: this.i18n.t(
          'admin.messages.active_le_rappel_quotidien_des_commandites_a_approuver'
        )
      },
      {
        key: 'FUNDING_ADMIN_REVIEW_REMINDER_MIN_AGE_DAYS',
        label: this.i18n.t('admin.messages.age_rappel_approbation'),
        note: this.i18n.t(
          'admin.messages.nombre_de_jours_avant_le_premier_rappel'
        )
      },
      {
        key: 'FUNDING_ADMIN_REVIEW_REMINDER_POLL_INTERVAL_MS',
        label: this.i18n.t('admin.messages.intervalle_rappel'),
        note: this.i18n.t(
          'admin.messages.frequence_de_verification_des_rappels_admin'
        )
      },
      {
        key: 'FUNDING_ADMIN_REVIEW_REMINDER_MAX_ITEMS',
        label: this.i18n.t('admin.messages.dossiers_dans_le_rappel'),
        note: this.i18n.t(
          'admin.messages.nombre_maximal_de_dossiers_listes_dans_le_courriel'
        )
      },
      {
        key: 'FUNDING_SPONSORSHIP_INVOICE_PREFIX',
        label: this.i18n.t('admin.messages.prefixe_facture'),
        note: this.i18n.t('admin.messages.numerotation_des_factures_commandite')
      },
      {
        key: 'FUNDING_INVOICE_ISSUER_NAME',
        label: this.i18n.t('admin.legacy.emetteur_facture'),
        note: this.i18n.t('admin.messages.nom_legal_ou_public_sur_la_facture')
      },
      {
        key: 'FUNDING_INVOICE_ISSUER_EMAIL',
        label: this.i18n.t('admin.legacy.courriel_facture'),
        note: this.i18n.t(
          'admin.messages.courriel_affiche_dans_le_bloc_emetteur'
        )
      },
      {
        key: 'FUNDING_INVOICE_ISSUER_ADDRESS',
        label: this.i18n.t('admin.messages.adresse_facture'),
        note: this.i18n.t('admin.messages.adresse_affichee_si_configuree')
      },
      {
        key: 'FUNDING_INVOICE_TAX_ID',
        label: this.i18n.t('admin.messages.identifiant_fiscal'),
        note: this.i18n.t('admin.messages.numero_fiscal_affiche_si_applicable')
      },
      {
        key: 'FUNDING_SPONSORSHIP_INVOICE_TAX_LABEL',
        label: this.i18n.t('admin.messages.libelle_taxes'),
        note: this.i18n.t('admin.messages.texte_de_taxe_affiche_sur_la_facture')
      },
      {
        key: 'DATABASE_URL',
        label: 'PostgreSQL',
        note: 'Persistance, admin et file courriel.'
      }
    ];
  }

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
        error instanceof Error
          ? error.message
          : this.i18n.t('admin.legacy.le_test_courriel_a_echoue')
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
      case 'FUNDING_ADMIN_REVIEW_REMINDER_ENABLED':
        return setup.email.admin_review_reminder_enabled;
      case 'FUNDING_ADMIN_REVIEW_REMINDER_MIN_AGE_DAYS':
        return setup.email.admin_review_reminder_min_age_days >= 0;
      case 'FUNDING_ADMIN_REVIEW_REMINDER_POLL_INTERVAL_MS':
        return setup.email.admin_review_reminder_poll_interval_ms > 0;
      case 'FUNDING_ADMIN_REVIEW_REMINDER_MAX_ITEMS':
        return setup.email.admin_review_reminder_max_items > 0;
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
    return ready ? this.i18n.t('admin.messages.pret') : 'A completer';
  }

  configuredLabel(configured: boolean): string {
    return configured
      ? this.i18n.t('admin.messages.configure')
      : this.i18n.t('admin.messages.manquant');
  }

  enabledLabel(enabled: boolean): string {
    return enabled
      ? this.i18n.t('admin.dossier.yes')
      : this.i18n.t('admin.dossier.no');
  }

  valueLabel(value: string | null): string {
    return value?.trim() ? value : this.i18n.t('admin.messages.non_configure');
  }

  originsLabel(origins: readonly string[]): string {
    return origins.length > 0
      ? origins.join(', ')
      : this.i18n.t('admin.messages.aucune_origine_explicite');
  }

  dataSourceLabel(source: AdminSetupStatusResponse['data_source']): string {
    switch (source) {
      case 'database':
        return 'PostgreSQL';
      case 'stripe_direct':
        return 'Stripe-direct';
      case 'empty':
        return this.i18n.t('admin.messages.aucune_source');
    }
  }

  dateLabel(iso: string | null): string {
    if (!iso) {
      return this.i18n.t('admin.messages.jamais');
    }

    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return iso;
    }

    return new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date);
  }

  stripeSummary(setup: AdminSetupStatusResponse): string {
    if (this.isStripeReady(setup)) {
      return this.i18n.t('admin.messages.cle_et_webhook_presents');
    }

    return this.i18n.t('admin.messages.cle_stripe_ou_secret_webhook_a_ajouter');
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
      return this.i18n.t('admin.messages.connexion_postgresql_active');
    }

    return this.i18n.t('admin.messages.base_non_configuree_ou_inaccessible');
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
