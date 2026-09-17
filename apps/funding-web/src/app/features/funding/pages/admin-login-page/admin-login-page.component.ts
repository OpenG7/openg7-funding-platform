import { TranslatePipe } from '@ngx-translate/core';
import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';

@Component({
  selector: 'openg7-admin-login-page',
  standalone: true,
  imports: [TranslatePipe, CommonModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="admin-login-shell">
      <section class="admin-login-panel" aria-labelledby="admin-login-title">
        <header>
          <span>OpenG7</span>
          <button
            type="button"
            (click)="i18n.toggleLanguage()"
            [attr.aria-label]="
              (i18n.currentLanguage() === 'fr-CA'
                ? 'admin.shell.toEnglish'
                : 'admin.shell.toFrench'
              ) | translate
            "
          >
            {{ i18n.currentLanguage() === 'fr-CA' ? 'EN' : 'FR' }}
          </button>
          <h1 id="admin-login-title">
            {{ 'admin.legacy.acces_admin' | translate }}
          </h1>
          <p>
            {{
              'admin.legacy.entrez_le_jeton_admin_configure_cote_serveur_pour_ouvrir_une_sess'
                | translate
            }}
          </p>
        </header>

        <form (submit)="$event.preventDefault(); signIn()">
          <label>
            {{ 'admin.legacy.jeton_admin' | translate }}
            <input
              type="password"
              autocomplete="current-password"
              [value]="token()"
              (input)="setToken($event)"
              required
            />
          </label>

          <button type="submit" [disabled]="state() === 'loading'">
            {{
              state() === 'loading'
                ? ('admin.legacy.connexion' | translate)
                : ('admin.legacy.se_connecter' | translate)
            }}
          </button>
        </form>

        <p class="state state-error" *ngIf="state() === 'error'">
          {{
            'admin.legacy.connexion_refusee_verifiez_le_jeton_admin_et_la_configuration_api'
              | translate
          }}
        </p>

        <a routerLink="/fonds-des-batisseurs">{{
          'admin.legacy.retour_au_fonds' | translate
        }}</a>
      </section>
    </main>
  `,
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-forms.css'
  ],
  styles: [
    `
      .admin-login-shell {
        align-items: center;
        background: var(--admin-panel-raised);
        color: var(--admin-text);
        display: grid;
        font-family: inherit;
        min-height: 100vh;
        padding: 1rem;
      }

      .admin-login-panel {
        background: var(--admin-panel);
        border: 1px solid var(--admin-border);
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
        color: var(--admin-muted);
        font-size: 0.78rem;
        font-weight: 900;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      .admin-login-panel h1 {
        font-family: inherit;
        font-size: clamp(2rem, 6vw, 3rem);
        line-height: 1;
        margin: 0.35rem 0 0.65rem;
      }

      .admin-login-panel p {
        color: var(--admin-muted);
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
        border: 1px solid var(--admin-border);
        padding: 0.65rem 0.75rem;
      }

      .admin-login-panel button {
        background: var(--admin-panel-raised);
        border: 0;
        color: var(--admin-text);
        cursor: pointer;
        font-weight: 900;
        padding: 0 1rem;
      }

      .admin-login-panel button:disabled {
        cursor: wait;
        opacity: 0.65;
      }

      .admin-login-panel a {
        color: var(--admin-muted);
        font-weight: 800;
        text-decoration: none;
      }

      .state-error {
        background: var(--admin-panel-raised);
        border: 1px solid var(--admin-border);
        border-radius: 0.35rem;
        color: var(--admin-danger);
        font-weight: 800;
        padding: 0.75rem 0.85rem;
      }
    `
  ]
})
export class AdminLoginPageComponent implements OnInit {
  readonly i18n = inject(FundingI18nService);
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
