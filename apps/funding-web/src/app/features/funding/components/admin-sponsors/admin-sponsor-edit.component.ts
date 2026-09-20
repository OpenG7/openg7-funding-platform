import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { validateAdminSponsorshipDetails } from '@openg7/funding-core';
import type {
  AdminSponsorshipCorrectionReason,
  AdminSponsorshipDetails,
  AdminSponsorshipDetailsRequest,
  AdminSponsorshipRecord
} from '@openg7/funding-core';

import { AdminConfirmationService } from '../../services/admin-confirmation.service.js';
import {
  AdminDashboardRequestError,
  FundingAdminService
} from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminDrawerComponent } from '../admin-ui/admin-drawer.component.js';

const detailsFrom = (
  record: AdminSponsorshipRecord
): AdminSponsorshipDetails => ({
  companyName: record.sponsor_company_name ?? '',
  publicName: record.public_name ?? '',
  contactName: record.sponsor_contact_name ?? '',
  contactEmail: record.sponsor_contact_email ?? '',
  websiteUrl: record.sponsor_website_url ?? ''
});
const emptyDetails: AdminSponsorshipDetails = {
  companyName: '',
  publicName: '',
  contactName: '',
  contactEmail: '',
  websiteUrl: ''
};

/** Funding organism: confirmed, versioned identity corrections for one dossier. */
@Component({
  selector: 'openg7-admin-sponsor-edit',
  standalone: true,
  imports: [FormsModule, TranslatePipe, AdminDrawerComponent],
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
  readonly opened = signal(false);
  readonly busy = signal(false);
  readonly saving = signal(false);
  readonly draft = signal<AdminSponsorshipDetails>(emptyDetails);
  readonly reason = signal<AdminSponsorshipCorrectionReason>('correction');
  readonly attempted = signal(false);
  readonly error = signal('');
  readonly success = signal(false);
  readonly fields = [
    { key: 'companyName', type: 'text', autocomplete: 'organization' },
    { key: 'publicName', type: 'text', autocomplete: 'off' },
    { key: 'contactName', type: 'text', autocomplete: 'name' },
    { key: 'contactEmail', type: 'email', autocomplete: 'email' },
    { key: 'websiteUrl', type: 'url', autocomplete: 'url' }
  ] as const;
  readonly errors = computed(() =>
    this.attempted() ? validateAdminSponsorshipDetails(this.draft()) : {}
  );
  private readonly initial = signal<AdminSponsorshipRecord | null>(null);
  readonly changed = computed(() => {
    const initial = this.initial();
    return (
      !!initial &&
      this.fields.some(
        ({ key }) => this.draft()[key].trim() !== detailsFrom(initial)[key]
      )
    );
  });
  private readonly admin = inject(FundingAdminService);
  readonly readonlyAccess = computed(
    () => this.admin.identity()?.role === 'reader'
  );
  private readonly confirmation = inject(AdminConfirmationService);
  private readonly i18n = inject(FundingI18nService);
  private readonly router = inject(Router);
  private readonly destroy = inject(DestroyRef);
  private generation = 0;
  private pendingRequest: { signature: string; requestId: string } | null =
    null;

  constructor() {
    let previousId: string | undefined;
    effect(() => {
      const id = this.sponsorship().id;
      if (previousId && previousId !== id) {
        this.generation++;
        this.close();
        this.busy.set(false);
        this.saving.set(false);
        this.success.set(false);
        this.error.set('');
      }
      previousId = id;
    });
  }

  open(): void {
    if (this.busy() || this.disabled() || this.readonlyAccess()) return;
    this.generation++;
    this.initial.set(this.sponsorship());
    this.draft.set(detailsFrom(this.sponsorship()));
    this.reason.set('correction');
    this.error.set('');
    this.success.set(false);
    this.attempted.set(false);
    this.pendingRequest = null;
    this.opened.set(true);
  }

  close(): void {
    this.opened.set(false);
    this.initial.set(null);
    this.draft.set(emptyDetails);
    this.pendingRequest = null;
  }

  setField(field: keyof AdminSponsorshipDetails, value: string): void {
    this.draft.update((draft) => ({ ...draft, [field]: value }));
  }

  async save(): Promise<void> {
    const initial = this.initial();
    if (
      !initial ||
      this.busy() ||
      this.disabled() ||
      this.readonlyAccess() ||
      this.error() === 'conflict'
    )
      return;
    this.attempted.set(true);
    if (Object.keys(this.errors()).length || !this.changed()) return;
    const generation = this.generation;
    const current = () =>
      !this.destroy.destroyed && generation === this.generation;
    this.busy.set(true);
    this.error.set('');
    try {
      const payload = {
        ...this.draft(),
        contributionId: initial.id,
        expectedVersion: initial.version,
        reason: this.reason(),
        confirmed: true as const
      };
      const target = [payload.companyName, payload.contactEmail]
        .filter(Boolean)
        .join(' · ');
      if (
        !(await this.confirmation.confirm(
          this.i18n.t('admin.editDossier.confirm'),
          target
        )) ||
        !current()
      )
        return;
      const signature = JSON.stringify(payload);
      if (this.pendingRequest?.signature !== signature)
        this.pendingRequest = { signature, requestId: crypto.randomUUID() };
      const request: AdminSponsorshipDetailsRequest = {
        ...payload,
        requestId: this.pendingRequest.requestId
      };
      this.saving.set(true);
      await this.admin.updateSponsorshipDetails(
        this.admin.getSavedAdminToken(),
        request
      );
      if (!current()) return;
      this.close();
      this.success.set(true);
      this.saved.emit();
    } catch (error) {
      if (!current()) return;
      const status =
        error instanceof AdminDashboardRequestError ? error.status : 0;
      if (status === 401 || status === 403) {
        this.close();
        this.error.set('forbidden');
        if (status === 401) {
          this.admin.clearAdminSession();
          await this.router.navigate(['/admin/login'], {
            queryParams: { returnUrl: this.router.url }
          });
        }
      } else if (status === 409) {
        this.error.set('conflict');
        this.conflicted.emit();
      } else this.error.set(status === 404 ? 'notFound' : 'saveError');
    } finally {
      if (current()) {
        this.busy.set(false);
        this.saving.set(false);
      }
    }
  }
}
