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
import { NgTemplateOutlet } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import {
  normalizeSponsorMediaUsage,
  getSponsorMediaUsageTerms,
  SPONSOR_MEDIA_USAGE_CHANNELS,
  SPONSOR_MEDIA_USAGE_TARGETS,
  SPONSOR_MEDIA_TRANSFORMATIONS,
  type SponsorMediaUsageRights,
  type SponsorMediaTermsAcceptance
} from '@openg7/funding-core';

export interface SponsorMediaUsageSubmission {
  readonly usage: SponsorMediaUsageRights;
  readonly evidenceReference?: string;
  readonly termsAcceptance?: SponsorMediaTermsAcceptance;
}

export type SponsorMediaUsageScope = Pick<
  SponsorMediaUsageRights,
  'channels' | 'targets'
>;

/** Funding molecule: explicit usage facts; the enclosing flow owns authorization and persistence. */
@Component({
  selector: 'openg7-sponsor-media-usage-editor',
  standalone: true,
  imports: [TranslatePipe, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sponsor-media-usage-editor.component.html',
  styleUrl: './sponsor-media-usage-editor.component.css'
})
export class SponsorMediaUsageEditorComponent {
  readonly value = input<SponsorMediaUsageRights | null>(null);
  readonly suggestedScope = input<SponsorMediaUsageScope | null>(null);
  readonly disabled = input(false);
  readonly requireEvidence = input(false);
  readonly saveButton = input(true);
  readonly compactTerms = input(false);
  readonly locale = input<'fr-CA' | 'en'>('fr-CA');
  readonly contextKey = input<unknown>(null);
  readonly valueChange = output<SponsorMediaUsageRights | null>();
  readonly acceptanceChange = output<SponsorMediaTermsAcceptance | null>();
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
  readonly terms = computed(() => getSponsorMediaUsageTerms(this.locale()));
  readonly acceptance = computed<SponsorMediaTermsAcceptance | null>(() => {
    if (!this.compactTerms() || !this.normalized()) return null;
    const { version, fingerprint, locale } = this.terms();
    return { version, fingerprint, locale, accepted: true };
  });
  readonly usesSuggestedScope = computed(() => {
    const usage = this.value();
    return (
      !!this.suggestedScope() &&
      (!usage || usage.state === 'needs_confirmation') &&
      !usage?.channels.length &&
      !usage?.targets.length
    );
  });
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
      const scope = this.usesSuggestedScope() ? this.suggestedScope() : null;
      const compact = this.compactTerms();
      this.contextKey();
      untracked(() => this.resetDraft(usage, scope, compact));
    });
    effect(() => {
      this.locale();
      untracked(() => this.confirmed.set(false));
    });
    effect(() => this.valueChange.emit(this.normalized()));
    effect(() => this.acceptanceChange.emit(this.acceptance()));
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
  cancel(): void {
    this.resetDraft(
      this.value(),
      this.usesSuggestedScope() ? this.suggestedScope() : null,
      this.compactTerms()
    );
  }
  private resetDraft(
    usage: SponsorMediaUsageRights | null,
    scope: SponsorMediaUsageScope | null,
    compact: boolean
  ): void {
    this.selectedChannels.set(
      scope?.channels ?? usage?.channels ?? (compact ? ['website'] : [])
    );
    this.selectedTargets.set(
      scope?.targets ?? usage?.targets ?? (compact ? ['openg7'] : [])
    );
    this.selectedTransforms.set(
      usage?.transformations ?? (compact ? ['technical'] : [])
    );
    this.credit.set(usage?.credit ?? '');
    this.restrictions.set(usage?.restrictions ?? '');
    this.confirmed.set(false);
    this.evidence.set('');
  }
  submit(): void {
    const usage = this.normalized();
    if (usage && this.canSave())
      this.saved.emit({
        usage,
        ...(this.acceptance() ? { termsAcceptance: this.acceptance()! } : {}),
        ...(this.requireEvidence()
          ? { evidenceReference: this.evidence().trim() }
          : {})
      });
  }
}
