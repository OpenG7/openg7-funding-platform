import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';

import { FundingAdminService } from '../../services/funding-admin.service.js';
import { AdminGuidanceService } from '../../services/admin-guidance.service.js';
import { revealControllerFocus } from '../admin-controller/admin-controller-navigation.js';

import type { PreparationReturnOrigin } from './preparation-navigation.js';

export interface PreparationReturnRequest {
  readonly sequence: number;
  readonly origin: PreparationReturnOrigin;
}

/** One session-scoped navigation bookmark in memory, never a saved business draft. */
@Injectable({ providedIn: 'root' })
export class PreparationReturnService {
  private readonly admin = inject(FundingAdminService);
  private readonly router = inject(Router);
  private readonly guidance = inject(AdminGuidanceService);
  private readonly bookmark = signal<PreparationReturnOrigin | null>(null);
  private readonly request = signal<PreparationReturnRequest | null>(null);
  readonly restoreRequest = this.request.asReadonly();
  readonly returning = signal(false);
  private identity = '';
  private sequence = 0;

  constructor() {
    effect(() => {
      const identity = this.identityKey();
      untracked(() => this.synchronize(identity));
    });
  }

  private identityKey(): string {
    const identity = this.admin.identity();
    return `${this.admin.sessionGeneration()}:${identity?.id ?? 'token'}:${identity?.sessionId ?? 'token'}:${identity?.role ?? 'owner'}`;
  }

  private permitted(): boolean {
    return (
      this.admin.hasValidAdminSession() &&
      (!this.admin.identity() || this.admin.identity()?.role === 'owner')
    );
  }

  private synchronize(identity = this.identityKey()): void {
    if (identity === this.identity && this.permitted()) return;
    this.identity = identity;
    this.bookmark.set(null);
    this.request.set(null);
    this.returning.set(false);
  }

  remember(origin: PreparationReturnOrigin | null): void {
    this.synchronize();
    if (!origin || !this.permitted()) return;
    // Opening another subsection of the same assistance keeps the actual origin.
    const previous = this.bookmark();
    if (
      previous?.contributionId === origin.contributionId &&
      previous.kind === origin.kind &&
      previous.runId === origin.runId &&
      previous.position === origin.position
    )
      return;
    this.request.set(null);
    this.bookmark.set(origin);
  }

  origin(contributionId: string): PreparationReturnOrigin | null {
    const bookmark = this.bookmark();
    return this.identity === this.identityKey() &&
      this.permitted() &&
      bookmark?.contributionId === contributionId
      ? bookmark
      : null;
  }

  canReturn(contributionId: string): boolean {
    return this.origin(contributionId) !== null;
  }

  async returnToOrigin(contributionId: string): Promise<boolean> {
    this.synchronize();
    const origin = this.origin(contributionId);
    if (!origin || this.returning()) return false;
    const identity = this.identity;
    this.returning.set(true);
    try {
      await this.router.navigateByUrl(origin.url);
      if (
        this.identityKey() !== identity ||
        !this.permitted() ||
        this.router.url !== origin.url
      )
        return false;
      if (origin.kind === 'guide' && this.guidance.available()) {
        if (!this.guidance.enabled()) this.guidance.toggle();
        this.guidance.setMode('automatic');
      }
      this.request.set({ sequence: ++this.sequence, origin });
      return true;
    } catch {
      return false;
    } finally {
      if (this.identityKey() === identity) this.returning.set(false);
    }
  }

  current(request: PreparationReturnRequest): boolean {
    return (
      this.request()?.sequence === request.sequence &&
      this.origin(request.origin.contributionId) !== null &&
      this.router.url === request.origin.url
    );
  }

  /** Called after a fresh server read and render; focus does not approve any control. */
  finish(request: PreparationReturnRequest, host: HTMLElement): void {
    if (!this.current(request) || !host.isConnected) return;
    const document = host.ownerDocument;
    if (document.querySelector('dialog[open]')) return;
    const receipt = Array.from(
      host.querySelectorAll<HTMLElement>('[data-og7="preparation-receipt"]')
    ).find(
      (item) =>
        item.getAttribute('data-og7-id') === request.origin.contributionId
    );
    const issue = Array.from(
      receipt?.querySelectorAll<HTMLButtonElement>(
        '[data-og7="preparation-issue"]'
      ) ?? []
    ).find(
      (item) => item.getAttribute('data-og7-id') === request.origin.issueId
    );
    const target =
      issue ??
      receipt?.querySelector<HTMLButtonElement>(
        '[data-og7="preparation-pilot-actions"]'
      ) ??
      host.querySelector<HTMLButtonElement>(
        '[data-og7="preparation-receipt-refresh"]'
      );
    this.request.set(null);
    this.bookmark.set(null);
    if (target) revealControllerFocus(target);
  }
}
