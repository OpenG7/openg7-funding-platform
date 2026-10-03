import { CommonModule, DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  inject,
  signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ActivatedRoute,
  NavigationEnd,
  Router,
  RouterLink
} from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { distinctUntilChanged, filter, map, startWith } from 'rxjs';
import type {
  AdminPublicationBatchesResponse,
  AdminPublicationDraftsResponse,
  AdminPublicationSlotsResponse,
  AdminSocialPublicationJobsResponse,
  AdminSponsorshipRecord
} from '@openg7/funding-core';

import { AdminLayoutComponent } from '../../components/admin-layout/admin-layout.component.js';
import { AdminPublicationQueueComponent } from '../../components/admin-publications/admin-publication-queue.component.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';

import { AdminPublicationDraftsPanelComponent } from './panels/admin-publication-drafts-panel.component.js';
import { AdminPublicationSlotsPanelComponent } from './panels/admin-publication-slots-panel.component.js';
import { AdminPublicationBatchesPanelComponent } from './panels/admin-publication-batches-panel.component.js';
import type {
  PublicationAutomationTarget,
  PublicationLoadState
} from './publication-panels.contracts.js';

type PublicationView = 'overview' | 'drafts' | 'batches' | 'calendar';

@Component({
  selector: 'openg7-admin-publications-page',
  standalone: true,
  imports: [
    CommonModule,
    AdminLayoutComponent,
    AdminPublicationQueueComponent,
    AdminPublicationDraftsPanelComponent,
    AdminPublicationSlotsPanelComponent,
    AdminPublicationBatchesPanelComponent,
    RouterLink,
    TranslatePipe
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-publications-page.component.html',
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    './admin-publications-page.component.css'
  ]
})
export class AdminPublicationsPageComponent implements OnInit {
  private readonly admin = inject(FundingAdminService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly destroy = inject(DestroyRef);
  private loadGeneration = 0;
  readonly publicationPath = '/admin/fundraiser/publications';
  readonly publicationSpaces = ['drafts', 'batches', 'calendar'] as const;
  readonly navigationParams = signal<Record<string, string>>({});
  readonly activeView = signal<PublicationView>('overview');
  readonly selectedDraftId = signal<string | null>(null);
  readonly selectedBatchId = signal<string | null>(null);
  readonly selectedSlotId = signal<string | null>(null);
  readonly draftTargetId = signal<string | null>(null);
  readonly showEligible = signal(false);
  readonly newBatchOpen = signal(false);
  readonly newSlotOpen = signal(false);
  readonly notice = signal('');
  private readonly target = signal<string | null>(null);
  get targetId(): string | null {
    return this.target();
  }
  readonly targetFound = computed(
    () =>
      !this.targetId ||
      [
        ...this.slots(),
        ...this.batches(),
        ...this.drafts(),
        ...this.sponsorships()
      ].some((item) => item.id === this.targetId)
  );
  readonly adminToken = signal('');
  readonly sponsorships = signal<readonly AdminSponsorshipRecord[]>([]);
  readonly draftsResponse = signal<AdminPublicationDraftsResponse | null>(null);
  readonly batchesResponse = signal<AdminPublicationBatchesResponse | null>(
    null
  );
  readonly slotsResponse = signal<AdminPublicationSlotsResponse | null>(null);
  readonly socialJobsResponse =
    signal<AdminSocialPublicationJobsResponse | null>(null);
  readonly state = signal<PublicationLoadState>('idle');
  readonly drafts = computed(() => this.draftsResponse()?.drafts ?? []);
  readonly batches = computed(() => this.batchesResponse()?.batches ?? []);
  readonly slots = computed(() => this.slotsResponse()?.slots ?? []);
  // A stable callback lets panels await the single shared refresh after mutations.
  readonly reload = (): Promise<void> => this.load();

  ngOnInit(): void {
    this.adminToken.set(this.admin.getSavedAdminToken());
    this.destroy.onDestroy(() => this.loadGeneration++);
    // Read both path and query parameters after a completed navigation so a
    // history traversal cannot briefly apply parameters from two different URLs.
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        startWith(null),
        map(() => this.router.url),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroy)
      )
      .subscribe(() => {
        const params = this.route.snapshot.queryParamMap;
        const view = (this.route.snapshot.paramMap.get('workspace') ??
          'overview') as PublicationView;
        const targetView = params.has('slotId')
          ? 'calendar'
          : params.has('batchId')
            ? 'batches'
            : params.has('draftId')
              ? 'drafts'
              : null;
        // Existing attention and search links continue to open the right page.
        if (targetView && view !== targetView) {
          void this.router.navigate([this.publicationPath, targetView], {
            queryParams: this.route.snapshot.queryParams,
            replaceUrl: true
          });
          return;
        }
        const previousView = this.activeView();
        const previousTarget = this.target();
        const target =
          params.get('slotId') ||
          params.get('batchId') ||
          params.get('draftId');
        this.target.set(target);
        this.activeView.set(view);
        this.navigationParams.set(
          params.has('returnTo') ? { returnTo: params.get('returnTo')! } : {}
        );
        if (params.has('slotId')) this.selectedSlotId.set(params.get('slotId'));
        if (params.has('batchId'))
          this.selectedBatchId.set(params.get('batchId'));
        if (params.has('draftId')) {
          this.selectedDraftId.set(params.get('draftId'));
        }
        this.draftTargetId.set(params.get('draftId'));
        if (previousView !== view) this.notice.set('');
        if (this.state() === 'idle' || previousTarget !== target) {
          void this.load();
        } else if (target) {
          this.focusObject(target);
        }
        if (!target && previousView !== view) {
          afterNextRender(
            () => this.document.getElementById('publication-heading')?.focus(),
            { injector: this.injector }
          );
        }
      });
  }

  async load(): Promise<void> {
    const generation = ++this.loadGeneration;
    this.state.set('loading');

    try {
      const [sponsorships, drafts, batches, slots, socialJobs] =
        await Promise.all([
          this.loadApprovedSponsorships(generation),
          this.admin.getPublicationDrafts(
            this.adminToken(),
            this.route.snapshot.queryParamMap.get('draftId') ?? undefined
          ),
          this.admin.getPublicationBatches(
            this.adminToken(),
            this.route.snapshot.queryParamMap.get('batchId') ?? undefined
          ),
          this.admin.getPublicationSlots(
            this.adminToken(),
            this.route.snapshot.queryParamMap.get('slotId') ?? undefined
          ),
          this.admin.getSocialPublicationJobs(this.adminToken())
        ]);
      if (generation !== this.loadGeneration) return;
      this.sponsorships.set(sponsorships);
      this.draftsResponse.set(drafts);
      this.batchesResponse.set(batches);
      this.slotsResponse.set(slots);
      this.socialJobsResponse.set(socialJobs);
      this.state.set('ready');
      if (this.targetId)
        afterNextRender(
          () => {
            if (generation !== this.loadGeneration) return;
            const target = this.document.getElementById(
              'attention-object-' + this.targetId
            );
            target?.focus({ preventScroll: true });
            target?.scrollIntoView({ block: 'center' });
          },
          { injector: this.injector }
        );
      this.admin.saveAdminToken(this.adminToken());
    } catch {
      if (generation !== this.loadGeneration) return;
      this.state.set('error');
    }
  }

  private async loadApprovedSponsorships(
    generation: number
  ): Promise<readonly AdminSponsorshipRecord[]> {
    const sponsors: AdminSponsorshipRecord[] = [];
    const token = this.adminToken();
    for (let page = 1; ; page++) {
      const response = await this.admin.getSponsorships(token, {
        page,
        pageSize: 25,
        reviewStatus: 'approved',
        paymentStatus: 'paid',
        sort: 'company',
        direction: 'asc'
      });
      if (generation !== this.loadGeneration) return [];
      sponsors.push(...response.sponsorships);
      if (!response.pagination.hasNextPage) return sponsors;
    }
  }

  async focusBatch(batchId: string): Promise<void> {
    if (
      !(await this.router.navigate([this.publicationPath, 'batches'], {
        queryParams: this.navigationParams()
      }))
    )
      return;
    this.selectedBatchId.set(batchId);
    this.focusObject(batchId);
  }

  focusObject(id: string): void {
    afterNextRender(
      () => {
        const target = this.document.getElementById('attention-object-' + id);
        target?.focus({ preventScroll: true });
        target?.scrollIntoView({ block: 'center' });
      },
      { injector: this.injector }
    );
  }

  prepareDraft(): void {
    this.showEligible.set(true);
  }

  async openAutomation(target: PublicationAutomationTarget): Promise<void> {
    await this.router.navigate([this.publicationPath + '/automation'], {
      queryParams: { batchId: target.batchId, feedId: target.feedId }
    });
  }
}
