const sponsorshipFollowupSessionStorageKey =
  'openg7-sponsorship-followup-token';

export interface SponsorshipFollowupBrowserPort {
  getRememberedToken(): string;
  rememberToken(token: string): void;
  clearToken(): void;
  removeUrlToken(): void;
}

/** Browser-only access resources; unavailable storage never blocks this visit. */
export class SponsorshipFollowupBrowser implements SponsorshipFollowupBrowserPort {
  constructor(private readonly isBrowser: () => boolean) {}

  getRememberedToken(): string {
    if (!this.isBrowser()) return '';
    try {
      return (
        window.sessionStorage.getItem(sponsorshipFollowupSessionStorageKey) ??
        ''
      );
    } catch {
      return '';
    }
  }

  rememberToken(token: string): void {
    if (!this.isBrowser()) return;
    try {
      window.sessionStorage.setItem(
        sponsorshipFollowupSessionStorageKey,
        token
      );
    } catch {
      /* The token remains in memory for this visit. */
    }
  }

  clearToken(): void {
    if (!this.isBrowser()) return;
    try {
      window.sessionStorage.removeItem(sponsorshipFollowupSessionStorageKey);
    } catch {
      /* Storage can be unavailable. */
    }
  }

  removeUrlToken(): void {
    if (!this.isBrowser()) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has('token')) return;
    url.searchParams.delete('token');
    window.history.replaceState(
      window.history.state,
      '',
      url.pathname + url.search + url.hash
    );
  }
}
