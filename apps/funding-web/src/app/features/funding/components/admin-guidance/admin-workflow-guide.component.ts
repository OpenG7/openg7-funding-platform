import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  effect,
  inject,
  output,
  signal,
  untracked
} from '@angular/core';
import { RouterLink } from '@angular/router';

import fr from '../../../../../assets/i18n/admin-workflow-guide.fr-CA.json' with { type: 'json' };
import en from '../../../../../assets/i18n/admin-workflow-guide.en.json' with { type: 'json' };
import { AdminGuidanceService } from '../../services/admin-guidance.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { adminContentRegions } from '../admin-layout/admin-content-scope.js';

import { ADMIN_WORKFLOW_GUIDE_JOURNEYS } from './admin-workflow-guide.catalog.js';
import { highlightGuidanceRegions } from './admin-guidance-highlight.js';
import {
  guidanceSpace,
  revealGuidanceRegion
} from './admin-guidance-scroll.js';

/** Reading-only journey explorer. Navigation opens disclosures, never business controls. */
@Component({
  selector: 'openg7-admin-workflow-guide',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './admin-workflow-guide.component.html',
  styleUrls: [
    '../admin-ui/admin-controls.css',
    './admin-workflow-guide.component.css'
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AdminWorkflowGuideComponent {
  readonly guidance = inject(AdminGuidanceService);
  readonly journeys = ADMIN_WORKFLOW_GUIDE_JOURNEYS;
  readonly moveRequested = output<void>();
  readonly missing = signal(false);
  readonly refresh = signal(0);
  readonly journey = computed(
    () =>
      this.journeys.find(
        (entry) => entry.id === this.guidance.workflow().journeyId
      ) ?? this.journeys[0]!
  );
  readonly step = computed(
    () => this.journey().steps[this.guidance.workflow().step]!
  );
  readonly context = computed(() => {
    if (this.guidance.page()?.id !== 'sponsors') return null;
    const id = this.guidance.paymentContext();
    return id &&
      /(?:[?&])tab=publication(?:[&#]|$)/.test(this.guidance.navigationUrl())
      ? id
      : null;
  });
  readonly dossierParams = computed(() => ({
    sponsorshipId: this.guidance.paymentContext() ?? undefined,
    tab: 'publication'
  }));
  private readonly i18n = inject(FundingI18nService);
  private readonly document = inject(DOCUMENT);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    effect(() => {
      const language = this.i18n.currentLanguage();
      untracked(() =>
        this.i18n.mergeTranslations(language, {
          admin: { workflowGuide: language === 'en' ? en : fr }
        })
      );
    });
    afterRenderEffect((onCleanup) => {
      const position = this.guidance.workflow();
      const context = this.context();
      const step = this.step();
      this.guidance.navigationUrl();
      this.refresh();
      this.missing.set(false);
      if (position.paused || !context) return;
      const view = this.document.defaultView;
      const layout = this.element.nativeElement.closest<HTMLElement>(
        '[data-og7="admin-layout"]'
      );
      if (!view || !layout) return;
      let release: (() => void) | undefined;
      let frame = 0;
      let revealFrame = 0;
      let reveal = true;
      let expanded = false;
      let current: HTMLElement[] = [];
      const update = () => {
        frame = 0;
        const dossier = adminContentRegions(layout).flatMap((scope) =>
          Array.from(
            scope.querySelectorAll<HTMLElement>(
              `[data-og7="sponsorship-dossier"][data-og7-id="${context}"]`
            )
          )
        )[0];
        // A modal owns interaction until the user closes it in its usual screen.
        if (this.document.querySelector('dialog[open]')) {
          release?.();
          release = undefined;
          current = [];
          return;
        }
        const regions = step.targets
          .flatMap((hook) =>
            Array.from(
              dossier?.querySelectorAll<HTMLElement>(`[data-og7="${hook}"]`) ??
                []
            )
          )
          .filter((region) => {
            if (region.closest('[hidden]')) return false;
            // Native disclosures are presentation only; business buttons are never activated.
            for (
              let parent: HTMLElement | null = region;
              !expanded && parent && parent !== dossier;
              parent = parent.parentElement
            )
              if (parent instanceof HTMLDetailsElement && !parent.open)
                parent.open = true;
            return (
              region.getClientRects().length > 0 &&
              view.getComputedStyle(region).visibility !== 'hidden'
            );
          });
        this.missing.set(regions.length === 0);
        if (regions.length) expanded = true;
        if (
          regions.length === current.length &&
          regions.every((region, index) => region === current[index])
        )
          return;
        release?.();
        current = regions;
        release = regions.length
          ? highlightGuidanceRegions(regions, view)
          : undefined;
        if (!reveal || !regions[0]) return;
        reveal = false;
        const landmark = regions[0];
        const target =
          landmark.querySelector<HTMLElement>(
            'h1,h2,h3,h4,h5,legend,summary'
          ) ?? landmark;
        const card = this.element.nativeElement.closest<HTMLElement>(
          '[data-og7="admin-guidance"]'
        );
        target.scrollIntoView({
          block: 'nearest',
          inline: 'nearest',
          behavior: 'instant'
        });
        const space = guidanceSpace(
          landmark,
          card?.getBoundingClientRect(),
          view
        );
        card?.classList.toggle('at-bottom');
        const alternative = guidanceSpace(
          landmark,
          card?.getBoundingClientRect(),
          view
        );
        card?.classList.toggle('at-bottom');
        if (alternative.bottom - alternative.top > space.bottom - space.top)
          this.moveRequested.emit();
        revealFrame = view.requestAnimationFrame(() => {
          revealFrame = 0;
          if (landmark.isConnected)
            revealGuidanceRegion(
              landmark,
              target,
              card?.getBoundingClientRect(),
              view
            );
        });
      };
      const schedule = () => {
        if (frame) view.cancelAnimationFrame(frame);
        frame = view.requestAnimationFrame(update);
      };
      const observer = new MutationObserver(schedule);
      for (const scope of adminContentRegions(layout))
        observer.observe(scope, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['hidden', 'open', 'data-og7-id']
        });
      schedule();
      onCleanup(() => {
        observer.disconnect();
        if (frame) view.cancelAnimationFrame(frame);
        if (revealFrame) view.cancelAnimationFrame(revealFrame);
        release?.();
      });
    });
  }

  t(key: string, params?: Record<string, unknown>): string {
    return this.i18n.t('admin.workflowGuide.' + key, params);
  }
  journeyText(key: string): string {
    return this.t(`journeys.${this.journey().id}.${key}`);
  }
  stepText(key: string): string {
    return this.journeyText(`steps.${this.step().id}.${key}`);
  }
  move(offset: number): void {
    this.guidance.selectWorkflow(
      this.journey().id,
      this.guidance.workflow().step + offset
    );
  }
  show(): void {
    this.refresh.update((value) => value + 1);
  }
}
