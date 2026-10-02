const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole elapsed days; future timestamps stay negative for due-date checks. */
export const elapsedDaysSince = (
  now: Date,
  timestamp: string | null
): number | null => {
  if (!timestamp) return null;
  const earlier = Date.parse(timestamp);
  if (Number.isNaN(earlier)) return null;
  return Math.floor((now.getTime() - earlier) / MS_PER_DAY);
};
