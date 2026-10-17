import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  signal,
  TemplateRef,
  viewChild
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { PilotAppearanceService } from '../../services/pilot-appearance.service.js';
import { AdminNavComponent } from '../admin-nav/admin-nav.component.js';
import { AdminGuidanceComponent } from '../admin-guidance/admin-guidance.component.js';
import { AdminGlobalSearchComponent } from '../admin-search/admin-global-search.component.js';
import { AdminIconComponent } from '../admin-ui/admin-icon.component.js';
import { AdminInspectorComponent } from '../admin-inspector/admin-inspector.component.js';
import { AdminConfirmationComponent } from '../admin-ui/admin-confirmation.component.js';
import { ContributionActivityComponent } from '../contribution-activity/contribution-activity.component.js';
import { FundingModerationPanelComponent } from '../admin-moderation/funding-moderation-panel.component.js';
import { AdminControllerComponent } from '../admin-controller/admin-controller.component.js';
import { AdminSandboxService } from '../../services/admin-sandbox.service.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';

/** Admin page template: placement and navigation, no business data loading. */
@Component({
  selector: 'openg7-admin-layout',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    RouterLink,
    TranslatePipe,
    AdminNavComponent,
    AdminGuidanceComponent,
    AdminIconComponent,
    AdminGlobalSearchComponent,
    AdminInspectorComponent,
    AdminConfirmationComponent,
    FundingModerationPanelComponent,
    AdminControllerComponent,
    ContributionActivityComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a
      class="skip-link"
      href="#admin-main"
      (click)="$event.preventDefault(); main.focus()"
    >
      {{ 'admin.shell.skip' | translate }}
    </a>
    <div
      class="layout"
      [class.navigation-collapsed]="navigationCollapsed()"
      [class.pilotage-layout]="pilotage()"
      [class.concentrated]="concentrated()"
      [class.controller-shell]="controllerRadial() && controllerDeck()"
      [class.controller-shell-expanded]="controllerExpanded()"
      [class.sandbox-controller-open]="
        sandbox.available() && sandbox.virtualOpen()
      "
      data-og7="admin-layout"
    >
      <openg7-admin-nav id="admin-sidebar" [collapsible]="true" />
      <div class="workspace">
        <header class="topbar">
          <button
            class="admin-button navigation-toggle"
            type="button"
            data-og7="admin-navigation-toggle"
            (click)="navigationCollapsed.set(!navigationCollapsed())"
            [attr.aria-expanded]="!navigationCollapsed()"
            aria-controls="admin-sidebar"
            [attr.aria-label]="
              (navigationCollapsed() ? 'admin.nav.open' : 'admin.nav.close')
                | translate
            "
            [title]="
              (navigationCollapsed() ? 'admin.nav.open' : 'admin.nav.close')
                | translate
            "
          >
            <openg7-admin-icon name="menu" />
          </button>
          <openg7-admin-global-search />
          <div class="tools">
            @if (guidance.guidance.available()) {
              @let count = pendingDossierCount();
              @let hasDossiers = count !== null && count > 0;
              <button
                class="admin-button admin-button--primary new-passage"
                type="button"
                data-og7="admin-automatic-portfolio-start"
                aria-describedby="admin-new-passage-count-description"
                [title]="pendingDossierDescription()"
                [disabled]="guidance.portfolioStartDisabled()"
                (click)="guidance.startPortfolio()"
              >
                <span
                  class="new-passage-bell"
                  [class.active]="hasDossiers"
                  data-og7="admin-automatic-portfolio-bell"
                  [attr.data-og7-id]="hasDossiers ? 'active' : 'inactive'"
                  aria-hidden="true"
                  ><openg7-admin-icon
                    [name]="hasDossiers ? 'bellActive' : 'bell'"
                /></span>
                <span>{{ 'admin.shell.startPass' | translate }}</span>
                <span
                  class="new-passage-count"
                  [class.active]="hasDossiers"
                  data-og7="admin-automatic-portfolio-count"
                  aria-hidden="true"
                  >{{ count ?? '—' }}</span
                >
              </button>
              <span
                class="visually-hidden"
                id="admin-new-passage-count-description"
                role="status"
                aria-live="polite"
                aria-atomic="true"
                >{{ pendingDossierDescription() }}</span
              >
            }
            <openg7-contribution-activity />
            <a
              class="admin-button"
              routerLink="/admin/fundraiser/assistant"
              [queryParams]="
                sponsorshipId() ? { sponsorshipId: sponsorshipId() } : {}
              "
            >
              <openg7-admin-icon name="assistant" />{{
                'admin.nav.assistant' | translate
              }}
            </a>
            <button
              class="admin-button"
              type="button"
              (click)="i18n.toggleLanguage()"
              [attr.aria-label]="
                (i18n.currentLanguage() === 'fr-CA'
                  ? 'admin.shell.toEnglish'
                  : 'admin.shell.toFrench'
                ) | translate
              "
            >
              {{ i18n.currentLanguage() === 'fr-CA' ? 'EN' : 'FR' }}
            </button>
            <span class="identity"
              ><openg7-admin-icon name="audit" /><span>{{
                'admin.shell.identity' | translate
              }}</span></span
            >
          </div>
        </header>
        <div class="guidance-tools" data-og7="admin-guidance-tools">
          <openg7-admin-guidance #guidance />
          <openg7-admin-controller />
        </div>
        <main id="admin-main" #main tabindex="-1"><ng-content /></main>
        <openg7-admin-inspector />
        <openg7-admin-confirmation />
        <openg7-funding-moderation-panel />
      </div>
      @if (controllerRadial() && controllerDeck()) {
        <div class="controller-shell-surface" aria-hidden="true">
          <span class="controller-shell-corner"></span>
        </div>
        <div
          #controllerRadialSlot
          class="controller-radial-slot"
          data-og7="controller-radial-slot"
          data-og7-controller-owner="pilotage"
        >
          <ng-container [ngTemplateOutlet]="controllerRadial()" />
        </div>
        <div
          #controllerDeckSlot
          class="controller-deck-slot"
          data-og7="controller-deck-slot"
          data-og7-controller-owner="pilotage"
        >
          <ng-container [ngTemplateOutlet]="controllerDeck()" />
        </div>
      }
      @if (sandbox.available() && sandbox.virtualOpen()) {
        <aside
          class="sandbox-controller-dock"
          data-og7="sandbox-controller-dock"
          [attr.aria-label]="'admin.controller.simulator.open' | translate"
        ></aside>
      }
    </div>
  `,
  styleUrls: [
    '../../../../../styles/admin-fonts.css',
    '../../../../../styles/admin-type-tokens.css',
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    './admin-layout.component.css'
  ]
})
export class AdminLayoutComponent {
  readonly sponsorshipId = input<string>();
  readonly pilotage = input(false);
  readonly concentrated = input(false);
  readonly controllerRadial = input<TemplateRef<unknown> | null>(null);
  readonly controllerDeck = input<TemplateRef<unknown> | null>(null);
  readonly controllerExpanded = input(true);
  readonly i18n = inject(FundingI18nService);
  readonly appearance = inject(PilotAppearanceService);
  readonly navigationCollapsed = signal(false);
  readonly sandbox = inject(AdminSandboxService);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly main = viewChild.required<ElementRef<HTMLElement>>('main');
  private readonly radialSlot = viewChild<ElementRef<HTMLElement>>(
    'controllerRadialSlot'
  );
  private readonly deckSlot =
    viewChild<ElementRef<HTMLElement>>('controllerDeckSlot');
  private readonly admin = inject(FundingAdminService);
  readonly pendingDossierCount = computed(() => {
    const queue = this.admin.workQueue();
    const count = queue?.pendingDossierCount;
    if (
      !queue?.available ||
      queue.coverage !== 'complete' ||
      queue.missingSources.length ||
      typeof count !== 'number' ||
      !Number.isSafeInteger(count) ||
      count < 0
    )
      return null;
    return count;
  });

  constructor() {
    let disconnect = (): void => {};
    // Render effects run only in the browser and also follow dynamically supplied templates.
    afterRenderEffect((onCleanup) => {
      const radial = this.radialSlot()?.nativeElement;
      const deck = this.deckSlot()?.nativeElement;
      if (!radial || !deck || typeof ResizeObserver === 'undefined') return;
      const root = this.element.nativeElement;
      const document = root.ownerDocument;
      const slots = [radial, deck];
      let lastFocused: HTMLElement | null = null;
      const rememberFocus = (event: FocusEvent): void => {
        const target = event.target;
        lastFocused =
          target instanceof HTMLElement &&
          slots.some((slot) => slot.contains(target))
            ? target
            : null;
      };
      const forgetFocus = (event: FocusEvent): void => {
        if (event.target !== lastFocused) return;
        // A CSS-hidden control may blur to body before ResizeObserver is notified.
        // Remember only that case; intentional focus changes must never be reclaimed.
        if (event.relatedTarget || lastFocused?.getClientRects().length)
          lastFocused = null;
      };
      const restoreVisibleFocus = (): void => {
        const active = document.activeElement;
        const previous =
          active instanceof HTMLElement &&
          slots.some((slot) => slot.contains(active))
            ? active
            : active === document.body
              ? lastFocused
              : null;
        if (!previous || previous.getClientRects().length) return;
        lastFocused = null;
        const fallback = Array.from(
          radial.querySelectorAll<HTMLButtonElement>(
            'button:not(:disabled):not([aria-disabled="true"])'
          )
        ).find((button) => button.getClientRects().length > 0);
        if (fallback) fallback.focus();
        else this.main().nativeElement.focus({ preventScroll: true });
      };
      root.addEventListener('focusin', rememberFocus);
      root.addEventListener('focusout', forgetFocus);
      const observer = new ResizeObserver(restoreVisibleFocus);
      for (const slot of slots) observer.observe(slot);
      disconnect = (): void => {
        observer.disconnect();
        root.removeEventListener('focusin', rememberFocus);
        root.removeEventListener('focusout', forgetFocus);
      };
      onCleanup(disconnect);
    });
    inject(DestroyRef).onDestroy(() => disconnect());
  }

  pendingDossierDescription(): string {
    const count = this.pendingDossierCount();
    return count === null
      ? this.i18n.t('admin.shell.startPassCountUnavailable')
      : this.i18n.t('admin.shell.startPassDossierCount', { count });
  }
}
