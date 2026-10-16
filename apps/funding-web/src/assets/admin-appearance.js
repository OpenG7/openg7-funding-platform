/* Apply the local admin palette before Angular renders. */
(() => {
  try {
    const value = JSON.parse(
      localStorage.getItem('openg7.pilotage.appearance.v1') || '{}'
    );
    const theme = ['night', 'mineral', 'graphite'].includes(value?.theme)
      ? value.theme
      : 'mineral';
    document.documentElement.dataset.og7PilotTheme =
      value?.system === true
        ? matchMedia('(prefers-color-scheme: dark)').matches
          ? 'night'
          : 'mineral'
        : theme;
    document.documentElement.dataset.og7PilotDensity =
      value?.density === 'compact' ? 'compact' : 'comfortable';
  } catch {
    /* A malformed or unavailable preference uses the same default as Angular. */
    document.documentElement.dataset.og7PilotTheme = 'mineral';
    document.documentElement.dataset.og7PilotDensity = 'comfortable';
  }
})();
