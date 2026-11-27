import {
  Component,
  ChangeDetectionStrategy,
  signal,
  computed,
  inject,
  effect,
  untracked,
  DestroyRef
} from '@angular/core';
import type { AdminPreparationPlan } from '@openg7/funding-core';

import fr from '../../../../../assets/i18n/admin-preparation-plan.fr-CA.json' with { type: 'json' };
import en from '../../../../../assets/i18n/admin-preparation-plan.en.json' with { type: 'json' };
import { FundingAdminService } from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminGuidanceService } from '../../services/admin-guidance.service.js';

import { AdminAutomaticPortfolioClient } from './admin-automatic-portfolio.client.js';
import { AdminAutomaticPortfolioService } from './admin-automatic-portfolio.service.js';

/** Optional Funding organism: preview native defaults, then reuse the durable portfolio. */
@Component({
  selector: 'openg7-admin-preparation-plan',
  standalone: true,
  templateUrl: './admin-preparation-plan.component.html',
  styleUrls: [
    '../admin-ui/admin-controls.css',
    './admin-preparation-plan.component.css'
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AdminPreparationPlanComponent {
  private readonly admin = inject(FundingAdminService);
  private readonly guidance = inject(AdminGuidanceService);
  private readonly portfolio = inject(AdminAutomaticPortfolioService);
  private readonly i18n = inject(FundingI18nService);
  private readonly client = new AdminAutomaticPortfolioClient(this.admin);
  readonly data = signal<AdminPreparationPlan | null>(null);
  readonly loading = signal(false);
  readonly failed = signal(false);
  readonly permitted = computed(
    () =>
      this.admin.hasValidAdminSession() &&
      this.admin.identity()?.role !== 'reader' &&
      this.guidance.available() &&
      this.guidance.enabled() &&
      this.guidance.mode() === 'automatic'
  );
  readonly canStart = computed(
    () =>
      this.permitted() &&
      !this.loading() &&
      !this.portfolio.active() &&
      (!this.portfolio.snapshot().state?.run ||
        this.portfolio.snapshot().state?.run?.status === 'completed') &&
      !!this.data()?.items.length
  );
  private readonly context = computed(() =>
    JSON.stringify([
      this.admin.sessionGeneration(),
      this.admin.identity()?.id,
      this.admin.identity()?.role,
      this.admin.dataRevision()
    ])
  );
  private generation = 0;
  private destroyed = false;
  constructor() {
    this.i18n.mergeTranslations('fr-CA', { admin: { preparationPlan: fr } });
    this.i18n.mergeTranslations('en', { admin: { preparationPlan: en } });
    effect(() => {
      this.context();
      untracked(() => {
        ++this.generation;
        this.data.set(null);
        this.loading.set(false);
        this.failed.set(false);
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      ++this.generation;
      this.data.set(null);
    });
  }
  t(key: string): string {
    return this.i18n.t('admin.preparationPlan.' + key);
  }
  async load(): Promise<void> {
    if (this.loading()) return;
    const generation = ++this.generation;
    this.data.set(null);
    this.loading.set(true);
    this.failed.set(false);
    try {
      const plan = await this.client.preparationPlan();
      if (!this.destroyed && generation === this.generation)
        this.data.set(plan);
    } catch {
      if (!this.destroyed && generation === this.generation)
        this.failed.set(true);
    } finally {
      if (!this.destroyed && generation === this.generation)
        this.loading.set(false);
    }
  }
  async start(): Promise<void> {
    if (!this.canStart()) return;
    const selection = this.data()!.items.map(({ contributionId, version }) => ({
      contributionId,
      version
    }));
    this.data.set(null);
    await this.portfolio.start(selection);
  }
}
