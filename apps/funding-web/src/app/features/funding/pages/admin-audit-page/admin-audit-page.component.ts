import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal
} from '@angular/core';
import type { AdminAuditLogEntry, AdminAuditLogResponse } from '@openg7/funding-core';

import { AdminNavComponent } from '../../components/admin-nav/admin-nav.component.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';

@Component({
  selector: 'openg7-admin-audit-page',
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
            <h1>Audit</h1>
          </div>
          <button type="button" (click)="loadAuditLog()">Actualiser</button>
        </header>

        <section class="admin-auth-panel" aria-labelledby="admin-auth-title">
          <div>
            <h2 id="admin-auth-title">Acces admin</h2>
            <p>Les actions sensibles sont journalisees cote serveur.</p>
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

        <p class="state" *ngIf="state() === 'loading'">Chargement de l'audit...</p>
        <p class="state state-error" *ngIf="state() === 'error'">
          Impossible de charger le journal d'audit.
        </p>

        <section class="filters" aria-label="Filtres audit">
          <label>
            Recherche
            <input
              type="search"
              placeholder="Action, entite, resume..."
              [value]="search()"
              (input)="setSearch($event)"
            />
          </label>
        </section>

        <section class="audit-panel" aria-labelledby="audit-title">
          <header>
            <div>
              <span>{{ filteredEntries().length }} entree(s)</span>
              <h2 id="audit-title">Journal admin</h2>
            </div>
            <small>Mis a jour {{ dateLabel(response()?.last_updated_at ?? null) }}</small>
          </header>

          <div class="table-scroll" *ngIf="filteredEntries().length > 0">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Action</th>
                  <th>Entite</th>
                  <th>Resume</th>
                  <th>Acteur</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let entry of filteredEntries(); trackBy: trackByEntry">
                  <td>{{ dateLabel(entry.created_at) }}</td>
                  <td>{{ entry.action }}</td>
                  <td>{{ entityLabel(entry) }}</td>
                  <td>{{ entry.summary || 'Non fourni' }}</td>
                  <td>{{ entry.actor }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <article class="empty-state" *ngIf="state() === 'ready' && filteredEntries().length === 0">
            <h3>Aucune entree trouvee</h3>
            <p>Le journal se remplira lors des prochaines actions admin.</p>
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
        color: #667085;
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
      .empty-state p,
      .audit-panel small {
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

      .state-error {
        color: #9f1d2f;
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
    void this.loadAuditLog();
  }

  async loadAuditLog(): Promise<void> {
    this.state.set('loading');

    try {
      this.response.set(await this.admin.getAuditLog(this.adminToken()));
      this.state.set('ready');
      this.admin.saveAdminToken(this.adminToken());
    } catch {
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
      return 'Non disponible';
    }

    return new Intl.DateTimeFormat('fr-CA', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value));
  }

  private valueFromEvent(event: Event): string {
    return (event.target as HTMLInputElement | null)?.value ?? '';
  }
}
