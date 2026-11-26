import { isPlatformBrowser, DOCUMENT } from '@angular/common';
import {
  Component,
  ChangeDetectionStrategy,
  input,
  signal,
  computed,
  inject,
  effect,
  untracked,
  DestroyRef,
  PLATFORM_ID
} from '@angular/core';
import type { AdminFlowMeasurement } from '@openg7/funding-core';

import fr from '../../../../../assets/i18n/admin-flow-measurement.fr-CA.json' with { type: 'json' };
import en from '../../../../../assets/i18n/admin-flow-measurement.en.json' with { type: 'json' };
import { FundingI18nService } from '../../services/funding-i18n.service.js';

import { readableDuration, aggregateWidth } from './flow-presentation.js';
import {
  HumanWorkSample,
  workCategories,
  type WorkCategory
} from './human-work-sample.js';

/** Funding organism: authoritative read projection plus an explicitly voluntary local sample. */
@Component({
  selector: 'openg7-admin-flow-measurement',
  standalone: true,
  templateUrl: './admin-flow-measurement.component.html',
  styleUrl: './admin-flow-measurement.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AdminFlowMeasurementComponent {
  readonly measurement = input<AdminFlowMeasurement | null>(null);
  readonly context = input('');
  readonly i18n = inject(FundingI18nService);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly document = inject(DOCUMENT);
  private readonly sample = new HumanWorkSample();
  readonly categories = workCategories;
  readonly consent = signal(false);
  readonly running = signal(false);
  readonly category = signal<WorkCategory>('diagnostic');
  readonly samples = signal(this.sample.seconds(0));
  readonly total = computed(() =>
    Object.values(this.samples()).reduce((a, b) => a + b, 0)
  );
  private tick: ReturnType<typeof setInterval> | null = null;
  constructor() {
    this.i18n.mergeTranslations('fr-CA', { admin: { flowMeasurement: fr } });
    this.i18n.mergeTranslations('en', { admin: { flowMeasurement: en } });
    effect(() => {
      this.context();
      untracked(() => this.clear(true));
    });
    const pause = () => this.pause();
    const visibility = () => {
      if (this.document.hidden) this.pause();
    };
    if (this.browser) {
      this.document.addEventListener('visibilitychange', visibility);
      this.document.defaultView?.addEventListener('blur', pause);
    }
    inject(DestroyRef).onDestroy(() => {
      this.clear(true);
      this.document.removeEventListener('visibilitychange', visibility);
      this.document.defaultView?.removeEventListener('blur', pause);
    });
  }
  t(key: string): string {
    return this.i18n.t('admin.flowMeasurement.' + key);
  }
  value(value: number | null | undefined): string {
    return value === null || value === undefined
      ? this.t('unknown')
      : String(value);
  }
  duration(value: number | null | undefined): string {
    return (
      readableDuration(value, this.i18n.currentLanguage()) ??
      this.t('notMeasured')
    );
  }
  readonly barWidth = aggregateWidth;
  consentChanged(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    if (!checked) this.clear(true);
    else this.consent.set(true);
  }
  categoryChanged(event: Event): void {
    const category = (event.target as HTMLSelectElement).value;
    if (workCategories.includes(category as WorkCategory)) {
      this.pause();
      this.category.set(category as WorkCategory);
    }
  }
  start(): void {
    if (
      !this.browser ||
      !this.consent() ||
      this.document.hidden ||
      this.running()
    )
      return;
    this.sample.start(this.category(), performance.now());
    this.running.set(this.sample.running);
    this.tick = setInterval(
      () => this.samples.set(this.sample.seconds(performance.now())),
      1000
    );
  }
  pause(): void {
    if (this.tick !== null) clearInterval(this.tick);
    this.tick = null;
    if (this.browser) this.sample.pause(performance.now());
    this.running.set(false);
    this.samples.set(this.sample.seconds(0));
  }
  clear(revoke = false): void {
    this.pause();
    this.sample.clear();
    this.samples.set(this.sample.seconds(0));
    if (revoke) this.consent.set(false);
  }
}
