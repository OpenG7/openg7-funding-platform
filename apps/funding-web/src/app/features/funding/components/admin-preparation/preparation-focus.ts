const carouselNavigationHook =
  /^preparation-receipt-(previous|next|slot|refresh)$/;

/** Preserve preparation focus across a reread without reclaiming another interaction. */
export function capturePreparationFocus(
  host: HTMLElement
): (() => void) | null {
  const document = host.ownerDocument;
  const active = document.activeElement;
  const pilot = active?.closest<HTMLElement>('[data-og7="preparation-pilot"]');
  const button = active?.closest<HTMLButtonElement>('button');
  const hook = button?.getAttribute('data-og7') ?? 'preparation-pilot-actions';
  const carousel = button?.closest(
    '[data-og7="preparation-receipts-carousel"]'
  );
  const navigation =
    !!carousel && host.contains(carousel) && carouselNavigationHook.test(hook);
  if ((!pilot || !host.contains(pilot)) && !navigation) return null;
  const id = button?.getAttribute('data-og7-id') ?? null;
  const owner = pilot?.getAttribute('data-og7-controller-owner');

  return () => {
    if (
      !host.isConnected ||
      !host.getClientRects().length ||
      document.activeElement !== document.body ||
      document.querySelector('dialog[open]')
    )
      return;
    const buttons = Array.from(
      host.querySelectorAll<HTMLButtonElement>('button[data-og7]')
    ).filter((candidate) => {
      const currentPilot = candidate.closest('[data-og7="preparation-pilot"]');
      const sameContext = navigation
        ? candidate.closest('[data-og7="preparation-receipts-carousel"]') ===
            carousel &&
          carouselNavigationHook.test(candidate.getAttribute('data-og7') ?? '')
        : !!currentPilot &&
          currentPilot.getAttribute('data-og7-controller-owner') === owner;
      return (
        sameContext &&
        !candidate.disabled &&
        !candidate.closest(
          '[hidden],[inert],[aria-hidden="true"],[aria-disabled="true"]'
        ) &&
        candidate.getClientRects().length > 0 &&
        document.defaultView?.getComputedStyle(candidate).visibility !==
          'hidden'
      );
    });
    const target =
      buttons.find(
        (candidate) =>
          candidate.getAttribute('data-og7') === hook &&
          candidate.getAttribute('data-og7-id') === id
      ) ??
      buttons.find(
        (candidate) =>
          candidate.getAttribute('data-og7') ===
          (navigation
            ? 'preparation-receipt-refresh'
            : 'preparation-pilot-actions')
      ) ??
      (navigation ? buttons[0] : undefined);
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
}
