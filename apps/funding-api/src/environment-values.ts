/** Parsers for optional settings that fall back when a value is invalid. */
export const parseBooleanEnv = (
  value: string | undefined,
  fallback: boolean
): boolean => {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
};

export const parsePositiveIntegerEnv = (
  value: string | undefined,
  fallback: number,
  maximum = Number.POSITIVE_INFINITY
): number => {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, maximum)
    : fallback;
};

// Preserve Number's empty-string-to-zero behavior; callers treating blank
// settings as absent must normalize them to undefined before parsing.
export const parseNonNegativeIntegerEnv = (
  value: string | undefined,
  fallback: number
): number => {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
};
