import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output
} from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type {
  AdminSponsorshipDetails,
  AdminSponsorshipRecord
} from '@openg7/funding-core';

import { AdminConfirmationService } from '../../services/admin-confirmation.service.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminDrawerComponent } from '../admin-ui/admin-drawer.component.js';

import { AdminSponsorEditController } from './admin-sponsor-edit-controller.js';

/** Funding organism: confirmed, versioned identity corrections for one dossier. */
@Component({
  selector: 'openg7-admin-sponsor-edit',
  standalone: true,
  imports: [TranslatePipe, AdminDrawerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-sponsor-edit.component.html',
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    '../admin-ui/admin-forms.css'
  ],
  styles: [
    `
      :host {
        display: block;
        padding: 0 1rem 1rem;
      }
      form,
      label {
        display: grid;
        gap: 0.5rem;
      }
      form {
        gap: 1rem;
      }
      input,
      select {
        width: 100%;
        min-width: 0;
        box-sizing: border-box;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
      }
      .error {
        color: var(--admin-danger);
      }
      input:focus-visible,
      select:focus-visible {
        outline: 3px solid var(--admin-focus);
        outline-offset: 2px;
      }
    `
  ]
})
export class AdminSponsorEditComponent {
  readonly sponsorship = input.required<AdminSponsorshipRecord>();
  readonly disabled = input(false);
  readonly saved = output<void>();
  readonly conflicted = output<void>();
  private readonly admin = inject(FundingAdminService);
  readonly readonlyAccess = computed(
    () => this.admin.identity()?.role === 'reader'
  );
  private readonly confirmation = inject(AdminConfirmationService);
  private readonly i18n = inject(FundingI18nService);
  private readonly router = inject(Router);
  private readonly destroy = inject(DestroyRef);
  private readonly controller = new AdminSponsorEditController({
    sponsorship: () => this.sponsorship(),
    disabled: () => this.disabled(),
    readonlyAccess: () => this.readonlyAccess(),
    token: () => this.admin.getSavedAdminToken(),
    isDestroyed: () => this.destroy.destroyed,
    newRequestId: () => crypto.randomUUID(),
    confirm: (target) =>
      this.confirmation.confirm(
        this.i18n.t('admin.editDossier.confirm'),
        target
      ),
    updateSponsorshipDetails: (token, request) =>
      this.admin.updateSponsorshipDetails(token, request),
    saved: () => this.saved.emit(),
    conflicted: () => this.conflicted.emit(),
    onUnauthorized: async () => {
      this.admin.clearAdminSession();
      await this.router.navigate(['/admin/login'], {
        queryParams: { returnUrl: this.router.url }
      });
    }
  });
  readonly opened = this.controller.opened;
  readonly busy = this.controller.busy;
  readonly saving = this.controller.saving;
  readonly draft = this.controller.draft;
  readonly reason = this.controller.reason;
  readonly attempted = this.controller.attempted;
  readonly error = this.controller.error;
  readonly success = this.controller.success;
  readonly fields = this.controller.fields;
  readonly errors = this.controller.errors;
  readonly changed = this.controller.changed;

  constructor() {
    let previousId: string | undefined;
    effect(() => {
      const id = this.sponsorship().id;
      if (previousId && previousId !== id) this.controller.targetChanged();
      previousId = id;
    });
  }

  open(): void {
    this.controller.open();
  }

  close(): void {
    this.controller.close();
  }

  setField(field: keyof AdminSponsorshipDetails, value: string): void {
    this.controller.setField(field, value);
  }

  setReason(value: string): void {
    this.controller.setReason(value);
  }

  save(): Promise<void> {
    return this.controller.save();
  }
}
