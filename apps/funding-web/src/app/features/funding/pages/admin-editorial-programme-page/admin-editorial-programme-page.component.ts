import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  afterNextRender,
  inject,
  signal,
  viewChild
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type { PilotReceipt, PilotState } from '@openg7/funding-core';

import { AdminLayoutComponent } from '../../components/admin-layout/admin-layout.component.js';
import {
  EditorialProgrammeComponent,
  type ProgrammeCommand
} from '../../components/admin-pilotage/editorial-programme.component.js';
import { ControllerService } from '../../components/admin-pilotage/controller.service.js';
import { AdminPilotageCommandWorkflow } from '../../services/admin-pilotage-command-workflow.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';

/** Publications owns editorial preparation; decisions retain their dedicated workspace. */
@Component({
  selector: 'openg7-admin-editorial-programme-page',
  standalone: true,
  imports: [
    AdminLayoutComponent,
    EditorialProgrammeComponent,
    FormsModule,
    RouterLink,
    TranslatePipe
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-editorial-programme-page.component.html',
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-forms.css',
    './admin-editorial-programme-page.component.css'
  ]
})
export class AdminEditorialProgrammePageComponent {
  private readonly admin = inject(FundingAdminService);
  readonly i18n = inject(FundingI18nService);
  readonly controller = inject(ControllerService);
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly programme = viewChild(EditorialProgrammeComponent);
  readonly queue = signal<PilotState | null>(null);
  readonly queueLoading = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly receipt = signal<PilotReceipt | null>(null);
  readonly unresolved = signal('');
  incidentReason = '';
  private disposed = false;
  private queueRequest = 0;
  private readonly commands = new AdminPilotageCommandWorkflow({
    admin: this.admin,
    state: {
      busy: this.busy,
      error: this.error,
      receipt: this.receipt,
      unresolved: this.unresolved
    },
    actorId: () => this.admin.identity()?.id ?? 'token',
    storage: () => this.document.defaultView?.sessionStorage ?? null,
    requestId: () => this.document.defaultView!.crypto.randomUUID(),
    resetInput: () => this.controller.reset(),
    settleCommand: () => {},
    closeIncident: () => {
      this.incidentReason = '';
    },
    confirmed: () => this.controller.feedback(),
    denyWrites: () =>
      this.queue.update((state) =>
        state ? { ...state, writable: false } : state
      ),
    refresh: async () => {
      if (this.disposed) return;
      await Promise.all([this.loadQueue(), this.programme()?.load()]);
    }
  });

  constructor() {
    const destroy = inject(DestroyRef);
    destroy.onDestroy(() => {
      this.disposed = true;
      this.queueRequest++;
    });
    afterNextRender(() => {
      const release = this.controller.attach(
        (intent) => this.programme()?.guide()?.handleIntent(intent) ?? false,
        { priority: 100, keyboard: true }
      );
      destroy.onDestroy(release);
      try {
        this.unresolved.set(
          this.document.defaultView?.sessionStorage.getItem(
            this.commands.receiptStorageKey()
          ) ?? ''
        );
      } catch {
        /* Receipt recovery remains available during this visit. */
      }
      void this.loadQueue();
      if (this.unresolved()) void this.recover();
    });
  }

  async loadQueue(): Promise<void> {
    const request = ++this.queueRequest;
    this.queueLoading.set(true);
    try {
      const queue = await this.admin.pilotage();
      if (!this.disposed && request === this.queueRequest) {
        this.queue.set(queue);
        if (this.error() === 'PILOTAGE_UNAVAILABLE') this.error.set('');
      }
    } catch {
      if (!this.disposed && request === this.queueRequest) {
        this.queue.set(null);
        this.error.set('PILOTAGE_UNAVAILABLE');
      }
    } finally {
      if (!this.disposed && request === this.queueRequest)
        this.queueLoading.set(false);
    }
  }

  command(command: ProgrammeCommand): void {
    if (!this.queue()?.writable || this.disposed) return;
    void this.commands.send(command);
  }

  recover(): Promise<void> {
    return this.commands.recover();
  }

  acknowledgeIncident(): Promise<void> {
    return this.commands.acknowledgeIncident(this.incidentReason);
  }

  reviewDecision(id: string): void {
    if (this.busy() || this.unresolved()) return;
    this.controller.reset();
    void this.router.navigate(['/admin/fundraiser/pilotage'], {
      queryParams: {
        decisionId: id,
        returnTo: '/admin/fundraiser/publications/programme'
      }
    });
  }

  startSession(): void {
    if (this.busy() || this.unresolved()) return;
    this.controller.reset();
    void this.router.navigate(['/admin/fundraiser/pilotage'], {
      queryParams: {
        session: '1',
        returnTo: '/admin/fundraiser/publications/programme'
      }
    });
  }

  errorLabel(code: string): string {
    for (const prefix of [
      'admin.programme.errors.',
      'admin.pilotage.errors.'
    ]) {
      const translated = this.i18n.t(prefix + code);
      if (translated !== prefix + code) return translated;
    }
    return this.i18n.t('admin.pilotage.errors.generic');
  }
}
