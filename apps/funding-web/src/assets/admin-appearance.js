/* Apply the local palette before Angular renders. Only the pilotage route uses it. */
(() => {
  try {
    const value = JSON.parse(
      localStorage.getItem('openg7.pilotage.appearance.v1') || '{}'
    );
    const theme = ['night', 'mineral', 'graphite'].includes(value?.theme)
      ? value.theme
      : 'night';
    document.documentElement.dataset.og7PilotTheme =
      value?.system === true
        ? matchMedia('(prefers-color-scheme: dark)').matches
          ? 'night'
          : 'mineral'
        : theme;
    document.documentElement.dataset.og7PilotDensity =
      value?.density === 'compact' ? 'compact' : 'comfortable';
  } catch {
    /* Storage is optional; the default palette remains usable. */
  }
})();
