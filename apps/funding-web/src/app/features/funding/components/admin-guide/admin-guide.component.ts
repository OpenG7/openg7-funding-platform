import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  afterRenderEffect,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild
} from '@angular/core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';

export interface AdminGuideStep {
  readonly id: string;
  /** Stable data-og7 hook; never a selector supplied by a server or user. */
  readonly target: string;
}

/** Admin presentation organism: explain existing controls without activating them. */
@Component({
  selector: 'openg7-admin-guide',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-guide.component.html',
  styleUrl: './admin-guide.component.css'
})
export class AdminGuideComponent {
  readonly guideId = input.required<string>();
  readonly accountId = input.required<string>();
  readonly steps = input.required<readonly AdminGuideStep[]>();
  readonly disabled = input(false);
  readonly activeChanged = output<boolean>();
  readonly stepChanged = output<string>();
  readonly active = signal(false);
  readonly index = signal(0);
  readonly started = signal(false);
  readonly completed = signal(false);
  readonly storageAvailable = signal(true);
  readonly ready = signal(false);
  readonly targetMissing = signal(false);
  readonly cardAtTop = signal(false);
  readonly rectangle = signal<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
  readonly current = computed(() => this.steps()[this.index()]);
  readonly last = computed(() => this.index() === this.steps().length - 1);
  readonly i18n = inject(FundingI18nService);
  private readonly document = inject(DOCUMENT);
  private readonly dialog =
    viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly card = viewChild.required<ElementRef<HTMLElement>>('card');
  private readonly advance =
    viewChild.required<ElementRef<HTMLButtonElement>>('advance');
  private opener: HTMLElement | null = null;
  private target: HTMLElement | null = null;
  private renderedStep = '';
  private storageKey = '';
  private frame = 0;
  private revealPending = false;
  private cleanup: (() => void) | null = null;

  constructor() {
    afterNextRender(() => this.ready.set(true));
    afterRenderEffect(() => {
      if (!this.ready()) return;
      const key = `og7-admin-guide:v1:${this.accountId()}:${this.guideId()}`;
      if (key !== this.storageKey) {
        this.quit();
        this.storageKey = key;
        this.restore();
      }
      const dialog = this.dialog().nativeElement;
      if (!this.active()) {
        if (dialog.open) dialog.close();
        this.stopTracking();
        this.renderedStep = '';
        this.restoreFocus();
        return;
      }
      if (!dialog.open) {
        dialog.showModal();
        this.track();
      }
      const step = this.current();
      if (step && step.id !== this.renderedStep) {
        this.renderedStep = step.id;
        this.target = this.document.querySelector<HTMLElement>(
          `[data-og7="${step.target}"]`
        );
        this.target?.scrollIntoView({
          block: 'center',
          inline: 'nearest',
          behavior: 'instant'
        });
        this.advance().nativeElement.focus({ preventScroll: true });
        this.schedule(true);
      }
    });
    inject(DestroyRef).onDestroy(() => {
      this.stopTracking();
      const dialog = this.dialog().nativeElement;
      if (dialog.open) dialog.close();
      this.restoreFocus();
    });
  }

  t(key: string): string {
    return this.i18n.t('admin.guide.' + key);
  }
  text(part: 'title' | 'body'): string {
    return this.t(`${this.guideId()}.${this.current()?.id}.${part}`);
  }
  start(): void {
    if (this.disabled() || !this.ready() || !this.steps().length) return;
    this.opener = this.document.activeElement as HTMLElement | null;
    if (this.completed()) this.index.set(0);
    this.started.set(true);
    this.completed.set(false);
    this.active.set(true);
    this.save();
    this.activeChanged.emit(true);
    this.stepChanged.emit(this.current()!.id);
  }
  previous(): void {
    if (this.index() > 0) this.go(this.index() - 1);
  }
  next(): void {
    if (this.last()) {
      this.completed.set(true);
      this.save();
      this.quit();
    } else this.go(this.index() + 1);
  }
  private go(index: number): void {
    this.index.set(index);
    this.rectangle.set(null);
    this.save();
    this.stepChanged.emit(this.current()!.id);
    // A held controller input must return to neutral at every step.
    this.activeChanged.emit(true);
  }
  quit(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    if (!this.active()) return;
    this.active.set(false);
    this.activeChanged.emit(false);
  }

  /** Consume all cockpit shortcuts while the guide owns the interaction. */
  handleIntent(intent: string): boolean {
    if (!this.active()) return false;
    if (intent === 'secondary') this.quit();
    else if (['previous', 'left'].includes(intent)) this.previous();
    else if (['next', 'right'].includes(intent)) this.next();
    else if (intent === 'primary') {
      const active = this.document.activeElement as HTMLElement | null;
      if (
        active?.matches('button:not([disabled])') &&
        this.card().nativeElement.contains(active)
      )
        active.click();
      else this.next();
    } else if (['up', 'down'].includes(intent))
      this.moveFocus(intent === 'up' ? -1 : 1);
    else if (['scrollUp', 'scrollDown'].includes(intent))
      this.card().nativeElement.scrollBy({
        top: intent === 'scrollUp' ? -120 : 120
      });
    return true;
  }
  keydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.quit(event);
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      this.moveFocus(event.shiftKey ? -1 : 1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) {
        if (event.key === 'ArrowLeft') this.previous();
        else this.next();
      }
    }
  }
  private moveFocus(direction: number): void {
    const buttons = Array.from(
      this.card().nativeElement.querySelectorAll<HTMLButtonElement>(
        'button:not([disabled])'
      )
    );
    const index = buttons.indexOf(
      this.document.activeElement as HTMLButtonElement
    );
    buttons[(index + direction + buttons.length) % buttons.length]?.focus();
  }
  private restore(): void {
    this.index.set(0);
    this.started.set(false);
    this.completed.set(false);
    this.storageAvailable.set(true);
    try {
      const saved: unknown = JSON.parse(
        this.document.defaultView!.localStorage.getItem(this.storageKey) ??
          'null'
      );
      if (!saved || typeof saved !== 'object') return;
      const value = saved as { step?: unknown; completed?: unknown };
      const index = this.steps().findIndex((s) => s.id === value.step);
      if (index < 0 || typeof value.completed !== 'boolean') return;
      this.index.set(index);
      this.started.set(true);
      this.completed.set(value.completed);
    } catch {
      this.storageAvailable.set(false);
    }
  }
  private save(): void {
    try {
      this.document.defaultView!.localStorage.setItem(
        this.storageKey,
        JSON.stringify({
          step: this.current()!.id,
          completed: this.completed()
        })
      );
      this.storageAvailable.set(true);
    } catch {
      this.storageAvailable.set(false);
    }
  }
  private restoreFocus(): void {
    if (this.opener?.isConnected && !this.opener.matches(':disabled'))
      this.opener.focus();
    this.opener = null;
  }
  private track(): void {
    const win = this.document.defaultView!;
    const update = () => this.schedule();
    const reveal = () => this.schedule(true);
    win.addEventListener('resize', reveal);
    this.document.addEventListener('scroll', update, true);
    win.visualViewport?.addEventListener('resize', reveal);
    const resize = new ResizeObserver(reveal);
    resize.observe(this.card().nativeElement);
    const mutations = new MutationObserver(update);
    // Targets can disappear after an asynchronous refresh. Never retain a stale rectangle.
    mutations.observe(this.document.body, { childList: true, subtree: true });
    this.cleanup = () => {
      win.removeEventListener('resize', reveal);
      this.document.removeEventListener('scroll', update, true);
      win.visualViewport?.removeEventListener('resize', reveal);
      resize.disconnect();
      mutations.disconnect();
    };
  }
  private schedule(reveal = false): void {
    const win = this.document.defaultView!;
    this.revealPending ||= reveal;
    if (this.frame) win.cancelAnimationFrame(this.frame);
    this.frame = win.requestAnimationFrame(() => {
      this.frame = 0;
      if (!this.active()) return;
      const step = this.current();
      this.target = step
        ? this.document.querySelector<HTMLElement>(
            `[data-og7="${step.target}"]`
          )
        : null;
      const target = this.target;
      if (!target || !target.getClientRects().length) {
        this.targetMissing.set(true);
        this.rectangle.set(null);
        this.cardAtTop.set(false);
        return;
      }
      this.targetMissing.set(false);
      const height = Math.min(
        win.innerHeight,
        win.visualViewport?.height ?? win.innerHeight
      );
      const width = this.document.documentElement.clientWidth;
      const card = this.card().nativeElement.getBoundingClientRect();
      const cardTop = height - card.height - 16;
      if (this.revealPending) {
        this.revealPending = false;
        const rect = target.getBoundingClientRect();
        const available = Math.max(60, cardTop - 24);
        const desired = Math.max(
          12,
          (available - Math.min(available, rect.height)) / 2
        );
        const scroller =
          target.closest('dialog[open]') ?? this.document.scrollingElement;
        scroller?.scrollBy({ top: rect.top - desired, behavior: 'instant' });
      }
      const rect = target.getBoundingClientRect();
      this.cardAtTop.set(
        rect.left < card.right &&
          rect.right > card.left &&
          rect.bottom > cardTop - 12 &&
          rect.top > card.height + 32
      );
      const top = Math.max(6, rect.top - 5),
        left = Math.max(6, rect.left - 5);
      const bottom = Math.min(height - 6, rect.bottom + 5),
        right = Math.min(width - 6, rect.right + 5);
      const value =
        bottom > top && right > left
          ? { top, left, width: right - left, height: bottom - top }
          : null;
      if (JSON.stringify(value) !== JSON.stringify(this.rectangle()))
        this.rectangle.set(value);
    });
  }
  private stopTracking(): void {
    this.cleanup?.();
    this.cleanup = null;
    this.document.defaultView?.cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.revealPending = false;
  }
}
