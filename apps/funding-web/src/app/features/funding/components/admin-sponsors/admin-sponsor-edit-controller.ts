import { computed, signal } from '@angular/core';
import { validateAdminSponsorshipDetails } from '@openg7/funding-core';
import type {
  AdminSponsorshipCorrectionReason,
  AdminSponsorshipDetails,
  AdminSponsorshipDetailsRequest,
  AdminSponsorshipDetailsResult,
  AdminSponsorshipRecord
} from '@openg7/funding-core';

import { AdminDashboardRequestError } from '../../services/funding-admin-session.js';

export interface AdminSponsorEditPorts {
  sponsorship(): AdminSponsorshipRecord;
  disabled(): boolean;
  readonlyAccess(): boolean;
  token(): string;
  isDestroyed(): boolean;
  newRequestId(): string;
  confirm(target: string): Promise<boolean>;
  updateSponsorshipDetails(
    token: string,
    request: AdminSponsorshipDetailsRequest
  ): Promise<AdminSponsorshipDetailsResult>;
  saved(): void;
  conflicted(): void;
  onUnauthorized(): Promise<void>;
}

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

/** Owns the versioned correction draft and retries for one dossier. */
export class AdminSponsorEditController {
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
  private generation = 0;
  private pendingRequest: {
    signature: string;
    request: AdminSponsorshipDetailsRequest;
  } | null = null;

  constructor(private readonly ports: AdminSponsorEditPorts) {}

  targetChanged(): void {
    this.generation++;
    this.close();
    this.busy.set(false);
    this.saving.set(false);
    this.success.set(false);
    this.error.set('');
  }

  open(): void {
    if (
      this.ports.isDestroyed() ||
      this.busy() ||
      this.ports.disabled() ||
      this.ports.readonlyAccess()
    )
      return;
    this.generation++;
    const sponsorship = this.ports.sponsorship();
    this.initial.set(sponsorship);
    this.draft.set(detailsFrom(sponsorship));
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

  setReason(value: string): void {
    if (
      value === 'correction' ||
      value === 'contact_update' ||
      value === 'organization_update'
    )
      this.reason.set(value);
  }

  async save(): Promise<void> {
    const initial = this.initial();
    if (
      !initial ||
      this.ports.isDestroyed() ||
      this.ports.sponsorship().id !== initial.id ||
      this.busy() ||
      this.ports.disabled() ||
      this.ports.readonlyAccess() ||
      this.error() === 'conflict'
    )
      return;
    this.attempted.set(true);
    if (Object.keys(this.errors()).length || !this.changed()) return;
    const generation = this.generation;
    const current = () =>
      !this.ports.isDestroyed() &&
      generation === this.generation &&
      this.ports.sponsorship().id === initial.id;
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
      if (!(await this.ports.confirm(target)) || !current()) return;
      const signature = JSON.stringify(payload);
      if (this.pendingRequest?.signature !== signature)
        this.pendingRequest = {
          signature,
          request: { ...payload, requestId: this.ports.newRequestId() }
        };
      this.saving.set(true);
      await this.ports.updateSponsorshipDetails(
        this.ports.token(),
        this.pendingRequest.request
      );
      if (!current()) return;
      this.close();
      this.success.set(true);
      this.ports.saved();
    } catch (error) {
      if (!current()) return;
      const status =
        error instanceof AdminDashboardRequestError ? error.status : 0;
      if (status === 401 || status === 403) {
        this.close();
        this.error.set('forbidden');
        if (status === 401) await this.ports.onUnauthorized();
      } else if (status === 409) {
        this.error.set('conflict');
        this.ports.conflicted();
      } else this.error.set(status === 404 ? 'notFound' : 'saveError');
    } finally {
      if (current()) {
        this.busy.set(false);
        this.saving.set(false);
      }
    }
  }
}
