/** Pure input transitions. Only navigation can repeat; decisions require release. */
export type ControllerIntent =
  | 'primary'
  | 'secondary'
  | 'edit'
  | 'details'
  | 'previous'
  | 'next'
  | 'domainPrevious'
  | 'domainNext'
  | 'calendar'
  | 'menu'
  | 'help'
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'scrollUp'
  | 'scrollDown';
export interface ControllerSample {
  connected: boolean;
  mapping: string;
  buttons: readonly number[];
  axes: readonly number[];
}
export interface ControllerProfile {
  deadzone: number;
  repeatDelay: number;
  repeatInterval: number;
  calibrated: boolean;
  deviceId: string;
  rawButtons: number[];
  rawAxes: { index: number; sign: number }[];
  bindings: Record<'primary' | 'secondary' | 'edit' | 'details', number>;
}
export const defaultControllerProfile = (): ControllerProfile => ({
  deadzone: 0.45,
  repeatDelay: 400,
  repeatInterval: 150,
  calibrated: false,
  deviceId: '',
  rawButtons: Array.from({ length: 16 }, (_, i) => i),
  rawAxes: Array.from({ length: 4 }, (_, index) => ({ index, sign: 1 })),
  bindings: { primary: 0, secondary: 1, edit: 2, details: 3 }
});
export function validControllerProfile(
  value: unknown
): value is ControllerProfile {
  if (!value || typeof value !== 'object') return false;
  const p = value as ControllerProfile;
  if (
    typeof p.deviceId !== 'string' ||
    p.deviceId.length > 500 ||
    !Array.isArray(p.rawButtons) ||
    p.rawButtons.length !== 16 ||
    new Set(p.rawButtons).size !== 16 ||
    !p.rawButtons.every((i) => Number.isInteger(i) && i >= 0 && i <= 63) ||
    !Array.isArray(p.rawAxes) ||
    p.rawAxes.length !== 4 ||
    new Set(p.rawAxes.map((a) => a?.index)).size !== 4 ||
    !p.rawAxes.every(
      (a) =>
        a &&
        Number.isInteger(a.index) &&
        a.index >= 0 &&
        a.index <= 15 &&
        [1, -1].includes(a.sign)
    )
  )
    return false;
  return (
    Number.isFinite(p.deadzone) &&
    p.deadzone >= 0.2 &&
    p.deadzone <= 0.85 &&
    Number.isFinite(p.repeatDelay) &&
    p.repeatDelay >= 250 &&
    p.repeatDelay <= 1000 &&
    Number.isFinite(p.repeatInterval) &&
    p.repeatInterval >= 100 &&
    p.repeatInterval <= 500 &&
    typeof p.calibrated === 'boolean' &&
    !!p.bindings &&
    ['primary', 'secondary', 'edit', 'details'].every(
      (k) =>
        Number.isInteger(p.bindings[k as keyof typeof p.bindings]) &&
        p.bindings[k as keyof typeof p.bindings] >= 0 &&
        p.bindings[k as keyof typeof p.bindings] <= 3
    ) &&
    new Set(Object.values(p.bindings)).size === 4
  );
}
export function normalizeControllerSample(
  sample: ControllerSample,
  profile: ControllerProfile,
  deviceId: string
): ControllerSample | null {
  if (sample.mapping === 'standard') return sample;
  if (!profile.calibrated || !profile.deviceId || profile.deviceId !== deviceId)
    return null;
  if (
    profile.rawButtons.some((i) => sample.buttons[i] === undefined) ||
    profile.rawAxes.some((a) => sample.axes[a.index] === undefined)
  )
    return null;
  return {
    connected: sample.connected,
    mapping: 'standard',
    buttons: profile.rawButtons.map((i) => sample.buttons[i]!),
    axes: profile.rawAxes.map((a) => sample.axes[a.index]! * a.sign)
  };
}
export class ControllerInput {
  private armed = false;
  private modifier = false;
  private previous = new Set<ControllerIntent>();
  private repeats = new Map<ControllerIntent, number>();
  reset(): void {
    this.armed = false;
    this.modifier = false;
    this.previous.clear();
    this.repeats.clear();
  }
  read(
    sample: ControllerSample | null,
    now: number,
    profile: ControllerProfile
  ): ControllerIntent[] {
    if (
      !sample?.connected ||
      (sample.mapping !== 'standard' && !profile.calibrated)
    ) {
      this.reset();
      return [];
    }
    const button = (index: number) => (sample.buttons[index] ?? 0) > 0.6;
    const axis = (index: number) =>
      Math.abs(sample.axes[index] ?? 0) > profile.deadzone
        ? sample.axes[index]!
        : 0;
    const neutral =
      !sample.buttons.some((v) => v > 0.6) &&
      !sample.axes.some((v) => Math.abs(v) > profile.deadzone);
    if (!this.armed) {
      if (neutral) this.armed = true;
      return [];
    }
    if (this.modifier && !button(6)) {
      this.reset();
      return [];
    }
    this.modifier = button(6);
    const pressed = new Set<ControllerIntent>();
    if (button(6)) {
      if (button(4)) pressed.add('domainPrevious');
      else if (button(5)) pressed.add('domainNext');
      else if (button(profile.bindings.details)) pressed.add('calendar');
    } else {
      for (const [intent, index] of Object.entries(profile.bindings))
        if (button(index)) pressed.add(intent as ControllerIntent);
      if (button(4)) pressed.add('previous');
      if (button(5)) pressed.add('next');
    }
    if (button(8)) pressed.add('help');
    if (button(9)) pressed.add('menu');
    if (button(12) || axis(1) < 0) pressed.add('up');
    if (button(13) || axis(1) > 0) pressed.add('down');
    if (button(14) || axis(0) < 0) pressed.add('left');
    if (button(15) || axis(0) > 0) pressed.add('right');
    if (axis(3) < 0) pressed.add('scrollUp');
    if (axis(3) > 0) pressed.add('scrollDown');
    const repeatable = [
      'up',
      'down',
      'left',
      'right',
      'scrollUp',
      'scrollDown',
      'previous',
      'next'
    ];
    const actions: ControllerIntent[] = [];
    for (const intent of pressed) {
      if (!this.previous.has(intent)) {
        actions.push(intent);
        this.repeats.set(intent, now + profile.repeatDelay);
      } else if (
        repeatable.includes(intent) &&
        now >= (this.repeats.get(intent) ?? Infinity)
      ) {
        actions.push(intent);
        this.repeats.set(intent, now + profile.repeatInterval);
      }
    }
    // Modifier transitions must not turn a held chord into an individual action.
    this.previous = pressed;
    if (actions.length > 1 && actions.some((a) => !repeatable.includes(a))) {
      this.reset();
      return [];
    }
    return actions.slice(0, 1);
  }
}
