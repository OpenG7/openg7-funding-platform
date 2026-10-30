import { Injectable, effect, inject, signal } from '@angular/core';
import { NavigationSkipped, NavigationStart, Router } from '@angular/router';
import type {
  ActivatedRouteSnapshot,
  CanDeactivateFn,
  Route
} from '@angular/router';

import { AdminPublicationNavigationService } from './admin-publication-navigation.service.js';
import { FundingAdminService } from './funding-admin.service.js';

export interface AdminGuideNavigationParticipant {
  hasLocalWork(): boolean;
  canLeave(): boolean | Promise<boolean>;
  cancelLeave(): void;
  reveal(): void;
}

interface GuideDeparture {
  participant: AdminGuideNavigationParticipant;
  identity: string;
}

/** Coordinates mounted guide surfaces without retaining their draft contents. */
@Injectable({ providedIn: 'root' })
export class AdminGuideNavigationService {
  private readonly admin = inject(FundingAdminService);
  private readonly participants = new Set<AdminGuideNavigationParticipant>();
  private readonly departure = signal<GuideDeparture | null>(null);

  constructor() {
    inject(Router).events.subscribe((event) => {
      if (
        event instanceof NavigationStart ||
        event instanceof NavigationSkipped
      ) {
        const departure = this.departure();
        if (departure) this.cancel(departure);
      }
    });
    effect(() => {
      const departure = this.departure();
      const identity = this.identity();
      const valid = this.admin.hasValidAdminSession();
      if (departure && (!valid || identity !== departure.identity))
        this.cancel(departure);
    });
  }

  register(participant: AdminGuideNavigationParticipant): () => void {
    this.participants.add(participant);
    return () => {
      this.participants.delete(participant);
      const departure = this.departure();
      if (departure?.participant === participant) this.cancel(departure);
    };
  }

  async canLeave(): Promise<boolean> {
    // Session revocation and logout must never wait for a presentation draft.
    if (!this.admin.hasValidAdminSession()) return true;
    if (this.departure()) return false;
    const identity = this.identity();
    for (const participant of this.participants) {
      if (!participant.hasLocalWork()) continue;
      const departure = { participant, identity };
      this.departure.set(departure);
      try {
        participant.reveal();
        if (!this.currentIdentity(identity)) return true;
        if (this.departure() !== departure) return false;
        const accepted = await participant.canLeave();
        if (!this.currentIdentity(identity)) return true;
        if (this.departure() !== departure) return false;
        if (
          !accepted &&
          this.participants.has(participant) &&
          participant.hasLocalWork()
        )
          return false;
      } finally {
        if (this.departure() === departure) this.departure.set(null);
      }
    }
    return true;
  }

  private currentIdentity(identity: string): boolean {
    return this.admin.hasValidAdminSession() && this.identity() === identity;
  }

  private cancel(departure: GuideDeparture): void {
    if (this.departure() !== departure) return;
    this.departure.set(null);
    departure.participant.cancelLeave();
  }

  private identity(): string {
    const identity = this.admin.identity();
    return `${this.admin.sessionGeneration()}:${identity?.id ?? 'token'}:${identity?.sessionId ?? 'token'}`;
  }
}

function retainsRoute(
  next: ActivatedRouteSnapshot,
  current: Route | null
): boolean {
  return (
    current !== null &&
    (next.routeConfig === current ||
      next.children.some((child) => retainsRoute(child, current)))
  );
}

/** Resolve real editorial drafts first so only one confirmation is shown. */
export const adminWorkspaceNavigationGuard: CanDeactivateFn<unknown> = async (
  _component,
  current,
  _state,
  next
) => {
  const publications = inject(AdminPublicationNavigationService);
  const guide = inject(AdminGuideNavigationService);
  if (!(await publications.canLeave())) return false;
  // Query/parameter updates can keep the page and its embedded guide alive.
  return retainsRoute(next.root, current.routeConfig) || guide.canLeave();
};
