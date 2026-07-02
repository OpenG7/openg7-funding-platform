import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'openg7-funding-header',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="builders-nav">
      <a class="builders-brand" routerLink="/" aria-label="Accueil Fonds des bâtisseurs OpenG7">
        <span class="brand-leaf" aria-hidden="true">◆</span>
        <span>
          <strong>Fonds des bâtisseurs</strong>
          <em>OpenG7</em>
        </span>
      </a>

      <nav aria-label="Navigation principale">
        <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Accueil</a>
        <a
          routerLink="/fonds-des-batisseurs/a-propos"
          routerLinkActive="active"
          [routerLinkActiveOptions]="{ exact: true }"
        >
          À propos
        </a>
        <a routerLink="/ecosystem" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">
          Écosystème
        </a>
        <a
          routerLink="/fonds-des-batisseurs/transparence"
          routerLinkActive="active"
          [routerLinkActiveOptions]="{ exact: true }"
        >
          Transparence
        </a>
        <a routerLink="/support" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Support</a>
      </nav>

      <a class="nav-contribute" routerLink="/" fragment="support">Soutenir OpenG7</a>
    </header>
  `
})
export class FundingHeaderComponent {}