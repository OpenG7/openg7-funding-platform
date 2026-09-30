import { TranslatePipe } from '@ngx-translate/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Injector,
  OnInit,
  PLATFORM_ID,
  afterNextRender,
  computed,
  inject,
  signal
} from '@angular/core';
import type {
  AdminSetupStatusResponse,
  AdminEmailTestResult,
  CockpitSystem
} from '@openg7/funding-core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminLayoutComponent } from '../../components/admin-layout/admin-layout.component.js';
import { AdminIconComponent } from '../../components/admin-ui/admin-icon.component.js';
import { AdminDrawerComponent } from '../../components/admin-ui/admin-drawer.component.js';
import { AdminSystemCardsComponent } from '../../components/admin-cockpit/admin-system-cards.component.js';
import { AdminCockpitActivityComponent } from '../../components/admin-cockpit/admin-cockpit-activity.component.js';
import { AdminCockpitStatusComponent } from '../../components/admin-cockpit/admin-cockpit-status.component.js';
import { createCockpitBlock } from '../../components/admin-cockpit/cockpit-block.js';
import { systemState } from '../../components/admin-cockpit/system-state.js';
import {
  FundingAdminService,
  AdminDashboardRequestError
} from '../../services/funding-admin.service.js';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';
type SetupSection =
  | 'overview'
  | 'readiness'
  | 'stripe'
  | 'email'
  | 'queue'
  | 'database'
  | 'storage'
  | 'env'
  | 'activity';
interface SetupRecommendation {
  readonly key:
    | 'database'
    | 'queue'
    | 'emailFailures'
    | 'service'
    | 'stripe'
    | 'email'
    | 'invoice'
    | 'verification'
    | 'ready';
  readonly section: SetupSection;
  readonly tone: 'warning' | 'neutral' | 'success';
  readonly url?: string;
  readonly urlAction?: 'openQueue' | 'openStripeEvents';
}
type TestState =
  | 'idle'
  | 'submitting'
  | 'checking'
  | 'queued'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'unknown'
  | 'error';
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
  imports: [
    TranslatePipe,
    CommonModule,
    AdminLayoutComponent,
    RouterLink,
    AdminIconComponent,
    AdminDrawerComponent,
    AdminSystemCardsComponent,
    AdminCockpitActivityComponent,
    AdminCockpitStatusComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-setup-page.component.html',
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-forms.css',
    './admin-setup-page.component.css'
  ]
})
export class AdminSetupPageComponent implements OnInit {
  readonly i18n = inject(FundingI18nService);
  readonly router = inject(Router);
  private readonly admin = inject(FundingAdminService);
  private readonly adminToken = signal(this.admin.getSavedAdminToken());
  private readonly route = inject(ActivatedRoute);
  private readonly injector = inject(Injector);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly state = signal<LoadState>('idle');
  readonly setup = signal<AdminSetupStatusResponse | null>(null);
  readonly testEmail = signal('');
  readonly testState = signal<TestState>('idle');
  readonly testMessage = signal('');
  readonly testResult = signal<AdminEmailTestResult | null>(null);
  readonly testRequestId = signal<string | null>(null);
  readonly testBusy = computed(() =>
    ['submitting', 'checking'].includes(this.testState())
  );
  readonly accessError = signal('');
  readonly refreshKey = signal(0);
  readonly systems = createCockpitBlock(
    'systems',
    this.refreshKey,
    () => !!this.setup() && !this.accessError()
  );
  readonly operationalCount = computed(
    () =>
      this.systems
        .data()
        ?.systems.filter(
          (system) =>
            systemState(system, this.systems.clock(), this.systems.failed()) ===
            'operational'
        ).length ?? 0
  );
  readonly recommendation = computed<SetupRecommendation>(() => {
    const setup = this.setup();
    if (!setup)
      return { key: 'verification', section: 'readiness', tone: 'neutral' };
    if (!setup.database.reachable)
      return { key: 'database', section: 'database', tone: 'warning' };
    if (!this.queueReadable(setup))
      return { key: 'queue', section: 'queue', tone: 'warning' };
    if (setup.email.failed_count > 0)
      return {
        key: 'emailFailures',
        section: 'queue',
        tone: 'warning',
        url: '/admin/fundraiser/email-queue'
      };
    const systems = this.systems.data()?.systems ?? [];
    const problem = systems.find((system) =>
      ['unavailable', 'degraded'].includes(
        systemState(system, this.systems.clock(), this.systems.failed())
      )
    );
    if (problem?.id === 'stripe')
      return {
        key: 'service',
        section: 'stripe',
        tone: 'warning',
        url: '/admin/fundraiser/attention?type=stripe_event_failed',
        urlAction: 'openStripeEvents'
      };
    if (problem?.id === 'email')
      return {
        key: 'service',
        section: 'email',
        tone: 'warning',
        url: '/admin/fundraiser/email-queue',
        urlAction: 'openQueue'
      };
    if (problem)
      return { key: 'service', section: problem.id, tone: 'warning' };
    if (!this.isStripeReady(setup))
      return { key: 'stripe', section: 'stripe', tone: 'warning' };
    if (!this.isEmailReady(setup))
      return { key: 'email', section: 'email', tone: 'warning' };
    if (!setup.invoice.ready)
      return { key: 'invoice', section: 'email', tone: 'warning' };
    if (
      this.systems.state() !== 'ready' ||
      systems.length !== 4 ||
      this.operationalCount() !== 4
    )
      return { key: 'verification', section: 'readiness', tone: 'neutral' };
    return { key: 'ready', section: 'activity', tone: 'success' };
  });
  readonly checklist = computed(() => {
    const data = this.setup();
    return data
      ? [
          { id: 'stripe' as const, ready: this.isStripeReady(data) },
          { id: 'email' as const, ready: this.isEmailReady(data) },
          { id: 'queue' as const, ready: this.isQueueReady(data) },
          {
            id: 'database' as const,
            ready: data.database.configured && data.database.reachable
          },
          { id: 'invoice' as const, ready: data.invoice.ready }
        ]
      : [];
  });
  readonly checklistCount = computed(
    () => this.checklist().filter((item) => item.ready).length
  );
  readonly storageSystem = computed(() =>
    this.systems.data()?.systems.find((system) => system.id === 'storage')
  );
  private testStorageKey = '';
  private loadRequest = 0;
  private destroyed = false;
  readonly tourIndex = signal(-1);

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.loadRequest++;
    });
  }

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
        body: this.i18n.t('admin.setup.tourSystems')
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
        note: this.i18n.t('admin.setup.databaseNote')
      }
    ];
  }

  ngOnInit(): void {
    if (!this.browser) return;
    this.testStorageKey =
      'openg7-email-test:' + (this.admin.identity()?.id ?? 'token');
    void this.initialize();
  }

  private async initialize(): Promise<void> {
    await this.loadSetup();
    if (!this.setup() || typeof window === 'undefined') return;
    const section = this.route.snapshot.queryParamMap.get('section');
    if (
      section &&
      [
        'overview',
        'readiness',
        'stripe',
        'email',
        'queue',
        'database',
        'storage',
        'env',
        'activity'
      ].includes(section)
    ) {
      afterNextRender(() => this.focusSection(section as SetupSection), {
        injector: this.injector
      });
    }
    try {
      const id = window.sessionStorage.getItem(this.testStorageKey);
      if (id && /^[0-9a-f-]{36}$/i.test(id)) {
        this.testRequestId.set(id);
        await this.checkEmailTest();
      }
    } catch {
      /* Storage is optional for consultation. */
    }
  }

  async loadSetup(): Promise<void> {
    if (this.destroyed || !this.browser) return;
    const request = ++this.loadRequest;
    this.state.set('loading');
    this.setup.set(null);
    this.accessError.set('');

    try {
      const setup = await this.admin.getSetupStatus(this.adminToken());
      if (request !== this.loadRequest) return;
      this.setup.set(setup);
      this.refreshKey.update((value) => value + 1);
      if (!this.testEmail() && setup.email.admin_notification_email) {
        this.testEmail.set(setup.email.admin_notification_email);
      }
      this.state.set('ready');
    } catch (error) {
      if (request !== this.loadRequest) return;
      this.handleAccessError(error);
      this.state.set('error');
    }
  }

  async sendEmailTest(): Promise<void> {
    const setup = this.setup();
    if (
      !setup ||
      !this.canSendEmailTest(setup) ||
      this.testBusy() ||
      this.testState() === 'unknown'
    ) {
      return;
    }

    const requestId = this.testResult()
      ? crypto.randomUUID()
      : (this.testRequestId() ?? crypto.randomUUID());
    try {
      window.sessionStorage.setItem(this.testStorageKey, requestId);
    } catch {
      this.testMessage.set(this.i18n.t('admin.setupEmail.storage'));
      return;
    }
    this.testRequestId.set(requestId);
    this.testResult.set(null);
    this.testState.set('submitting');
    this.testMessage.set('');

    try {
      const to =
        this.testEmail().trim() ||
        setup.email.admin_notification_email ||
        undefined;
      const result = await this.admin.sendEmailTest(this.adminToken(), {
        to,
        requestId
      });
      this.acceptEmailResult(result);
      await this.loadSetup();
    } catch (error) {
      if (this.handleAccessError(error)) return;
      if (
        error instanceof AdminDashboardRequestError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 409
      ) {
        this.testState.set('error');
        this.testMessage.set(this.i18n.t('admin.setupEmail.invalid'));
      } else this.testState.set('unknown');
    }
  }

  async checkEmailTest(): Promise<void> {
    const id = this.testRequestId();
    if (!id || this.testBusy()) return;
    this.testState.set('checking');
    this.testMessage.set('');
    try {
      this.acceptEmailResult(
        await this.admin.getEmailTest(this.adminToken(), id)
      );
    } catch (error) {
      if (this.handleAccessError(error)) return;
      if (error instanceof AdminDashboardRequestError && error.status === 404) {
        this.testState.set('idle');
        this.testMessage.set(this.i18n.t('admin.setupEmail.notFound'));
      } else this.testState.set('unknown');
    }
  }

  private acceptEmailResult(result: AdminEmailTestResult): void {
    this.testResult.set(result);
    this.testEmail.set(result.to);
    this.testState.set(result.status);
    this.testMessage.set(
      result.status === 'failed'
        ? this.i18n.t('admin.setupEmail.failedHelp')
        : ''
    );
  }

  private handleAccessError(error: unknown): boolean {
    if (
      !(error instanceof AdminDashboardRequestError) ||
      ![401, 403].includes(error.status)
    )
      return false;
    ++this.loadRequest;
    this.endTour();
    this.setup.set(null);
    this.testEmail.set('');
    this.testResult.set(null);
    this.testMessage.set('');
    this.testState.set('error');
    this.accessError.set(
      this.i18n.t(
        error.status === 401
          ? 'admin.setupEmail.expired'
          : 'admin.setupEmail.forbidden'
      )
    );
    return true;
  }

  setTestEmail(event: Event): void {
    if (this.testBusy() || this.testState() === 'unknown') return;
    const input = event.target as HTMLInputElement | null;
    this.testEmail.set(input?.value ?? '');
    if (this.testResult()) {
      this.testResult.set(null);
      this.testRequestId.set(null);
      try {
        window.sessionStorage.removeItem(this.testStorageKey);
      } catch {
        /* No pending outcome to recover. */
      }
    }
    if (!this.testResult()) {
      this.testState.set('idle');
      this.testMessage.set('');
    }
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
    return (
      this.queueReadable(setup) &&
      setup.email.failed_count === 0 &&
      !setup.email.last_error
    );
  }

  queueReadable(setup: AdminSetupStatusResponse): boolean {
    // Older servers can return zero counters alongside a failed queue inspection.
    return (
      setup.email.queue_available &&
      setup.database.reachable &&
      !(setup.email.last_error && !setup.email.last_failed_at)
    );
  }

  canSendEmailTest(setup: AdminSetupStatusResponse): boolean {
    return this.isEmailReady(setup) && this.queueReadable(setup);
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
    return this.i18n.t(
      ready ? 'admin.setup.configured' : 'admin.setup.incomplete'
    );
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
      timeZone: 'America/Toronto',
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
      return this.i18n.t('admin.setup.emailConfigured');
    }

    return this.i18n.t('admin.setup.emailIncomplete');
  }

  queueSummary(setup: AdminSetupStatusResponse): string {
    if (this.isQueueReady(setup)) {
      return this.i18n.t('admin.setup.queueSummary', {
        queued: setup.email.queued_count,
        failed: setup.email.failed_count
      });
    }

    return this.i18n.t('admin.setup.queueUnavailable');
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

  focusSection(section: SetupSection | 'invoice'): void {
    if (!this.browser || this.destroyed) return;
    const target = document.getElementById(
      'setup-' + (section === 'invoice' ? 'email' : section)
    );
    if (!target) return;
    const details = target.querySelector('details');
    if (details) details.open = true;
    target.focus({ preventScroll: true });
    target.scrollIntoView({
      block: 'start',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth'
    });
  }

  inspectSystem(id: CockpitSystem['id']): void {
    this.focusSection(id);
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

      const target = document.querySelector(`[data-tour-anchor="${anchor}"]`);
      const details = target?.querySelector('details');
      if (details) details.open = true;
      target?.scrollIntoView({ behavior: 'instant', block: 'center' });
    });
  }
}
