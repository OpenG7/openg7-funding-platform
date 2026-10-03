import { TranslatePipe } from '@ngx-translate/core';
import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal
} from '@angular/core';
import type { AdminTransparencyResponse } from '@openg7/funding-core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminLayoutComponent } from '../../components/admin-layout/admin-layout.component.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';

import { AdminTransparencySummaryComponent } from './admin-transparency-summary.component.js';
import { AdminTransparencySnapshotComponent } from './admin-transparency-snapshot.component.js';
import { AdminTransparencyAllocationsComponent } from './admin-transparency-allocations.component.js';
import type {
  AdminTransparencyDateFormatter,
  AdminTransparencyMoneyFormatter
} from './admin-transparency-presentation.models.js';

@Component({
  selector: 'openg7-admin-transparency-page',
  standalone: true,
  imports: [
    TranslatePipe,
    CommonModule,
    AdminLayoutComponent,
    AdminTransparencySummaryComponent,
    AdminTransparencySnapshotComponent,
    AdminTransparencyAllocationsComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-transparency-page.component.html',
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-forms.css',
    './admin-transparency-page.component.css'
  ]
})
export class AdminTransparencyPageComponent implements OnInit {
  readonly i18n = inject(FundingI18nService);
  private readonly admin = inject(FundingAdminService);
  private readonly destroy = inject(DestroyRef);
  private loadGeneration = 0;

  readonly adminToken = signal<string>('');
  readonly transparency = signal<AdminTransparencyResponse | null>(null);
  readonly state = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  readonly publishedExpenses = computed(
    () =>
      this.transparency()?.expenses.filter((expense) =>
        ['published', 'active'].includes(expense.status)
      ) ?? []
  );

  ngOnInit(): void {
    this.adminToken.set(this.admin.getSavedAdminToken());
    this.destroy.onDestroy(() => this.loadGeneration++);
    void this.loadTransparency();
  }

  async loadTransparency(): Promise<void> {
    if (this.destroy.destroyed) return;
    const generation = ++this.loadGeneration;
    const token = this.adminToken();
    this.state.set('loading');

    try {
      const response = await this.admin.getTransparency(token);
      if (generation !== this.loadGeneration) return;
      this.transparency.set(response);
      this.state.set('ready');
      this.admin.saveAdminToken(token);
    } catch {
      if (generation !== this.loadGeneration) return;
      this.state.set('error');
    }
  }

  setAdminToken(event: Event): void {
    this.adminToken.set(this.valueFromEvent(event));
    this.admin.saveAdminToken(this.adminToken());
  }

  readonly formatMoney: AdminTransparencyMoneyFormatter = (
    amount,
    currency
  ) => {
    return new Intl.NumberFormat(this.i18n.currentLanguage(), {
      style: 'currency',
      currency: currency || 'CAD'
    }).format(amount);
  };

  readonly dateLabel: AdminTransparencyDateFormatter = (value) => {
    if (!value) {
      return this.i18n.t('admin.dashboard.notAvailable');
    }

    return new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value));
  };

  private valueFromEvent(event: Event): string {
    return (event.target as HTMLInputElement | null)?.value ?? '';
  }
}
