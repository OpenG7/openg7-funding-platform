import { signal } from '@angular/core';

/** Local preview URL ownership; the caller supplies loading and error presentation. */
export class BlobPreviewResource {
  private readonly currentUrl = signal('');
  readonly url = this.currentUrl.asReadonly();
  private generation = 0;
  private disposed = false;

  async load(
    source: (() => Promise<Blob>) | null,
    onError: (error: unknown) => void
  ): Promise<void> {
    this.clear();
    if (!source || this.disposed) return;
    const generation = this.generation;
    try {
      const blob = await source();
      if (!this.disposed && generation === this.generation)
        this.currentUrl.set(URL.createObjectURL(blob));
    } catch (error) {
      if (!this.disposed && generation === this.generation) onError(error);
    }
  }

  clear(): void {
    this.generation++;
    const url = this.currentUrl();
    if (url) URL.revokeObjectURL(url);
    this.currentUrl.set('');
  }

  dispose(): void {
    this.disposed = true;
    this.clear();
  }
}
