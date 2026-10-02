import { signal } from '@angular/core';
import type { AdminSessionResponse } from '@openg7/funding-core';

const sessionTokenStorageKey = 'openg7-admin-session-token';
const sessionExpiresAtStorageKey = 'openg7-admin-session-expires-at';
const legacyTokenStorageKey = 'openg7-admin-token';
const adminSessionTokenPrefix = 'openg7-admin-session.';
const selectedSponsorshipStorageKey = 'openg7-admin-selected-sponsorship';
const cookieSessionMarker = 'openg7-admin-session.cookie';
export interface AdminIdentityProfile {
  id: string;
  sessionId: string;
  displayName: string;
  role: 'reader' | 'operator' | 'owner';
  expiresAt: string;
}
export interface AdminAccessAccount {
  id: string;
  subject: string;
  displayName: string;
  role: 'reader' | 'operator' | 'owner';
  disabled: boolean;
}
export interface AdminAccessResponse {
  accounts: AdminAccessAccount[];
  sessions: {
    id: string;
    accountId: string;
    createdAt: string;
    expiresAt: string;
  }[];
}

export class AdminDashboardRequestError extends Error {
  constructor(
    readonly status: number,
    message = 'Admin dashboard could not be loaded.',
    readonly code?: string
  ) {
    super(message);
    this.name = 'AdminDashboardRequestError';
  }
}

interface AdminJsonRequestOptions {
  readonly auth: 'saved' | { readonly token: string };
  readonly method?: 'GET' | 'POST';
  readonly cache?: RequestCache;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: object;
  readonly signal?: AbortSignal;
}

/** Browser admin session and authenticated transport for the Funding feature. */
export class FundingAdminSession {
  readonly sessionGeneration = signal(0);
  readonly identity = signal<AdminIdentityProfile | null>(null);
  readonly apiBaseUrl = this.resolveApiBaseUrl();
  private usesCookieSession = false;

  constructor(
    private readonly onClear: () => void,
    private readonly onSave: () => void
  ) {}

  async authMode(): Promise<'oidc' | 'token'> {
    const response = await fetch(`${this.apiBaseUrl}/admin/auth/config`, {
      cache: 'no-store'
    });
    if (!response.ok)
      throw new Error('Authentication configuration unavailable.');
    return (await response.json()).mode;
  }
  identitySignInUrl(returnUrl: string): string {
    return `${this.apiBaseUrl}/admin/auth/start?returnUrl=${encodeURIComponent(returnUrl)}`;
  }
  async restoreSession(): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    const saved = this.getSavedAdminToken();
    if (saved && saved !== cookieSessionMarker) return true;
    try {
      const response = await fetch(`${this.apiBaseUrl}/admin/auth/current`, {
        cache: 'no-store'
      });
      if (!response.ok) {
        this.clearAdminSession();
        return false;
      }
      const identity = (await response.json()) as AdminIdentityProfile;
      this.usesCookieSession = true;
      this.identity.set(identity);
      window.sessionStorage.setItem(
        sessionTokenStorageKey,
        cookieSessionMarker
      );
      window.sessionStorage.setItem(
        sessionExpiresAtStorageKey,
        identity.expiresAt
      );
      return true;
    } catch {
      this.clearAdminSession();
      return false;
    }
  }
  async signOut(): Promise<void> {
    if (
      this.usesCookieSession ||
      (typeof window !== 'undefined' &&
        window.sessionStorage.getItem(sessionTokenStorageKey) ===
          cookieSessionMarker)
    ) {
      const response = await fetch(`${this.apiBaseUrl}/admin/auth/logout`, {
        method: 'POST'
      });
      if (!response.ok) throw new Error('Sign-out unavailable.');
    }
    this.usesCookieSession = false;
    this.clearAdminSession();
  }
  async accessAccounts(): Promise<AdminAccessResponse> {
    const response = await fetch(`${this.apiBaseUrl}/admin/access`, {
      cache: 'no-store'
    });
    if (!response.ok) await this.accessError(response);
    return response.json();
  }
  async updateAccess(
    input: (AdminAccessAccount | { sessionId: string }) & {
      confirmation: string;
    }
  ): Promise<void> {
    const response = await fetch(`${this.apiBaseUrl}/admin/access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    });
    if (!response.ok) await this.accessError(response);
  }
  async accessError(response: Response): Promise<never> {
    if (response.status === 401) this.clearAdminSession();
    const body = (await response.json().catch(() => ({}))) as { code?: string };
    throw new AdminDashboardRequestError(
      response.status,
      body.code ?? 'ACCESS_UNAVAILABLE'
    );
  }

  getSelectedSponsorship(): string | undefined {
    if (typeof window === 'undefined' || !this.hasValidAdminSession())
      return undefined;
    const id = window.sessionStorage.getItem(selectedSponsorshipStorageKey);
    return id &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
      ? id
      : undefined;
  }

  selectSponsorship(id: string | null): void {
    if (typeof window === 'undefined') return;
    if (id) window.sessionStorage.setItem(selectedSponsorshipStorageKey, id);
    else window.sessionStorage.removeItem(selectedSponsorshipStorageKey);
  }

  getSavedAdminToken(): string {
    if (typeof window === 'undefined') {
      return '';
    }

    window.sessionStorage.removeItem(legacyTokenStorageKey);
    window.localStorage.removeItem(legacyTokenStorageKey);

    const sessionToken =
      window.sessionStorage.getItem(sessionTokenStorageKey) ?? '';
    const expiresAt =
      window.sessionStorage.getItem(sessionExpiresAtStorageKey) ?? '';

    if (!sessionToken || !this.isAdminSessionToken(sessionToken)) {
      this.clearAdminSession();
      return '';
    }

    if (!expiresAt || Date.parse(expiresAt) <= Date.now()) {
      this.clearAdminSession();
      return '';
    }

    return sessionToken;
  }

  saveAdminToken(token: string): void {
    if (typeof window === 'undefined') {
      return;
    }

    const trimmed = token.trim();
    if (!trimmed) {
      this.clearAdminSession();
      return;
    }

    if (this.isAdminSessionToken(trimmed)) {
      window.sessionStorage.setItem(sessionTokenStorageKey, trimmed);
    }
  }

  clearAdminSession(): void {
    this.sessionGeneration.update((value) => value + 1);
    this.identity.set(null);
    this.onClear();
    if (typeof window === 'undefined') {
      return;
    }

    window.sessionStorage.removeItem(sessionTokenStorageKey);
    window.sessionStorage.removeItem(selectedSponsorshipStorageKey);
    window.sessionStorage.removeItem(sessionExpiresAtStorageKey);
    window.sessionStorage.removeItem(legacyTokenStorageKey);
    window.localStorage.removeItem(legacyTokenStorageKey);
  }

  hasValidAdminSession(): boolean {
    return Boolean(this.getSavedAdminToken());
  }

  async signIn(token: string): Promise<AdminSessionResponse> {
    this.usesCookieSession = false;
    this.identity.set(null);
    const session = await this.createAdminSession(token);
    this.saveAdminSession(session);
    return session;
  }

  async createHeaders(token: string): Promise<Record<string, string>> {
    const sessionToken = await this.resolveAdminSessionToken(token);

    return {
      Accept: 'application/json',
      ...(sessionToken && sessionToken !== cookieSessionMarker
        ? {
            Authorization: `Bearer ${sessionToken}`
          }
        : {})
    };
  }

  async requestAdminJson(
    path: string,
    options: AdminJsonRequestOptions
  ): Promise<Response> {
    const { auth, body, headers, ...request } = options;
    return fetch(`${this.apiBaseUrl}${path}`, {
      ...request,
      headers: {
        ...(await this.createHeaders(
          auth === 'saved' ? this.getSavedAdminToken() : auth.token
        )),
        ...headers
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
  }

  private async resolveAdminSessionToken(token: string): Promise<string> {
    const trimmed = token.trim();
    if (!trimmed) {
      return '';
    }

    if (this.isAdminSessionToken(trimmed)) {
      this.saveAdminToken(trimmed);
      return trimmed;
    }

    const savedSessionToken = this.getSavedAdminToken();
    if (savedSessionToken) {
      return savedSessionToken;
    }

    const session = await this.createAdminSession(trimmed);
    this.saveAdminSession(session);
    return session.sessionToken;
  }

  private async createAdminSession(
    token: string
  ): Promise<AdminSessionResponse> {
    const response = await fetch(`${this.apiBaseUrl}/admin/session`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ token })
    });

    if (!response.ok) {
      throw new Error('Admin session could not be created.');
    }

    return (await response.json()) as AdminSessionResponse;
  }

  private saveAdminSession(session: AdminSessionResponse): void {
    if (typeof window === 'undefined') {
      return;
    }

    this.selectSponsorship(null);
    this.onSave();
    window.sessionStorage.setItem(sessionTokenStorageKey, session.sessionToken);
    window.sessionStorage.setItem(
      sessionExpiresAtStorageKey,
      session.expiresAt
    );
  }

  private isAdminSessionToken(token: string): boolean {
    return token.startsWith(adminSessionTokenPrefix);
  }

  private resolveApiBaseUrl(): string {
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
}
