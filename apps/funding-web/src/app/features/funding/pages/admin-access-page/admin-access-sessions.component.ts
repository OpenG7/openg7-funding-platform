import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  PLATFORM_ID,
  ViewChild,
  inject,
  input,
  output
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import type { AdminAccessAccount } from '../../services/funding-admin.service.js';

import type {
  AdminAccessSession,
  AdminAccessSessionSelection
} from './admin-access-presentation.types.js';

/** Admin organism: sessions and explicit revocation decision, without HTTP. */
@Component({
  selector: 'openg7-admin-access-sessions',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  templateUrl: './admin-access-sessions.component.html',
  styleUrl: './admin-access-controls.css'
})
export class AdminAccessSessionsComponent {
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly accounts = input.required<readonly AdminAccessAccount[]>();
  readonly sessions = input.required<readonly AdminAccessSession[]>();
  readonly busy = input.required<boolean>();
  readonly pendingSession = input.required<string | null>();
  readonly sessionSelected = output<AdminAccessSessionSelection>();
  readonly revokeRequested = output<string>();
  readonly cancelRequested = output<void>();

  @ViewChild('revokeConfirmButton') set revokeConfirmButton(
    button: ElementRef<HTMLButtonElement> | undefined
  ) {
    if (this.browser) button?.nativeElement.focus();
  }

  nameFor(id: string): string {
    return (
      this.accounts().find((account) => account.id === id)?.displayName ?? id
    );
  }

  sessionName(id: string): string {
    const session = this.sessions().find((item) => item.id === id);
    return session
      ? `${this.nameFor(session.accountId)} — ${session.createdAt}`
      : '';
  }

  selectSession(sessionId: string, event: Event): void {
    this.sessionSelected.emit({
      sessionId,
      trigger: event.currentTarget as HTMLButtonElement
    });
  }
}
