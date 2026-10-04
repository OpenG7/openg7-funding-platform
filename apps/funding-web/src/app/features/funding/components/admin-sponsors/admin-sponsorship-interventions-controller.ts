import { signal } from '@angular/core';
import type {
  SponsorshipIntervention,
  SponsorshipInterventionKind,
  SponsorshipInterventionRequest,
  SponsorshipInterventionsResponse
} from '@openg7/funding-core';

import { AdminDashboardRequestError } from '../../services/funding-admin-session.js';

export interface AdminSponsorshipInterventionsPorts {
  contributionId(): string;
  canManage(): boolean;
  disabled(): boolean;
  isDestroyed(): boolean;
  token(): string;
  newRequestId(): string;
  getSponsorshipInterventions(
    token: string,
    sponsorshipId: string,
    before?: string
  ): Promise<SponsorshipInterventionsResponse>;
  recordSponsorshipIntervention(
    token: string,
    payload: SponsorshipInterventionRequest
  ): Promise<SponsorshipIntervention>;
  saved(): void;
  onUnauthorized(): Promise<void>;
}

/** Private journal reads, append requests and uncertain retries for one dossier. */
export class AdminSponsorshipInterventionsController {
  readonly data = signal<SponsorshipInterventionsResponse | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly success = signal(false);
  readonly note = signal('');
  readonly kind = signal<SponsorshipInterventionKind>('internal');
  readonly nextReviewOn = signal('');
  readonly kinds: readonly SponsorshipInterventionKind[] = [
    'email',
    'phone',
    'internal',
    'extension',
    'refund_review'
  ];
  private generation = 0;
  private pending: {
    signature: string;
    request: SponsorshipInterventionRequest;
  } | null = null;

  constructor(private readonly ports: AdminSponsorshipInterventionsPorts) {}

  resetDossier(): void {
    this.generation++;
    this.note.set('');
    this.kind.set('internal');
    this.nextReviewOn.set('');
    this.pending = null;
    this.success.set(false);
    this.saving.set(false);
    this.data.set(null);
  }

  private current(generation: number): boolean {
    return generation === this.generation && !this.ports.isDestroyed();
  }

  async load(more = false): Promise<void> {
    const generation = ++this.generation;
    const previous = more ? this.data() : null;
    this.loading.set(true);
    this.error.set('');
    try {
      const data = await this.ports.getSponsorshipInterventions(
        this.ports.token(),
        this.ports.contributionId(),
        previous?.nextCursor ?? undefined
      );
      if (!this.current(generation)) return;
      if (!data.followup || !Array.isArray(data.entries))
        throw new Error('Invalid intervention response.');
      this.data.set({
        ...data,
        entries: previous
          ? [
              ...previous.entries,
              ...data.entries.filter(
                (entry) => !previous.entries.some((old) => old.id === entry.id)
              )
            ]
          : data.entries
      });
    } catch (error) {
      if (this.current(generation)) await this.handleError(error, 'loadError');
    } finally {
      if (this.current(generation)) this.loading.set(false);
    }
  }

  setKind(value: string): void {
    if (this.kinds.includes(value as SponsorshipInterventionKind))
      this.kind.set(value as SponsorshipInterventionKind);
  }

  async save(): Promise<void> {
    if (
      !this.ports.canManage() ||
      this.ports.disabled() ||
      this.saving() ||
      this.loading() ||
      !this.data()
    )
      return;
    if (
      !this.note().trim() ||
      this.note().length > 2000 ||
      (this.kind() === 'extension' && !this.nextReviewOn())
    ) {
      this.error.set('invalid');
      return;
    }
    const payload = {
      contributionId: this.ports.contributionId(),
      kind: this.kind(),
      note: this.note().trim(),
      nextReviewOn: this.kind() === 'extension' ? this.nextReviewOn() : null
    };
    const signature = JSON.stringify(payload);
    if (this.pending?.signature !== signature)
      this.pending = {
        signature,
        request: { ...payload, requestId: this.ports.newRequestId() }
      };
    const generation = this.generation;
    this.saving.set(true);
    this.error.set('');
    this.success.set(false);
    try {
      await this.ports.recordSponsorshipIntervention(
        this.ports.token(),
        this.pending.request
      );
      if (!this.current(generation)) return;
      this.note.set('');
      this.nextReviewOn.set('');
      this.kind.set('internal');
      this.pending = null;
      this.success.set(true);
      this.saving.set(false);
      await this.load();
      if (
        !this.ports.isDestroyed() &&
        this.ports.contributionId() === payload.contributionId
      )
        this.ports.saved();
    } catch (error) {
      if (this.current(generation)) await this.handleError(error, 'saveError');
    } finally {
      if (this.current(generation)) this.saving.set(false);
    }
  }

  private async handleError(error: unknown, fallback: string): Promise<void> {
    const status =
      error instanceof AdminDashboardRequestError ? error.status : 0;
    this.error.set(
      status === 400
        ? 'invalid'
        : status === 403
          ? 'forbidden'
          : status === 409
            ? 'conflict'
            : fallback
    );
    if (status === 401 || status === 403) {
      this.data.set(null);
      this.note.set('');
      this.pending = null;
    }
    if (status === 401) await this.ports.onUnauthorized();
  }
}
