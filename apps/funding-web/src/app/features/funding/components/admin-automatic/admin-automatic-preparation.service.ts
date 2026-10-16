import { Injectable, signal } from '@angular/core';
import type { AdminAttentionActionExecutionMode } from '@openg7/funding-core';

export type AdminAutomaticPreparationMode = Exclude<
  AdminAttentionActionExecutionMode,
  'navigate'
>;

export interface AdminAutomaticPreparationEntry {
  readonly id: string;
  readonly element: HTMLButtonElement;
  /** Exact payment/dossier identifier; null is only eligible outside a payment. */
  readonly target: string | null;
  readonly executionMode: AdminAutomaticPreparationMode;
  /** Owner-reviewed opening or preparation; never a business mutation. */
  readonly prepare: () => void;
}

/** Only explicit page-owned preparations are discoverable; never activates DOM controls. */
@Injectable({ providedIn: 'root' })
export class AdminAutomaticPreparationService {
  private readonly registered = signal<
    readonly AdminAutomaticPreparationEntry[]
  >([]);
  readonly entries = this.registered.asReadonly();

  register(entry: AdminAutomaticPreparationEntry): () => void {
    this.registered.update((entries) => [...entries, entry]);
    return () => {
      this.registered.update((entries) =>
        entries.filter((candidate) => candidate !== entry)
      );
    };
  }

  available(
    target?: string | null,
    region?: string | null
  ): readonly AdminAutomaticPreparationEntry[] {
    return this.registered().filter(
      (entry) =>
        (target == null || entry.target === target) &&
        this.visible(entry, region)
    );
  }

  /** A selection can become obsolete while its explanation is being read. */
  prepare(
    entry: AdminAutomaticPreparationEntry,
    target?: string | null,
    region?: string | null
  ): boolean {
    if (!this.available(target, region).includes(entry)) return false;
    entry.prepare();
    return true;
  }

  label(entry: AdminAutomaticPreparationEntry): string {
    return (
      entry.element.getAttribute('aria-label')?.trim() ||
      entry.element.textContent?.trim().replace(/\s+/g, ' ') ||
      ''
    );
  }

  private visible(
    entry: AdminAutomaticPreparationEntry,
    region?: string | null
  ): boolean {
    const element = entry.element;
    const document = element.ownerDocument;
    const view = document.defaultView;
    const main = document.getElementById('admin-main');
    if (
      !entry.id.trim() ||
      !['prepare', 'confirmation_required'].includes(entry.executionMode) ||
      element.tagName !== 'BUTTON' ||
      element.type !== 'button' ||
      !element.isConnected ||
      !main?.contains(element) ||
      !view ||
      element.matches(':disabled,[aria-disabled="true"]') ||
      element.getClientRects().length === 0 ||
      !this.label(entry)
    )
      return false;
    let inRegion = region == null;
    for (
      let ancestor: HTMLElement | null = element;
      ancestor;
      ancestor = ancestor.parentElement
    ) {
      if (
        ancestor.matches(
          '[inert],[hidden],[aria-hidden="true"],[aria-disabled="true"]'
        ) ||
        ['hidden', 'collapse'].includes(
          view.getComputedStyle(ancestor).visibility
        )
      )
        return false;
      if (ancestor.getAttribute('data-og7') === region) inRegion = true;
    }
    return inRegion;
  }
}
