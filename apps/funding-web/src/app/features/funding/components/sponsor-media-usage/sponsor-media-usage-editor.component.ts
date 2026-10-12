import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
  untracked
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import {
  normalizeSponsorMediaUsage,
  SPONSOR_MEDIA_USAGE_CHANNELS,
  SPONSOR_MEDIA_USAGE_TARGETS,
  SPONSOR_MEDIA_TRANSFORMATIONS,
  type SponsorMediaUsageRights
} from '@openg7/funding-core';

export interface SponsorMediaUsageSubmission {
  readonly usage: SponsorMediaUsageRights;
  readonly evidenceReference?: string;
}

/** Funding molecule: explicit usage facts; the enclosing flow owns authorization and persistence. */
@Component({
  selector: 'openg7-sponsor-media-usage-editor',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sponsor-media-usage-editor.component.html',
  styleUrl: './sponsor-media-usage-editor.component.css'
})
export class SponsorMediaUsageEditorComponent {
  readonly value = input<SponsorMediaUsageRights | null>(null);
  readonly disabled = input(false);
  readonly requireEvidence = input(false);
  readonly saveButton = input(true);
  readonly valueChange = output<SponsorMediaUsageRights | null>();
  readonly saved = output<SponsorMediaUsageSubmission>();
  readonly channels = SPONSOR_MEDIA_USAGE_CHANNELS;
  readonly targets = SPONSOR_MEDIA_USAGE_TARGETS;
  readonly transformations = SPONSOR_MEDIA_TRANSFORMATIONS;
  readonly selectedChannels = signal<readonly string[]>([]);
  readonly selectedTargets = signal<readonly string[]>([]);
  readonly selectedTransforms = signal<readonly string[]>([]);
  readonly credit = signal('');
  readonly restrictions = signal('');
  readonly evidence = signal('');
  readonly confirmed = signal(false);
  readonly normalized = computed(() => {
    if (!this.confirmed()) return null;
    try {
      return normalizeSponsorMediaUsage({
        state: 'confirmed',
        channels: this.selectedChannels(),
        targets: this.selectedTargets(),
        transformations: this.selectedTransforms(),
        credit: this.credit().trim() || null,
        restrictions: this.restrictions().trim() || null
      });
    } catch {
      return null;
    }
  });
  readonly canSave = computed(
    () =>
      !this.disabled() &&
      !!this.normalized() &&
      (!this.requireEvidence() || this.evidence().trim().length >= 10)
  );
  constructor() {
    effect(() => {
      const usage = this.value();
      untracked(() => {
        this.selectedChannels.set(usage?.channels ?? []);
        this.selectedTargets.set(usage?.targets ?? []);
        this.selectedTransforms.set(usage?.transformations ?? []);
        this.credit.set(usage?.credit ?? '');
        this.restrictions.set(usage?.restrictions ?? '');
        this.confirmed.set(false);
        this.evidence.set('');
      });
    });
    effect(() => this.valueChange.emit(this.normalized()));
  }
  toggle(
    group: 'channel' | 'target' | 'transform',
    value: string,
    event: Event
  ): void {
    this.confirmed.set(false);
    const values =
      group === 'channel'
        ? this.selectedChannels
        : group === 'target'
          ? this.selectedTargets
          : this.selectedTransforms;
    values.update((current) =>
      (event.target as HTMLInputElement).checked
        ? [...current, value]
        : current.filter((item) => item !== value)
    );
  }
  changeText(
    field: 'credit' | 'restrictions' | 'evidence',
    event: Event
  ): void {
    this.confirmed.set(false);
    this[field].set((event.target as HTMLInputElement).value);
  }
  confirm(event: Event): void {
    this.confirmed.set((event.target as HTMLInputElement).checked);
  }
  submit(): void {
    const usage = this.normalized();
    if (usage && this.canSave())
      this.saved.emit({
        usage,
        ...(this.requireEvidence()
          ? { evidenceReference: this.evidence().trim() }
          : {})
      });
  }
}
