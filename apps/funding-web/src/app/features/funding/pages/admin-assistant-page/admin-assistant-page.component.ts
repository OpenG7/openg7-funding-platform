import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type {
  AdminAssistantAnswerBlock,
  AdminAssistantDraftType,
  AdminAssistantPrepareResponse,
  AdminAssistantQueryResponse,
  AdminAssistantSummary,
  AdminAttentionItem,
  AdminAttentionItemType,
  AdminAttentionSeverity,
  AdminAttentionSuggestedAction
} from '@openg7/funding-core';

import { AdminNavComponent } from '../../components/admin-nav/admin-nav.component.js';
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

const SEVERITY_LABELS: Record<AdminAttentionSeverity, string> = {
  urgent: 'Urgent',
  today: "Aujourd'hui",
  this_week: 'Cette semaine',
  informational: 'Information'
};

const ANSWER_BLOCK_LABELS: Record<AdminAssistantAnswerBlock['kind'], string> = {
  facts: 'Faits (issus des outils)',
  interpretation: 'Interprétation',
  recommendation: 'Recommandation',
  data_unavailable: 'Donnée indisponible'
};

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
  imports: [CommonModule, RouterLink, AdminNavComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="admin-shell">
      <openg7-admin-nav />

      <section class="admin-content">
        <header class="admin-topbar">
          <div>
            <span>Administration</span>
            <h1>Assistant</h1>
          </div>
          <button type="button" (click)="loadSummary()">Actualiser</button>
        </header>

        <section class="admin-auth-panel" aria-labelledby="admin-auth-title">
          <div>
            <h2 id="admin-auth-title">
              Copilote opérationnel en lecture seule
            </h2>
            <p>
              L'assistant détecte et explique ce qui demande votre attention. Il
              ne peut ni approuver, ni rembourser, ni publier, ni modifier une
              donnée.
            </p>
          </div>
          <label>
            Jeton admin
            <input
              type="password"
              autocomplete="off"
              [value]="adminToken()"
              (input)="setAdminToken($event)"
            />
          </label>
        </section>

        <p class="state" *ngIf="summaryState() === 'loading'">
          Chargement du résumé...
        </p>
        <p class="state state-error" *ngIf="summaryState() === 'error'">
          Impossible de charger le résumé de l'assistant.
        </p>

        <section
          class="summary-panel"
          *ngIf="summary() as data"
          aria-labelledby="summary-title"
        >
          <header>
            <div>
              <span>Priorités</span>
              <h2 id="summary-title">Que faut-il traiter?</h2>
            </div>
            <small>Généré {{ dateLabel(data.generatedAt) }}</small>
          </header>

          <div class="counts">
            <article class="count count-urgent">
              <strong>{{ data.counts.urgent }}</strong>
              <span>Urgent</span>
            </article>
            <article class="count count-today">
              <strong>{{ data.counts.today }}</strong>
              <span>Aujourd'hui</span>
            </article>
            <article class="count count-week">
              <strong>{{ data.counts.thisWeek }}</strong>
              <span>Cette semaine</span>
            </article>
            <article class="count count-info">
              <strong>{{ data.counts.informational }}</strong>
              <span>Information</span>
            </article>
          </div>

          <article
            class="empty-state calm"
            *ngIf="data.attentionItems.length === 0"
          >
            <h3>Aucune action urgente</h3>
            <p>Rien ne demande votre attention immédiate pour le moment.</p>
          </article>

          <section
            class="financial"
            *ngIf="data.financialSummary as financial"
            aria-label="Résumé financier"
          >
            <h3>Résumé financier prudent</h3>
            <ul class="facts">
              <li>
                <span>Montant brut payé</span>
                <strong
                  >{{ financial.grossPaid }} {{ financial.currency }}</strong
                >
              </li>
              <li>
                <span>Remboursements</span>
                <strong
                  >{{ financial.refunded }} {{ financial.currency }}</strong
                >
              </li>
              <li>
                <span>Montant net estimé</span>
                <strong>{{
                  financial.netReceived === null
                    ? 'Données incomplètes'
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
            Aucun élément.
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
              Échéance : {{ dateLabel(item.dueAt) }}
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
                    ? 'Préparation...'
                    : action.label
                }}
              </button>
              <a *ngIf="item.adminUrl as url" class="link" [routerLink]="url">
                {{ navigateLabel(item) }}
              </a>
            </div>

            <p class="state-error" *ngIf="draftState(item) === 'error'">
              {{ draftError(item) }}
            </p>

            <aside
              class="draft"
              *ngIf="draftFor(item) as prepared"
              aria-label="Brouillon préparé"
            >
              <p class="draft-notice" *ngIf="prepared.status !== 'ok'">
                {{ prepared.message }}
              </p>

              <ng-container *ngIf="prepared.draft as draft">
                <header>
                  <h4>{{ draft.title }}</h4>
                  <span class="draft-flag">Non envoyé · non publié</span>
                </header>
                <dl class="draft-fields" *ngIf="draft.fields.length > 0">
                  <ng-container *ngFor="let field of draft.fields">
                    <dt>{{ field.label }}</dt>
                    <dd>{{ field.value }}</dd>
                  </ng-container>
                </dl>
                <p class="draft-line" *ngFor="let line of draft.bodyLines">
                  {{ line }}
                </p>
                <p class="draft-notice">{{ draft.notice }}</p>
                <p
                  class="limitation"
                  *ngFor="let limitation of draft.limitations"
                >
                  {{ limitation }}
                </p>
                <a class="link" [routerLink]="draft.adminUrl">
                  Ouvrir l'écran pour agir
                </a>
              </ng-container>
            </aside>
          </article>
        </section>

        <section class="conversation" aria-labelledby="conversation-title">
          <header>
            <h2 id="conversation-title">Poser une question</h2>
            <small>
              L'assistant répond à partir d'outils en lecture seule et n'exécute
              aucune action.
            </small>
          </header>

          <form (submit)="ask($event)">
            <label>
              Question
              <input
                type="text"
                name="assistant-question"
                placeholder="Quelles commandites dois-je traiter aujourd'hui?"
                [value]="question()"
                (input)="setQuestion($event)"
              />
            </label>
            <button type="submit" [disabled]="answerState() === 'loading'">
              {{ answerState() === 'loading' ? 'En cours...' : 'Demander' }}
            </button>
          </form>

          <p class="state state-error" *ngIf="answerState() === 'error'">
            {{ answerError() }}
          </p>

          <article class="answer" *ngIf="answer() as reply">
            <p class="answer-status" [class]="'answer-status-' + reply.status">
              {{ statusLabel(reply.status) }}
            </p>

            <section
              class="answer-block"
              *ngFor="let block of reply.answer; trackBy: trackByBlock"
            >
              <h4>{{ blockLabel(block.kind) }}</h4>
              <ul>
                <li *ngFor="let line of block.lines">{{ line }}</li>
              </ul>
            </section>

            <nav class="answer-links" *ngIf="reply.links.length > 0">
              <a
                *ngFor="let link of reply.links"
                class="link"
                [routerLink]="link.adminUrl"
              >
                {{ link.label }}
              </a>
            </nav>

            <ul class="limitations" *ngIf="reply.limitations.length > 0">
              <li *ngFor="let limitation of reply.limitations">
                {{ limitation }}
              </li>
            </ul>
          </article>
        </section>
      </section>
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
        color: #667085;
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
        background: #fff;
        border: 1px solid #d9e0ea;
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
        color: #526070;
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
        border: 1px solid #cdd6e3;
        border-radius: 0.35rem;
        font: inherit;
        padding: 0.65rem 0.75rem;
      }

      button {
        background: #18233a;
        border: 0;
        border-radius: 0.35rem;
        color: #fff;
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
        border: 1px solid #e4e9f2;
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
        color: #667085;
        font-size: 0.75rem;
        font-weight: 800;
        text-transform: uppercase;
      }

      .count-urgent {
        background: #fdecec;
        border-color: #f4c4c4;
      }

      .count-today {
        background: #fff4e5;
        border-color: #f4dcae;
      }

      .count-week {
        background: #eef4ff;
        border-color: #cad9f5;
      }

      .financial {
        border-top: 1px solid #e4e9f2;
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
        color: #526070;
      }

      .limitation {
        color: #7a5a12;
        font-size: 0.85rem;
        margin: 0.2rem 0 0;
      }

      .attention-section {
        display: grid;
        gap: 0.75rem;
      }

      .badge {
        background: #18233a;
        border-radius: 999px;
        color: #fff;
        font-size: 0.8rem;
        font-weight: 800;
        min-width: 1.6rem;
        padding: 0.15rem 0.55rem;
        text-align: center;
      }

      .attention-item {
        border: 1px solid #e4e9f2;
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
        color: #384457;
        line-height: 1.5;
        margin: 0;
      }

      .due {
        color: #7a5a12;
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
        background: #fdecec;
        color: #9f1d2f;
      }

      .severity-today {
        background: #fff4e5;
        color: #8a5a00;
      }

      .severity-this_week {
        background: #eef4ff;
        color: #23508f;
      }

      .severity-informational {
        background: #eef1f6;
        color: #4a5568;
      }

      .link {
        color: #18233a;
        font-weight: 800;
        text-decoration: underline;
      }

      .empty-note {
        color: #667085;
        font-style: italic;
        margin: 0;
      }

      .conversation form {
        align-items: end;
        display: grid;
        gap: 0.75rem;
        grid-template-columns: minmax(0, 1fr) auto;
      }

      .answer {
        border-top: 1px solid #e4e9f2;
        display: grid;
        gap: 0.75rem;
        margin-top: 1rem;
        padding-top: 0.85rem;
      }

      .answer-status {
        font-weight: 800;
        margin: 0;
      }

      .answer-status-timeout,
      .answer-status-provider_error {
        color: #9f1d2f;
      }

      .answer-block h4 {
        margin: 0 0 0.3rem;
      }

      .answer-block ul,
      .limitations {
        color: #384457;
        line-height: 1.5;
        margin: 0;
        padding-left: 1.1rem;
      }

      .limitations {
        color: #667085;
        font-size: 0.85rem;
      }

      .answer-links {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
      }

      .state-error {
        color: #9f1d2f;
        font-weight: 800;
      }

      .actions {
        align-items: center;
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
      }

      .prepare-button {
        background: #b98224;
        color: #101827;
        min-height: 2.4rem;
      }

      .draft {
        background: #fbf7ee;
        border: 1px solid #e6d5ab;
        border-radius: 0.4rem;
        display: grid;
        gap: 0.5rem;
        margin-top: 0.6rem;
        padding: 0.85rem;
      }

      .draft header {
        align-items: center;
        display: flex;
        gap: 0.75rem;
        justify-content: space-between;
      }

      .draft h4 {
        margin: 0;
      }

      .draft-flag {
        background: #9f1d2f;
        border-radius: 999px;
        color: #fff;
        font-size: 0.7rem;
        font-weight: 900;
        padding: 0.2rem 0.6rem;
        text-transform: uppercase;
        white-space: nowrap;
      }

      .draft-fields {
        display: grid;
        gap: 0.2rem 0.75rem;
        grid-template-columns: auto minmax(0, 1fr);
        margin: 0;
      }

      .draft-fields dt {
        color: #7a5a12;
        font-weight: 800;
      }

      .draft-fields dd {
        margin: 0;
        overflow-wrap: anywhere;
      }

      .draft-line {
        line-height: 1.5;
        margin: 0;
        white-space: pre-wrap;
      }

      .draft-notice {
        color: #7a5a12;
        font-weight: 800;
        margin: 0;
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
  private readonly admin = inject(FundingAdminService);

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
      title: section.title,
      items: items.filter((item) => item.type === section.type)
    }));
  });

  ngOnInit(): void {
    this.adminToken.set(this.admin.getSavedAdminToken());
    void this.loadSummary();
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
          : "La demande n'a pas pu être traitée."
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

  navigateLabel(item: AdminAttentionItem): string {
    return (
      item.suggestedActions.find(
        (action) => action.executionMode === 'navigate'
      )?.label ?? 'Ouvrir le dossier'
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
            : 'La préparation du brouillon a échoué.'
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
    return SEVERITY_LABELS[severity];
  }

  blockLabel(kind: AdminAssistantAnswerBlock['kind']): string {
    return ANSWER_BLOCK_LABELS[kind];
  }

  statusLabel(status: AdminAssistantQueryResponse['status']): string {
    switch (status) {
      case 'ok':
        return 'Réponse fondée sur les outils.';
      case 'assistant_disabled':
        return 'Assistant conversationnel désactivé.';
      case 'provider_not_configured':
        return 'Modèle non configuré.';
      case 'no_results':
        return 'Aucun résultat pour cette question.';
      case 'timeout':
        return 'Délai dépassé.';
      case 'provider_error':
        return 'Erreur du fournisseur.';
      default:
        return status;
    }
  }

  dateLabel(value: string | null | undefined): string {
    if (!value) {
      return 'Non disponible';
    }
    return new Intl.DateTimeFormat('fr-CA', {
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

  trackByBlock(index: number, block: AdminAssistantAnswerBlock): string {
    return `${block.kind}-${index}`;
  }

  private valueFromEvent(event: Event): string {
    return (event.target as HTMLInputElement | null)?.value ?? '';
  }
}
