import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  EDITORIAL_INTENTS,
  programmeWarnings,
  type EditorialIntent,
  type PilotCommand,
  type PilotState,
  type ProgrammeMove,
  type ProgrammeState,
  type PublicationDelivery,
  type PublicationFeedId
} from '@openg7/funding-core';

import { FundingAdminService } from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminGuideComponent } from '../admin-guide/admin-guide.component.js';

import { PROGRAMME_GUIDE } from './pilotage-guides.js';

export type ProgrammeCommand = Pick<
  PilotCommand,
  'action' | 'targetId' | 'version' | 'payload'
>;
type View =
  'brief' | 'calendar' | 'rehearsal' | 'editorial' | 'memory' | 'incidents';
/** Funding organism: proposals and comparisons; the parent owns command receipts. */
@Component({
  selector: 'openg7-editorial-programme',
  standalone: true,
  imports: [FormsModule, RouterLink, AdminGuideComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './editorial-programme.component.html',
  styleUrl: './editorial-programme.component.css'
})
export class EditorialProgrammeComponent {
  readonly queue = input<PilotState | null>(null);
  readonly disabled = input(false);
  readonly command = output<ProgrammeCommand>();
  readonly review = output<string>();
  readonly session = output<void>();
  readonly contextChanged = output<void>();
  readonly guide = viewChild(AdminGuideComponent);
  readonly guideSteps = PROGRAMME_GUIDE;
  private guidePreviousView: View | null = null;
  readonly admin = inject(FundingAdminService);
  readonly i18n = inject(FundingI18nService);
  private readonly document = inject(DOCUMENT);
  private destroyed = false;
  private imageRequest = 0;
  readonly state = signal<ProgrammeState | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly working = signal(false);
  readonly view = signal<View>('brief');
  readonly views: View[] = [
    'brief',
    'calendar',
    'rehearsal',
    'editorial',
    'memory',
    'incidents'
  ];
  readonly feedId = signal<PublicationFeedId>('openg7:facebook');
  readonly moves = signal<ProgrammeMove[]>([]);
  readonly planVersion = signal('');
  readonly planned = signal(false);
  readonly emptySlots = signal<string[]>([]);
  readonly unplaced = signal<string[]>([]);
  readonly selectedId = signal('');
  readonly pending = signal<ProgrammeCommand | null>(null);
  readonly variant = signal<Awaited<
    ReturnType<FundingAdminService['editorialVariant']>
  > | null>(null);
  readonly preferences = signal<EditorialIntent[]>([]);
  readonly image = signal('');
  readonly imageFailed = signal(false);
  readonly intents = EDITORIAL_INTENTS;
  cadence = 2;
  includeApproved = false;
  instruction = '';
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
      this.disabled() ||
      this.loading() ||
      !this.state()?.writable ||
      this.working()
  );
  readonly days = computed(() => {
    const now = this.state()?.generatedAt;
    if (!now) return [];
    const start = new Date(this.dayKey(now) + 'T12:00:00Z');
    return Array.from({ length: 7 }, (_, i) =>
      new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10)
    );
  });
  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.clearImage();
    });
    afterNextRender(() => void this.load());
  }
  t(key: string): string {
    return this.i18n.t('admin.programme.' + key);
  }
  guideActive(active: boolean): void {
    if (active && this.guidePreviousView === null)
      this.guidePreviousView = this.view();
    if (!active && this.guidePreviousView !== null) {
      this.view.set(this.guidePreviousView);
      this.guidePreviousView = null;
    }
    this.contextChanged.emit();
  }
  guideStep(id: string): void {
    if (this.views.includes(id as View)) {
      // Presentation only: preserve proposals, fields and pending edits.
      this.view.set(id as View);
      if (id === 'rehearsal') void this.preview();
    }
  }
  label(code: string): string {
    for (const prefix of [
      'admin.programme.errors.',
      'admin.pilotage.errors.',
      'admin.publicationAutomation.errors.'
    ]) {
      const key = prefix + code,
        text = this.i18n.t(key);
      if (text !== key) return text;
    }
    return this.t('errors.generic');
  }
  date(value: string): string {
    return new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: this.feed()?.timezone ?? 'America/Toronto'
    }).format(new Date(value));
  }
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
  dayLabel(day: string): string {
    return new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC'
    }).format(new Date(day + 'T12:00:00Z'));
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
  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    this.state.set(null);
    this.resetPlan();
    this.variant.set(null);
    try {
      const state = await this.admin.pilotageProgramme();
      if (this.destroyed) return;
      this.state.set(state);
      this.resetPlan();
      this.preferences.set([...(this.profile()?.preferences ?? [])]);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'PROGRAMME_UNAVAILABLE');
    } finally {
      if (!this.destroyed) this.loading.set(false);
    }
  }
  switchView(view: View): void {
    this.view.set(view);
    this.error.set('');
    this.pending.set(null);
    this.contextChanged.emit();
    if (view === 'rehearsal') void this.preview();
  }
  changeFeed(id: PublicationFeedId): void {
    this.feedId.set(id);
    this.resetPlan();
    this.preferences.set([...(this.profile()?.preferences ?? [])]);
    this.variant.set(null);
    this.pending.set(null);
    this.selectedId.set('');
    this.contextChanged.emit();
    if (this.view() === 'rehearsal') void this.preview();
  }
  resetPlan(): void {
    this.pending.set(null);
    this.moves.set([]);
    this.planned.set(false);
    this.planVersion.set('');
    this.emptySlots.set([]);
    this.unplaced.set([]);
    this.contextChanged.emit();
  }
  async propose(): Promise<void> {
    if (this.readonly()) return;
    this.working.set(true);
    this.error.set('');
    this.resetPlan();
    try {
      const result = await this.admin.proposeProgramme(
        this.feedId(),
        Number(this.cadence),
        this.includeApproved
      );
      if (this.destroyed) return;
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
      this.error.set(e instanceof Error ? e.message : 'PROGRAMME_UNAVAILABLE');
    } finally {
      this.working.set(false);
      this.contextChanged.emit();
    }
  }
  select(id: string): void {
    this.selectedId.set(id);
    this.variant.set(null);
    this.pending.set(null);
    this.contextChanged.emit();
    if (this.view() === 'rehearsal') void this.preview();
  }
  shift(minutes: number): void {
    const d = this.selected();
    if (
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
    this.pending.set(null);
  }
  stagePlan(): void {
    if (
      this.readonly() ||
      !this.changes().length ||
      this.warnings().some(
        (w) =>
          w.code === 'collision' &&
          w.ids.some((id) => this.changes().some((m) => m.id === id))
      )
    )
      return;
    this.pending.set({
      action: 'programme.apply',
      targetId: this.feedId(),
      version: this.planVersion(),
      payload: { moves: this.changes() }
    });
    this.contextChanged.emit();
  }
  confirm(): void {
    const c = this.pending();
    if (c && !this.readonly()) {
      this.pending.set(null);
      this.command.emit(c);
    }
  }
  next(direction: number): void {
    const ds = this.projection();
    if (!ds.length) return;
    const i = ds.findIndex((d) => d.id === this.selected()?.id);
    this.select(ds[(i + direction + ds.length) % ds.length]!.id);
  }
  private clearImage(): void {
    if (this.image().startsWith('blob:')) URL.revokeObjectURL(this.image());
    this.image.set('');
  }
  async preview(): Promise<void> {
    const request = ++this.imageRequest;
    this.clearImage();
    this.imageFailed.set(false);
    const id = this.selected()?.mediaId;
    if (!id) return;
    try {
      const blob = await this.admin.getSponsorMediaPreview(
        this.admin.getSavedAdminToken(),
        id
      );
      if (!this.destroyed && request === this.imageRequest)
        this.image.set(URL.createObjectURL(blob));
    } catch {
      if (request === this.imageRequest) this.imageFailed.set(true);
    }
  }
  async transform(intent?: EditorialIntent): Promise<void> {
    const d = this.selected();
    if (!d || this.readonly()) return;
    this.working.set(true);
    this.error.set('');
    this.variant.set(null);
    this.pending.set(null);
    try {
      const v = await this.admin.editorialVariant(
        d.id,
        d.version,
        intent ?? this.instruction
      );
      if (!this.destroyed) this.variant.set(v);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'PROGRAMME_UNAVAILABLE');
    } finally {
      this.working.set(false);
      this.contextChanged.emit();
    }
  }
  stageVariant(): void {
    const v = this.variant(),
      d = this.selected();
    if (
      !v ||
      !d ||
      this.readonly() ||
      v.before === v.after ||
      v.deliveryId !== d.id
    )
      return;
    this.pending.set({
      action: 'publication.edit',
      targetId: d.id,
      version: String(v.version),
      payload: {
        message: v.after,
        scheduledAt: this.originalDate(d.id),
        mediaId: d.mediaId,
        editorialIntent: v.intent
      }
    });
    this.contextChanged.emit();
  }
  paragraphs(value: string): string[] {
    return value.split(/\n\s*\n/);
  }
  changed(paragraph: string, other: string): boolean {
    return !this.paragraphs(other).includes(paragraph);
  }
  toggle(intent: EditorialIntent): void {
    this.preferences.update((ps) =>
      ps.includes(intent) ? ps.filter((p) => p !== intent) : [...ps, intent]
    );
    this.pending.set(null);
  }
  stagePreferences(): void {
    const p = this.profile();
    if (!p || this.readonly()) return;
    this.pending.set({
      action: 'editorial.preferences',
      targetId: this.feedId(),
      version: String(p.version),
      payload: { preferences: this.preferences() }
    });
    this.contextChanged.emit();
  }
  stageRepair(id: string): void {
    const proposal = this.issue(id)?.repair;
    if (!proposal || this.readonly()) return;
    this.pending.set({
      action: 'publication.repair',
      targetId: id,
      version: proposal.version
    });
    this.contextChanged.emit();
  }
  reviewPublication(d: PublicationDelivery): void {
    this.review.emit('publication:' + d.id);
  }
}
