import type { ControllerSample } from '../admin-pilotage/controller-input.js';

/** Standard samples only. Every short pointer press survives one input frame. */
export class VirtualControllerState {
  private active = false;
  private frame = 0;
  private neutralPending = false;
  private readonly buttons = Array<number>(17).fill(0);
  private readonly axes = Array<number>(4).fill(0);
  private readonly began = new Map<string, number>();
  private readonly releases = new Map<string, number>();
  private value: ControllerSample = this.snapshotValue();

  snapshot(): ControllerSample {
    return this.value;
  }
  enable(enabled: boolean): void {
    this.active = enabled;
    this.releaseAll();
  }
  releaseAll(): void {
    this.buttons.fill(0);
    this.axes.fill(0);
    this.began.clear();
    this.releases.clear();
    this.neutralPending = this.active;
    this.commit();
  }
  button(index: number, value: number): void {
    this.set('b', index, value);
  }
  axis(index: number, value: number): void {
    this.set('a', index, value);
  }
  releaseButton(index: number): void {
    this.release('b', index);
  }
  releaseAxis(index: number): void {
    this.release('a', index);
  }

  nextFrame(): ControllerSample {
    if (this.neutralPending) {
      this.neutralPending = false;
      return this.snapshotValue(true);
    }
    ++this.frame;
    for (const [key, after] of this.releases) {
      if (this.frame < after) continue;
      const values = key[0] === 'b' ? this.buttons : this.axes;
      values[Number(key.slice(1))] = 0;
      this.releases.delete(key);
      this.began.delete(key);
    }
    this.commit();
    return this.value;
  }
  private set(kind: 'b' | 'a', index: number, value: number): void {
    const values = kind === 'b' ? this.buttons : this.axes;
    if (
      !this.active ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= values.length ||
      !Number.isFinite(value)
    )
      return;
    const key = kind + index;
    const next = Math.max(kind === 'b' ? 0 : -1, Math.min(1, value));
    if (next === 0) {
      this.release(kind, index);
      return;
    }
    if (values[index] === 0) this.began.set(key, this.frame + 1);
    values[index] = next;
    this.releases.delete(key);
    this.commit();
  }
  private release(kind: 'b' | 'a', index: number): void {
    const values = kind === 'b' ? this.buttons : this.axes;
    if (
      !this.active ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= values.length ||
      !values[index]
    )
      return;
    const key = kind + index;
    this.releases.set(
      key,
      Math.max(this.frame + 1, (this.began.get(key) ?? this.frame) + 1)
    );
  }
  private snapshotValue(neutral = false): ControllerSample {
    return Object.freeze({
      connected: this.active,
      mapping: 'standard',
      buttons: Object.freeze(
        this.buttons.map((value) => (neutral ? 0 : value))
      ),
      axes: Object.freeze(this.axes.map((value) => (neutral ? 0 : value)))
    });
  }
  private commit(): void {
    if (
      this.value.connected !== this.active ||
      this.buttons.some(
        (value, index) => value !== this.value.buttons[index]
      ) ||
      this.axes.some((value, index) => value !== this.value.axes[index])
    )
      this.value = this.snapshotValue();
  }
}
