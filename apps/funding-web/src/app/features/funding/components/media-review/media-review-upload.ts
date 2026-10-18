import { signal } from '@angular/core';
import type { SponsorMediaKind } from '@openg7/funding-core';

import type { FundingAdminService } from '../../services/funding-admin.service.js';
import { AdminDashboardRequestError } from '../../services/funding-admin-session.js';

import type { MediaReviewWorkspaceController } from './media-review-workspace.controller.js';

interface MediaReviewUploadPorts {
  admin: Pick<FundingAdminService, 'mediaUpload'>;
  controller: MediaReviewWorkspaceController;
  contributionId(): string;
  refresh(): Promise<void>;
  changed(): void;
}

/** Sequential canonical uploads stop on an uncertain result and preserve its request ID. */
export class MediaReviewUpload {
  readonly busy = signal(false);
  readonly kind = signal<SponsorMediaKind>('supporting_image');
  readonly result = signal<{ received: number; failed: number } | null>(null);
  private generation = 0;
  private destroyed = false;
  constructor(private readonly ports: MediaReviewUploadPorts) {}
  reset(): void {
    this.generation++;
    this.busy.set(false);
    this.result.set(null);
  }
  dispose(): void {
    this.destroyed = true;
    this.generation++;
  }
  async upload(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement,
      files = Array.from(input.files ?? []).slice(0, 100);
    input.value = '';
    if (!files.length || !this.ports.controller.canWrite()) return;
    const generation = this.generation,
      contributionId = this.ports.contributionId(),
      kind = this.kind();
    this.busy.set(true);
    this.result.set(null);
    let received = 0,
      failed = 0;
    try {
      for (const file of files) {
        if (this.destroyed || generation !== this.generation) return;
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
          failed++;
          continue;
        }
        const requestId = crypto.randomUUID();
        try {
          const result = await this.ports.admin.mediaUpload(
            contributionId,
            kind,
            file,
            requestId
          );
          if (!result.uploaded) throw new Error('Unconfirmed upload.');
          received++;
        } catch (error) {
          failed++;
          if (
            !this.destroyed &&
            generation === this.generation &&
            (!(error instanceof AdminDashboardRequestError) ||
              error.status >= 500)
          ) {
            this.ports.controller.uncertainRequest.set(requestId);
            this.ports.controller.uncertain.set(true);
            this.ports.controller.error.set('uncertain');
            break;
          }
          if (
            error instanceof AdminDashboardRequestError &&
            (error.status === 401 || error.status === 403)
          )
            break;
        }
      }
      if (!this.destroyed && generation === this.generation) {
        this.result.set({ received, failed });
        await this.ports.refresh();
        this.ports.changed();
      }
    } finally {
      if (!this.destroyed && generation === this.generation)
        this.busy.set(false);
    }
  }
}
