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
      <header>
        <span>OpenG7</span>
        <strong>Admin Fonds</strong>
      </header>

      <nav>
        <a
          routerLink="/admin/fundraiser"
          routerLinkActive="active"
          [routerLinkActiveOptions]="{ exact: true }"
        >
          Dashboard
        </a>
        <a
          routerLink="/admin/fundraiser/contributions"
          routerLinkActive="active"
        >
          Contributions
        </a>
        <a routerLink="/admin/fundraiser/sponsors" routerLinkActive="active">
          Commandites
        </a>
        <a
          routerLink="/admin/fundraiser/publications"
          routerLinkActive="active"
        >
          Publications
        </a>
        <a routerLink="/admin/fundraiser/expenses" routerLinkActive="active">
          Depenses
        </a>
        <a
          routerLink="/admin/fundraiser/transparency"
          routerLinkActive="active"
        >
          Transparence
        </a>
        <a routerLink="/admin/fundraiser/audit" routerLinkActive="active">
          Audit
        </a>
      </nav>

      <footer>
        <button type="button" (click)="clearSession()">Deconnexion</button>
        <a routerLink="/fonds-des-batisseurs">Retour public</a>
      </footer>
    </aside>
  `,
  styles: [
    `
      .admin-nav {
        background: #172033;
        border-radius: 0.45rem;
        color: #fff;
        display: grid;
        gap: 1rem;
        grid-template-rows: auto 1fr auto;
        min-height: calc(100vh - 2.5rem);
        padding: 1rem;
        position: sticky;
        top: 1.25rem;
      }

      .admin-nav header,
      .admin-nav nav,
      .admin-nav footer {
        display: grid;
        gap: 0.55rem;
      }

      .admin-nav span {
        color: #aeb9ca;
        font-size: 0.72rem;
        font-weight: 900;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      .admin-nav strong {
        font-size: 1.15rem;
      }

      .admin-nav a {
        border-radius: 0.35rem;
        color: #dbe5f5;
        font-weight: 800;
        padding: 0.75rem 0.85rem;
        text-decoration: none;
      }

      .admin-nav button {
        background: #101827;
        border: 1px solid #52627a;
        border-radius: 0.35rem;
        color: #fff;
        cursor: pointer;
        font: inherit;
        font-weight: 800;
        padding: 0.75rem 0.85rem;
        text-align: left;
      }

      .admin-nav a.active,
      .admin-nav a:hover,
      .admin-nav button:hover {
        background: #254db8;
        color: #fff;
      }

      .admin-nav footer a {
        background: #243047;
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
