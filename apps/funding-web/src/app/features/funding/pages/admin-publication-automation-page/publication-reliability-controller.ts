import { computed, signal } from '@angular/core';
import type {
  PublicationReliabilityIncidentCode,
  PublicationReliabilityIncidentFilter,
  PublicationReliabilityIncidentPage,
  PublicationReliabilitySubjectType
} from '@openg7/funding-core';

/** Read-only paging; stale replies cannot replace a newer filter or a disposed page. */
export class PublicationReliabilityController {
  readonly page = signal<PublicationReliabilityIncidentPage | null>(null);
  readonly busy = signal(false);
  readonly started = signal(false);
  readonly error = signal('');
  readonly code = signal<PublicationReliabilityIncidentCode | ''>('');
  readonly subjectType = signal<PublicationReliabilitySubjectType | ''>('');
  private readonly cursors = signal<(string | undefined)[]>([]);
  readonly offset = computed(
    () => Math.max(0, this.cursors().length - 1) * (this.page()?.limit ?? 50)
  );
  readonly canPrevious = computed(
    () => this.cursors().length > 1 && !this.error()
  );
  private generation = 0;
  private disposed = false;

  constructor(
    private readonly ports: {
      readonly read: (
        filter: PublicationReliabilityIncidentFilter
      ) => Promise<PublicationReliabilityIncidentPage>;
    }
  ) {}

  setCode(code: PublicationReliabilityIncidentCode | ''): void {
    this.code.set(code);
    void this.refresh();
  }
  setSubjectType(type: PublicationReliabilitySubjectType | ''): void {
    this.subjectType.set(type);
    void this.refresh();
  }
  refresh(): Promise<void> {
    this.page.set(null);
    this.cursors.set([]);
    return this.load([undefined]);
  }
  next(): Promise<void> {
    const cursor = this.page()?.nextCursor;
    return !this.busy() && !this.error() && cursor
      ? this.load([...this.cursors(), cursor])
      : Promise.resolve();
  }
  previous(): Promise<void> {
    return !this.busy() && this.canPrevious()
      ? this.load(this.cursors().slice(0, -1))
      : Promise.resolve();
  }
  dispose(): void {
    this.disposed = true;
    this.generation++;
  }

  private async load(cursors: (string | undefined)[]): Promise<void> {
    if (this.disposed) return;
    const generation = ++this.generation;
    this.started.set(true);
    this.busy.set(true);
    this.error.set('');
    const filter = {
      ...(this.code()
        ? { code: this.code() as PublicationReliabilityIncidentCode }
        : {}),
      ...(this.subjectType()
        ? {
            subjectType: this.subjectType() as PublicationReliabilitySubjectType
          }
        : {}),
      ...(cursors.at(-1) ? { cursor: cursors.at(-1) } : {})
    };
    try {
      const page = await this.ports.read(filter);
      if (this.disposed || generation !== this.generation) return;
      if (this.page() && page.snapshot !== this.page()!.snapshot)
        throw new Error('RELIABILITY_SNAPSHOT_CHANGED');
      this.page.set(page);
      this.cursors.set(cursors);
    } catch (error) {
      if (this.disposed || generation !== this.generation) return;
      this.error.set(
        error instanceof Error &&
          error.message === 'RELIABILITY_SNAPSHOT_CHANGED'
          ? 'admin.publicationReliability.snapshotChanged'
          : 'admin.publicationReliability.unavailable'
      );
    } finally {
      if (!this.disposed && generation === this.generation)
        this.busy.set(false);
    }
  }
}
