import { signal } from '@angular/core';
import type { AdminMediaConsentSnapshotEntry } from '@openg7/funding-core';

import { MediaPreviewCollection } from './media-preview-collection.js';

const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** Presentation only: the prepared server manifest is the sole list of photos. */
export class MediaReviewConsentPreviews {
  readonly manifest = signal<readonly AdminMediaConsentSnapshotEntry[]>([]);
  readonly unavailable = signal(false);
  readonly previews: MediaPreviewCollection;
  private scope = '';
  private signature = '';
  private disposed = false;

  constructor(load: (id: string, version: string) => Promise<Blob>) {
    this.previews = new MediaPreviewCollection(load);
  }

  setManifest(
    delivery: unknown,
    contributionId: string,
    identity: string,
    currentAssets?: readonly AdminMediaConsentSnapshotEntry[]
  ): void {
    if (this.disposed) return;
    const scope = JSON.stringify([contributionId, identity]);
    if (scope !== this.scope) {
      this.scope = scope;
      this.signature = '';
      this.clear();
    }
    if (!delivery) {
      this.signature = '';
      this.clear();
      return;
    }
    const preview = delivery as Record<string, unknown>;
    const snapshots = preview.mediaSnapshot;
    const valid =
      !!identity &&
      uuid(contributionId) &&
      preview.purpose === 'media_consent' &&
      preview.contributionId === contributionId &&
      typeof preview.contextVersion === 'string' &&
      /^[a-f0-9]{64}$/.test(preview.contextVersion) &&
      Array.isArray(snapshots) &&
      snapshots.length > 0 &&
      snapshots.length <= 100 &&
      snapshots.every((entry: unknown) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry))
          return false;
        const value = entry as Record<string, unknown>;
        return (
          uuid(value.id) &&
          typeof value.version === 'string' &&
          value.version.trim().length > 0 &&
          value.version.length <= 128 &&
          !/[\u0000-\u001f\u007f]/.test(value.version)
        );
      }) &&
      new Set(
        snapshots.map((entry: AdminMediaConsentSnapshotEntry) =>
          entry.id.toLowerCase()
        )
      ).size === snapshots.length;
    if (!valid || !Array.isArray(snapshots)) {
      this.signature = '';
      this.clear();
      this.unavailable.set(true);
      return;
    }
    const manifest: readonly AdminMediaConsentSnapshotEntry[] = snapshots.map(
      ({ id, version }: AdminMediaConsentSnapshotEntry) => ({ id, version })
    );
    // Current metadata may invalidate an entry; it never adds a photo or
    // changes the prepared manifest's order or exact versions.
    const available = new Set(
      manifest
        .filter(
          (entry) =>
            currentAssets === undefined ||
            currentAssets.some(
              (asset) =>
                asset.id === entry.id && asset.version === entry.version
            )
        )
        .map((entry) => this.previews.key(entry.id, entry.version))
    );
    const signature = JSON.stringify([
      preview.contextVersion,
      manifest,
      [...available]
    ]);
    if (signature === this.signature) return;
    this.clear();
    this.signature = signature;
    this.manifest.set(manifest);
    for (const { id, version } of manifest) {
      const key = this.previews.key(id, version);
      if (available.has(key)) this.previews.request(id, version);
      else
        this.previews.previews.update((values) => ({
          ...values,
          [key]: { url: '', failed: true }
        }));
    }
  }

  clear(): void {
    this.signature = '';
    this.manifest.set([]);
    this.unavailable.set(false);
    this.previews.clear();
  }

  dispose(): void {
    this.disposed = true;
    this.clear();
    this.previews.dispose();
  }
}
