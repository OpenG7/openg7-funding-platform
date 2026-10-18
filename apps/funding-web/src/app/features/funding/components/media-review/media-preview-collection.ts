import { signal } from '@angular/core';

export interface MediaPreview {
  readonly url: string;
  readonly failed: boolean;
}

/** Private, bounded preview cache owned by one workspace and one admin session. */
export class MediaPreviewCollection {
  readonly previews = signal<Readonly<Record<string, MediaPreview>>>({});
  private readonly queue: { id: string; key: string; generation: number }[] =
    [];
  private readonly pending = new Set<string>();
  private active = 0;
  private generation = 0;
  private disposed = false;
  private retained: ReadonlySet<string> | null = null;

  constructor(private readonly load: (id: string) => Promise<Blob>) {}

  key(id: string, version: string): string {
    return id + ':' + version;
  }

  request(id: string, version: string): void {
    const key = this.key(id, version);
    if (this.disposed || this.previews()[key] || this.pending.has(key)) return;
    this.pending.add(key);
    this.queue.push({ id, key, generation: this.generation });
    this.drain();
  }

  retain(keys: readonly string[]): void {
    const retained = new Set(keys);
    this.retained = retained;
    for (let index = this.queue.length - 1; index >= 0; index--) {
      if (!retained.has(this.queue[index]!.key)) {
        this.pending.delete(this.queue[index]!.key);
        this.queue.splice(index, 1);
      }
    }
    this.previews.update((current) => {
      const next: Record<string, MediaPreview> = {};
      for (const [key, preview] of Object.entries(current)) {
        if (retained.has(key)) next[key] = preview;
        else if (preview.url) URL.revokeObjectURL(preview.url);
      }
      return next;
    });
  }

  clear(): void {
    this.generation++;
    this.queue.length = 0;
    this.pending.clear();
    this.retained = null;
    for (const preview of Object.values(this.previews()))
      if (preview.url) URL.revokeObjectURL(preview.url);
    this.previews.set({});
  }

  dispose(): void {
    this.disposed = true;
    this.clear();
  }

  private drain(): void {
    while (!this.disposed && this.active < 4 && this.queue.length) {
      const job = this.queue.shift()!;
      this.active++;
      void this.load(job.id)
        .then((blob) => {
          if (
            this.disposed ||
            job.generation !== this.generation ||
            (this.retained && !this.retained.has(job.key))
          )
            return;
          if (!['image/webp', 'image/png', 'image/jpeg'].includes(blob.type))
            throw new Error('Invalid private image.');
          const url = URL.createObjectURL(blob);
          this.previews.update((current) => ({
            ...current,
            [job.key]: { url, failed: false }
          }));
        })
        .catch(() => {
          if (!this.disposed && job.generation === this.generation)
            this.previews.update((current) => ({
              ...current,
              [job.key]: { url: '', failed: true }
            }));
        })
        .finally(() => {
          this.active--;
          if (job.generation === this.generation) this.pending.delete(job.key);
          this.drain();
        });
    }
  }
}
