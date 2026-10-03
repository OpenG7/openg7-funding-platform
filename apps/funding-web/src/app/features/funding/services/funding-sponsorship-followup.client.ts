import type {
  SponsorMediaDeleteRequest,
  SponsorMediaDeleteResult,
  SponsorMediaKind,
  SponsorMediaUploadResult,
  SponsorshipDetailsResult,
  SponsorshipDraftRequest,
  SponsorshipDraftSnapshot,
  SponsorshipFollowupDetailsRequest,
  SponsorshipFollowupResponse,
  SponsorshipMediaResponse
} from '@openg7/funding-core';

import { SponsorshipFollowupError } from '../models/sponsorship-followup-ui.js';

/** Private sponsor follow-up endpoints; tokens retain their endpoint-specific location. */
export class FundingSponsorshipFollowupClient {
  constructor(private readonly apiBaseUrl: string) {}

  async getSponsorshipFollowup(
    token: string
  ): Promise<SponsorshipFollowupResponse> {
    const params = new URLSearchParams({ token });
    const response = await fetch(
      `${this.apiBaseUrl}/sponsorship-followup?${params.toString()}`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json'
        }
      }
    );

    if (!response.ok) {
      throw new SponsorshipFollowupError(response.status);
    }

    return (await response.json()) as SponsorshipFollowupResponse;
  }

  async requestSponsorshipAccess(
    email: string,
    locale: 'fr-CA' | 'en',
    signal?: AbortSignal
  ): Promise<void> {
    const response = await fetch(
      `${this.apiBaseUrl}/sponsorship-followup/recover`,
      {
        signal,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, locale })
      }
    );
    if (!response.ok || (await response.json()).accepted !== true)
      throw new SponsorshipFollowupError(response.status);
  }

  async getSponsorshipDraft(token: string): Promise<SponsorshipDraftSnapshot> {
    const response = await fetch(
      `${this.apiBaseUrl}/sponsorship-followup/draft?${new URLSearchParams({ token })}`,
      { cache: 'no-store' }
    );
    if (!response.ok) throw new SponsorshipFollowupError(response.status);
    return response.json();
  }

  async saveSponsorshipDraft(
    payload: SponsorshipDraftRequest
  ): Promise<SponsorshipDraftSnapshot> {
    const response = await fetch(
      `${this.apiBaseUrl}/sponsorship-followup/draft`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }
    );
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new SponsorshipFollowupError(response.status, error.code ?? '');
    }
    return response.json();
  }

  async submitSponsorshipFollowupDetails(
    payload: SponsorshipFollowupDetailsRequest
  ): Promise<SponsorshipDetailsResult> {
    const response = await fetch(
      `${this.apiBaseUrl}/sponsorship-followup/details`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new SponsorshipFollowupError(response.status, error.code ?? '');
    }

    return (await response.json()) as SponsorshipDetailsResult;
  }

  async getSponsorshipMedia(token: string): Promise<SponsorshipMediaResponse> {
    const params = new URLSearchParams({ token });
    const response = await fetch(
      `${this.apiBaseUrl}/sponsorship-followup/media?${params.toString()}`,
      { headers: { Accept: 'application/json' } }
    );
    if (!response.ok) {
      throw new Error('Sponsorship media could not be loaded.');
    }
    return (await response.json()) as SponsorshipMediaResponse;
  }

  async getSponsorshipMediaPreview(
    token: string,
    assetId: string
  ): Promise<Blob> {
    const response = await fetch(
      `${this.apiBaseUrl}/sponsorship-followup/media/content/${encodeURIComponent(assetId)}`,
      {
        headers: {
          Accept: 'image/*',
          'X-Sponsorship-Followup-Token': token
        }
      }
    );
    if (!response.ok) {
      throw new Error('Sponsorship media preview could not be loaded.');
    }
    return response.blob();
  }

  async uploadSponsorshipMedia(
    token: string,
    kind: SponsorMediaKind,
    file: File,
    altText?: string
  ): Promise<SponsorMediaUploadResult> {
    const body = new FormData();
    body.set('token', token);
    body.set('kind', kind);
    body.set('media', file);
    if (altText?.trim()) {
      body.set('altText', altText.trim());
    }
    const response = await fetch(
      `${this.apiBaseUrl}/sponsorship-followup/media`,
      { method: 'POST', body }
    );
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        readonly error?: string;
      } | null;
      throw new Error(payload?.error ?? 'Sponsor media could not be uploaded.');
    }
    return (await response.json()) as SponsorMediaUploadResult;
  }

  async deleteSponsorshipMedia(
    payload: SponsorMediaDeleteRequest
  ): Promise<SponsorMediaDeleteResult> {
    const response = await fetch(
      `${this.apiBaseUrl}/sponsorship-followup/media/delete`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        readonly error?: string;
      } | null;
      throw new Error(body?.error ?? 'Sponsor media could not be deleted.');
    }
    return (await response.json()) as SponsorMediaDeleteResult;
  }
}
