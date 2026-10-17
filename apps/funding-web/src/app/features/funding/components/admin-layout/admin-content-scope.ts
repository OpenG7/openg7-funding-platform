/** Page content includes its explicitly owned controller slots, never shell navigation. */
export function adminContentRegions(
  layout: HTMLElement
): readonly HTMLElement[] {
  return Array.from(
    layout.querySelectorAll<HTMLElement>(
      '#admin-main, ' +
        '[data-og7="controller-radial-slot"][data-og7-controller-owner], ' +
        '[data-og7="controller-deck-slot"][data-og7-controller-owner]'
    )
  ).filter((region) => region.closest('[data-og7="admin-layout"]') === layout);
}
