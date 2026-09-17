import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
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
  AdminAuditLogEntry,
  AdminAuditLogResponse
} from '@openg7/funding-core';

import { AdminInspectionService } from '../../services/admin-inspection.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminLayoutComponent } from '../../components/admin-layout/admin-layout.component.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';

@Component({
  selector: 'openg7-admin-audit-page',
  standalone: true,
  imports: [TranslatePipe, CommonModule, AdminLayoutComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <openg7-admin-layout>
      <section class="admin-content">
        <header class="admin-topbar">
          <div>
            <span>{{ 'admin.legacy.administration' | translate }}</span>
            <h1>{{ 'admin.legacy.audit' | translate }}</h1>
          </div>
          <button type="button" (click)="loadAuditLog()">
            {{ 'admin.legacy.actualiser' | translate }}
          </button>
        </header>

        <p class="state" *ngIf="state() === 'loading'">
          {{ 'admin.legacy.chargement_de_l_audit' | translate }}
        </p>
        <p class="state state-error" *ngIf="state() === 'error'">
          {{
            'admin.legacy.impossible_de_charger_le_journal_d_audit' | translate
          }}
        </p>

        <section
          class="filters"
          [attr.aria-label]="'admin.legacy.filtres_audit' | translate"
        >
          <label>
            {{ 'admin.legacy.recherche' | translate
            }}<input
              type="search"
              [attr.placeholder]="
                'admin.legacy.action_entite_resume' | translate
              "
              [value]="search()"
              (input)="setSearch($event)"
            />
          </label>
        </section>

        <section class="audit-panel" aria-labelledby="audit-title">
          <header>
            <div>
              <span>{{
                'admin.legacy.p0_entree_s'
                  | translate: { p0: filteredEntries().length }
              }}</span>
              <h2 id="audit-title">
                {{ 'admin.legacy.journal_admin' | translate }}
              </h2>
            </div>
            <small>{{
              'admin.legacy.mis_a_jour_p0'
                | translate
                  : { p0: dateLabel(response()?.last_updated_at ?? null) }
            }}</small>
          </header>

          <div class="table-scroll" *ngIf="filteredEntries().length > 0">
            <table>
              <thead>
                <tr>
                  <th>{{ 'admin.legacy.date' | translate }}</th>
                  <th>{{ 'admin.legacy.action' | translate }}</th>
                  <th>{{ 'admin.legacy.entite' | translate }}</th>
                  <th>{{ 'admin.legacy.resume' | translate }}</th>
                  <th>{{ 'admin.legacy.acteur' | translate }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  *ngFor="let entry of filteredEntries(); trackBy: trackByEntry"
                >
                  <td>{{ dateLabel(entry.created_at) }}</td>
                  <td>
                    <button type="button" (click)="inspection.audit(entry)">
                      {{ entry.action }}
                    </button>
                  </td>
                  <td>{{ entityLabel(entry) }}</td>
                  <td>
                    {{
                      entry.summary || ('admin.legacy.non_fourni' | translate)
                    }}
                  </td>
                  <td>{{ entry.actor }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <article
            class="empty-state"
            *ngIf="state() === 'ready' && filteredEntries().length === 0"
          >
            <h3>{{ 'admin.legacy.aucune_entree_trouvee' | translate }}</h3>
            <p>
              {{
                'admin.legacy.le_journal_se_remplira_lors_des_prochaines_actions_admin'
                  | translate
              }}
            </p>
          </article>
        </section>
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
      .admin-content {
        display: grid;
        gap: 1rem;
        min-width: 0;
      }

      .admin-topbar,
      .admin-auth-panel,
      .filters,
      .audit-panel,
      .state {
        margin: 0 auto;
        max-width: 78rem;
        width: 100%;
      }

      .admin-topbar,
      .audit-panel header {
        align-items: center;
        display: flex;
        gap: 1rem;
        justify-content: space-between;
      }

      .admin-topbar span,
      .audit-panel span {
        color: var(--admin-muted);
        font-size: 0.78rem;
        font-weight: 800;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      .admin-topbar h1,
      .admin-auth-panel h2,
      .audit-panel h2,
      .empty-state h3 {
        margin: 0;
      }

      .admin-auth-panel,
      .filters,
      .audit-panel,
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
      .empty-state p,
      .audit-panel small {
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

      .audit-panel {
        display: grid;
        gap: 0.85rem;
      }

      .table-scroll {
        overflow-x: auto;
      }

      table {
        border-collapse: collapse;
        min-width: 62rem;
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

      .state-error {
        color: var(--admin-danger);
        font-weight: 800;
      }

      @media (max-width: 860px) {
        .admin-shell,
        .admin-auth-panel {
          grid-template-columns: 1fr;
        }

        .admin-topbar,
        .audit-panel header {
          align-items: start;
          flex-direction: column;
        }
      }
    `
  ]
})
export class AdminAuditPageComponent implements OnInit {
  readonly i18n = inject(FundingI18nService);
  private readonly destroyRef = inject(DestroyRef);
  private requestGeneration = 0;
  private exactId: string | undefined;
  private readonly route = inject(ActivatedRoute);

  readonly inspection = inject(AdminInspectionService);
  private readonly admin = inject(FundingAdminService);

  readonly adminToken = signal<string>('');
  readonly response = signal<AdminAuditLogResponse | null>(null);
  readonly state = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  readonly search = signal<string>('');
  readonly entries = computed(() => this.response()?.entries ?? []);
  readonly filteredEntries = computed(() => {
    const search = this.search().trim().toLowerCase();

    if (!search) {
      return this.entries();
    }

    return this.entries().filter((entry) =>
      [
        entry.action,
        entry.entity_type,
        entry.entity_id,
        entry.summary,
        entry.actor
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(search)
    );
  });

  ngOnInit(): void {
    this.adminToken.set(this.admin.getSavedAdminToken());
    this.destroyRef.onDestroy(() => {
      this.requestGeneration++;
    });
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        this.exactId = params.get('entryId') ?? undefined;
        this.response.set(null);
        this.search.set('');

        void this.loadAuditLog();
      });
  }

  async loadAuditLog(): Promise<void> {
    const generation = ++this.requestGeneration;
    this.state.set('loading');

    try {
      const result = await this.admin.getAuditLog(
        this.adminToken(),
        this.exactId
      );
      if (generation !== this.requestGeneration) return;
      this.response.set(result);
      this.state.set('ready');
      this.admin.saveAdminToken(this.adminToken());
    } catch {
      if (generation !== this.requestGeneration) return;
      this.state.set('error');
    }
  }

  setAdminToken(event: Event): void {
    this.adminToken.set(this.valueFromEvent(event));
    this.admin.saveAdminToken(this.adminToken());
  }

  setSearch(event: Event): void {
    this.search.set(this.valueFromEvent(event));
  }

  trackByEntry(_: number, entry: AdminAuditLogEntry): string {
    return entry.id;
  }

  entityLabel(entry: AdminAuditLogEntry): string {
    return entry.entity_id
      ? `${entry.entity_type} ${entry.entity_id}`
      : entry.entity_type;
  }

  dateLabel(value: string | null): string {
    if (!value) {
      return this.i18n.t('admin.dashboard.notAvailable');
    }

    return new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value));
  }

  private valueFromEvent(event: Event): string {
    return (event.target as HTMLInputElement | null)?.value ?? '';
  }
}
