/** Resolve public runtime configuration when a Funding transport is constructed. */
export function resolveFundingApiBaseUrl(): string {
  const globalApiBaseUrl =
    typeof window !== 'undefined'
      ? (
          window as Window & {
            readonly __OPENG7_FUNDING_API_BASE_URL__?: string;
          }
        ).__OPENG7_FUNDING_API_BASE_URL__
      : undefined;

  return globalApiBaseUrl?.replace(/\/$/, '') ?? '/api';
}
