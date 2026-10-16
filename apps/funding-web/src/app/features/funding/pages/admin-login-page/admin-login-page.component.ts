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
          @if (mode() === 'token') {
            <p>
              {{
                'admin.legacy.entrez_le_jeton_admin_configure_cote_serveur_pour_ouvrir_une_sess'
                  | translate
              }}
            </p>
          }
        </header>

        @if (mode() === 'oidc') {
          <p>{{ 'admin.access.signInHelp' | translate }}</p>
          <a [href]="identityUrl()" data-og7="identity-sign-in">{{
            'admin.access.signIn' | translate
          }}</a>
        }
        @if (mode() === 'token') {
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
        }

        @if (sessionExpired) {
          <p role="status">{{ 'admin.access.sessionExpired' | translate }}</p>
        }
        <p role="alert" class="state state-error" *ngIf="state() === 'error'">
          {{
            (mode() === 'token'
              ? 'admin.legacy.connexion_refusee_verifiez_le_jeton_admin_et_la_configuration_api'
              : 'admin.access.signInError'
            ) | translate
          }}
        </p>

        <a routerLink="/admin/oidc-setup" data-og7="identity-setup-link">{{
          'admin.identitySetup.openGuide' | translate
        }}</a>

        <a routerLink="/fonds-des-batisseurs">{{
          'admin.legacy.retour_au_fonds' | translate
        }}</a>
      </section>
    </main>
  `,
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-forms.css',
    './admin-login-page.component.css'
  ]
})
export class AdminLoginPageComponent implements OnInit {
  readonly i18n = inject(FundingI18nService);
  private readonly admin = inject(FundingAdminService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly token = signal<string>('');
  readonly state = signal<'idle' | 'loading' | 'error'>('idle');
  readonly mode = signal<'oidc' | 'token' | null>(null);
  readonly sessionExpired =
    this.route.snapshot.queryParamMap.has('sessionExpired');
  identityUrl(): string {
    return this.admin.identitySignInUrl(this.returnUrl());
  }

  async ngOnInit(): Promise<void> {
    try {
      this.mode.set(await this.admin.authMode());
    } catch {
      this.state.set('error');
      return;
    }
    if (this.route.snapshot.queryParamMap.has('identityError'))
      this.state.set('error');
    if (await this.admin.restoreSession()) {
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
