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
import type { CockpitSystem } from '@openg7/funding-core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminLayoutComponent } from '../../components/admin-layout/admin-layout.component.js';
import { AdminBackupsComponent } from '../../components/admin-backups/admin-backups.component.js';
import { AdminIconComponent } from '../../components/admin-ui/admin-icon.component.js';
import { AdminDrawerComponent } from '../../components/admin-ui/admin-drawer.component.js';
import { AdminCockpitActivityComponent } from '../../components/admin-cockpit/admin-cockpit-activity.component.js';
import { createCockpitBlock } from '../../components/admin-cockpit/cockpit-block.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';

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
import { SetupPresentation } from './setup-presentation.js';
import { AdminSetupReadController } from './admin-setup-read-controller.js';
import { AdminSetupEmailTestWorkflow } from './admin-setup-email-test-workflow.js';

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

  private readonly setupRead = new AdminSetupReadController({
    admin: this.admin,
    token: () => this.adminToken(),
    t: (key, params) => this.i18n.t(key, params),
    onAccessDenied: () => {
      this.emailTestWorkflow.resetAccess();
      this.endTour();
    }
  });
  private readonly emailTestWorkflow = new AdminSetupEmailTestWorkflow({
    admin: this.admin,
    token: () => this.adminToken(),
    t: (key, params) => this.i18n.t(key, params),
    scope: this.admin.identity()?.id ?? 'token',
    storage: () => (this.browser ? window.sessionStorage : null),
    requestId: () => crypto.randomUUID(),
    onAccessDenied: (status) => this.setupRead.rejectAccess(status)
  });
  readonly state = this.setupRead.state;
  readonly navSection = signal<SetupSection>('readiness');
  readonly setup = this.setupRead.setup;
  readonly testEmail = this.emailTestWorkflow.email;
  readonly testState = this.emailTestWorkflow.state;
  readonly testMessage = this.emailTestWorkflow.message;
  readonly testResult = this.emailTestWorkflow.result;
  readonly testRequestId = this.emailTestWorkflow.requestId;
  readonly testBusy = this.emailTestWorkflow.busy;
  readonly accessError = this.setupRead.accessError;
  readonly refreshKey = this.setupRead.refreshKey;
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
  readonly emailTest = this.emailTestWorkflow.view;
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
  private destroyed = false;
  readonly tourIndex = signal(-1);

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.setupRead.dispose();
      this.emailTestWorkflow.dispose();
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
    void this.initialize();
  }

  private async initialize(): Promise<void> {
    await this.loadSetup();
    if (this.destroyed || !this.setup()) return;
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
    await this.emailTestWorkflow.restore();
  }

  async loadSetup(): Promise<void> {
    if (this.destroyed || !this.browser) return;
    const setup = await this.setupRead.load();
    if (setup) this.emailTestWorkflow.defaultRecipient(setup);
  }

  async sendEmailTest(): Promise<void> {
    if (this.destroyed || !this.browser) return;
    if (await this.emailTestWorkflow.send(this.setup())) await this.loadSetup();
  }

  async checkEmailTest(): Promise<void> {
    if (this.destroyed || !this.browser) return;
    await this.emailTestWorkflow.check();
  }

  setTestEmail(email: string): void {
    if (this.destroyed || !this.browser) return;
    this.emailTestWorkflow.setEmail(email);
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
