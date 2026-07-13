import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { FundingAdminService } from '../../services/funding-admin.service.js';

@Component({
  selector: 'openg7-admin-login-page',
  standalone: true,
  imports: [CommonModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="admin-login-shell">
      <section class="admin-login-panel" aria-labelledby="admin-login-title">
        <header>
          <span>OpenG7</span>
          <h1 id="admin-login-title">Acces admin</h1>
          <p>
            Entrez le jeton admin configure cote serveur pour ouvrir une
            session temporaire.
          </p>
        </header>

        <form (submit)="$event.preventDefault(); signIn()">
          <label>
            Jeton admin
            <input
              type="password"
              autocomplete="off"
              autofocus
              required
              [value]="token()"
              (input)="setToken($event)"
            />
          </label>

          <button type="submit" [disabled]="state() === 'loading'">
            {{ state() === 'loading' ? 'Connexion...' : 'Se connecter' }}
          </button>
        </form>

        <p class="state state-error" *ngIf="state() === 'error'">
          Connexion refusee. Verifiez le jeton admin et la configuration API.
        </p>

        <a routerLink="/fonds-des-batisseurs">Retour au fonds</a>
      </section>
    </main>
  `,
  styles: [
    `
      .admin-login-shell {
        align-items: center;
        background: #f5f7fb;
        color: #172033;
        display: grid;
        font-family: 'Trebuchet MS', Arial, sans-serif;
        min-height: 100vh;
        padding: 1rem;
      }

      .admin-login-panel {
        background: #fff;
        border: 1px solid #d9e0ea;
        border-radius: 0.5rem;
        box-shadow: 0 1rem 2.5rem rgb(15 23 42 / 10%);
        display: grid;
        gap: 1rem;
        margin: 0 auto;
        max-width: 28rem;
        padding: clamp(1.25rem, 4vw, 2rem);
        width: 100%;
      }

      .admin-login-panel span {
        color: #667085;
        font-size: 0.78rem;
        font-weight: 900;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      .admin-login-panel h1 {
        font-family: Georgia, 'Times New Roman', serif;
        font-size: clamp(2rem, 6vw, 3rem);
        line-height: 1;
        margin: 0.35rem 0 0.65rem;
      }

      .admin-login-panel p {
        color: #526070;
        line-height: 1.55;
        margin: 0;
      }

      .admin-login-panel form,
      .admin-login-panel label {
        display: grid;
        gap: 0.65rem;
      }

      .admin-login-panel label {
        font-size: 0.9rem;
        font-weight: 800;
      }

      .admin-login-panel input,
      .admin-login-panel button {
        border-radius: 0.35rem;
        font: inherit;
        min-height: 2.9rem;
      }

      .admin-login-panel input {
        border: 1px solid #cdd6e3;
        padding: 0.65rem 0.75rem;
      }

      .admin-login-panel button {
        background: #172033;
        border: 0;
        color: #fff;
        cursor: pointer;
        font-weight: 900;
        padding: 0 1rem;
      }

      .admin-login-panel button:disabled {
        cursor: wait;
        opacity: 0.65;
      }

      .admin-login-panel a {
        color: #254db8;
        font-weight: 800;
        text-decoration: none;
      }

      .state-error {
        background: #fff0f2;
        border: 1px solid #f1a8b4;
        border-radius: 0.35rem;
        color: #9f1d2f;
        font-weight: 800;
        padding: 0.75rem 0.85rem;
      }
    `
  ]
})
export class AdminLoginPageComponent implements OnInit {
  private readonly admin = inject(FundingAdminService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly token = signal<string>('');
  readonly state = signal<'idle' | 'loading' | 'error'>('idle');

  ngOnInit(): void {
    if (this.admin.hasValidAdminSession()) {
      void this.router.navigateByUrl(this.returnUrl());
    }
  }

  async signIn(): Promise<void> {
    const token = this.token().trim();
    if (!token) {
      this.state.set('error');
      return;
    }

    this.state.set('loading');
    try {
      await this.admin.signIn(token);
      await this.router.navigateByUrl(this.returnUrl());
    } catch {
      this.state.set('error');
    }
  }

  setToken(event: Event): void {
    this.token.set((event.target as HTMLInputElement | null)?.value ?? '');
  }

  private returnUrl(): string {
    const candidate =
      this.route.snapshot.queryParamMap.get('returnUrl') ?? '/admin/fundraiser';

    if (
      candidate === '/admin/fundraiser' ||
      candidate.startsWith('/admin/fundraiser/')
    ) {
      return candidate;
    }

    return '/admin/fundraiser';
  }
}
