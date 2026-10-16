import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  PLATFORM_ID,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type {
  AdminCockpitMetrics,
  AdminCockpitSystems
} from '@openg7/funding-core';

import en from '../../../../../assets/i18n/admin-celebrations.en.json' with { type: 'json' };
import fr from '../../../../../assets/i18n/admin-celebrations.fr-CA.json' with { type: 'json' };
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { serviceState, systemState } from '../admin-cockpit/system-state.js';

const preferenceKey = 'openg7.admin.celebrations.v1';
const systemIds = [
  'stripe',
  'email',
  'storage',
  'database',
  'identity'
] as const;

/** Admin presentation only: observes existing reads without producing financial facts. */
@Component({
  selector: 'openg7-admin-celebrations',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './admin-celebrations.component.html',
  styleUrls: ['./admin-celebrations.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AdminCelebrationsComponent {
  readonly metrics = input<AdminCockpitMetrics | null>(null);
  readonly metricsFresh = input(false);
  readonly systems = input<AdminCockpitSystems | null>(null);
  readonly systemsFresh = input(false);
  readonly now = input(0);
  readonly enabled = signal(true);
  readonly browserReady = signal(false);
  readonly gains = signal<readonly { currency: string; minor: number }[]>([]);
  readonly burstId = signal(0);
  readonly coins = [0, 1, 2, 3, 4, 5, 6];
  private readonly i18n = inject(FundingI18nService);
  private readonly document = inject(DOCUMENT);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly highWater = new Map<string, number>();
  private lastSnapshot = -Infinity;
  private timer: ReturnType<typeof setTimeout> | undefined;

  readonly health = computed(() => {
    const data = this.systems();
    if (!this.systemsFresh() || !data) return 'unknown';
    const states = systemIds.map((id) => {
      const system = data.systems.find((item) => item.id === id);
      return system ? serviceState(system, this.now()) : 'unknown';
    });
    const stripe = data.systems.find((system) => system.id === 'stripe');
    states.push(stripe ? systemState(stripe, this.now()) : 'unknown');
    if (states.every((state) => state === 'operational')) return 'operational';
    return states.some(
      (state) => state !== 'operational' && state !== 'unknown'
    )
      ? 'attention'
      : 'unknown';
  });

  constructor() {
    effect(() => {
      const language = this.i18n.currentLanguage();
      // Merge only after the base locale has loaded. Pre-registering another
      // language would prevent the translation loader from fetching its copy.
      untracked(() =>
        this.i18n.mergeTranslations(language, {
          admin: { celebrations: language === 'en' ? en : fr }
        })
      );
    });
    afterNextRender(() => {
      try {
        this.enabled.set(
          this.document.defaultView?.localStorage.getItem(preferenceKey) !==
            'off'
        );
      } catch {
        // The control remains usable when browser storage is unavailable.
      }
      this.browserReady.set(true);
    });
    effect(() => {
      const data = this.metrics();
      const fresh = this.metricsFresh();
      const enabled = this.enabled();
      const ready = this.browserReady();
      untracked(() => {
        if (!this.browser || !fresh || !data?.available) {
          this.clearGains();
          return;
        }
        const timestamp = Date.parse(data.generatedAt);
        if (!Number.isFinite(timestamp) || timestamp <= this.lastSnapshot)
          return;
        this.lastSnapshot = timestamp;
        const gains: { currency: string; minor: number }[] = [];
        for (const values of data.currencies) {
          if (!Number.isSafeInteger(values.grossMinor) || values.grossMinor < 0)
            continue;
          const previous = this.highWater.get(values.currency);
          this.highWater.set(
            values.currency,
            Math.max(previous ?? 0, values.grossMinor)
          );
          if (previous !== undefined && values.grossMinor > previous) {
            gains.push({
              currency: values.currency,
              minor: values.grossMinor - previous
            });
          }
        }
        // Backfills can increase gross too: describe a confirmed aggregate gain,
        // never claim a new live payment or profit. Ambiguous facts stay quiet.
        const ambiguous = data.warnings.some(
          (warning) => warning !== 'publications_unavailable'
        );
        if (!ready || !enabled || ambiguous || !gains.length) return;
        this.clearGains();
        this.burstId.update((id) => id + 1);
        this.gains.set(gains);
        this.timer = setTimeout(() => this.clearGains(), 5000);
      });
    });
    inject(DestroyRef).onDestroy(() => this.clearGains());
  }

  toggle(): void {
    this.enabled.update((enabled) => !enabled);
    if (!this.enabled()) this.clearGains();
    try {
      this.document.defaultView?.localStorage.setItem(
        preferenceKey,
        this.enabled() ? 'on' : 'off'
      );
    } catch {
      // The choice still applies for this page when storage is unavailable.
    }
  }

  money(minor: number, currency: string): string {
    const formatter = new Intl.NumberFormat(this.i18n.currentLanguage(), {
      style: 'currency',
      currency,
      currencyDisplay: 'code'
    });
    const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
    return formatter.format(minor / 10 ** digits);
  }

  private clearGains(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.gains.set([]);
  }
}
