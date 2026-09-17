import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  PLATFORM_ID,
  computed,
  inject,
  signal
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink, UrlTree } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type {
  AdminAssistantDraftType,
  AdminAssistantPrepareResponse,
  AdminAssistantQueryResponse,
  AdminAssistantSummary,
  AdminAttentionItem,
  AdminAttentionItemType,
  AdminAttentionSeverity,
  AdminAttentionSuggestedAction
} from '@openg7/funding-core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminAssistantContextComponent } from '../../components/admin-assistant/admin-assistant-context.component.js';
import { AdminAssistantDraftComponent } from '../../components/admin-assistant/admin-assistant-draft.component.js';
import { AdminAssistantAnswerComponent } from '../../components/admin-assistant/admin-assistant-answer.component.js';
import { AdminLayoutComponent } from '../../components/admin-layout/admin-layout.component.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';

interface AttentionSection {
  readonly type: AdminAttentionItemType;
  readonly title: string;
  readonly items: readonly AdminAttentionItem[];
}

const SECTION_ORDER: readonly {
  readonly type: AdminAttentionItemType;
  readonly title: string;
}[] = [
  {
    type: 'sponsorship_needs_info',
    title: 'Fiches commanditaires incomplètes'
  },
  { type: 'sponsorship_needs_review', title: 'Commandites à réviser' },
  { type: 'publication_needs_preparation', title: 'Publications à préparer' },
  { type: 'publication_late', title: 'Publications en retard' },
  { type: 'email_delivery_failed', title: 'Courriels échoués' },
  { type: 'financial_data_warning', title: 'Avertissements financiers' }
];

const DRAFT_TYPE_BY_ACTION: Record<string, AdminAssistantDraftType> = {
  prepare_reminder: 'sponsorship_reminder',
  prepare_publication: 'publication_draft',
  prepare_note: 'admin_note',
  propose_slot: 'slot_proposal'
};

type DraftState = 'idle' | 'loading' | 'ready' | 'error';

@Component({
  selector: 'openg7-admin-assistant-page',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    TranslatePipe,
    AdminAssistantContextComponent,
    AdminAssistantDraftComponent,
    AdminAssistantAnswerComponent,
    AdminLayoutComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (sponsorshipId(); as id) {
      <openg7-admin-layout [sponsorshipId]="id">
        <h1 class="context-title">{{ 'admin.nav.assistant' | translate }}</h1>
        <openg7-admin-assistant-context [sponsorshipId]="id" />
      </openg7-admin-layout>
    } @else {
      <openg7-admin-layout>
        <section class="admin-content">
          <header class="admin-topbar">
            <div>
              <span>{{ 'admin.legacy.administration' | translate }}</span>
              <h1>{{ 'admin.legacy.assistant' | translate }}</h1>
            </div>
            <button type="button" (click)="loadSummary()">
              {{ 'admin.legacy.actualiser' | translate }}
            </button>
          </header>

          <section class="admin-auth-panel" aria-labelledby="admin-auth-title">
            <div>
              <h2 id="admin-auth-title">
                {{
                  'admin.legacy.copilote_operationnel_en_lecture_seule'
                    | translate
                }}
              </h2>
              <p>
                {{
                  'admin.legacy.l_assistant_detecte_et_explique_ce_qui_demande_votre_attention_il'
                    | translate
                }}
              </p>
            </div>
          </section>

          <p class="state" *ngIf="summaryState() === 'loading'">
            {{ 'admin.legacy.chargement_du_resume' | translate }}
          </p>
          <p class="state state-error" *ngIf="summaryState() === 'error'">
            {{
              'admin.legacy.impossible_de_charger_le_resume_de_l_assistant'
                | translate
            }}
          </p>

          <section
            class="summary-panel"
            *ngIf="summary() as data"
            aria-labelledby="summary-title"
          >
            <header>
              <div>
                <span>{{ 'admin.legacy.priorites' | translate }}</span>
                <h2 id="summary-title">
                  {{ 'admin.legacy.que_faut_il_traiter' | translate }}
                </h2>
              </div>
              <small>{{
                'admin.legacy.genere_p0'
                  | translate: { p0: dateLabel(data.generatedAt) }
              }}</small>
            </header>

            <div class="counts">
              <article class="count count-urgent">
                <strong>{{ data.counts.urgent }}</strong>
                <span>{{ 'admin.legacy.urgent' | translate }}</span>
              </article>
              <article class="count count-today">
                <strong>{{ data.counts.today }}</strong>
                <span>{{ 'admin.legacy.aujourd_hui' | translate }}</span>
              </article>
              <article class="count count-week">
                <strong>{{ data.counts.thisWeek }}</strong>
                <span>{{ 'admin.legacy.cette_semaine' | translate }}</span>
              </article>
              <article class="count count-info">
                <strong>{{ data.counts.informational }}</strong>
                <span>{{ 'admin.legacy.information' | translate }}</span>
              </article>
            </div>

            <article
              class="empty-state calm"
              *ngIf="data.attentionItems.length === 0"
            >
              <h3>{{ 'admin.legacy.aucune_action_urgente' | translate }}</h3>
              <p>
                {{
                  'admin.legacy.rien_ne_demande_votre_attention_immediate_pour_le_moment'
                    | translate
                }}
              </p>
            </article>

            <section
              class="financial"
              *ngIf="data.financialSummary as financial"
              [attr.aria-label]="'admin.legacy.resume_financier' | translate"
            >
              <h3>{{ 'admin.legacy.resume_financier_prudent' | translate }}</h3>
              <ul class="facts">
                <li>
                  <span>{{
                    'admin.legacy.montant_brut_paye' | translate
                  }}</span>
                  <strong
                    >{{ financial.grossPaid }} {{ financial.currency }}</strong
                  >
                </li>
                <li>
                  <span>{{ 'admin.legacy.remboursements' | translate }}</span>
                  <strong
                    >{{ financial.refunded }} {{ financial.currency }}</strong
                  >
                </li>
                <li>
                  <span>{{
                    'admin.legacy.montant_net_estime' | translate
                  }}</span>
                  <strong>{{
                    financial.netReceived === null
                      ? ('admin.legacy.donnees_incompletes' | translate)
                      : financial.netReceived + ' ' + financial.currency
                  }}</strong>
                </li>
              </ul>
              <p
                class="limitation"
                *ngFor="let limitation of financial.limitations"
              >
                {{ limitation }}
              </p>
            </section>
          </section>

          <section
            class="attention-section"
            *ngFor="let section of sections(); trackBy: trackBySection"
            [attr.aria-label]="section.title"
          >
            <header>
              <h2>{{ section.title }}</h2>
              <span class="badge">{{ section.items.length }}</span>
            </header>

            <p class="empty-note" *ngIf="section.items.length === 0">
              {{ 'admin.legacy.aucun_element' | translate }}
            </p>

            <article
              class="attention-item"
              *ngFor="let item of section.items; trackBy: trackByItem"
            >
              <header>
                <h3>{{ item.title }}</h3>
                <span class="severity" [class]="'severity-' + item.severity">
                  {{ severityLabel(item.severity) }}
                </span>
              </header>
              <p class="explanation">{{ item.explanation }}</p>
              <p class="due" *ngIf="item.dueAt">
                {{
                  'admin.legacy.echeance_p0'
                    | translate: { p0: dateLabel(item.dueAt) }
                }}
              </p>
              <div class="actions">
                <button
                  *ngIf="prepareAction(item) as action"
                  type="button"
                  class="prepare-button"
                  [disabled]="draftState(item) === 'loading'"
                  (click)="prepare(item, action)"
                >
                  {{
                    draftState(item) === 'loading'
                      ? ('admin.legacy.preparation' | translate)
                      : action.label
                  }}
                </button>
                <a
                  *ngIf="item.adminUrl as url"
                  class="link"
                  [routerLink]="adminLink(url)"
                >
                  {{ navigateLabel(item) }}
                </a>
              </div>

              <p class="state-error" *ngIf="draftState(item) === 'error'">
                {{ draftError(item) }}
              </p>

              <aside
                class="draft"
                *ngIf="draftFor(item) as prepared"
                [attr.aria-label]="'admin.legacy.brouillon_prepare' | translate"
              >
                <p class="draft-notice" *ngIf="prepared.status !== 'ok'">
                  {{ prepared.message }}
                </p>

                <openg7-admin-assistant-draft
                  *ngIf="prepared.draft as draft"
                  [draft]="draft"
                />
              </aside>
            </article>
          </section>

          <section class="conversation" aria-labelledby="conversation-title">
            <header>
              <h2 id="conversation-title">
                {{ 'admin.legacy.poser_une_question' | translate }}
              </h2>
              <small>
                {{
                  'admin.legacy.l_assistant_repond_a_partir_d_outils_en_lecture_seule_et_n_execut'
                    | translate
                }}</small
              >
            </header>

            <form (submit)="ask($event)">
              <label>
                {{ 'admin.legacy.question' | translate
                }}<input
                  type="text"
                  name="assistant-question"
                  [attr.placeholder]="
                    'admin.legacy.quelles_commandites_dois_je_traiter_aujourd_hui'
                      | translate
                  "
                  [value]="question()"
                  (input)="setQuestion($event)"
                />
              </label>
              <button type="submit" [disabled]="answerState() === 'loading'">
                {{
                  answerState() === 'loading'
                    ? ('admin.legacy.en_cours' | translate)
                    : ('admin.legacy.demander' | translate)
                }}
              </button>
            </form>

            <p class="state state-error" *ngIf="answerState() === 'error'">
              {{ answerError() }}
            </p>

            <openg7-admin-assistant-answer
              *ngIf="answer() as reply"
              [answer]="reply"
            />
          </section>
        </section>
      </openg7-admin-layout>
    }
  `,
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-forms.css'
  ],
  styles: [
    `
      .context-title {
        font:
          700 1.75rem 'Segoe UI',
          system-ui,
          sans-serif;
        margin: 0 0 1rem;
      }

      .admin-content {
        display: grid;
        gap: 1rem;
        min-width: 0;
      }

      .admin-topbar,
      .admin-auth-panel,
      .summary-panel,
      .attention-section,
      .conversation,
      .state {
        margin: 0 auto;
        max-width: 78rem;
        width: 100%;
      }

      .admin-topbar,
      .summary-panel header,
      .attention-section header,
      .conversation header {
        align-items: center;
        display: flex;
        gap: 1rem;
        justify-content: space-between;
      }

      .admin-topbar span,
      .summary-panel span {
        color: var(--admin-muted);
        font-size: 0.78rem;
        font-weight: 800;
        text-transform: uppercase;
      }

      .admin-topbar h1,
      .admin-auth-panel h2,
      .summary-panel h2,
      .attention-section h2,
      .conversation h2,
      .empty-state h3 {
        margin: 0;
      }

      .admin-auth-panel,
      .summary-panel,
      .attention-section,
      .conversation,
      .empty-state {
        background: var(--admin-panel);
        border: 1px solid var(--admin-border);
        border-radius: 0.45rem;
        padding: 1rem;
      }

      .admin-auth-panel {
        align-items: end;
        display: grid;
        gap: 1rem;
        grid-template-columns: minmax(0, 1fr) minmax(16rem, 24rem);
      }

      .admin-auth-panel p,
      .empty-state p {
        color: var(--admin-muted);
        line-height: 1.55;
        margin: 0.35rem 0 0;
      }

      label {
        display: grid;
        gap: 0.35rem;
        font-size: 0.85rem;
        font-weight: 800;
      }

      input {
        border: 1px solid var(--admin-border);
        border-radius: 0.35rem;
        font: inherit;
        padding: 0.65rem 0.75rem;
      }

      button {
        background: var(--admin-panel-raised);
        border: 0;
        border-radius: 0.35rem;
        color: var(--admin-text);
        cursor: pointer;
        font: inherit;
        font-weight: 800;
        min-height: 2.7rem;
        padding: 0 0.9rem;
      }

      button:disabled {
        cursor: progress;
        opacity: 0.6;
      }

      .counts {
        display: grid;
        gap: 0.75rem;
        grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
        margin-top: 0.85rem;
      }

      .count {
        border: 1px solid var(--admin-border);
        border-radius: 0.4rem;
        display: grid;
        gap: 0.2rem;
        padding: 0.85rem;
        text-align: center;
      }

      .count strong {
        font-size: 1.7rem;
      }

      .count span {
        color: var(--admin-muted);
        font-size: 0.75rem;
        font-weight: 800;
        text-transform: uppercase;
      }

      .count-urgent {
        background: var(--admin-panel-raised);
        border-color: var(--admin-border);
      }

      .count-today {
        background: #3c3221;
        border-color: var(--admin-border);
      }

      .count-week {
        background: var(--admin-panel-raised);
        border-color: var(--admin-border);
      }

      .financial {
        border-top: 1px solid var(--admin-border);
        margin-top: 1rem;
        padding-top: 0.85rem;
      }

      .facts {
        display: grid;
        gap: 0.4rem;
        list-style: none;
        margin: 0.5rem 0;
        padding: 0;
      }

      .facts li {
        display: flex;
        gap: 1rem;
        justify-content: space-between;
      }

      .facts span {
        color: var(--admin-muted);
      }

      .limitation {
        color: var(--admin-warning);
        font-size: 0.85rem;
        margin: 0.2rem 0 0;
      }

      .attention-section {
        display: grid;
        gap: 0.75rem;
      }

      .badge {
        background: var(--admin-panel-raised);
        border-radius: 999px;
        color: var(--admin-text);
        font-size: 0.8rem;
        font-weight: 800;
        min-width: 1.6rem;
        padding: 0.15rem 0.55rem;
        text-align: center;
      }

      .attention-item {
        border: 1px solid var(--admin-border);
        border-radius: 0.4rem;
        display: grid;
        gap: 0.4rem;
        padding: 0.85rem;
      }

      .attention-item header {
        align-items: center;
        display: flex;
        gap: 0.75rem;
        justify-content: space-between;
      }

      .attention-item h3 {
        font-size: 1rem;
        margin: 0;
      }

      .explanation {
        color: var(--admin-muted);
        line-height: 1.5;
        margin: 0;
      }

      .due {
        color: var(--admin-warning);
        font-size: 0.85rem;
        margin: 0;
      }

      .severity {
        border-radius: 999px;
        font-size: 0.72rem;
        font-weight: 900;
        padding: 0.2rem 0.6rem;
        text-transform: uppercase;
        white-space: nowrap;
      }

      .severity-urgent {
        background: var(--admin-panel-raised);
        color: var(--admin-danger);
      }

      .severity-today {
        background: #3c3221;
        color: var(--admin-warning);
      }

      .severity-this_week {
        background: var(--admin-panel-raised);
        color: var(--admin-muted);
      }

      .severity-informational {
        background: var(--admin-panel-raised);
        color: var(--admin-muted);
      }

      .link {
        color: var(--admin-text);
        font-weight: 800;
        text-decoration: underline;
      }

      .empty-note {
        color: var(--admin-muted);
        font-style: italic;
        margin: 0;
      }

      .conversation form {
        align-items: end;
        display: grid;
        gap: 0.75rem;
        grid-template-columns: minmax(0, 1fr) auto;
      }

      .state-error {
        color: var(--admin-danger);
        font-weight: 800;
      }

      .actions {
        align-items: center;
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
      }

      .prepare-button {
        background: #3c3221;
        color: var(--admin-text);
        min-height: 2.4rem;
      }

      @media (max-width: 860px) {
        .admin-shell,
        .admin-auth-panel,
        .conversation form {
          grid-template-columns: 1fr;
        }

        .admin-topbar,
        .summary-panel header,
        .attention-section header,
        .conversation header {
          align-items: start;
          flex-direction: column;
        }
      }
    `
  ]
})
export class AdminAssistantPageComponent implements OnInit {
  readonly i18n = inject(FundingI18nService);
  private readonly admin = inject(FundingAdminService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly params = toSignal(this.route.queryParamMap);
  private readonly destroy = inject(DestroyRef);
  private readonly platform = inject(PLATFORM_ID);
  readonly sponsorshipId = computed(
    () => this.params()?.get('sponsorshipId') || undefined
  );

  readonly adminToken = signal<string>('');
  readonly summary = signal<AdminAssistantSummary | null>(null);
  readonly summaryState = signal<'idle' | 'loading' | 'ready' | 'error'>(
    'idle'
  );

  readonly question = signal<string>('');
  readonly answer = signal<AdminAssistantQueryResponse | null>(null);
  readonly answerState = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  readonly answerError = signal<string>('');

  // Prepared drafts (iteration 2), keyed by attention-item id. Generation only:
  // these never persist, send or publish anything.
  readonly draftResponses = signal<
    Record<string, AdminAssistantPrepareResponse>
  >({});
  readonly draftStates = signal<Record<string, DraftState>>({});
  readonly draftErrors = signal<Record<string, string>>({});

  readonly sections = computed<readonly AttentionSection[]>(() => {
    const items = this.summary()?.attentionItems ?? [];
    return SECTION_ORDER.map((section) => ({
      type: section.type,
      title: this.i18n.t('admin.attention.types.' + section.type),
      items: items.filter((item) => item.type === section.type)
    }));
  });

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platform)) return;
    this.adminToken.set(this.admin.getSavedAdminToken());
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe((params) => {
        if (!params.get('sponsorshipId')) void this.loadSummary();
      });
  }

  async loadSummary(): Promise<void> {
    this.summaryState.set('loading');
    try {
      this.summary.set(await this.admin.getAssistantSummary(this.adminToken()));
      this.summaryState.set('ready');
      this.admin.saveAdminToken(this.adminToken());
    } catch {
      this.summaryState.set('error');
    }
  }

  async ask(event: Event): Promise<void> {
    event.preventDefault();
    const message = this.question().trim();
    if (!message) {
      return;
    }

    this.answerState.set('loading');
    this.answerError.set('');
    try {
      this.answer.set(
        await this.admin.queryAssistant(this.adminToken(), { message })
      );
      this.answerState.set('ready');
    } catch (error) {
      this.answerError.set(
        error instanceof Error
          ? error.message
          : this.i18n.t('admin.messages.la_demande_n_a_pas_pu_etre_traitee')
      );
      this.answerState.set('error');
    }
  }

  prepareAction(
    item: AdminAttentionItem
  ): AdminAttentionSuggestedAction | null {
    return (
      item.suggestedActions.find(
        (action) => action.executionMode === 'prepare'
      ) ?? null
    );
  }

  adminLink(url: string): UrlTree {
    return this.router.parseUrl(url);
  }

  navigateLabel(item: AdminAttentionItem): string {
    return (
      item.suggestedActions.find(
        (action) => action.executionMode === 'navigate'
      )?.label ?? this.i18n.t('admin.context.open')
    );
  }

  draftState(item: AdminAttentionItem): DraftState {
    return this.draftStates()[item.id] ?? 'idle';
  }

  draftError(item: AdminAttentionItem): string {
    return this.draftErrors()[item.id] ?? '';
  }

  draftFor(item: AdminAttentionItem): AdminAssistantPrepareResponse | null {
    return this.draftResponses()[item.id] ?? null;
  }

  async prepare(
    item: AdminAttentionItem,
    action: AdminAttentionSuggestedAction
  ): Promise<void> {
    const type = DRAFT_TYPE_BY_ACTION[action.actionType];
    if (!type) {
      return;
    }

    const referenceFact = item.facts['reference'];
    const reference =
      item.sponsorshipId ??
      item.publicationId ??
      (typeof referenceFact === 'string' ? referenceFact : undefined);

    this.setDraftState(item.id, 'loading');
    try {
      const result = await this.admin.prepareAssistantDraft(this.adminToken(), {
        type,
        reference
      });
      this.draftResponses.update((map) => ({ ...map, [item.id]: result }));
      this.setDraftState(item.id, 'ready');
    } catch (error) {
      this.draftErrors.update((map) => ({
        ...map,
        [item.id]:
          error instanceof Error
            ? error.message
            : this.i18n.t('admin.messages.la_preparation_du_brouillon_a_echoue')
      }));
      this.setDraftState(item.id, 'error');
    }
  }

  private setDraftState(id: string, state: DraftState): void {
    this.draftStates.update((map) => ({ ...map, [id]: state }));
  }

  setAdminToken(event: Event): void {
    this.adminToken.set(this.valueFromEvent(event));
    this.admin.saveAdminToken(this.adminToken());
  }

  setQuestion(event: Event): void {
    this.question.set(this.valueFromEvent(event));
  }

  severityLabel(severity: AdminAttentionSeverity): string {
    return this.i18n.t('admin.attention.priority.' + severity);
  }

  dateLabel(value: string | null | undefined): string {
    if (!value) {
      return this.i18n.t('admin.dashboard.notAvailable');
    }
    return new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value));
  }

  trackBySection(_: number, section: AttentionSection): string {
    return section.type;
  }

  trackByItem(_: number, item: AdminAttentionItem): string {
    return item.id;
  }

  private valueFromEvent(event: Event): string {
    return (event.target as HTMLInputElement | null)?.value ?? '';
  }
}
