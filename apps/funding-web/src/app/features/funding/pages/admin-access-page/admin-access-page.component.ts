import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  ViewChild,
  inject,
  signal
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { AdminLayoutComponent } from '../../components/admin-layout/admin-layout.component.js';
import {
  FundingAdminService,
  AdminDashboardRequestError,
  AdminAccessAccount,
  AdminAccessResponse
} from '../../services/funding-admin.service.js';

import { AdminAccessAccountsComponent } from './admin-access-accounts.component.js';
import { AdminAccessEditorComponent } from './admin-access-editor.component.js';
import type {
  AdminAccessFieldChange,
  AdminAccessSessionSelection
} from './admin-access-presentation.types.js';
import { AdminAccessSessionsComponent } from './admin-access-sessions.component.js';

@Component({
  selector: 'openg7-admin-access-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslatePipe,
    RouterLink,
    AdminLayoutComponent,
    AdminAccessAccountsComponent,
    AdminAccessEditorComponent,
    AdminAccessSessionsComponent
  ],
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
          <openg7-admin-access-accounts
            [accounts]="access.accounts"
            [busy]="busy()"
            (editRequested)="edit($event)"
          />
          <openg7-admin-access-editor
            [draft]="draft()"
            [busy]="busy()"
            [confirmed]="confirmed()"
            (fieldChanged)="changeField($event)"
            (confirmationChanged)="confirmed.set($event)"
            (newRequested)="newAccount()"
            (saveRequested)="save()"
          />
          <openg7-admin-access-sessions
            [accounts]="access.accounts"
            [sessions]="access.sessions"
            [busy]="busy()"
            [pendingSession]="pendingSession()"
            (sessionSelected)="selectSession($event)"
            (revokeRequested)="revoke($event)"
            (cancelRequested)="cancelRevoke()"
          />
        }</section
    ></openg7-admin-layout>
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
        margin: 1rem 0;
      }
      a {
        color: var(--og7-admin-accent, #a5d8ff);
      }
      :focus-visible {
        outline: 3px solid var(--admin-focus, #facc15);
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
  private revokeTrigger: HTMLButtonElement | null = null;
  @ViewChild('accessTitle') private accessTitle?: ElementRef<HTMLElement>;
  readonly confirmed = signal(false);
  readonly draft = signal<AdminAccessAccount>({
    id: '',
    subject: '',
    displayName: '',
    role: 'reader',
    disabled: false
  });
  async ngOnInit(): Promise<void> {
    await this.load();
  }
  edit(account: AdminAccessAccount): void {
    this.draft.set({ ...account });
    this.confirmed.set(false);
  }
  newAccount(): void {
    this.draft.set({
      id: '',
      subject: '',
      displayName: '',
      role: 'reader',
      disabled: false
    });
    this.confirmed.set(false);
  }
  changeField(change: AdminAccessFieldChange): void {
    this.draft.update((draft) => ({ ...draft, [change.field]: change.value }));
    this.confirmed.set(false);
  }
  selectSession(selection: AdminAccessSessionSelection): void {
    this.revokeTrigger = selection.trigger;
    this.pendingSession.set(selection.sessionId);
  }
  cancelRevoke(): void {
    if (this.busy()) return;
    const sessionId = this.pendingSession();
    this.pendingSession.set(null);
    if (
      this.revokeTrigger?.isConnected &&
      this.data()?.sessions.some((session) => session.id === sessionId)
    )
      this.revokeTrigger.focus();
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
    if (!this.confirmed() || this.busy()) return;
    const draft = this.draft();
    await this.change({ ...draft, confirmation: draft.subject });
    this.confirmed.set(false);
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
