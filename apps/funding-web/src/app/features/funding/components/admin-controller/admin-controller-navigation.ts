import type { ControllerIntent } from '../admin-pilotage/controller-input.js';
import { revealGuidanceRegion } from '../admin-guidance/admin-guidance-scroll.js';

const controls =
  'a[href],button,input,textarea,select,summary,[tabindex],[role="button"]';

function insideClosedDisclosure(element: HTMLElement): boolean {
  for (
    let parent = element.parentElement;
    parent;
    parent = parent.parentElement
  ) {
    if (!parent.matches('details:not([open])')) continue;
    const summary = parent.querySelector(':scope > summary');
    if (!summary?.contains(element)) return true;
  }
  return false;
}

/** The active modal owns input, including a virtual editor above another modal. */
export function controllerScope(document: Document): HTMLElement {
  return (
    document.activeElement?.closest<HTMLDialogElement>('dialog[open]') ??
    Array.from(document.querySelectorAll<HTMLDialogElement>('dialog[open]')).at(
      -1
    ) ??
    document.querySelector<HTMLElement>('[data-og7="admin-layout"]') ??
    document.body
  );
}

export function controllerControls(scope: HTMLElement): HTMLElement[] {
  const view = scope.ownerDocument.defaultView;
  return Array.from(scope.querySelectorAll<HTMLElement>(controls)).filter(
    (element) =>
      element.tabIndex >= 0 &&
      !element.matches(
        ':disabled,[aria-disabled="true"],input[type="hidden"]'
      ) &&
      !element.closest('[inert],[hidden],[aria-hidden="true"]') &&
      !element.closest('[data-og7="virtual-controller"]') &&
      !insideClosedDisclosure(element) &&
      element.getClientRects().length > 0 &&
      view?.getComputedStyle(element).visibility !== 'hidden'
  );
}

export function revealControllerFocus(element: HTMLElement): void {
  element.focus({ preventScroll: true });
  element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  // Leave room for sticky navigation and the floating guide without moving it.
  const document = element.ownerDocument;
  const view = document.defaultView;
  if (!view || element.closest('dialog[open],[data-og7="admin-guidance"]'))
    return;
  const footer = document.querySelector<HTMLElement>(
    '[data-og7="dossier-actions"]'
  );
  if (footer && !footer.contains(element)) {
    const bounds = element.getBoundingClientRect(),
      obstruction = footer.getBoundingClientRect();
    if (
      obstruction.top > 0 &&
      obstruction.top < view.innerHeight &&
      bounds.bottom > obstruction.top - 16 &&
      bounds.top < obstruction.bottom
    )
      view.scrollBy({
        top: bounds.bottom - obstruction.top + 24,
        behavior: 'instant'
      });
  }
  const guide = document.querySelector<HTMLElement>(
    '[data-og7="admin-guidance"].open'
  );
  revealGuidanceRegion(element, element, guide?.getBoundingClientRect(), view);
  if (!guide || controllerFocusVisible(element)) return;
  // At the document's scroll limits the other card placement can expose the control.
  guide
    .querySelector<HTMLButtonElement>('[data-og7="admin-guidance-move"]')
    ?.click();
  view.requestAnimationFrame(() => {
    if (!element.isConnected || document.activeElement !== element) return;
    revealGuidanceRegion(element, element, guide.getBoundingClientRect(), view);
    if (!controllerFocusVisible(element)) {
      // An enlarged guide can fill the viewport: preserve its bookmark and reduce it.
      guide
        .querySelector<HTMLButtonElement>('[data-og7="admin-guidance-toggle"]')
        ?.click();
      view.requestAnimationFrame(() => {
        if (element.isConnected && document.activeElement === element) {
          revealGuidanceRegion(element, element, undefined, view);
        }
      });
    }
  });
}

/** A focused control must also be visible before a controller can activate it. */
export function controllerFocusVisible(element: HTMLElement): boolean {
  const document = element.ownerDocument;
  const view = document.defaultView;
  if (!view) return false;
  return Array.from(element.getClientRects()).some((rect) => {
    if (!rect.width || !rect.height) return false;
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    if (x < 0 || y < 0 || x >= view.innerWidth || y >= view.innerHeight)
      return false;
    const hit = document.elementFromPoint(x, y);
    return (
      !!hit &&
      (element === hit ||
        element.contains(hit) ||
        hit.closest('label')?.control === element)
    );
  });
}

/** Bumpers follow DOM order; the directional pad follows visible control geometry. */
export function moveControllerFocus(
  document: Document,
  intent: ControllerIntent
): boolean {
  const items = controllerControls(controllerScope(document));
  if (!items.length) return false;
  const active = document.activeElement as HTMLElement | null;
  const index = items.indexOf(active!);
  const backwards = ['previous', 'up', 'left'].includes(intent);
  // Reading landmarks receive programmatic focus without joining the Tab order.
  // Continue beside that landmark instead of restarting at the page navigation.
  const adjacent =
    index < 0 && active && active !== document.body
      ? backwards
        ? [...items]
            .reverse()
            .find(
              (item) =>
                active.compareDocumentPosition(item) &
                Node.DOCUMENT_POSITION_PRECEDING
            )
        : items.find(
            (item) =>
              active.compareDocumentPosition(item) &
              Node.DOCUMENT_POSITION_FOLLOWING
          )
      : undefined;
  let next =
    adjacent ??
    items[
      index < 0
        ? 0
        : (index + (backwards ? -1 : 1) + items.length) % items.length
    ]!;
  if (index >= 0 && ['up', 'down', 'left', 'right'].includes(intent)) {
    const rect = active!.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const horizontal = intent === 'left' || intent === 'right';
    const sign = backwards ? -1 : 1;
    const ranked = items
      .filter((item) => item !== active)
      .map((item) => {
        const bounds = item.getBoundingClientRect();
        const dx = bounds.left + bounds.width / 2 - x;
        const dy = bounds.top + bounds.height / 2 - y;
        return {
          item,
          forward: (horizontal ? dx : dy) * sign,
          lateral: Math.abs(horizontal ? dy : dx)
        };
      })
      .filter((candidate) => candidate.forward > 2)
      .sort((a, b) => a.forward + a.lateral * 3 - (b.forward + b.lateral * 3));
    next = ranked[0]?.item ?? next;
  }
  revealControllerFocus(next);
  return true;
}

export function scrollControllerFocus(
  document: Document,
  amount: number
): void {
  const scope = controllerScope(document);
  const view = document.defaultView;
  let element = document.activeElement as HTMLElement | null;
  while (element && scope.contains(element)) {
    if (
      element.scrollHeight > element.clientHeight + 1 &&
      /^(auto|scroll)$/.test(view?.getComputedStyle(element).overflowY ?? '')
    ) {
      element.scrollBy({ top: amount });
      return;
    }
    if (element === scope) break;
    element = element.parentElement;
  }
  if (scope.matches('dialog[open]')) scope.scrollBy({ top: amount });
  else view?.scrollBy({ top: amount });
}

export function controllerEditable(
  element: HTMLElement | null
): element is HTMLInputElement | HTMLTextAreaElement {
  return !!(
    element?.matches(
      'textarea,input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="hidden"]):not([type="range"]):not([type="color"])'
    ) && !element.matches(':disabled,[readonly]')
  );
}
