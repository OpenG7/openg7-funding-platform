import { TranslatePipe } from '@ngx-translate/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
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
import { AdminBackupsComponent } from '../../components/admin-backups/admin-backups.component.js';
import { AdminIconComponent } from '../../components/admin-ui/admin-icon.component.js';
import { AdminDrawerComponent } from '../../components/admin-ui/admin-drawer.component.js';
import { AdminCockpitActivityComponent } from '../../components/admin-cockpit/admin-cockpit-activity.component.js';
import { createCockpitBlock } from '../../components/admin-cockpit/cockpit-block.js';
import {
  FundingAdminService,
  AdminDashboardRequestError
} from '../../services/funding-admin.service.js';

import { AdminSetupReadinessComponent } from './admin-setup-readiness.component.js';
import { AdminSetupRecommendationComponent } from './admin-setup-recommendation.component.js';
import { AdminSetupServicesComponent } from './admin-setup-services.component.js';
import { AdminSetupChecklistComponent } from './admin-setup-checklist.component.js';
import { AdminSetupEnvironmentComponent } from './admin-setup-environment.component.js';
import {
  projectReadiness,
  projectChecklist,
  projectOperationalCount,
  projectRecommendation,
  type SetupSection
} from './setup-projections.js';
import {
  SetupPresentation,
  type SetupEmailTestState,
  type SetupEmailTestView
} from './setup-presentation.js';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';
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
    AdminBackupsComponent,
    RouterLink,
    AdminIconComponent,
    AdminDrawerComponent,
    AdminCockpitActivityComponent,
    AdminSetupReadinessComponent,
    AdminSetupRecommendationComponent,
    AdminSetupServicesComponent,
    AdminSetupChecklistComponent,
    AdminSetupEnvironmentComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-setup-page.component.html',
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-forms.css',
    './admin-setup-presentation.css',
    './admin-setup-page.component.css'
  ]
})
export class AdminSetupPageComponent implements OnInit {
  readonly i18n = inject(FundingI18nService);
  private readonly admin = inject(FundingAdminService);
  private readonly adminToken = signal(this.admin.getSavedAdminToken());
  private readonly route = inject(ActivatedRoute);
  private readonly injector = inject(Injector);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly state = signal<LoadState>('idle');
  readonly navSection = signal<SetupSection>('readiness');
  readonly setup = signal<AdminSetupStatusResponse | null>(null);
  readonly testEmail = signal('');
  readonly testState = signal<SetupEmailTestState>('idle');
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
  readonly labels = new SetupPresentation(this.i18n);
  readonly readiness = computed(() => {
    const setup = this.setup();
    return setup ? projectReadiness(setup) : null;
  });
  readonly emailTest = computed<SetupEmailTestView>(() => ({
    email: this.testEmail(),
    state: this.testState(),
    busy: this.testBusy(),
    message: this.testMessage(),
    result: this.testResult(),
    requestId: this.testRequestId()
  }));
  readonly operationalCount = computed(() =>
    projectOperationalCount(
      this.systems.data()?.systems ?? [],
      this.systems.clock(),
      this.systems.failed()
    )
  );
  readonly recommendation = computed(() =>
    projectRecommendation({
      setup: this.setup(),
      systems: this.systems.data()?.systems ?? [],
      systemsState: this.systems.state(),
      now: this.systems.clock(),
      failed: this.systems.failed()
    })
  );
  readonly checklist = computed(() => projectChecklist(this.setup()));
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
        'backups',
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
      !projectReadiness(setup).canSendEmailTest ||
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

  setTestEmail(email: string): void {
    if (this.testBusy() || this.testState() === 'unknown') return;
    this.testEmail.set(email);
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

  focusSection(section: SetupSection | 'invoice'): void {
    if (!this.browser || this.destroyed) return;
    const target = document.getElementById(
      'setup-' + (section === 'invoice' ? 'email' : section)
    );
    if (!target) return;
    this.navSection.set(
      section === 'overview'
        ? 'readiness'
        : section === 'readiness' ||
            section === 'env' ||
            section === 'backups' ||
            section === 'activity'
          ? section
          : 'stripe'
    );
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
