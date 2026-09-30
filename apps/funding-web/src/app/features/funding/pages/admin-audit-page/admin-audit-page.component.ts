import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import {
  DestroyRef,
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal
} from '@angular/core';
import type {
  AdminAuditLogEntry,
  AdminAuditLogResponse
} from '@openg7/funding-core';

import { AdminInspectionService } from '../../services/admin-inspection.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminIconComponent } from '../../components/admin-ui/admin-icon.component.js';
import { AdminLayoutComponent } from '../../components/admin-layout/admin-layout.component.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';

@Component({
  selector: 'openg7-admin-audit-page',
  standalone: true,
  imports: [TranslatePipe, AdminLayoutComponent, AdminIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-audit-page.component.html',
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-forms.css',
    './admin-audit-page.component.css'
  ]
})
export class AdminAuditPageComponent implements OnInit {
  readonly i18n = inject(FundingI18nService);
  private readonly destroyRef = inject(DestroyRef);
  private requestGeneration = 0;
  private exactId: string | undefined;
  private readonly route = inject(ActivatedRoute);

  readonly inspection = inject(AdminInspectionService);
  private readonly admin = inject(FundingAdminService);

  readonly adminToken = signal<string>('');
  readonly response = signal<AdminAuditLogResponse | null>(null);
  readonly state = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  readonly search = signal<string>('');
  readonly pageSize = 20;
  private readonly requestedPage = signal(1);
  readonly entries = computed(() => this.response()?.entries ?? []);
  readonly filteredEntries = computed(() => {
    const search = this.search().trim().toLowerCase();

    if (!search) {
      return this.entries();
    }

    return this.entries().filter((entry) =>
      [
        entry.action,
        entry.entity_type,
        entry.entity_id,
        entry.summary,
        entry.actor
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(search)
    );
  });

  readonly pageCount = computed(() =>
    Math.max(1, Math.ceil(this.filteredEntries().length / this.pageSize))
  );
  readonly page = computed(() =>
    Math.min(this.requestedPage(), this.pageCount())
  );
  readonly visibleEntries = computed(() => {
    const start = (this.page() - 1) * this.pageSize;
    return this.filteredEntries().slice(start, start + this.pageSize);
  });

  ngOnInit(): void {
    this.adminToken.set(this.admin.getSavedAdminToken());
    this.destroyRef.onDestroy(() => {
      this.requestGeneration++;
    });
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        this.exactId = params.get('entryId') ?? undefined;
        this.response.set(null);
        this.clearSearch();

        void this.loadAuditLog();
      });
  }

  async loadAuditLog(): Promise<void> {
    const generation = ++this.requestGeneration;
    this.state.set('loading');

    try {
      const result = await this.admin.getAuditLog(
        this.adminToken(),
        this.exactId
      );
      if (generation !== this.requestGeneration) return;
      this.response.set(result);
      this.requestedPage.set(this.page());
      this.state.set('ready');
      this.admin.saveAdminToken(this.adminToken());
    } catch {
      if (generation !== this.requestGeneration) return;
      this.state.set('error');
    }
  }

  setSearch(event: Event): void {
    this.search.set(this.valueFromEvent(event));
    this.requestedPage.set(1);
  }

  clearSearch(): void {
    this.search.set('');
    this.requestedPage.set(1);
  }

  previousPage(): void {
    this.requestedPage.set(Math.max(1, this.page() - 1));
  }

  nextPage(): void {
    this.requestedPage.set(Math.min(this.pageCount(), this.page() + 1));
  }

  entityLabel(entry: AdminAuditLogEntry): string {
    return entry.entity_id
      ? `${entry.entity_type} ${entry.entity_id}`
      : entry.entity_type;
  }

  dateLabel(value: string | null): string {
    if (!value) {
      return this.i18n.t('admin.dashboard.notAvailable');
    }

    return new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value));
  }

  private valueFromEvent(event: Event): string {
    return (event.target as HTMLInputElement | null)?.value ?? '';
  }
}
