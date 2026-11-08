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
  readonly result = signal<{
    received: number;
    failed: number;
    items: readonly {
      name: string;
      state:
        'received' | 'invalid' | 'rejected' | 'uncertain' | 'not_processed';
    }[];
  } | null>(null);
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
      allFiles = Array.from(input.files ?? []),
      files = allFiles.slice(0, 100);
    input.value = '';
    if (!files.length || !this.ports.controller.canWrite()) return;
    const generation = this.generation,
      contributionId = this.ports.contributionId(),
      kind = this.kind();
    this.busy.set(true);
    this.result.set(null);
    let received = 0,
      failed = 0;
    const items: {
      name: string;
      state:
        'received' | 'invalid' | 'rejected' | 'uncertain' | 'not_processed';
    }[] = [];
    const record = (file: File, state: (typeof items)[number]['state']) => {
      items.push({ name: file.name, state });
      if (!this.destroyed && generation === this.generation)
        this.result.set({ received, failed, items: [...items] });
    };
    try {
      for (const [index, file] of files.entries()) {
        if (this.destroyed || generation !== this.generation) return;
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
          failed++;
          record(file, 'invalid');
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
          record(file, 'received');
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
            record(file, 'uncertain');
            for (const remaining of files.slice(index + 1))
              record(remaining, 'not_processed');
            break;
          }
          record(file, 'rejected');
          if (
            error instanceof AdminDashboardRequestError &&
            (error.status === 401 || error.status === 403)
          ) {
            for (const remaining of files.slice(index + 1))
              record(remaining, 'not_processed');
            break;
          }
        }
      }
      if (!this.destroyed && generation === this.generation) {
        for (const extra of allFiles.slice(100)) record(extra, 'not_processed');
        this.result.set({ received, failed, items });
        await this.ports.refresh();
        this.ports.changed();
      }
    } finally {
      if (!this.destroyed && generation === this.generation)
        this.busy.set(false);
    }
  }
}
