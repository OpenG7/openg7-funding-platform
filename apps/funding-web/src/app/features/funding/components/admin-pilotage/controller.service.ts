import { DOCUMENT } from '@angular/common';
import { Injectable, NgZone, inject, signal } from '@angular/core';

import {
  ControllerInput,
  defaultControllerProfile,
  normalizeControllerSample,
  validControllerProfile,
  type ControllerIntent,
  type ControllerProfile
} from './controller-input.js';

/** Browser adapter, scoped to the cockpit. It never sends a business command. */
@Injectable()
export class ControllerService {
  private readonly document = inject(DOCUMENT);
  private readonly zone = inject(NgZone);
  private readonly input = new ControllerInput();
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

  start(emit: (intent: ControllerIntent) => void): void {
    const win = this.document.defaultView;
    if (!win) return;
    this.supported.set(typeof win.navigator.getGamepads === 'function');
    try {
      const saved: unknown = JSON.parse(
        win.localStorage.getItem('og7-controller-profile') ?? 'null'
      );
      if (validControllerProfile(saved)) this.profile.set(saved);
    } catch {
      /* Storage is optional. */
    }
    const reset = () => this.reset();
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
      if (intent) {
        event.preventDefault();
        emit(intent);
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
        let pad: Gamepad | null = null;
        try {
          pad =
            Array.from(win.navigator.getGamepads?.() ?? []).find(
              (p) => p?.connected
            ) ?? null;
        } catch {
          /* Browser permission or API unavailable. */
        }
        this.pad = pad;
        const device = pad ? `${pad.index}:${pad.id}` : '';
        if (this.previousDevice !== device) {
          this.reset();
          this.previousDevice = device;
        }
        this.zone.run(() => {
          this.connected.set(!!pad);
          this.standard.set(pad?.mapping === 'standard');
        });
        const buttons =
          pad?.buttons.map((b) => (Number.isFinite(b.value) ? b.value : 0)) ??
          [];
        const axes = pad?.axes.map((a) => (Number.isFinite(a) ? a : 0)) ?? [];
        if (now - this.diagnosticAt > 120) {
          this.diagnosticAt = now;
          this.zone.run(() =>
            this.diagnostic.set({
              buttons: buttons.flatMap((v, i) => (v > 0.6 ? [i] : [])),
              axes: axes.map((v) => Math.round(v * 100) / 100)
            })
          );
        }
        const normalized = pad
          ? normalizeControllerSample(
              { connected: pad.connected, mapping: pad.mapping, buttons, axes },
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
        else
          for (const intent of this.input.read(normalized, now, this.profile()))
            this.zone.run(() => emit(intent));
        this.frame = win.requestAnimationFrame(tick);
      };
      this.frame = win.requestAnimationFrame(tick);
    });
  }
  reset(): void {
    this.input.reset();
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
    if (!this.vibrate()) return;
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
  stop(): void {
    this.document.defaultView?.cancelAnimationFrame(this.frame);
    this.stopListening?.();
    this.reset();
    this.pad = null;
  }
}
