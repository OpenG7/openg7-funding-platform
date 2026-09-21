import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type {
  AdminPublicationBatchRecord,
  AdminPublicationDraftRecord,
  AdminPublicationSlotRecord
} from '@openg7/funding-core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';

/** Read-only overview of the loaded batches, in their planned publication order. */
@Component({
  selector: 'openg7-admin-publication-queue',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-publication-queue.component.html',
  styleUrls: [
    '../admin-ui/admin-controls.css',
    './admin-publication-queue.component.css'
  ]
})
export class AdminPublicationQueueComponent {
  readonly batches = input.required<readonly AdminPublicationBatchRecord[]>();
  readonly drafts = input.required<readonly AdminPublicationDraftRecord[]>();
  readonly slots = input.required<readonly AdminPublicationSlotRecord[]>();
  readonly state = input.required<'idle' | 'loading' | 'ready' | 'error'>();
  readonly openBatch = output<string>();
  readonly retry = output<void>();
  readonly i18n = inject(FundingI18nService);
  private readonly destroy = inject(DestroyRef);
  private readonly viewport = viewChild<ElementRef<HTMLElement>>('viewport');
  private readonly track = viewChild<ElementRef<HTMLElement>>('track');
  readonly canGoBack = signal(false);
  readonly canGoForward = signal(false);

  readonly queue = computed(() => {
    const slots = new Map(this.slots().map((slot) => [slot.id, slot]));
    const drafts = this.drafts();
    return this.batches()
      .filter(
        (batch) => batch.status === 'scheduled' || batch.status === 'open'
      )
      .map((batch) => {
        const slot = batch.slotId ? slots.get(batch.slotId) : undefined;
        const members = drafts.filter((draft) => draft.batch_id === batch.id);
        const date = batch.status === 'scheduled' ? batch.scheduledAt : null;
        const scheduledAt =
          date && Number.isFinite(Date.parse(date)) ? date : null;
        const targets = slot
          ? [slot.feedTarget]
          : [...new Set(members.map((draft) => draft.feed_target))].sort();
        const companies = members
          .map((draft) => draft.sponsor_company_name)
          .filter(Boolean)
          .slice(0, 2);
        return {
          batch,
          scheduledAt,
          timezone: slot?.timezone ?? 'America/Toronto',
          targets: targets
            .map((target) => (target === 'openg20' ? 'OpenG20' : 'OpenG7'))
            .join(' · '),
          companies,
          otherCompanies: Math.max(0, batch.capacityUsed - companies.length)
        };
      })
      .sort((a, b) => {
        if (a.scheduledAt && !b.scheduledAt) return -1;
        if (!a.scheduledAt && b.scheduledAt) return 1;
        if (a.scheduledAt && b.scheduledAt) {
          const difference =
            Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt);
          if (difference) return difference;
        }
        return (
          a.batch.createdAt.localeCompare(b.batch.createdAt) ||
          a.batch.id.localeCompare(b.batch.id)
        );
      });
  });
  readonly scheduledCount = computed(
    () => this.queue().filter((item) => item.scheduledAt).length
  );
  readonly undatedCount = computed(
    () => this.queue().length - this.scheduledCount()
  );

  constructor() {
    afterNextRender(() => {
      const viewport = this.viewport()?.nativeElement;
      const track = this.track()?.nativeElement;
      if (!viewport || !track) return;
      const observer = new ResizeObserver(() => this.updateNavigation());
      observer.observe(viewport);
      observer.observe(track);
      this.updateNavigation();
      this.destroy.onDestroy(() => observer.disconnect());
    });
  }

  updateNavigation(): void {
    const viewport = this.viewport()?.nativeElement;
    if (!viewport) return;
    this.canGoBack.set(viewport.scrollLeft > 1);
    this.canGoForward.set(
      viewport.scrollLeft + viewport.clientWidth < viewport.scrollWidth - 1
    );
  }

  move(direction: -1 | 1): void {
    const viewport = this.viewport()?.nativeElement;
    const card = this.track()?.nativeElement.firstElementChild;
    if (!viewport || !card) return;
    viewport.scrollBy({
      left: direction * (card.getBoundingClientRect().width + 16)
    });
  }

  navigate(event: KeyboardEvent): void {
    // Keep the arrow keys of links/buttons available to their own controls.
    if (event.target !== event.currentTarget) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      this.move(event.key === 'ArrowLeft' ? -1 : 1);
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const viewport = this.viewport()?.nativeElement;
      viewport?.scrollTo({
        left: event.key === 'Home' ? 0 : viewport.scrollWidth
      });
    }
  }

  dateLabel(value: string, timezone: string): string {
    try {
      return new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: timezone
      }).format(new Date(value));
    } catch {
      // Preserve an explicit instant if an older record has an invalid timezone.
      return value;
    }
  }
}
