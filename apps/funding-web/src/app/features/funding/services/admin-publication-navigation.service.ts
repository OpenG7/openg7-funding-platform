import { Injectable, effect, inject, signal } from '@angular/core';
import { NavigationSkipped, Router } from '@angular/router';
import type { CanDeactivateFn } from '@angular/router';

import type { PublicationDeliveryController } from '../components/admin-publications/publication-delivery-controller.js';

import { AdminConfirmationService } from './admin-confirmation.service.js';
import { FundingAdminService } from './funding-admin.service.js';

interface PublicationDeparture {
  controller: PublicationDeliveryController;
  identity: string;
  confirmation: ReturnType<AdminConfirmationService['pending']>;
}

/** Only mounted delivery editors participate; no draft content is copied or stored. */
@Injectable({ providedIn: 'root' })
export class AdminPublicationNavigationService {
  private readonly admin = inject(FundingAdminService);
  private readonly confirmation = inject(AdminConfirmationService);
  private readonly controllers = new Set<PublicationDeliveryController>();
  private readonly departure = signal<PublicationDeparture | null>(null);

  constructor() {
    // Returning to the current URL can skip NavigationStart while superseding
    // a pending departure. Only cancel the decision owned by this guard.
    inject(Router).events.subscribe((event) => {
      const departure = this.departure();
      if (event instanceof NavigationSkipped && departure)
        this.cancel(departure);
    });
    effect(() => {
      const departure = this.departure();
      const identity = this.identity();
      const valid = this.admin.hasValidAdminSession();
      if (
        departure &&
        (!valid ||
          identity !== departure.identity ||
          !this.open(departure.controller))
      )
        this.cancel(departure);
    });
  }

  register(controller: PublicationDeliveryController): () => void {
    this.controllers.add(controller);
    return () => {
      this.controllers.delete(controller);
      const departure = this.departure();
      if (departure?.controller === controller) this.cancel(departure);
    };
  }

  async canLeave(): Promise<boolean> {
    // Revocation and logout keep their forced cleanup; they never await a draft.
    if (!this.admin.hasValidAdminSession()) return true;
    const identity = this.identity();
    for (const controller of this.controllers) {
      if (!this.open(controller)) continue;
      if (this.confirmation.pending() || this.departure()) return false;
      const decision = controller.requestDiscardChanges();
      const departure: PublicationDeparture = {
        controller,
        identity,
        confirmation: this.confirmation.pending()
      };
      this.departure.set(departure);
      try {
        const discarded = await decision;
        if (!this.admin.hasValidAdminSession() || this.identity() !== identity)
          return true;
        if (
          !discarded &&
          this.controllers.has(controller) &&
          this.open(controller)
        )
          return false;
      } finally {
        if (this.departure() === departure) this.departure.set(null);
      }
    }
    return true;
  }

  private open(controller: PublicationDeliveryController): boolean {
    return !!controller.selected() || controller.composing();
  }

  private cancel(departure: PublicationDeparture): void {
    if (
      departure.confirmation &&
      this.confirmation.pending() === departure.confirmation
    )
      this.confirmation.answer(false);
  }

  private identity(): string {
    const identity = this.admin.identity();
    return `${this.admin.sessionGeneration()}:${identity?.id ?? 'token'}:${identity?.sessionId ?? 'token'}`;
  }
}

export const adminPublicationNavigationGuard: CanDeactivateFn<unknown> = () =>
  inject(AdminPublicationNavigationService).canLeave();
