import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, NgZone, inject, signal } from '@angular/core';

import { VirtualControllerState } from '../admin-controller/virtual-controller-state.js';

import {
  ControllerInput,
  defaultControllerProfile,
  normalizeControllerSample,
  validControllerProfile,
  type ControllerIntent,
  type ControllerProfile
} from './controller-input.js';

export interface ControllerAttachmentOptions {
  readonly priority?: number;
  /** Letter shortcuts belong to the cockpit; ordinary form typing remains untouched. */
  readonly keyboard?: boolean;
}

/** One browser adapter shared by active administrative surfaces; never sends a command. */
@Injectable({ providedIn: 'root' })
export class ControllerService {
  private readonly document = inject(DOCUMENT);
  private readonly zone = inject(NgZone);
  private readonly input = new ControllerInput();
  private readonly virtual = new VirtualControllerState();
  private readonly virtualActive = signal(false);
  readonly virtualEnabled = this.virtualActive.asReadonly();
  readonly virtualSample = signal(this.virtual.snapshot());
  readonly virtualReady = signal(false);
  readonly virtualReleaseRevision = signal(0);
  readonly supported = signal(true);
  readonly connected = signal(false);
  readonly ready = signal(false);
  readonly standard = signal(false);
  readonly enabled = signal(true);
  readonly profile = signal(defaultControllerProfile());
  readonly diagnostic = signal({
    buttons: [] as number[],
    axes: [] as number[]
  });
  readonly vibrate = signal(false);
  private pad: Gamepad | null = null;
  private frame = 0;
  private previousDevice = '';
  private diagnosticAt = 0;
  private stopListening: (() => void) | null = null;
  private readonly listeners = new Map<
    number,
    {
      listener: (intent: ControllerIntent) => boolean;
      priority: number;
      keyboard: boolean;
    }
  >();
  private sequence = 0;
  private pollGeneration = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  attach(
    listener: (intent: ControllerIntent) => boolean,
    options: ControllerAttachmentOptions = {}
  ): () => void {
    const id = ++this.sequence;
    this.listeners.set(id, {
      listener,
      priority: options.priority ?? 0,
      keyboard: options.keyboard ?? false
    });
    this.reset();
    if (this.listeners.size === 1) this.start();
    return () => {
      if (!this.listeners.delete(id)) return;
      this.reset();
      if (this.listeners.size === 0) this.stop();
    };
  }

  private dispatch(intent: ControllerIntent, keyboard = false): boolean {
    for (const entry of [...this.listeners.values()].sort(
      (a, b) => b.priority - a.priority
    )) {
      if ((!keyboard || entry.keyboard) && entry.listener(intent)) return true;
    }
    return false;
  }

  private start(): void {
    const win = this.document.defaultView;
    if (!win || this.stopListening) return;
    const pollGeneration = ++this.pollGeneration;
    this.supported.set(typeof win.navigator.getGamepads === 'function');
    try {
      const saved: unknown = JSON.parse(
        win.localStorage.getItem('og7-controller-profile') ?? 'null'
      );
      if (validControllerProfile(saved)) this.profile.set(saved);
    } catch {
      /* Storage is optional. */
    }
    const reset = () => {
      this.releaseVirtual();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey)
        return;
      const target = event.target as HTMLElement | null;
      if (target?.matches('input,textarea,select,[contenteditable="true"]'))
        return;
      const keys: Record<string, ControllerIntent> = {
        a: 'primary',
        b: 'secondary',
        x: 'edit',
        y: 'details',
        '[': 'previous',
        ']': 'next',
        c: 'calendar',
        m: 'menu',
        '?': 'help'
      };
      const intent = keys[event.key.toLowerCase()];
      if (intent && this.dispatch(intent, true)) {
        event.preventDefault();
      }
    };
    this.document.addEventListener('visibilitychange', reset);
    win.addEventListener('blur', reset);
    win.addEventListener('focus', reset);
    win.addEventListener('keydown', keydown);
    this.stopListening = () => {
      this.document.removeEventListener('visibilitychange', reset);
      win.removeEventListener('blur', reset);
      win.removeEventListener('focus', reset);
      win.removeEventListener('keydown', keydown);
    };
    this.zone.runOutsideAngular(() => {
      const tick = (now: number) => {
        if (pollGeneration !== this.pollGeneration || this.listeners.size === 0)
          return;
        let pad: Gamepad | null = null;
        try {
          pad = this.virtualEnabled()
            ? null
            : (Array.from(win.navigator.getGamepads?.() ?? []).find(
                (p) => p?.connected
              ) ?? null);
        } catch {
          /* Browser permission or API unavailable. */
        }
        this.pad = pad;
        const virtual = this.virtualEnabled();
        const device = virtual
          ? 'openg7-virtual-xbox'
          : pad
            ? `${pad.index}:${pad.id}`
            : '';
        if (this.previousDevice !== device) {
          this.reset();
          this.previousDevice = device;
        }
        const virtualSample = virtual ? this.virtual.nextFrame() : null;
        const buttons =
          virtualSample?.buttons ??
          pad?.buttons.map((b) => (Number.isFinite(b.value) ? b.value : 0)) ??
          [];
        const axes =
          virtualSample?.axes ??
          pad?.axes.map((a) => (Number.isFinite(a) ? a : 0)) ??
          [];
        this.zone.run(() => {
          this.connected.set(virtual || !!pad);
          this.standard.set(virtual || pad?.mapping === 'standard');
          if (virtualSample) this.virtualSample.set(virtualSample);
        });
        if (now - this.diagnosticAt > 120) {
          this.diagnosticAt = now;
          this.zone.run(() =>
            this.diagnostic.set({
              buttons: buttons.flatMap((v, i) => (v > 0.6 ? [i] : [])),
              axes: axes.map((v) => Math.round(v * 100) / 100)
            })
          );
        }
        const normalized = virtualSample
          ? normalizeControllerSample(virtualSample, this.profile(), device)
          : pad
            ? normalizeControllerSample(
                {
                  connected: pad.connected,
                  mapping: pad.mapping,
                  buttons,
                  axes
                },
                this.profile(),
                pad.id
              )
            : null;
        this.zone.run(() => this.ready.set(!!normalized));
        if (
          !this.enabled() ||
          this.document.hidden ||
          !this.document.hasFocus()
        )
          this.reset();
        else {
          if (
            virtual &&
            buttons.every((value) => value <= 0.6) &&
            axes.every((value) => Math.abs(value) <= this.profile().deadzone)
          )
            this.zone.run(() => this.virtualReady.set(true));
          for (const intent of this.input.read(normalized, now, this.profile()))
            this.zone.run(() => this.dispatch(intent));
        }
        if (pollGeneration === this.pollGeneration && this.listeners.size)
          this.frame = win.requestAnimationFrame(tick);
      };
      this.frame = win.requestAnimationFrame(tick);
    });
  }
  reset(): void {
    this.input.reset();
    this.virtualReady.set(false);
  }
  setVirtualEnabled(enabled: boolean): void {
    if (this.virtualEnabled() === enabled) return;
    this.virtualActive.set(enabled);
    this.virtual.enable(enabled);
    this.virtualSample.set(this.virtual.snapshot());
    this.virtualReleaseRevision.update((value) => value + 1);
    this.reset();
  }
  pressVirtualButton(index: number, value = 1): void {
    if (!this.virtualEnabled() || !this.enabled()) return;
    this.virtual.button(index, value);
    this.virtualSample.set(this.virtual.snapshot());
  }
  releaseVirtualButton(index: number): void {
    this.virtual.releaseButton(index);
  }
  setVirtualAxes(stick: 'left' | 'right', x: number, y: number): void {
    if (!this.virtualEnabled() || !this.enabled()) return;
    const offset = stick === 'left' ? 0 : 2;
    this.virtual.axis(offset, x);
    this.virtual.axis(offset + 1, y);
    this.virtualSample.set(this.virtual.snapshot());
  }
  releaseVirtualAxes(stick: 'left' | 'right'): void {
    const offset = stick === 'left' ? 0 : 2;
    this.virtual.releaseAxis(offset);
    this.virtual.releaseAxis(offset + 1);
  }
  releaseVirtual(): void {
    this.virtual.releaseAll();
    this.virtualSample.set(this.virtual.snapshot());
    this.virtualReleaseRevision.update((value) => value + 1);
    this.reset();
  }
  toggle(): void {
    this.enabled.update((v) => !v);
    this.reset();
  }
  save(profile: ControllerProfile): boolean {
    if (!validControllerProfile(profile)) return false;
    if (profile.calibrated && !this.pad) return false;
    this.profile.set(
      structuredClone({
        ...profile,
        deviceId: profile.calibrated ? this.pad!.id : ''
      })
    );
    this.reset();
    try {
      this.document.defaultView?.localStorage.setItem(
        'og7-controller-profile',
        JSON.stringify(this.profile())
      );
    } catch {
      /* Optional preference. */
    }
    return true;
  }
  feedback(): void {
    if (!this.vibrate() || this.virtualEnabled()) return;
    const actuator = this.pad?.vibrationActuator;
    if (typeof actuator?.playEffect !== 'function') return;
    try {
      void actuator
        .playEffect('dual-rumble', {
          duration: 90,
          strongMagnitude: 0.15,
          weakMagnitude: 0.2
        })
        .catch(() => undefined);
    } catch {
      /* Optional hardware feedback never changes a business receipt. */
    }
  }
  private stop(): void {
    ++this.pollGeneration;
    this.document.defaultView?.cancelAnimationFrame(this.frame);
    this.stopListening?.();
    this.stopListening = null;
    this.frame = 0;
    this.previousDevice = '';
    this.setVirtualEnabled(false);
    this.reset();
    this.pad = null;
  }
}
