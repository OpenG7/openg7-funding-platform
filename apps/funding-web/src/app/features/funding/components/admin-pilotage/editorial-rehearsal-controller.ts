import { signal } from '@angular/core';
import { EDITORIAL_INTENTS, type EditorialIntent } from '@openg7/funding-core';

import { BlobPreviewResource } from '../../services/blob-preview-resource.js';

import type { EditorialRehearsalPorts } from './editorial-programme.ports.js';

/** Local comparisons and drafts; the programme owns the displayed facts. */
export class EditorialRehearsalController {
  readonly variant = signal<Awaited<
    ReturnType<EditorialRehearsalPorts['api']['editorialVariant']>
  > | null>(null);
  readonly preferences = signal<EditorialIntent[]>([]);
  private readonly imageResource = new BlobPreviewResource();
  readonly image = this.imageResource.url;
  readonly imageFailed = signal(false);
  readonly intents = EDITORIAL_INTENTS;
  instruction = '';
  private comparisonRevision = 0;
  private requestGeneration = 0;
  private disposed = false;

  constructor(private readonly ports: EditorialRehearsalPorts) {}

  async preview(): Promise<void> {
    if (this.disposed) return;
    this.imageFailed.set(false);
    const id = this.ports.selected()?.mediaId;
    await this.imageResource.load(
      id ? () => this.ports.api.getMediaPreview(id) : null,
      () => this.imageFailed.set(true)
    );
  }

  clearPreview(): void {
    if (this.disposed) return;
    this.imageResource.clear();
    this.imageFailed.set(false);
  }

  async transform(intent?: EditorialIntent): Promise<void> {
    const d = this.ports.selected();
    if (this.disposed || !d || this.ports.readonly()) return;
    const feedId = this.ports.feedId();
    this.ports.working.set(true);
    this.ports.error.set('');
    this.invalidateComparison();
    this.ports.setPending(null);
    const revision = this.comparisonRevision;
    const generation = ++this.requestGeneration;
    const current = () =>
      !this.disposed &&
      revision === this.comparisonRevision &&
      this.ports.feedId() === feedId &&
      this.ports.selected()?.id === d.id &&
      this.ports.selected()?.version === d.version;
    try {
      const v = await this.ports.api.editorialVariant(
        d.id,
        d.version,
        intent ?? this.instruction
      );
      if (
        current() &&
        v.deliveryId === d.id &&
        v.version === d.version &&
        v.feedId === feedId
      )
        this.variant.set(v);
    } catch (e) {
      if (current())
        this.ports.error.set(
          e instanceof Error ? e.message : 'PROGRAMME_UNAVAILABLE'
        );
    } finally {
      if (!this.disposed && generation === this.requestGeneration) {
        this.ports.working.set(false);
        this.ports.contextChanged();
      }
    }
  }

  changeInstruction(value: string): void {
    if (this.disposed) return;
    this.instruction = value;
    this.invalidateComparison();
    this.ports.setPending(null);
    this.ports.error.set('');
    this.ports.contextChanged();
  }

  stageVariant(): void {
    const v = this.variant(),
      d = this.ports.selected();
    if (
      this.disposed ||
      !v ||
      !d ||
      this.ports.readonly() ||
      v.before === v.after ||
      v.deliveryId !== d.id ||
      v.version !== d.version ||
      v.feedId !== this.ports.feedId()
    )
      return;
    this.ports.setPending({
      action: 'publication.edit',
      targetId: d.id,
      version: String(v.version),
      payload: {
        message: v.after,
        scheduledAt: this.ports.originalDate(d.id),
        mediaId: d.mediaId,
        editorialIntent: v.intent
      }
    });
    this.ports.contextChanged();
  }

  paragraphs(value: string): string[] {
    return value.split(/\n\s*\n/);
  }

  changed(paragraph: string, other: string): boolean {
    return !this.paragraphs(other).includes(paragraph);
  }

  toggle(intent: EditorialIntent): void {
    if (this.disposed) return;
    this.preferences.update((ps) =>
      ps.includes(intent) ? ps.filter((p) => p !== intent) : [...ps, intent]
    );
    this.ports.setPending(null);
  }

  stagePreferences(): void {
    const p = this.ports.profile();
    if (this.disposed || !p || this.ports.readonly()) return;
    this.ports.setPending({
      action: 'editorial.preferences',
      targetId: this.ports.feedId(),
      version: String(p.version),
      payload: { preferences: this.preferences() }
    });
    this.ports.contextChanged();
  }

  stageRepair(id: string): void {
    const proposal = this.ports.issue(id)?.repair;
    if (this.disposed || !proposal || this.ports.readonly()) return;
    this.ports.setPending({
      action: 'publication.repair',
      targetId: id,
      version: proposal.version
    });
    this.ports.contextChanged();
  }

  invalidateComparison(): void {
    this.comparisonRevision++;
    this.variant.set(null);
  }

  syncPreferences(): void {
    if (!this.disposed)
      this.preferences.set([...(this.ports.profile()?.preferences ?? [])]);
  }

  dispose(): void {
    this.disposed = true;
    this.comparisonRevision++;
    this.requestGeneration++;
    this.imageResource.dispose();
  }
}
