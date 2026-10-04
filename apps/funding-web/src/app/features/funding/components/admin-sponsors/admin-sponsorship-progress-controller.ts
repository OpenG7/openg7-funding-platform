import { signal } from '@angular/core';
import type {
  AdminSponsorshipProgress,
  AdminSponsorshipProgressResponse
} from '@openg7/funding-core';

import { AdminDashboardRequestError } from '../../services/funding-admin-session.js';

export interface AdminSponsorshipProgressPorts {
  sponsorshipId(): string | undefined;
  compact(): boolean;
  isDestroyed(): boolean;
  token(): string;
  rememberedSelection(): string | undefined;
  selectSponsorship(id: string | null): void;
  getSponsorshipProgress(
    token: string,
    sponsorshipId?: string
  ): Promise<AdminSponsorshipProgressResponse>;
  loaded(dossier: AdminSponsorshipProgress | null): void;
  onUnauthorized(): Promise<void>;
}

/** Read-only server projection, including fallback for a remembered dossier. */
export class AdminSponsorshipProgressController {
  readonly data = signal<AdminSponsorshipProgressResponse | null>(null);
  readonly state = signal<'loading' | 'ready' | 'error' | 'forbidden'>(
    'loading'
  );
  private generation = 0;

  constructor(private readonly ports: AdminSponsorshipProgressPorts) {}

  private current(generation: number): boolean {
    return generation === this.generation && !this.ports.isDestroyed();
  }

  async load(): Promise<void> {
    const generation = ++this.generation;
    this.state.set('loading');
    this.data.set(null);
    this.ports.loaded(null);
    try {
      const token = this.ports.token();
      if (!token) throw new AdminDashboardRequestError(401);
      const remembered = this.ports.compact()
        ? this.ports.rememberedSelection()
        : undefined;
      let response = await this.ports.getSponsorshipProgress(
        token,
        this.ports.sponsorshipId() ?? remembered
      );
      if (!this.current(generation)) return;
      if (
        !this.ports.sponsorshipId() &&
        remembered &&
        response.status === 'not_found'
      ) {
        this.ports.selectSponsorship(null);
        response = await this.ports.getSponsorshipProgress(token);
      }
      if (!this.current(generation)) return;
      this.data.set(response);
      this.state.set('ready');
      this.ports.loaded(response.dossier);
    } catch (error) {
      if (!this.current(generation)) return;
      this.state.set(
        error instanceof AdminDashboardRequestError && error.status === 403
          ? 'forbidden'
          : 'error'
      );
      if (error instanceof AdminDashboardRequestError && error.status === 401)
        await this.ports.onUnauthorized();
    }
  }
}
