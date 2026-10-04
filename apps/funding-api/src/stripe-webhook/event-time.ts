export const toIsoFromUnix = (seconds: number): string =>
  new Date(seconds * 1000).toISOString();
