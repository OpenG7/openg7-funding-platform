const gold = 'var(--admin-gold, #f4c957)';
const halo = `0 0 0 6px color-mix(in srgb, ${gold} 18%, transparent), 0 0 22px color-mix(in srgb, ${gold} 18%, transparent)`;
const crest = `0 0 0 11px color-mix(in srgb, ${gold} 28%, transparent), 0 0 30px color-mix(in srgb, ${gold} 28%, transparent)`;
const properties = [
  'outline',
  'outline-color',
  'outline-style',
  'outline-width',
  'outline-offset',
  'box-shadow'
] as const;

/** Temporary visual cue only. Browser APIs are used exclusively on user request. */
export function highlightGuidanceRegions(
  regions: readonly HTMLElement[],
  view: Window | null,
  options: { persistent?: boolean } = {}
): () => void {
  const motion = view?.matchMedia('(prefers-reduced-motion: reduce)');
  const animations: Animation[] = [];
  const restore = regions.map((region) => {
    const marker = region.getAttribute('data-og7-guidance-highlight');
    // Keep CSSOM's declarations intact, including unresolved var() shorthands.
    const previous = region.ownerDocument.createElement('span').style;
    previous.cssText = region.style.cssText;
    for (const property of Array.from(previous))
      if (!(properties as readonly string[]).includes(property))
        previous.removeProperty(property);
    region.setAttribute('data-og7-guidance-highlight', '');
    region.style.setProperty('outline', `3px solid ${gold}`, 'important');
    region.style.setProperty('outline-offset', '4px', 'important');
    region.style.setProperty('box-shadow', halo);
    if (!motion?.matches && typeof region.animate === 'function')
      animations.push(
        region.animate(
          [{ boxShadow: halo }, { boxShadow: crest }, { boxShadow: halo }],
          {
            duration: 1600,
            iterations: options.persistent ? Infinity : 3,
            easing: 'ease-in-out'
          }
        )
      );
    return () => {
      if (marker === null)
        region.removeAttribute('data-og7-guidance-highlight');
      else region.setAttribute('data-og7-guidance-highlight', marker);
      region.style.removeProperty('outline');
      region.style.removeProperty('outline-offset');
      region.style.removeProperty('box-shadow');
      // Append only our saved properties to the current styles so unrelated
      // changes made by the page during the cue are preserved.
      region.style.cssText += ';' + previous.cssText;
    };
  });
  const stopPulse = () => {
    for (const animation of animations) animation.cancel();
  };
  const changedMotion = () => {
    if (motion?.matches) stopPulse();
  };
  motion?.addEventListener('change', changedMotion);
  return () => {
    motion?.removeEventListener('change', changedMotion);
    stopPulse();
    for (const release of restore) release();
  };
}
