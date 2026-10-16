interface VerticalSpace {
  top: number;
  bottom: number;
}

const gap = 12;

function ancestors(region: HTMLElement): HTMLElement[] {
  const result: HTMLElement[] = [];
  for (
    let parent = region.parentElement;
    parent;
    parent = parent.parentElement
  ) {
    result.push(parent);
  }
  return result;
}

/** Nested scrollports, fixed action bars and the floating card share visible space. */
export function guidanceSpace(
  region: HTMLElement,
  card: DOMRect | undefined,
  view: Window
): VerticalSpace {
  const viewport = view.visualViewport;
  let top = viewport?.offsetTop ?? 0;
  let bottom = top + (viewport?.height ?? view.innerHeight);
  for (const parent of ancestors(region)) {
    if (
      !/^(auto|scroll|hidden|clip)$/.test(
        view.getComputedStyle(parent).overflowY
      )
    ) {
      continue;
    }
    const rect = parent.getBoundingClientRect();
    top = Math.max(top, rect.top + parent.clientTop);
    bottom = Math.min(
      bottom,
      rect.top + parent.clientTop + parent.clientHeight
    );
  }
  const intro = region.ownerDocument.querySelector<HTMLElement>(
    '[data-og7="pilot-intro"]'
  );
  if (
    intro &&
    !intro.contains(region) &&
    view.getComputedStyle(intro).position === 'sticky'
  ) {
    const rect = intro.getBoundingClientRect();
    if (rect.top <= top + gap && rect.bottom > top) top = rect.bottom;
  }
  const regionRect = region.getBoundingClientRect();
  for (const bar of region.ownerDocument.querySelectorAll<HTMLElement>(
    '[data-og7="dossier-actions"],[data-og7="pilot-controls"]'
  )) {
    if (bar.contains(region) || !bar.getClientRects().length) continue;
    const fixed = [bar, ...ancestors(bar)].find((element) =>
      ['fixed', 'sticky'].includes(view.getComputedStyle(element).position)
    );
    if (!fixed || fixed.contains(region)) continue;
    const bounds = fixed.getBoundingClientRect();
    if (
      regionRect.left < bounds.right &&
      regionRect.right > bounds.left &&
      bounds.top < bottom &&
      bounds.bottom > top
    ) {
      if (bounds.top <= top + gap) top = Math.max(top, bounds.bottom);
      else bottom = Math.min(bottom, bounds.top);
    }
  }
  top += gap;
  bottom -= gap;
  const rect = region.getBoundingClientRect();
  if (
    card &&
    rect.left < card.right &&
    rect.right > card.left &&
    card.bottom > top &&
    card.top < bottom
  ) {
    const above = { top, bottom: Math.min(bottom, card.top - gap) };
    const below = { top: Math.max(top, card.bottom + gap), bottom };
    return above.bottom - above.top >= below.bottom - below.top ? above : below;
  }
  return { top, bottom };
}

/** Scroll the whole gold region when it fits; otherwise expose its beginning. */
export function revealGuidanceRegion(
  region: HTMLElement,
  target: HTMLElement,
  card: DOMRect | undefined,
  view: Window
): void {
  const document = region.ownerDocument;
  const root = document.scrollingElement;
  const scrollers = ancestors(region).filter(
    (parent) =>
      parent !== root &&
      /^(auto|scroll|hidden)$/.test(view.getComputedStyle(parent).overflowY) &&
      parent.scrollHeight > parent.clientHeight
  );
  // A bounded second pass accounts for sticky elements moving during the first.
  for (let pass = 0; pass < 2; pass++) {
    for (const scroller of [...scrollers, root]) {
      if (!scroller) continue;
      const space = guidanceSpace(region, card, view);
      if (space.bottom <= space.top) continue;
      const rect = region.getBoundingClientRect();
      let delta = 0;
      if (rect.height > space.bottom - space.top) {
        const heading = target.getBoundingClientRect();
        delta = Math.min(rect.top, heading.top) - space.top;
      } else if (rect.top < space.top) {
        delta = rect.top - space.top;
      } else if (rect.bottom > space.bottom) {
        delta = rect.bottom - space.bottom;
      }
      if (Math.abs(delta) < 1) continue;
      if (scroller === root) view.scrollBy({ top: delta, behavior: 'instant' });
      else scroller.scrollBy({ top: delta, behavior: 'instant' });
    }
  }
}
