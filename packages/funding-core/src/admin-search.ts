/** Private search terms travel in a POST body and are never part of a link. */
export interface AdminSearchRequest {
  readonly query: string;
  readonly page?: number;
  readonly pageSize?: number;
}

export interface AdminSearchGroup {
  readonly contributionId: string;
  readonly title: string;
  readonly reference: string | null;
  readonly amountMinor: number;
  readonly currency: string;
  readonly sponsorship: boolean;
  readonly invoice: { readonly id: string; readonly number: string } | null;
  readonly publications: readonly {
    readonly id: string;
    readonly target: string;
    readonly channel: string;
  }[];
}

export interface AdminSearchResponse {
  readonly available: boolean;
  readonly missingSources: readonly string[];
  readonly groups: readonly AdminSearchGroup[];
  /** Count of matching dossiers, before pagination, for the available sources. */
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}
