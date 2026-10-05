/** HTTP header and route adaptation shared by the API entry point and adapters. */
export const firstHeaderValue = (
  value: string | string[] | undefined
): string | null =>
  Array.isArray(value) ? (value[0] ?? null) : (value ?? null);

/** Exact JSON media type; parameters, surrounding whitespace and casing are ignored. */
export const isJsonContentType = (value: string | undefined): boolean =>
  value?.split(';')[0]?.trim().toLowerCase() === 'application/json';

export const createRouteMatcher = (publicBaseOrigin: string) => {
  const routeMatches = (
    url: string | undefined,
    ...candidates: readonly string[]
  ): boolean => {
    if (!url) {
      return false;
    }

    try {
      return candidates.includes(new URL(url, publicBaseOrigin).pathname);
    } catch {
      return candidates.includes(url);
    }
  };

  const routeStartsWith = (
    url: string | undefined,
    ...prefixes: readonly string[]
  ): boolean => {
    if (!url) {
      return false;
    }
    try {
      const pathname = new URL(url, publicBaseOrigin).pathname;
      return prefixes.some((prefix) => pathname.startsWith(prefix));
    } catch {
      return false;
    }
  };

  return { routeMatches, routeStartsWith };
};
