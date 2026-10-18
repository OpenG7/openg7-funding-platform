import { signal } from '@angular/core';

import type { MediaReviewHistoryResponse } from '../../services/funding-admin-media-review.client.js';
import type { FundingAdminService } from '../../services/funding-admin.service.js';

import type { MediaReviewWorkspaceController } from './media-review-workspace.controller.js';

interface MediaReviewHistoryPorts {
  admin: Pick<FundingAdminService, 'identity' | 'mediaHistory'>;
  controller: MediaReviewWorkspaceController;
}

/** Private inspector history, loaded on demand and discarded when its dossier changes. */
export class MediaReviewHistory {
  readonly data = signal<MediaReviewHistoryResponse | null>(null);
  readonly loading = signal(false);
  readonly error = signal(false);
  private generation = 0;
  private destroyed = false;
  constructor(private readonly ports: MediaReviewHistoryPorts) {}
  clear(): void {
    this.data.set(null);
    this.error.set(false);
  }
  reset(): void {
    this.generation++;
    this.clear();
  }
  dispose(): void {
    this.destroyed = true;
    this.generation++;
  }
  historyOpened(event: Event): void {
    if ((event.target as HTMLDetailsElement).open && !this.data())
      void this.loadHistory();
  }
  async loadHistory(more = false): Promise<void> {
    const asset = this.ports.controller.inspected(),
      generation = this.generation,
      cursor = more ? this.data()?.nextCursor : null;
    if (
      !asset ||
      this.loading() ||
      this.ports.admin.identity()?.role === 'reader'
    )
      return;
    this.loading.set(true);
    this.error.set(false);
    try {
      const history = await this.ports.admin.mediaHistory(
        asset.contributionId,
        asset.id,
        cursor ?? undefined
      );
      if (
        !this.destroyed &&
        generation === this.generation &&
        this.ports.controller.inspectedId() === asset.id
      )
        this.data.set(
          more
            ? {
                ...history,
                entries: [...(this.data()?.entries ?? []), ...history.entries]
              }
            : history
        );
    } catch {
      if (!this.destroyed && generation === this.generation)
        this.error.set(true);
    } finally {
      if (!this.destroyed && generation === this.generation)
        this.loading.set(false);
    }
  }
}
