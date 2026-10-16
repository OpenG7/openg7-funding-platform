import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild
} from '@angular/core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { ControllerService } from '../admin-pilotage/controller.service.js';

type Stick = 'left' | 'right';
type HeldControl =
  | { kind: 'button'; index: number }
  | { kind: 'trigger'; index: number; element: HTMLElement }
  | { kind: 'stick'; stick: Stick; element: HTMLElement }
  | { kind: 'direction'; stick: Stick };

/** Sandbox input device: produces standard samples, never administrative commands. */
@Component({
  selector: 'openg7-virtual-controller',
  standalone: true,
  templateUrl: './virtual-controller.component.html',
  styleUrls: ['./virtual-controller.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class VirtualControllerComponent {
  readonly enabled = input(false);
  readonly closed = output<void>();
  readonly controller = inject(ControllerService);
  readonly ltLocked = signal(false);
  readonly inModal = signal(false);
  readonly buttonValues = computed(() =>
    JSON.stringify(this.controller.virtualSample().buttons)
  );
  readonly axisValues = computed(() =>
    JSON.stringify(this.controller.virtualSample().axes)
  );
  readonly buttons = [
    { index: 0, label: 'A' },
    { index: 1, label: 'B' },
    { index: 2, label: 'X' },
    { index: 3, label: 'Y' },
    { index: 4, label: 'LB' },
    { index: 5, label: 'RB' },
    { index: 6, label: 'LT' },
    { index: 7, label: 'RT' },
    { index: 8, label: 'View' },
    { index: 9, label: 'Menu' },
    { index: 10, label: 'L3' },
    { index: 11, label: 'R3' },
    { index: 12, label: '↑' },
    { index: 13, label: '↓' },
    { index: 14, label: '←' },
    { index: 15, label: '→' },
    { index: 16, label: 'Xbox' }
  ];
  readonly sticks: readonly Stick[] = ['left', 'right'];
  readonly directions = [
    { id: 'up', label: '↑', x: 0, y: -1 },
    { id: 'left', label: '←', x: -1, y: 0 },
    { id: 'down', label: '↓', x: 0, y: 1 },
    { id: 'right', label: '→', x: 1, y: 0 }
  ];
  private readonly document = inject(DOCUMENT);
  private readonly i18n = inject(FundingI18nService);
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly home = viewChild<ElementRef<HTMLElement>>('home');
  private readonly held = new Map<number, HeldControl>();
  private modalHost: HTMLDialogElement | null = null;

  constructor() {
    const destroy = inject(DestroyRef);
    effect(() => {
      const enabled = this.enabled();
      this.controller.setVirtualEnabled(enabled);
      if (!enabled) this.clearLocal();
    });
    effect(() => {
      this.controller.virtualReleaseRevision();
      this.clearLocal();
    });
    afterNextRender(() => {
      const win = this.document.defaultView;
      if (!win) return;
      const sync = () => this.syncPortal();
      const up = (event: PointerEvent) => this.releasePointer(event);
      const cancel = (event: PointerEvent) => {
        if (this.held.has(event.pointerId)) this.neutral();
      };
      const observer = new win.MutationObserver(sync);
      observer.observe(this.document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['open', 'hidden']
      });
      this.document.addEventListener('focusin', sync);
      // Moving the panel into a modal can lose capture while A is held.
      // Only an actual pointerup/cancel or an interruption releases that hold.
      this.document.addEventListener('pointerup', up, true);
      this.document.addEventListener('pointercancel', cancel, true);
      this.syncPortal();
      destroy.onDestroy(() => {
        observer.disconnect();
        this.document.removeEventListener('focusin', sync);
        this.document.removeEventListener('pointerup', up, true);
        this.document.removeEventListener('pointercancel', cancel, true);
      });
    });
    destroy.onDestroy(() => {
      this.controller.setVirtualEnabled(false);
      this.clearLocal();
      this.modalHost?.removeAttribute('data-og7-virtual-controller-host');
      this.modalHost = null;
      this.panel()?.nativeElement.remove();
    });
  }

  t(key: string): string {
    return this.i18n.t('admin.controller.virtual.' + key);
  }
  pressed(index: number): boolean {
    return (this.controller.virtualSample().buttons[index] ?? 0) > 0.6;
  }
  value(index: number): number {
    return Math.round(
      (this.controller.virtualSample().buttons[index] ?? 0) * 100
    );
  }
  axis(stick: Stick, offset: number): number {
    return (
      this.controller.virtualSample().axes[
        (stick === 'left' ? 0 : 2) + offset
      ] ?? 0
    );
  }
  preserve(event: PointerEvent): void {
    if (
      (event.target as Element | null)?.closest(
        '[data-og7="virtual-scenarios"]'
      )
    )
      return;
    event.preventDefault();
    event.stopPropagation();
  }
  press(event: PointerEvent, index: number): void {
    if (!this.begin(event, { kind: 'button', index })) return;
    this.controller.pressVirtualButton(index);
  }
  trigger(event: PointerEvent, index: number): void {
    const element = event.currentTarget as HTMLElement;
    if (!this.begin(event, { kind: 'trigger', index, element })) return;
    if (index === 6) this.ltLocked.set(false);
    this.move(event);
  }
  stick(event: PointerEvent, stick: Stick): void {
    const element = event.currentTarget as HTMLElement;
    if (!this.begin(event, { kind: 'stick', stick, element })) return;
    this.move(event);
  }
  pressDirection(
    event: PointerEvent,
    stick: Stick,
    x: number,
    y: number
  ): void {
    if (!this.begin(event, { kind: 'direction', stick })) return;
    this.controller.setVirtualAxes(stick, x, y);
  }
  move(event: PointerEvent): void {
    const held = this.held.get(event.pointerId);
    if (!held || (held.kind !== 'trigger' && held.kind !== 'stick')) return;
    this.preserve(event);
    const rect = held.element.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    if (held.kind === 'trigger') {
      this.controller.pressVirtualButton(
        held.index,
        Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
      );
    } else {
      this.controller.setVirtualAxes(
        held.stick,
        Math.max(
          -1,
          Math.min(1, ((event.clientX - rect.left) / rect.width) * 2 - 1)
        ),
        Math.max(
          -1,
          Math.min(1, ((event.clientY - rect.top) / rect.height) * 2 - 1)
        )
      );
    }
  }
  lockLT(): void {
    this.ltLocked.update((value) => !value);
    if (this.ltLocked()) this.controller.pressVirtualButton(6);
    else this.controller.releaseVirtualButton(6);
  }
  neutral(): void {
    this.clearLocal();
    this.controller.releaseVirtual();
  }
  close(): void {
    this.clearLocal();
    this.controller.setVirtualEnabled(false);
    this.closed.emit();
  }

  private begin(event: PointerEvent, held: HeldControl): boolean {
    this.preserve(event);
    if (event.button !== 0 || !this.enabled() || !this.controller.enabled())
      return false;
    this.held.set(event.pointerId, held);
    try {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      /* Document pointerup still releases a pointer after a portal move. */
    }
    return true;
  }
  private releasePointer(event: PointerEvent): void {
    const held = this.held.get(event.pointerId);
    if (!held) return;
    this.preserve(event);
    this.held.delete(event.pointerId);
    if (held.kind === 'button' || held.kind === 'trigger') {
      if (held.index === 6 && this.ltLocked())
        this.controller.pressVirtualButton(6);
      else this.controller.releaseVirtualButton(held.index);
    } else this.controller.releaseVirtualAxes(held.stick);
  }
  private clearLocal(): void {
    this.held.clear();
    this.ltLocked.set(false);
  }
  private syncPortal(): void {
    const panel = this.panel()?.nativeElement;
    const home = this.home()?.nativeElement;
    if (!panel || !home) return;
    const active =
      this.document.activeElement?.closest<HTMLDialogElement>('dialog[open]');
    const dialogs = Array.from(
      this.document.querySelectorAll<HTMLDialogElement>('dialog[open]')
    ).filter((dialog) => dialog.getClientRects().length > 0);
    const modal = this.enabled() ? (active ?? dialogs.at(-1)) : undefined;
    if (this.modalHost !== (modal ?? null)) {
      this.modalHost?.removeAttribute('data-og7-virtual-controller-host');
      this.modalHost = modal ?? null;
      this.modalHost?.setAttribute('data-og7-virtual-controller-host', '');
    }
    const dock = this.document.querySelector<HTMLElement>(
      '[data-og7="sandbox-controller-dock"]'
    );
    const parent = modal ?? dock ?? home;
    if (panel.parentElement !== parent) parent.append(panel);
    this.inModal.set(!!modal);
  }
}
