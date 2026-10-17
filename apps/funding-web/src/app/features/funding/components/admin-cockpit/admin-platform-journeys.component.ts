import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type {
  AdminPlatformJourney,
  AdminPlatformJourneyId,
  AdminPlatformJourneyObservation,
  AdminPlatformJourneyState,
  AdminPlatformJourneyStep
} from '@openg7/funding-core';

import en from '../../../../../assets/i18n/admin-platform-journeys.en.json' with { type: 'json' };
import fr from '../../../../../assets/i18n/admin-platform-journeys.fr-CA.json' with { type: 'json' };
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import {
  AdminIconComponent,
  type AdminIconName
} from '../admin-ui/admin-icon.component.js';

import { formatCockpitDateTime } from './admin-cockpit-date-time.js';
import { AdminCockpitStatusComponent } from './admin-cockpit-status.component.js';
import { createCockpitBlock } from './cockpit-block.js';
import { journeyExpired, journeyState } from './platform-journey-state.js';

/** Admin observation organism: read-only journey lights and their evidence. */
@Component({
  selector: 'openg7-admin-platform-journeys',
  standalone: true,
  imports: [
    TranslatePipe,
    RouterLink,
    AdminIconComponent,
    AdminCockpitStatusComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-platform-journeys.component.html',
  styleUrls: [
    '../admin-ui/admin-controls.css',
    './admin-platform-journeys.component.css'
  ]
})
export class AdminPlatformJourneysComponent {
  readonly refreshKey = input(0);
  readonly block = createCockpitBlock('journeys', this.refreshKey, () => true, {
    autoRefreshMs: 45_000
  });
  readonly selected = signal<AdminPlatformJourneyId | null>(null);
  readonly router = inject(Router);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly i18n = inject(FundingI18nService);
  readonly stale = computed(
    () =>
      this.block.stale() ||
      Boolean(
        this.block
          .data()
          ?.journeys.some(
            (journey) =>
              this.expired(journey) ||
              journey.steps.some((step) => this.expired(step))
          )
      )
  );
  // Refreshing the display at the next deadline prevents an expired green light
  // between the shared clock ticks, including while an API read is pending.
  private readonly expiryClock = effect((onCleanup) => {
    if (!this.browser) return;
    const now = this.block.clock();
    const data = this.block.data();
    if (!data) return;
    const deadlines = data.journeys.flatMap((journey) => [
      Date.parse(journey.validUntil),
      ...journey.steps.map((step) => Date.parse(step.validUntil))
    ]);
    deadlines.push(Date.parse(data.generatedAt) + 300_001);
    const next = Math.min(
      ...deadlines.filter((date) => Number.isFinite(date) && date > now)
    );
    if (!Number.isFinite(next)) return;
    const timer = setTimeout(
      this.block.updateClock,
      Math.max(1, next - this.block.now() + 1)
    );
    onCleanup(() => clearTimeout(timer));
  });

  constructor() {
    effect(() => {
      const language = this.i18n.currentLanguage();
      untracked(() =>
        this.i18n.mergeTranslations(language, {
          admin: { platformJourneys: language === 'en' ? en : fr }
        })
      );
    });
  }

  expired(observation: AdminPlatformJourneyObservation): boolean {
    return journeyExpired(observation, this.block.clock(), this.block.failed());
  }

  state(
    observation: AdminPlatformJourney | AdminPlatformJourneyStep
  ): AdminPlatformJourneyState {
    const failed = this.block.failed() || this.block.stale();
    if (
      'steps' in observation &&
      observation.steps.some((step) =>
        journeyExpired(step, this.block.clock(), failed)
      )
    )
      return 'unknown';
    return journeyState(observation, this.block.clock(), failed);
  }

  select(id: AdminPlatformJourneyId): void {
    this.selected.update((selected) => (selected === id ? null : id));
  }

  close(id: AdminPlatformJourneyId, event: Event): void {
    const details = event.target as HTMLDetailsElement;
    if (!details.open && this.selected() === id) {
      this.selected.set(null);
      details.ownerDocument
        .getElementById('platform-journey-control-' + id)
        ?.focus();
    }
  }

  icon(state: AdminPlatformJourneyState): AdminIconName {
    switch (state) {
      case 'operational':
        return 'check';
      case 'degraded':
        return 'warning';
      case 'unavailable':
        return 'close';
      default:
        return 'clock';
    }
  }

  date(value: string | null): string {
    return value && Number.isFinite(Date.parse(value))
      ? formatCockpitDateTime(value, this.i18n.currentLanguage())
      : this.i18n.t('admin.platformJourneys.noObservation');
  }
}
