import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  ViewChild,
  inject,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { AdminLayoutComponent } from '../../components/admin-layout/admin-layout.component.js';
import {
  FundingAdminService,
  AdminDashboardRequestError,
  AdminAccessAccount,
  AdminAccessResponse
} from '../../services/funding-admin.service.js';

@Component({
  selector: 'openg7-admin-access-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TranslatePipe, RouterLink, AdminLayoutComponent],
  template: `
    <openg7-admin-layout
      ><section class="access-content" data-og7="admin-access">
        <a routerLink="/admin/fundraiser">{{
          'admin.access.back' | translate
        }}</a>
        <h1 #accessTitle tabindex="-1">
          {{ 'admin.access.title' | translate }}
        </h1>
        <p>{{ 'admin.access.help' | translate }}</p>
        @if (error()) {
          <p role="alert">{{ error() | translate }}</p>
        }
        @if (busy()) {
          <p role="status">{{ 'admin.access.loading' | translate }}</p>
        }
        @if (data(); as access) {
          <h2>{{ 'admin.access.accounts' | translate }}</h2>
          <ul>
            @for (account of access.accounts; track account.id) {
              <li data-og7="admin-account" [attr.data-og7-id]="account.id">
                {{ account.displayName }} —
                {{ 'admin.access.roles.' + account.role | translate }}
                @if (account.disabled) {
                  <span>({{ 'admin.access.disabled' | translate }})</span>
                }
                <button
                  type="button"
                  (click)="edit(account)"
                  [disabled]="busy()"
                >
                  {{ 'admin.access.edit' | translate }}
                </button>
              </li>
            }
          </ul>
          <form (ngSubmit)="save()">
            <h2>{{ 'admin.access.edit' | translate }}</h2>
            <button type="button" (click)="newAccount()" [disabled]="busy()">
              {{ 'admin.access.new' | translate }}
            </button>
            <label
              >{{ 'admin.access.subject' | translate
              }}<input
                name="subject"
                [(ngModel)]="draft.subject"
                (ngModelChange)="confirmed = false"
                [disabled]="busy()"
                [readonly]="!!draft.id"
                required
                maxlength="255"
            /></label>
            <label
              >{{ 'admin.access.name' | translate
              }}<input
                name="name"
                [(ngModel)]="draft.displayName"
                (ngModelChange)="confirmed = false"
                [disabled]="busy()"
                required
                maxlength="120"
            /></label>
            <label
              >{{ 'admin.access.role' | translate
              }}<select
                name="role"
                [(ngModel)]="draft.role"
                (ngModelChange)="confirmed = false"
                [disabled]="busy()"
              >
                @for (role of roles; track role) {
                  <option [value]="role">
                    {{ 'admin.access.roles.' + role | translate }}
                  </option>
                }
              </select></label
            >
            <label
              ><input
                type="checkbox"
                name="disabled"
                [(ngModel)]="draft.disabled"
                (ngModelChange)="confirmed = false"
                [disabled]="busy()"
              />{{ 'admin.access.disabled' | translate }}</label
            >
            <label
              ><input
                type="checkbox"
                name="confirmed"
                [(ngModel)]="confirmed"
                [disabled]="busy()"
                required
              />{{ 'admin.access.confirm' | translate }}</label
            >
            <button type="submit" [disabled]="busy() || !confirmed">
              {{ 'admin.access.save' | translate }}
            </button>
          </form>
          <h2>{{ 'admin.access.sessions' | translate }}</h2>
          <ul>
            @for (session of access.sessions; track session.id) {
              <li data-og7="admin-session" [attr.data-og7-id]="session.id">
                {{ nameFor(session.accountId) }} — {{ session.createdAt }}
                <button
                  type="button"
                  [disabled]="busy()"
                  (click)="selectSession(session.id, $event)"
                >
                  {{ 'admin.access.revoke' | translate }}
                </button>
              </li>
            }
          </ul>
          @if (pendingSession(); as id) {
            <section
              role="group"
              [attr.aria-label]="'admin.access.revoke' | translate"
              (keydown.escape)="cancelRevoke(); $event.stopPropagation()"
            >
              <p>
                {{ 'admin.access.revokeConfirm' | translate }}
                {{ sessionName(id) }}
              </p>
              <button
                #revokeConfirmButton
                type="button"
                [disabled]="busy()"
                (click)="revoke(id)"
              >
                {{ 'admin.access.revoke' | translate }}
              </button>
              <button
                type="button"
                [disabled]="busy()"
                (click)="cancelRevoke()"
              >
                {{ 'admin.access.cancel' | translate }}
              </button>
            </section>
          }
        }
      </section></openg7-admin-layout
    >
  `,
  styles: [
    `
      :host {
        display: block;
        min-height: 100vh;
        background: #101827;
        color: #f8fafc;
      }
      .access-content {
        max-width: 65rem;
        margin: auto;
        padding: clamp(0.25rem, 2vw, 2rem);
        overflow-wrap: anywhere;
      }
      h1 {
        font-size: clamp(1.5rem, 4vw, 2rem);
        font-weight: 800;
        margin: 1rem 0;
      }
      h2 {
        font-size: 1.15rem;
        font-weight: 700;
        margin: 1.25rem 0 0.5rem;
      }
      a {
        color: #a5d8ff;
      }
      form,
      label {
        display: grid;
        gap: 0.5rem;
      }
      form {
        max-width: 35rem;
        gap: 1rem;
        padding: 1rem;
        background: var(--admin-panel);
        border: 1px solid var(--admin-border);
        border-radius: 0.5rem;
      }
      input,
      select,
      button {
        font: inherit;
        padding: 0.65rem;
        border-radius: 0.3rem;
        color: #0f172a;
        background: #fff;
        min-width: 0;
        max-width: 100%;
      }
      button {
        min-height: 44px;
        margin: 0.3rem;
        cursor: pointer;
      }
      input[type='checkbox'] {
        width: 1.3rem;
        height: 1.3rem;
      }
      li {
        padding: 0.5rem;
      }
      :focus-visible {
        outline: 3px solid #facc15;
        outline-offset: 3px;
      }
    `
  ]
})
export class AdminAccessPageComponent implements OnInit {
  private readonly admin = inject(FundingAdminService);
  private readonly router = inject(Router);
  readonly data = signal<AdminAccessResponse | null>(null);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly pendingSession = signal<string | null>(null);
  readonly roles = ['reader', 'operator', 'owner'] as const;
  private revokeTrigger: HTMLButtonElement | null = null;
  @ViewChild('accessTitle') private accessTitle?: ElementRef<HTMLElement>;
  @ViewChild('revokeConfirmButton') set revokeConfirmButton(
    button: ElementRef<HTMLButtonElement> | undefined
  ) {
    button?.nativeElement.focus();
  }
  confirmed = false;
  draft: AdminAccessAccount = {
    id: '',
    subject: '',
    displayName: '',
    role: 'reader',
    disabled: false
  };
  async ngOnInit(): Promise<void> {
    await this.load();
  }
  edit(account: AdminAccessAccount): void {
    this.draft = { ...account };
    this.confirmed = false;
  }
  newAccount(): void {
    this.draft = {
      id: '',
      subject: '',
      displayName: '',
      role: 'reader',
      disabled: false
    };
    this.confirmed = false;
  }
  nameFor(id: string): string {
    return this.data()?.accounts.find((a) => a.id === id)?.displayName ?? id;
  }
  sessionName(id: string): string {
    const session = this.data()?.sessions.find((item) => item.id === id);
    return session
      ? `${this.nameFor(session.accountId)} — ${session.createdAt}`
      : '';
  }
  selectSession(id: string, event: Event): void {
    this.revokeTrigger = event.currentTarget as HTMLButtonElement;
    this.pendingSession.set(id);
  }
  cancelRevoke(): void {
    if (this.busy()) return;
    this.pendingSession.set(null);
    if (this.revokeTrigger?.isConnected) this.revokeTrigger.focus();
    else this.accessTitle?.nativeElement.focus();
  }
  private handleError(error: unknown): void {
    if (
      error instanceof AdminDashboardRequestError &&
      [401, 403].includes(error.status)
    ) {
      this.data.set(null);
      this.pendingSession.set(null);
      this.newAccount();
      if (error.status === 401) {
        void this.router.navigate(['/admin/login'], {
          queryParams: {
            returnUrl: '/admin/fundraiser/access',
            sessionExpired: '1'
          }
        });
        return;
      }
      this.error.set('admin.access.ownerRequired');
      return;
    }
    this.error.set(
      error instanceof Error && error.message === 'LAST_OWNER'
        ? 'admin.access.lastOwner'
        : 'admin.access.error'
    );
  }
  private async load(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      this.data.set(await this.admin.accessAccounts());
    } catch (error) {
      this.handleError(error);
    } finally {
      this.busy.set(false);
    }
  }
  async save(): Promise<void> {
    if (!this.confirmed || this.busy()) return;
    await this.change({ ...this.draft, confirmation: this.draft.subject });
    this.confirmed = false;
  }
  async revoke(sessionId: string): Promise<void> {
    if (this.busy() || this.pendingSession() !== sessionId) return;
    await this.change({ sessionId, confirmation: sessionId });
    this.cancelRevoke();
  }
  private async change(
    input: (AdminAccessAccount | { sessionId: string }) & {
      confirmation: string;
    }
  ): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.admin.updateAccess(input);
      await this.load();
    } catch (error) {
      this.handleError(error);
    } finally {
      this.busy.set(false);
    }
  }
}
