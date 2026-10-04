import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  afterNextRender,
  inject,
  input,
  output,
  signal,
  viewChild
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type {
  EditorialIntent,
  PilotState,
  PublicationDelivery,
  PublicationFeedId
} from '@openg7/funding-core';

import { FundingAdminService } from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminGuideComponent } from '../admin-guide/admin-guide.component.js';

import { EditorialProgrammeController } from './editorial-programme-controller.js';
import { EditorialRehearsalController } from './editorial-rehearsal-controller.js';
import type { ProgrammeCommand } from './editorial-programme.ports.js';
import { PROGRAMME_GUIDE } from './pilotage-guides.js';

export type { ProgrammeCommand } from './editorial-programme.ports.js';

type View =
  'brief' | 'calendar' | 'rehearsal' | 'editorial' | 'memory' | 'incidents';
/** Funding organism: presentation and one reviewed intention; the parent owns receipts. */
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
  readonly working = signal(false);
  readonly pending = signal<ProgrammeCommand | null>(null);
  readonly view = signal<View>('brief');
  readonly views: View[] = [
    'brief',
    'calendar',
    'rehearsal',
    'editorial',
    'memory',
    'incidents'
  ];
  private readonly programme: EditorialProgrammeController =
    new EditorialProgrammeController({
      api: {
        pilotageProgramme: () => this.admin.pilotageProgramme(),
        proposeProgramme: (feedId, cadence, includeApproved) =>
          this.admin.proposeProgramme(feedId, cadence, includeApproved)
      },
      disabled: () => this.disabled(),
      working: this.working,
      setPending: (command) => this.pending.set(command),
      contextChanged: () => this.contextChanged.emit(),
      clearComparison: () => this.rehearsal.invalidateComparison(),
      syncPreferences: () => this.rehearsal.syncPreferences()
    });
  private readonly rehearsal: EditorialRehearsalController =
    new EditorialRehearsalController({
      api: {
        editorialVariant: (id, version, instruction) =>
          this.admin.editorialVariant(id, version, instruction),
        getMediaPreview: (id) =>
          this.admin.getSponsorMediaPreview(this.admin.getSavedAdminToken(), id)
      },
      working: this.working,
      error: this.programme.error,
      readonly: () => this.programme.readonly(),
      feedId: () => this.programme.feedId(),
      selected: () => this.programme.selected(),
      profile: () => this.programme.profile(),
      originalDate: (id) => this.programme.originalDate(id),
      issue: (id) => this.programme.issue(id),
      setPending: (command) => this.pending.set(command),
      contextChanged: () => this.contextChanged.emit()
    });
  readonly state = this.programme.state;
  readonly loading = this.programme.loading;
  readonly error = this.programme.error;
  readonly feedId = this.programme.feedId;
  readonly moves = this.programme.moves;
  readonly planVersion = this.programme.planVersion;
  readonly planned = this.programme.planned;
  readonly emptySlots = this.programme.emptySlots;
  readonly unplaced = this.programme.unplaced;
  readonly selectedId = this.programme.selectedId;
  readonly feed = this.programme.feed;
  readonly deliveries = this.programme.deliveries;
  readonly projection = this.programme.projection;
  readonly selected = this.programme.selected;
  readonly profile = this.programme.profile;
  readonly warnings = this.programme.warnings;
  readonly changes = this.programme.changes;
  readonly issues = this.programme.issues;
  readonly readonly = this.programme.readonly;
  readonly days = this.programme.days;
  readonly variant = this.rehearsal.variant;
  readonly preferences = this.rehearsal.preferences;
  readonly image = this.rehearsal.image;
  readonly imageFailed = this.rehearsal.imageFailed;
  readonly intents = this.rehearsal.intents;

  get cadence(): number {
    return this.programme.cadence;
  }
  set cadence(value: number) {
    this.programme.cadence = value;
  }
  get includeApproved(): boolean {
    return this.programme.includeApproved;
  }
  set includeApproved(value: boolean) {
    this.programme.includeApproved = value;
  }
  get instruction(): string {
    return this.rehearsal.instruction;
  }
  set instruction(value: string) {
    this.rehearsal.instruction = value;
  }

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.programme.dispose();
      this.rehearsal.dispose();
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
    return this.programme.dayKey(value);
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
    return this.programme.entries(day);
  }
  outsideWeek() {
    return this.programme.outsideWeek();
  }
  delivery(id: string) {
    return this.programme.delivery(id);
  }
  title(id: string) {
    return this.programme.title(id);
  }
  originalDate(id: string) {
    return this.programme.originalDate(id);
  }
  issue(id: string) {
    return this.programme.issue(id);
  }
  async load(): Promise<void> {
    this.rehearsal.clearPreview();
    if ((await this.programme.load()) && this.view() === 'rehearsal')
      void this.preview();
  }
  switchView(view: View): void {
    this.view.set(view);
    this.error.set('');
    this.pending.set(null);
    this.contextChanged.emit();
    if (view === 'rehearsal') void this.preview();
  }
  changeFeed(id: PublicationFeedId): void {
    this.programme.changeFeed(id);
    if (this.view() === 'rehearsal') void this.preview();
  }
  resetPlan(): void {
    this.programme.resetPlan();
  }
  propose(): Promise<void> {
    return this.programme.propose();
  }
  select(id: string): void {
    this.programme.select(id);
    if (this.view() === 'rehearsal') void this.preview();
  }
  shift(minutes: number): void {
    this.programme.shift(minutes);
  }
  stagePlan(): void {
    this.programme.stagePlan();
  }
  confirm(): void {
    const c = this.pending();
    if (c && !this.readonly()) {
      this.pending.set(null);
      this.command.emit(c);
    }
  }
  next(direction: number): void {
    if (!this.projection().length) return;
    this.programme.next(direction);
    if (this.view() === 'rehearsal') void this.preview();
  }
  preview(): Promise<void> {
    return this.rehearsal.preview();
  }
  transform(intent?: EditorialIntent): Promise<void> {
    return this.rehearsal.transform(intent);
  }
  changeInstruction(value: string): void {
    this.rehearsal.changeInstruction(value);
  }
  stageVariant(): void {
    this.rehearsal.stageVariant();
  }
  paragraphs(value: string): string[] {
    return this.rehearsal.paragraphs(value);
  }
  changed(paragraph: string, other: string): boolean {
    return this.rehearsal.changed(paragraph, other);
  }
  toggle(intent: EditorialIntent): void {
    this.rehearsal.toggle(intent);
  }
  stagePreferences(): void {
    this.rehearsal.stagePreferences();
  }
  stageRepair(id: string): void {
    this.rehearsal.stageRepair(id);
  }
  reviewPublication(d: PublicationDelivery): void {
    this.review.emit('publication:' + d.id);
  }
}
