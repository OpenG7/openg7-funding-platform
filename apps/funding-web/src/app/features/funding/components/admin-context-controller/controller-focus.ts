export type ControllerDirection = 'up' | 'down' | 'left' | 'right';

const controls = (zone: Element): HTMLElement[] =>
  Array.from(
    zone.querySelectorAll<HTMLElement>('button:not([disabled]),a[href]')
  ).filter(
    (element) =>
      element.tabIndex >= 0 &&
      element.getClientRects().length > 0 &&
      element.closest('[data-controller-zone]') === zone &&
      !element.closest(
        '[hidden],[inert],[aria-hidden="true"],[aria-disabled="true"]'
      )
  );

export function focusControllerZone(
  active: Element,
  destination: 'radial' | 'bottom'
): boolean {
  const layout = active.closest('[data-og7="admin-layout"]');
  const owner = active.closest('[data-og7-controller-owner]');
  const ownerId = owner?.getAttribute('data-og7-controller-owner');
  if (!owner || !ownerId) return false;
  const root = layout ?? owner;
  const zones = [root, ...root.querySelectorAll('[data-controller-zone]')];
  const target = zones
    .filter(
      (zone) =>
        zone.getAttribute('data-controller-zone') === destination &&
        zone
          .closest('[data-og7-controller-owner]')
          ?.getAttribute('data-og7-controller-owner') === ownerId
    )
    .flatMap(controls)[0];
  if (!target) return false;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  return true;
}

/** Local spatial navigation never changes the selected business record. */
export function moveControllerFocus(
  active: Element,
  direction: ControllerDirection
): boolean {
  const zone = active.closest('[data-controller-zone]');
  if (!zone) return false;
  const bottom = zone.getAttribute('data-controller-zone') === 'bottom';
  if ((bottom && direction === 'up') || (!bottom && direction === 'right')) {
    focusControllerZone(active, bottom ? 'radial' : 'bottom');
    return true;
  }
  const elements = controls(zone);
  const index = elements.indexOf(active as HTMLElement);
  if (!elements.length) return true;
  if (!bottom && direction === 'down' && index === elements.length - 1) {
    if (focusControllerZone(active, 'bottom')) return true;
  }
  const advances = bottom
    ? direction === 'right' || direction === 'left'
    : direction === 'down' || direction === 'up';
  if (!advances) return true;
  const step = direction === 'up' || direction === 'left' ? -1 : 1;
  const target = elements[(index + step + elements.length) % elements.length]!;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  return true;
}
