import { signal } from '@angular/core';
import type { SponsorshipCommitmentAdoptionPreview } from '@openg7/funding-core';

import { AdminDashboardRequestError } from '../../services/funding-admin-session.js';

export interface SponsorshipAdoptionPorts {
  canOwn(): boolean;
  destroyed(): boolean;
  identity(): string;
  preview(
    pageSize: 25 | 50,
    cursor?: string
  ): Promise<SponsorshipCommitmentAdoptionPreview>;
  unauthorized(): Promise<void>;
}

/** Bounded, read-only portfolio inventory; no qualification or publication command. */
export class AdminSponsorshipAdoptionController {
  readonly data = signal<SponsorshipCommitmentAdoptionPreview | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly pageSize = signal<25 | 50>(25);
  private generation = 0;

  constructor(private readonly ports: SponsorshipAdoptionPorts) {}

  reset(): void {
    this.generation++;
    this.data.set(null);
    this.loading.set(false);
    this.error.set('');
  }

  private current(generation: number, identity: string): boolean {
    return (
      !this.ports.destroyed() &&
      this.ports.canOwn() &&
      this.ports.identity() === identity &&
      generation === this.generation
    );
  }

  async load(more = false): Promise<void> {
    if (!this.ports.canOwn() || this.ports.destroyed() || this.loading())
      return;
    const cursor = more ? (this.data()?.nextCursor ?? undefined) : undefined;
    if (more && !cursor) return;
    const generation = ++this.generation;
    const identity = this.ports.identity();
    this.loading.set(true);
    this.error.set('');
    try {
      const result = await this.ports.preview(this.pageSize(), cursor);
      if (this.current(generation, identity)) this.data.set(result);
    } catch (error) {
      if (this.current(generation, identity)) {
        if (
          error instanceof AdminDashboardRequestError &&
          [401, 403].includes(error.status)
        )
          this.data.set(null);
        this.error.set(
          error instanceof AdminDashboardRequestError && error.status === 403
            ? 'ownerRequired'
            : 'loadError'
        );
        if (error instanceof AdminDashboardRequestError && error.status === 401)
          await this.ports.unauthorized();
      }
    } finally {
      if (this.current(generation, identity)) this.loading.set(false);
    }
  }
}
