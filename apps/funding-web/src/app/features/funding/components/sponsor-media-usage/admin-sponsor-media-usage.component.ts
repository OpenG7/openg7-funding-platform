import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  OnDestroy,
  output,
  signal,
  untracked
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { AdminSponsorMediaUsageRequest } from '@openg7/funding-core';

import type { AdminSponsorMediaAssetView } from '../../models/admin-sponsors-ui.models.js';
import { sponsorMediaMutationRejection } from '../../models/sponsor-media-mutation-outcome.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';
import { AdminDashboardRequestError } from '../../services/funding-admin-session.js';

import {
  SponsorMediaUsageEditorComponent,
  type SponsorMediaUsageSubmission
} from './sponsor-media-usage-editor.component.js';

/** Admin organism: qualifies evidence without treating it as editorial approval. */
@Component({
  selector: 'openg7-admin-sponsor-media-usage',
  standalone: true,
  imports: [TranslatePipe, SponsorMediaUsageEditorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (canWrite()) {
      <div class="usage-panel" [attr.aria-busy]="busy()">
        <openg7-sponsor-media-usage-editor
          [value]="asset().usage ?? null"
          [disabled]="disabled() || busy()"
          [requireEvidence]="true"
          (saved)="save($event)"
        />
        @if (notice()) {
          <p
            class="usage-notice"
            [attr.role]="notice() === 'saved' ? 'status' : 'alert'"
          >
            {{ 'funding.followup.media.usage.' + notice() | translate }}
          </p>
        }
        @if (pending()) {
          <button
            type="button"
            class="admin-button"
            [disabled]="disabled() || busy()"
            (click)="retry()"
            data-og7="admin-media-usage-retry"
          >
            {{ 'funding.followup.media.usage.retry' | translate }}
          </button>
        }
      </div>
    }
  `,
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    '../admin-ui/admin-forms.css',
    './admin-sponsor-media-usage.component.css'
  ]
})
export class AdminSponsorMediaUsageComponent implements OnDestroy {
  readonly asset = input.required<AdminSponsorMediaAssetView>();
  readonly disabled = input(false);
  readonly changed = output<void>();
  readonly busyChange = output<boolean>();
  readonly busy = signal(false);
  readonly notice = signal('');
  readonly pending = signal<AdminSponsorMediaUsageRequest | null>(null);
  private readonly admin = inject(FundingAdminService);
  readonly canWrite = computed(() => this.admin.identity()?.role !== 'reader');
  private generation = 0;
  private disposed = false;
  private context = '';
  constructor() {
    effect(() => {
      const context = this.asset().id;
      if (context !== this.context)
        untracked(() => {
          this.context = context;
          this.generation++;
          this.pending.set(null);
          this.notice.set('');
          this.setBusy(false);
        });
    });
  }
  async save(submission: SponsorMediaUsageSubmission): Promise<void> {
    if (
      this.disabled() ||
      this.busy() ||
      !this.canWrite() ||
      !submission.evidenceReference
    )
      return;
    const asset = this.asset();
    const payload: AdminSponsorMediaUsageRequest = {
      assetId: asset.id,
      expectedVersion: asset.version,
      confirmation: asset.id,
      requestId: crypto.randomUUID(),
      usage: structuredClone(submission.usage),
      evidenceReference: submission.evidenceReference
    };
    const existing = this.pending();
    if (existing) {
      if (
        JSON.stringify({ ...payload, requestId: existing.requestId }) !==
        JSON.stringify(existing)
      ) {
        this.notice.set('verificationRequired');
        return;
      }
      await this.send(existing);
      return;
    }
    this.pending.set(payload);
    await this.send(payload);
  }
  async retry(): Promise<void> {
    const pending = this.pending();
    if (pending) await this.send(pending);
  }
  ngOnDestroy(): void {
    this.disposed = true;
    this.generation++;
  }
  private async send(payload: AdminSponsorMediaUsageRequest): Promise<void> {
    if (
      this.disposed ||
      this.busy() ||
      this.disabled() ||
      !this.canWrite() ||
      this.asset().id !== payload.assetId
    )
      return;
    const generation = this.generation;
    this.setBusy(true);
    this.notice.set('');
    try {
      const result = await this.admin.updateSponsorMediaUsage(payload);
      if (this.disposed || generation !== this.generation) return;
      if (!result.updated) throw new Error('Usage update is unconfirmed.');
      this.pending.set(null);
      this.notice.set('saved');
      this.changed.emit();
    } catch (error) {
      if (!this.disposed && generation === this.generation) {
        const rejection =
          error instanceof AdminDashboardRequestError
            ? sponsorMediaMutationRejection(error.status, error.code)
            : null;
        if (rejection) {
          this.pending.set(null);
          this.notice.set(rejection);
          this.changed.emit();
        } else this.notice.set('mutationUnavailable');
      }
    } finally {
      if (!this.disposed && generation === this.generation) this.setBusy(false);
    }
  }
  private setBusy(value: boolean): void {
    this.busy.set(value);
    this.busyChange.emit(value);
  }
}
