import type { Locator, Page } from '@playwright/test';

import { expect, sampledFrames } from './test.js';

const buttons = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  View: 8,
  Menu: 9,
  Up: 12,
  Down: 13,
  Left: 14,
  Right: 15
} as const;
export type ControllerButton = keyof typeof buttons;

interface FixturePad {
  connected: boolean;
  buttons: { pressed: boolean; value: number; touched: boolean }[];
  axes: number[];
}
type ControllerWindow = Window & { og7ControllerFixture: FixturePad };

/** Only the browser's hardware boundary is simulated; no UI handler is invoked. */
export async function installAdminController(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const pad = {
      id: 'Xbox 360 Controller (XInput STANDARD GAMEPAD)',
      index: 0,
      connected: true,
      mapping: 'standard',
      timestamp: 0,
      buttons: Array.from({ length: 17 }, () => ({
        value: 0,
        pressed: false,
        touched: false
      })),
      axes: [0, 0, 0, 0]
    };
    (window as unknown as ControllerWindow).og7ControllerFixture = pad;
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => (pad.connected ? [pad] : [])
    });
  });
}

export function adminController(page: Page) {
  const hold = async (...held: ControllerButton[]) => {
    await page.evaluate(
      (pressed) => {
        const pad = (window as unknown as ControllerWindow)
          .og7ControllerFixture;
        pad.buttons.forEach((button, index) => {
          button.pressed = (pressed as number[]).includes(index);
          button.touched = button.pressed;
          button.value = button.pressed ? 1 : 0;
        });
      },
      held.map((button) => buttons[button])
    );
    await sampledFrames(page);
  };
  const release = async () => hold();
  const press = async (...held: ControllerButton[]) => {
    await hold(...held);
    await release();
  };

  const reach = async (target: Locator) => {
    await expect(target).toBeVisible();
    await expect(target).toBeEnabled();
    const visited: string[] = [];
    // Reading the rendered DOM chooses a direction. Actual focus changes always
    // come from LB/RB, exactly as they do for a connected standard controller.
    for (let attempt = 0; attempt < 320; attempt++) {
      if ((await target.count()) === 0)
        throw new Error(
          `The controller target disappeared while navigating: ${target}`
        );
      const direction = await target.evaluate((element) => {
        if (document.activeElement === element) return 'reached';
        const active = document.activeElement;
        if (!active || active === document.body) return 'RB';
        const editor = element.closest('[data-og7="controller-editor"]');
        if (editor?.contains(active)) {
          // Plan physical gestures through the visible keyboard grid. No value,
          // focus, production controller state or application handler is changed.
          const items = Array.from(
            editor.querySelectorAll<HTMLElement>('button')
          ).filter(
            (item) =>
              !item.matches(':disabled') && item.getClientRects().length > 0
          );
          const source = items.indexOf(active as HTMLElement);
          const destination = items.indexOf(element as HTMLElement);
          const centers = items.map((item) => {
            const rect = item.getBoundingClientRect();
            return {
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2
            };
          });
          const queue: {
            index: number;
            first: 'Up' | 'Down' | 'Left' | 'Right' | 'LB' | 'RB' | null;
          }[] = [{ index: source, first: null }];
          const seen = new Set([source]);
          for (let cursor = 0; cursor < queue.length; cursor++) {
            const entry = queue[cursor]!;
            for (const gesture of [
              'Up',
              'Down',
              'Left',
              'Right',
              'LB',
              'RB'
            ] as const) {
              const backwards = ['Up', 'Left', 'LB'].includes(gesture);
              let next =
                (entry.index + (backwards ? -1 : 1) + items.length) %
                items.length;
              if (gesture !== 'LB' && gesture !== 'RB') {
                const start = centers[entry.index]!;
                const horizontal = gesture === 'Left' || gesture === 'Right';
                const sign = backwards ? -1 : 1;
                const ranked = centers
                  .map((point, index) => {
                    const dx = point.x - start.x,
                      dy = point.y - start.y;
                    return {
                      index,
                      forward: (horizontal ? dx : dy) * sign,
                      lateral: Math.abs(horizontal ? dy : dx)
                    };
                  })
                  .filter((point) => point.forward > 2)
                  .sort(
                    (a, b) =>
                      a.forward + 3 * a.lateral - b.forward - 3 * b.lateral
                  );
                next = ranked[0]?.index ?? next;
              }
              const first = entry.first ?? gesture;
              if (next === destination) return first;
              if (!seen.has(next)) {
                seen.add(next);
                queue.push({ index: next, first });
              }
            }
          }
        }
        return active.compareDocumentPosition(element) &
          Node.DOCUMENT_POSITION_FOLLOWING
          ? 'RB'
          : 'LB';
      });
      if (direction === 'reached') {
        await expect
          .poll(
            () =>
              target.evaluate((element) => {
                const rect = element.getBoundingClientRect();
                const hit = document.elementFromPoint(
                  rect.left + rect.width / 2,
                  rect.top + rect.height / 2
                );
                return !!hit && (hit === element || element.contains(hit));
              }),
            {
              message:
                'The controller must reveal its focused control before activation.'
            }
          )
          .toBe(true);
        return;
      }
      visited.push(
        await page.evaluate(() => {
          const active = document.activeElement;
          return `${active?.tagName}:${active?.getAttribute('data-og7') ?? ''}:${active?.textContent?.trim().slice(0, 45)}`;
        })
      );
      if (visited.length > 40) visited.shift();
      await press(direction);
    }
    const active = await page.evaluate(() => ({
      tag: document.activeElement?.tagName,
      text: document.activeElement?.textContent?.slice(0, 120),
      hook: document.activeElement?.getAttribute('data-og7')
    }));
    throw new Error(
      `Controller could not reach ${target}; active=${JSON.stringify(active)}; visited=${JSON.stringify(visited)}`
    );
  };
  const activate = async (target: Locator) => {
    await reach(target);
    await press('A');
  };
  const text = async (target: Locator, value: string) => {
    await activate(target);
    const editor = page.locator('[data-og7="controller-editor"]');
    await expect(editor).toBeVisible();
    await activate(editor.locator('[data-og7="editor-clear"]'));
    for (const character of value) {
      if (character.toLowerCase() !== character.toUpperCase()) {
        const uppercase = character === character.toUpperCase();
        const shift = editor.locator('[data-og7="editor-shift"]');
        if ((await shift.getAttribute('aria-pressed')) !== String(uppercase))
          await activate(shift);
      }
      const key =
        character === ' '
          ? editor.locator('[data-og7="editor-space"]')
          : character === '\n'
            ? editor.locator('[data-og7="editor-newline"]')
            : editor.locator(
                `[data-og7="editor-key"][data-og7-id=${JSON.stringify(character)}]`
              );
      await activate(key);
    }
    await activate(editor.locator('[data-og7="editor-apply"]'));
    await expect(editor).not.toBeVisible();
    await expect(target).toHaveValue(value);
  };
  return {
    hold,
    release,
    press,
    reach,
    activate,
    text,
    async ready() {
      const cue = page.locator('[data-og7="controller-menu-open"]');
      await expect(cue).toBeVisible();
      await expect(cue).not.toContainText('admin.controller.');
      await release();
    },
    async select(target: Locator, value: string) {
      const index = await target.evaluate(
        (element, selected) =>
          Array.from((element as HTMLSelectElement).options).findIndex(
            (option) => option.value === selected
          ),
        value
      );
      expect(index).toBeGreaterThanOrEqual(0);
      await activate(target);
      const picker = page.locator('[data-og7="controller-select"]');
      await expect(picker).toBeVisible();
      await activate(
        picker.locator(
          `[data-og7="controller-select-option"][data-og7-id="${index}"]`
        )
      );
      await activate(picker.locator('[data-og7="controller-select-apply"]'));
      await expect(picker).toHaveCount(0);
      await expect(target).toHaveValue(value);
    },
    async connect(connected: boolean) {
      await page.evaluate((value) => {
        const pad = (window as unknown as ControllerWindow)
          .og7ControllerFixture;
        pad.connected = value;
        pad.buttons.forEach((button) => {
          button.pressed = false;
          button.value = 0;
          button.touched = false;
        });
      }, connected);
      await sampledFrames(page);
    },
    async axes(values: readonly [number, number, number, number]) {
      await page.evaluate((value) => {
        (window as unknown as ControllerWindow).og7ControllerFixture.axes = [
          ...value
        ];
      }, values);
      await sampledFrames(page);
    }
  };
}

export type AdminController = ReturnType<typeof adminController>;
