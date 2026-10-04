import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  OnDestroy,
  OnInit,
  ViewChild,
  afterNextRender,
  inject
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { AdminLayoutComponent } from '../../components/admin-layout/admin-layout.component.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';
import type { AdminAccessAccount } from '../../services/funding-admin.service.js';

import { AdminAccessAccountsComponent } from './admin-access-accounts.component.js';
import { AdminAccessController } from './admin-access-controller.js';
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
export class AdminAccessPageComponent implements OnInit, OnDestroy {
  private readonly admin = inject(FundingAdminService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly controller = new AdminAccessController({
    admin: {
      accessAccounts: () => this.admin.accessAccounts(),
      updateAccess: (input) => this.admin.updateAccess(input)
    },
    onSessionExpired: () => {
      void this.router.navigate(['/admin/login'], {
        queryParams: {
          returnUrl: '/admin/fundraiser/access',
          sessionExpired: '1'
        }
      });
    },
    restoreRevokeFocus: (sessionId) => this.restoreRevokeFocus(sessionId)
  });
  readonly data = this.controller.data;
  readonly busy = this.controller.busy;
  readonly error = this.controller.error;
  readonly pendingSession = this.controller.pendingSession;
  readonly confirmed = this.controller.confirmed;
  readonly draft = this.controller.draft;
  private revokeTrigger: HTMLButtonElement | null = null;
  @ViewChild('accessTitle') private accessTitle?: ElementRef<HTMLElement>;
  async ngOnInit(): Promise<void> {
    await this.controller.load();
  }
  ngOnDestroy(): void {
    this.controller.dispose();
  }
  edit(account: AdminAccessAccount): void {
    this.controller.edit(account);
  }
  newAccount(): void {
    this.controller.newAccount();
  }
  changeField(change: AdminAccessFieldChange): void {
    this.controller.changeField(change);
  }
  selectSession(selection: AdminAccessSessionSelection): void {
    this.revokeTrigger = selection.trigger;
    this.controller.selectSession(selection.sessionId);
  }
  cancelRevoke(): void {
    this.controller.cancelRevoke();
  }
  private restoreRevokeFocus(sessionId: string | null): void {
    afterNextRender(
      () => {
        if (
          this.revokeTrigger?.isConnected &&
          this.data()?.sessions.some((session) => session.id === sessionId)
        )
          this.revokeTrigger.focus();
        else this.accessTitle?.nativeElement.focus();
      },
      { injector: this.injector }
    );
  }
  async save(): Promise<void> {
    await this.controller.save();
  }
  async revoke(sessionId: string): Promise<void> {
    await this.controller.revoke(sessionId);
  }
}
