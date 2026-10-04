import { computed, signal } from '@angular/core';
import {
  programmeWarnings,
  type ProgrammeMove,
  type ProgrammeState,
  type PublicationFeedId
} from '@openg7/funding-core';

import type { EditorialProgrammePorts } from './editorial-programme.ports.js';

/** Owns the read projection and proposed moves; commands stay with the parent. */
export class EditorialProgrammeController {
  readonly state = signal<ProgrammeState | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly feedId = signal<PublicationFeedId>('openg7:facebook');
  readonly moves = signal<ProgrammeMove[]>([]);
  readonly planVersion = signal('');
  readonly planned = signal(false);
  readonly emptySlots = signal<string[]>([]);
  readonly unplaced = signal<string[]>([]);
  readonly selectedId = signal('');
  cadence = 2;
  includeApproved = false;
  private disposed = false;
  private readGeneration = 0;
  private proposalGeneration = 0;

  readonly feed = computed(() =>
    this.state()?.feeds.find((f) => f.id === this.feedId())
  );
  readonly deliveries = computed(
    () =>
      this.state()?.deliveries.filter((d) => d.feedId === this.feedId()) ?? []
  );
  readonly projection = computed(() =>
    this.deliveries()
      .map((d) => ({
        ...d,
        scheduledAt:
          this.moves().find((m) => m.id === d.id)?.scheduledAt ?? d.scheduledAt
      }))
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
  );
  readonly selected = computed(
    () =>
      this.projection().find((d) => d.id === this.selectedId()) ??
      this.projection()[0] ??
      null
  );
  readonly profile = computed(() =>
    this.state()?.profiles.find((p) => p.feedId === this.feedId())
  );
  readonly warnings = computed(() =>
    programmeWarnings(this.deliveries(), this.moves())
  );
  readonly changes = computed(() =>
    this.moves().filter(
      (m) =>
        this.deliveries().find((d) => d.id === m.id)?.scheduledAt !==
        m.scheduledAt
    )
  );
  readonly issues = computed(
    () =>
      this.state()?.issues.filter((i) =>
        this.deliveries().some((d) => d.id === i.deliveryId)
      ) ?? []
  );
  readonly readonly = computed(
    () =>
      this.ports.disabled() ||
      this.loading() ||
      !this.state()?.writable ||
      this.ports.working()
  );
  readonly days = computed(() => {
    const now = this.state()?.generatedAt;
    if (!now) return [];
    const start = new Date(this.dayKey(now) + 'T12:00:00Z');
    return Array.from({ length: 7 }, (_, i) =>
      new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10)
    );
  });

  constructor(private readonly ports: EditorialProgrammePorts) {}

  dayKey(value: string): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.feed()?.timezone ?? 'America/Toronto',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date(value));
    const get = (key: string) => parts.find((p) => p.type === key)?.value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  }

  entries(day: string) {
    return this.projection().filter((d) => this.dayKey(d.scheduledAt) === day);
  }

  outsideWeek() {
    return this.projection().filter(
      (d) => !this.days().includes(this.dayKey(d.scheduledAt))
    );
  }

  delivery(id: string) {
    return this.deliveries().find((d) => d.id === id);
  }

  title(id: string) {
    return this.delivery(id)?.message.slice(0, 100) ?? id;
  }

  originalDate(id: string) {
    return this.delivery(id)?.scheduledAt ?? '';
  }

  issue(id: string) {
    return this.issues().find((i) => i.deliveryId === id);
  }

  async load(): Promise<boolean> {
    if (this.disposed) return false;
    const generation = ++this.readGeneration;
    this.loading.set(true);
    this.error.set('');
    this.state.set(null);
    this.resetPlan();
    this.ports.clearComparison();
    try {
      const state = await this.ports.api.pilotageProgramme();
      if (!this.currentRead(generation)) return false;
      this.state.set(state);
      this.resetPlan();
      this.ports.syncPreferences();
      return true;
    } catch (e) {
      if (this.currentRead(generation))
        this.error.set(
          e instanceof Error ? e.message : 'PROGRAMME_UNAVAILABLE'
        );
      return false;
    } finally {
      if (this.currentRead(generation)) this.loading.set(false);
    }
  }

  changeFeed(id: PublicationFeedId): void {
    if (this.disposed) return;
    this.feedId.set(id);
    this.resetPlan();
    this.ports.syncPreferences();
    this.ports.clearComparison();
    this.ports.setPending(null);
    this.selectedId.set('');
    this.ports.contextChanged();
  }

  resetPlan(): void {
    if (this.disposed) return;
    this.proposalGeneration++;
    this.ports.setPending(null);
    this.moves.set([]);
    this.planned.set(false);
    this.planVersion.set('');
    this.emptySlots.set([]);
    this.unplaced.set([]);
    this.ports.contextChanged();
  }

  async propose(): Promise<void> {
    if (this.disposed || this.readonly()) return;
    this.ports.working.set(true);
    this.error.set('');
    this.resetPlan();
    const generation = this.proposalGeneration;
    const feedId = this.feedId();
    try {
      const result = await this.ports.api.proposeProgramme(
        feedId,
        Number(this.cadence),
        this.includeApproved
      );
      if (!this.currentProposal(generation, feedId)) return;
      if (result.version !== this.state()?.version) {
        this.error.set('VERSION_CONFLICT');
        return;
      }
      this.moves.set(result.plan.moves);
      this.planVersion.set(result.version);
      this.emptySlots.set(result.plan.emptySlots);
      this.unplaced.set(
        result.plan.warnings
          .filter((w) => w.code === 'unplaced')
          .flatMap((w) => w.ids)
      );
      this.planned.set(true);
    } catch (e) {
      if (this.currentProposal(generation, feedId))
        this.error.set(
          e instanceof Error ? e.message : 'PROGRAMME_UNAVAILABLE'
        );
    } finally {
      if (!this.disposed) {
        this.ports.working.set(false);
        this.ports.contextChanged();
      }
    }
  }

  select(id: string): void {
    if (this.disposed) return;
    this.selectedId.set(id);
    this.ports.clearComparison();
    this.ports.setPending(null);
    this.ports.contextChanged();
  }

  shift(minutes: number): void {
    const d = this.selected();
    if (
      this.disposed ||
      !d ||
      this.readonly() ||
      this.issue(d.id) ||
      !['draft', 'approved'].includes(d.status) ||
      (d.status === 'approved' && !this.includeApproved)
    )
      return;
    const scheduledAt = new Date(
      Date.parse(d.scheduledAt) + minutes * 60000
    ).toISOString();
    this.moves.update((ms) => [
      ...ms.filter((m) => m.id !== d.id),
      { id: d.id, version: d.version, scheduledAt }
    ]);
    this.planVersion.set(this.state()!.version);
    this.planned.set(true);
    this.ports.setPending(null);
  }

  stagePlan(): void {
    if (
      this.disposed ||
      this.readonly() ||
      !this.changes().length ||
      this.warnings().some(
        (w) =>
          w.code === 'collision' &&
          w.ids.some((id) => this.changes().some((m) => m.id === id))
      )
    )
      return;
    this.ports.setPending({
      action: 'programme.apply',
      targetId: this.feedId(),
      version: this.planVersion(),
      payload: { moves: this.changes() }
    });
    this.ports.contextChanged();
  }

  next(direction: number): void {
    if (this.disposed) return;
    const ds = this.projection();
    if (!ds.length) return;
    const i = ds.findIndex((d) => d.id === this.selected()?.id);
    this.select(ds[(i + direction + ds.length) % ds.length]!.id);
  }

  dispose(): void {
    this.disposed = true;
    this.readGeneration++;
    this.proposalGeneration++;
  }

  private currentRead(generation: number): boolean {
    return !this.disposed && generation === this.readGeneration;
  }

  private currentProposal(
    generation: number,
    feedId: PublicationFeedId
  ): boolean {
    return (
      !this.disposed &&
      generation === this.proposalGeneration &&
      feedId === this.feedId()
    );
  }
}
