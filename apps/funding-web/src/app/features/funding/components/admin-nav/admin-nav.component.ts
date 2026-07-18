import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

import { FundingAdminService } from '../../services/funding-admin.service.js';

@Component({
  selector: 'openg7-admin-nav',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside class="admin-nav" aria-label="Navigation admin fonds">
      <header class="admin-brand">
        <span class="brand-mark" aria-hidden="true">G7</span>
        <span class="brand-copy">
          <strong>Open G7</strong>
          <small>Fonds des batisseurs</small>
        </span>
      </header>

      <nav>
        <a
          routerLink="/admin/fundraiser"
          routerLinkActive="active"
          [routerLinkActiveOptions]="{ exact: true }"
        >
          <span aria-hidden="true">TB</span>
          Tableau de bord
        </a>
        <a
          routerLink="/admin/fundraiser/contributions"
          routerLinkActive="active"
        >
          <span aria-hidden="true">$</span>
          Contributions
        </a>
        <a routerLink="/admin/fundraiser/sponsors" routerLinkActive="active">
          <span aria-hidden="true">CO</span>
          Commandites
        </a>
        <a routerLink="/admin/fundraiser/invoices" routerLinkActive="active">
          <span aria-hidden="true">FA</span>
          Factures
        </a>
        <a
          routerLink="/admin/fundraiser/publications"
          routerLinkActive="active"
        >
          <span aria-hidden="true">PU</span>
          Publications
        </a>
        <a routerLink="/admin/fundraiser/expenses" routerLinkActive="active">
          <span aria-hidden="true">DE</span>
          Depenses
        </a>
        <a
          routerLink="/admin/fundraiser/transparency"
          routerLinkActive="active"
        >
          <span aria-hidden="true">TR</span>
          Transparence
        </a>
        <a routerLink="/admin/fundraiser/audit" routerLinkActive="active">
          <span aria-hidden="true">AU</span>
          Audit
        </a>
        <a routerLink="/admin/fundraiser/setup" routerLinkActive="active">
          <span aria-hidden="true">CF</span>
          Configuration
        </a>
      </nav>

      <footer>
        <button type="button" (click)="clearSession()">
          <span aria-hidden="true">DX</span>
          Deconnexion
        </button>
        <a routerLink="/fonds-des-batisseurs">
          <span aria-hidden="true">OP</span>
          Retour public
        </a>
      </footer>
    </aside>
  `,
  styles: [
    `
      .admin-nav {
        background: linear-gradient(180deg, #101827 0%, #172033 100%);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 0.5rem;
        box-shadow: 0 1rem 2rem rgba(16, 24, 39, 0.15);
        color: #fff;
        display: grid;
        gap: 1.25rem;
        grid-template-rows: auto 1fr auto;
        min-height: calc(100vh - 2.5rem);
        padding: 1.1rem;
        position: sticky;
        top: 1.25rem;
      }

      .admin-nav nav,
      .admin-nav footer {
        display: grid;
        gap: 0.45rem;
      }

      .admin-brand {
        align-items: center;
        border-bottom: 1px solid rgba(255, 255, 255, 0.12);
        display: grid;
        gap: 0.7rem;
        grid-template-columns: auto minmax(0, 1fr);
        padding-bottom: 1rem;
      }

      .brand-mark {
        align-items: center;
        background: #b98224;
        border-radius: 999px;
        color: #101827;
        display: inline-flex;
        font-size: 0.78rem;
        font-weight: 900;
        height: 2.45rem;
        justify-content: center;
        width: 2.45rem;
      }

      .brand-copy {
        display: grid;
        gap: 0.1rem;
        min-width: 0;
      }

      .admin-nav small {
        color: #c8d2e2;
        font-size: 0.72rem;
        font-weight: 900;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      .admin-nav strong {
        font-size: 1.2rem;
        line-height: 1.05;
      }

      .admin-nav a,
      .admin-nav button {
        align-items: center;
        border-radius: 0.35rem;
        display: grid;
        gap: 0.65rem;
        grid-template-columns: auto minmax(0, 1fr);
        min-height: 2.8rem;
      }

      .admin-nav a {
        color: #d9e4f5;
        font-weight: 800;
        padding: 0 0.75rem;
        text-decoration: none;
      }

      .admin-nav button {
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.14);
        color: #fff;
        cursor: pointer;
        font: inherit;
        font-weight: 800;
        padding: 0 0.75rem;
        text-align: left;
      }

      .admin-nav a span,
      .admin-nav button span {
        align-items: center;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 0.3rem;
        color: #c8d2e2;
        display: inline-flex;
        font-size: 0.68rem;
        font-weight: 900;
        height: 1.45rem;
        justify-content: center;
        width: 1.45rem;
      }

      .admin-nav a.active,
      .admin-nav a:hover,
      .admin-nav button:hover {
        background: rgba(184, 130, 36, 0.18);
        color: #fff;
      }

      .admin-nav a.active {
        box-shadow: inset 0.2rem 0 0 #b98224;
      }

      .admin-nav a.active span,
      .admin-nav a:hover span,
      .admin-nav button:hover span {
        background: #b98224;
        color: #101827;
      }

      .admin-nav footer a {
        background: rgba(255, 255, 255, 0.06);
      }

      @media (max-width: 860px) {
        .admin-nav {
          min-height: auto;
          position: static;
        }

        .admin-nav nav {
          grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
        }

        .admin-nav a,
        .admin-nav button {
          grid-template-columns: 1fr;
          justify-items: center;
          padding: 0.55rem;
          text-align: center;
        }
      }
    `
  ]
})
export class AdminNavComponent {
  private readonly admin = inject(FundingAdminService);

  clearSession(): void {
    this.admin.clearAdminSession();

    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  }
}
