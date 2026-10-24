import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  afterNextRender,
  effect,
  inject,
  signal
} from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { AdminGuidanceService } from '../../services/admin-guidance.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';
import { AdminSandboxService } from '../../services/admin-sandbox.service.js';
import type { ControllerIntent } from '../admin-pilotage/controller-input.js';
import { ControllerService } from '../admin-pilotage/controller.service.js';
import { AdminDrawerComponent } from '../admin-ui/admin-drawer.component.js';

import { AdminControllerEditorComponent } from './admin-controller-editor.component.js';
import { VirtualControllerComponent } from './virtual-controller.component.js';
import { AdminSandboxScenariosComponent } from './admin-sandbox-scenarios.component.js';
import {
  controllerControls,
  controllerEditable,
  controllerFocusVisible,
  controllerScope,
  moveControllerFocus,
  revealControllerFocus,
  scrollControllerFocus
} from './admin-controller-navigation.js';

/** Layout-wide controller adapter. It activates existing UI, never business APIs. */
@Component({
  selector: 'openg7-admin-controller',
  standalone: true,
  imports: [
    TranslatePipe,
    AdminDrawerComponent,
    AdminControllerEditorComponent,
    VirtualControllerComponent,
    AdminSandboxScenariosComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-og7-controller-global': '' },
  templateUrl: './admin-controller.component.html',
  styleUrls: [
    '../admin-ui/admin-controls.css',
    './admin-controller.component.css'
  ]
})
export class AdminControllerComponent {
  readonly controller = inject(ControllerService);
  readonly i18n = inject(FundingI18nService);
  readonly guidance = inject(AdminGuidanceService);
  readonly sandbox = inject(AdminSandboxService);
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly admin = inject(FundingAdminService);
  readonly menu = signal(false);
  readonly editing = signal<HTMLInputElement | HTMLTextAreaElement | null>(
    null
  );
  readonly selecting = signal<HTMLSelectElement | null>(null);
  readonly selected = signal<number[]>([]);
  readonly selectionError = signal('');
  readonly languageReady = signal(false);
  private selectionVersion = '';
  private marked: HTMLElement | null = null;
  private generation: number | undefined;

  constructor() {
    const destroy = inject(DestroyRef);
    let disposed = false;
    destroy.onDestroy(() => {
      disposed = true;
    });
    effect((onCleanup) => {
      const language = this.i18n.currentLanguage();
      this.languageReady.set(false);
      let current = true;
      onCleanup(() => {
        current = false;
      });
      const locale =
        language === 'en'
          ? import('../../../../../assets/i18n/admin-controller.en.json')
          : import('../../../../../assets/i18n/admin-controller.fr-CA.json');
      void locale
        .then(({ default: translations }) => {
          if (disposed || !current) return;
          this.i18n.mergeTranslations(language, {
            admin: { controller: translations }
          });
          this.languageReady.set(true);
        })
        .catch(() => {
          // The standard UI remains usable; do not show untranslated controller panels.
          if (!disposed && current) this.languageReady.set(false);
        });
    });
    effect(() => {
      const generation = this.admin.sessionGeneration();
      if (this.generation !== undefined && this.generation !== generation) {
        this.editing.set(null);
        this.selecting.set(null);
        this.menu.set(false);
        this.controller.releaseVirtual();
        this.clearFocus();
      }
      this.generation = generation;
    });
    afterNextRender(() => {
      const detach = this.controller.attach((intent) => this.intent(intent), {
        priority: 0,
        keyboard: false
      });
      const detachVisibility = this.controller.attach(
        (intent) => {
          if (!['primary', 'edit'].includes(intent)) return false;
          const active = this.document.activeElement as HTMLElement | null;
          const scope = controllerScope(this.document);
          if (
            !active ||
            !controllerControls(scope).includes(active) ||
            controllerFocusVisible(active)
          )
            return false;
          this.focus(active);
          this.controller.reset();
          return true;
        },
        { priority: 1000, keyboard: false }
      );
      const reset = () => {
        this.controller.releaseVirtual();
        this.editing.set(null);
        this.selecting.set(null);
        this.menu.set(false);
        this.clearFocus();
      };
      const subscription = this.router.events.subscribe(reset);
      const clearPointerFocus = () => this.clearFocus();
      this.document.addEventListener('pointerdown', clearPointerFocus);
      destroy.onDestroy(() => {
        detach();
        detachVisibility();
        subscription.unsubscribe();
        this.document.removeEventListener('pointerdown', clearPointerFocus);
        this.clearFocus();
      });
    });
  }

  options(): { index: number; label: string; disabled: boolean }[] {
    return Array.from(this.selecting()?.options ?? []).map((option, index) => ({
      index,
      label: option.label,
      disabled:
        option.disabled ||
        option.parentElement?.matches('optgroup:disabled') === true
    }));
  }

  choose(index: number): void {
    if (!this.selecting()?.multiple) this.selected.set([index]);
    else
      this.selected.update((values) =>
        values.includes(index)
          ? values.filter((value) => value !== index)
          : [...values, index]
      );
  }

  applySelection(): void {
    const target = this.selecting();
    if (
      !target?.isConnected ||
      target.matches(':disabled,[aria-disabled="true"]') ||
      target.closest(
        '[inert],[hidden],[aria-hidden="true"],[aria-disabled="true"]'
      ) ||
      target.getClientRects().length === 0 ||
      ['hidden', 'collapse'].includes(
        this.document.defaultView?.getComputedStyle(target).visibility ??
          'hidden'
      )
    ) {
      this.selectionError.set(
        this.i18n.t('admin.controller.editor.unavailable')
      );
      return;
    }
    if (this.selectVersion(target) !== this.selectionVersion) {
      this.selectionError.set(this.i18n.t('admin.controller.editor.changed'));
      return;
    }
    const probe = target.cloneNode(true) as HTMLSelectElement;
    for (const [index, option] of Array.from(probe.options).entries()) {
      option.selected = this.selected().includes(index);
    }
    if (!probe.checkValidity()) {
      this.selectionError.set(
        probe.validationMessage ||
          this.i18n.t('admin.controller.editor.invalid')
      );
      return;
    }
    for (const [index, option] of Array.from(target.options).entries())
      option.selected = this.selected().includes(index);
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    target.dispatchEvent(new Event('blur'));
    this.closeSelection();
  }

  closeSelection(): void {
    const target = this.selecting();
    this.selecting.set(null);
    this.selectionVersion = '';
    this.selectionError.set('');
    this.controller.reset();
    if (target?.isConnected) target.focus();
  }

  closeEditor(): void {
    const target = this.editing();
    this.editing.set(null);
    this.controller.reset();
    if (target?.isConnected) target.focus();
  }

  showMenu(): void {
    this.menu.set(true);
    this.controller.reset();
  }

  showGuide(): void {
    if (!this.guidance.enabled()) this.guidance.toggle();
    this.menu.set(false);
    this.controller.reset();
    this.document.defaultView?.requestAnimationFrame(() => {
      const target = [
        'payment-journey-next',
        'payment-journey-resume',
        'admin-guidance-show',
        'admin-guidance-toggle'
      ]
        .map((hook) =>
          this.document.querySelector<HTMLElement>(`[data-og7="${hook}"]`)
        )
        .find((element) => element && element.getClientRects().length > 0);
      if (target) this.focus(target);
    });
  }

  intent(intent: ControllerIntent): boolean {
    if (!this.controller.enabled() || !this.languageReady()) return false;
    const scope = controllerScope(this.document);
    const active = this.document.activeElement as HTMLElement | null;
    if (
      ['left', 'right'].includes(intent) &&
      active?.matches('input[type="range"]:not(:disabled)') &&
      scope.contains(active)
    ) {
      const target = active as HTMLInputElement;
      if (intent === 'right') target.stepUp();
      else target.stepDown();
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    if (['previous', 'next', 'up', 'down', 'left', 'right'].includes(intent)) {
      moveControllerFocus(this.document, intent);
      this.markFocus();
      return true;
    }
    if (intent === 'scrollDown' || intent === 'scrollUp') {
      scrollControllerFocus(
        this.document,
        intent === 'scrollDown' ? 140 : -140
      );
      return true;
    }
    if (intent === 'secondary') {
      const disclosure = active?.closest(
        '[data-og7-controller-back="disclosure"][open]'
      );
      if (disclosure && scope.contains(disclosure)) {
        const event = new KeyboardEvent('keydown', {
          key: 'Escape',
          code: 'Escape',
          bubbles: true,
          cancelable: true
        });
        if (!active!.dispatchEvent(event)) {
          this.controller.reset();
          this.markFocus();
          return true;
        }
      }
      if (scope.matches('dialog[open]')) {
        const event = new Event('cancel', { cancelable: true });
        if (scope.dispatchEvent(event)) (scope as HTMLDialogElement).close();
      } else if (
        active?.closest('[data-og7="admin-guidance"]') &&
        this.guidance.enabled()
      ) {
        this.guidance.toggle();
        this.document.getElementById('admin-main')?.focus();
      } else this.document.getElementById('admin-main')?.focus();
      this.controller.reset();
      this.markFocus();
      return true;
    }
    if (intent === 'menu' || intent === 'help') {
      // A modal retains ownership. Never open tools over a business confirmation.
      if (!scope.matches('dialog[open]')) this.showMenu();
      return true;
    }
    if (intent === 'details') {
      if (!scope.matches('dialog[open]')) this.showGuide();
      return true;
    }
    if (intent !== 'primary' && intent !== 'edit') return false;
    if (
      !active ||
      !scope.contains(active) ||
      !controllerControls(scope).includes(active)
    ) {
      const first = controllerControls(scope)[0];
      if (first) this.focus(first);
      this.controller.reset();
      return true;
    }
    if (!controllerFocusVisible(active)) {
      this.focus(active);
      this.controller.reset();
      return true;
    }
    if (controllerEditable(active)) {
      this.editing.set(active);
      this.controller.reset();
    } else if (intent === 'primary') {
      if (active.tagName === 'SELECT') {
        const target = active as HTMLSelectElement;
        this.selectionVersion = this.selectVersion(target);
        this.selectionError.set('');
        this.selecting.set(target);
        this.selected.set(
          Array.from(target.options).flatMap((option, index) =>
            option.selected ? [index] : []
          )
        );
      } else if (active.matches('input[type="range"]')) {
        const target = active as HTMLInputElement;
        target.stepUp();
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
      } else active.click();
      this.controller.reset();
    }
    this.markFocus();
    return true;
  }

  private focus(target: HTMLElement): void {
    revealControllerFocus(target);
    this.markFocus();
  }

  private selectVersion(target: HTMLSelectElement): string {
    return JSON.stringify(
      Array.from(target.options).map((option) => [
        option.value,
        option.label,
        option.disabled || option.parentElement?.matches('optgroup:disabled'),
        option.selected
      ])
    );
  }

  private markFocus(): void {
    this.clearFocus();
    const active = this.document.activeElement as HTMLElement | null;
    if (active && active !== this.document.body) {
      this.marked = active;
      active.setAttribute('data-og7-controller-focus', 'true');
    }
  }

  private clearFocus(): void {
    this.marked?.removeAttribute('data-og7-controller-focus');
    this.marked = null;
  }
}
