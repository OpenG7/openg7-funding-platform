import {
  NavigationCancel,
  NavigationError,
  NavigationSkipped,
  NavigationSkippedCode,
  NavigationStart,
  Scroll,
  UrlTree
} from '@angular/router';
import type { Event, Navigation, ParamMap } from '@angular/router';

import { dossierSectionTab } from '../../models/admin-sponsorship-navigation.js';
import type { AdminSponsorListController } from '../../services/admin-sponsor-list-controller.js';

export interface AdminSponsorsNavigationPorts {
  controller: Pick<
    AdminSponsorListController,
    | 'navigationStarted'
    | 'navigationCancelled'
    | 'navigationScrolled'
    | 'applyRouteSelection'
  >;
  selectedSponsorshipId(): string | null;
  currentUrl(): string;
  currentNavigation(): Pick<Navigation, 'trigger'> | null;
  parseUrl(url: string): UrlTree;
}

/** Angular route decoding; selection and deferred scrolling stay with the controller. */
export class AdminSponsorsNavigationAdapter {
  constructor(private readonly ports: AdminSponsorsNavigationPorts) {}

  handleRouterEvent(event: Event): void {
    if (
      event instanceof NavigationStart ||
      event instanceof NavigationSkipped
    ) {
      const imperative =
        event instanceof NavigationStart
          ? event.navigationTrigger === 'imperative'
          : event.code === NavigationSkippedCode.IgnoredSameUrlNavigation &&
            this.ports.currentNavigation()?.trigger === 'imperative';
      this.ports.controller.navigationStarted(
        event.id,
        imperative && this.isDossierTabNavigation(event.url)
      );
      return;
    }
    if (event instanceof NavigationCancel || event instanceof NavigationError) {
      this.ports.controller.navigationCancelled(event.id);
      return;
    }
    if (!(event instanceof Scroll)) return;
    if (this.ports.currentNavigation()) return;
    const targetTab = dossierSectionTab(event.anchor);
    if (!event.position && event.anchor && targetTab) {
      const url = this.ports.parseUrl(event.routerEvent.url);
      const sponsorshipId = url.queryParams['sponsorshipId'];
      if (
        sponsorshipId &&
        (url.queryParams['tab'] ?? 'overview') === targetTab
      ) {
        this.ports.controller.navigationScrolled(event.routerEvent.id, {
          fragment: event.anchor,
          sponsorshipId,
          tab: targetTab
        });
        return;
      }
    }
    this.ports.controller.navigationScrolled(event.routerEvent.id, null);
  }

  applyRouteSelection(params: Pick<ParamMap, 'get'>): void {
    this.ports.controller.applyRouteSelection(
      params.get('sponsorshipId'),
      params.get('tab')
    );
  }

  private isDossierTabNavigation(url: string): boolean {
    const id = this.ports.selectedSponsorshipId();
    if (!id) return false;
    const current = this.ports.parseUrl(this.ports.currentUrl());
    const target = this.ports.parseUrl(url);
    if (
      current.queryParams['sponsorshipId'] !== id ||
      target.queryParams['sponsorshipId'] !== id ||
      new UrlTree(current.root).toString() !==
        new UrlTree(target.root).toString() ||
      (current.fragment !== target.fragment &&
        !(target.fragment === null && dossierSectionTab(current.fragment)))
    )
      return false;
    const keys = new Set([
      ...Object.keys(current.queryParams),
      ...Object.keys(target.queryParams)
    ]);
    return [...keys].every(
      (key) =>
        key === 'tab' ||
        JSON.stringify(current.queryParams[key]) ===
          JSON.stringify(target.queryParams[key])
    );
  }
}
