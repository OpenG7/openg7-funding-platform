/** Presentation only: source durations and aggregates remain authoritative. */
export function readableDuration(
  value: number | null | undefined,
  language: string
): string | null {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  const seconds = Math.floor(value);
  const fr = language.startsWith('fr');
  const units = fr ? ['j', 'h', 'min', 's'] : ['d', 'h', 'min', 's'];
  const values = [
    Math.floor(seconds / 86400),
    Math.floor((seconds % 86400) / 3600),
    Math.floor((seconds % 3600) / 60),
    seconds % 60
  ];
  const first = values.findIndex((n) => n > 0);
  if (first < 0) return '0 s';
  return values
    .slice(first, first + 2)
    .map((n, index) => `${n} ${units[first + index]}`)
    .join(' ');
}

export function aggregateWidth(value: number, other: number): number {
  const max = Math.max(value, other);
  return max > 0 ? (value / max) * 100 : 0;
}
