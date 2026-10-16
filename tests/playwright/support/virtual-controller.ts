import type { Locator, Page } from '@playwright/test';

import { expect, sampledFrames as virtualFrames } from './test.js';

export { virtualFrames };

export const virtualHook = (page: Page, name: string, id?: string | number) =>
  page.locator(
    `[data-og7="${name}"]${id === undefined ? '' : `[data-og7-id="${id}"]`}`
  );

/** Click the shipped simulator controls. No navigator patch, focus setter or intent injection. */
export function virtualController(page: Page) {
  const surface = virtualHook(page, 'virtual-controller');
  const button = (index: number) => virtualHook(page, 'virtual-button', index);
  const release = async () => {
    await page.mouse.up();
    await virtualFrames(page);
  };
  const press = async (index: number) => {
    // A normal quick mouse click must survive the RAF sampling boundary.
    await button(index).click();
    await virtualFrames(page);
  };
  const hold = async (index: number) => {
    const control = button(index);
    await expect(control).toBeVisible();
    await control.scrollIntoViewIfNeeded();
    const rect = await control.boundingBox();
    expect(rect).not.toBeNull();
    await page.mouse.move(
      rect!.x + rect!.width / 2,
      rect!.y + rect!.height / 2
    );
    await page.mouse.down();
    await virtualFrames(page);
  };
  const values = async (name: 'buttons' | 'axes'): Promise<number[]> => {
    const raw = await surface.getAttribute(`data-og7-${name}`);
    expect(raw).not.toBeNull();
    const values: unknown = JSON.parse(raw!);
    expect(Array.isArray(values)).toBe(true);
    return values as number[];
  };
  const reach = async (target: Locator) => {
    await expect(target).toBeVisible();
    await expect(target).toBeEnabled();
    for (let attempt = 0; attempt < 220; attempt++) {
      const direction = await target.evaluate((element) => {
        const active = document.activeElement;
        if (active === element) return 0;
        if (!active || active === document.body) return 5;
        return active.compareDocumentPosition(element) &
          Node.DOCUMENT_POSITION_FOLLOWING
          ? 5
          : 4;
      });
      if (direction === 0) return;
      await press(direction);
    }
    throw new Error(`The virtual controller could not reach ${target}.`);
  };
  return {
    surface,
    button,
    press,
    hold,
    release,
    values,
    reach,
    async open() {
      await virtualHook(page, 'sandbox-controller-open').click();
      await expect(surface).toBeVisible();
      await expect(surface).toHaveAttribute(
        'data-og7-virtual-source',
        'active'
      );
      await expect(surface).toHaveAttribute('data-og7-ready', 'true');
      expect(await page.evaluate(() => 'og7ControllerFixture' in window)).toBe(
        false
      );
    },
    async activate(target: Locator) {
      await reach(target);
      await press(0);
    },
    async neutral() {
      await release();
      await virtualHook(page, 'virtual-release').click();
      await virtualFrames(page);
      await expect.poll(() => values('buttons')).toEqual(Array(17).fill(0));
      await expect.poll(() => values('axes')).toEqual([0, 0, 0, 0]);
    },
    async close() {
      await release();
      await virtualHook(page, 'virtual-close').click();
      await expect(surface).not.toBeVisible();
    },
    async dragStick(side: 'left' | 'right', x: number, y: number) {
      const stick = virtualHook(page, 'virtual-stick', side);
      await stick.scrollIntoViewIfNeeded();
      const rect = await stick.boundingBox();
      expect(rect).not.toBeNull();
      const center = {
        x: rect!.x + rect!.width / 2,
        y: rect!.y + rect!.height / 2
      };
      await page.mouse.move(center.x, center.y);
      await page.mouse.down();
      await page.mouse.move(
        center.x + x * rect!.width * 0.42,
        center.y + y * rect!.height * 0.42,
        { steps: 4 }
      );
      await virtualFrames(page);
    }
  };
}
