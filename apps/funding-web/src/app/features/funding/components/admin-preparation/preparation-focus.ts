/** Preserve a pilot's focus across a reread without reclaiming another interaction. */
export function capturePreparationFocus(
  host: HTMLElement
): (() => void) | null {
  const document = host.ownerDocument;
  const active = document.activeElement;
  const pilot = active?.closest<HTMLElement>('[data-og7="preparation-pilot"]');
  if (!pilot || !host.contains(pilot)) return null;
  const button = active?.closest<HTMLButtonElement>('button');
  const hook = button?.getAttribute('data-og7') ?? 'preparation-pilot-actions';
  const id = button?.getAttribute('data-og7-id') ?? null;
  const owner = pilot.getAttribute('data-og7-controller-owner');

  return () => {
    if (
      !host.isConnected ||
      document.activeElement !== document.body ||
      document.querySelector('dialog[open]')
    )
      return;
    const buttons = Array.from(
      host.querySelectorAll<HTMLButtonElement>('button[data-og7]')
    ).filter((candidate) => {
      const currentPilot = candidate.closest('[data-og7="preparation-pilot"]');
      return (
        !!currentPilot &&
        currentPilot.getAttribute('data-og7-controller-owner') === owner &&
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
          candidate.getAttribute('data-og7') === 'preparation-pilot-actions'
      );
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
}
