import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output
} from '@angular/core';
import type {
  PreparationAssistanceFact,
  PreparationAssistanceItem,
  PreparationAssistanceResolution,
  SponsorshipOfferSnapshot
} from '@openg7/funding-core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { revealControllerFocus } from '../admin-controller/admin-controller-navigation.js';

/** Proposal presentation and human row editors; this molecule never saves or qualifies an agreement. */
@Component({
  selector: 'openg7-preparation-assistance-proposal-table',
  standalone: true,
  templateUrl: './preparation-assistance-proposal-table.component.html',
  styleUrls: [
    '../admin-ui/admin-controls.css',
    '../admin-ui/admin-forms.css',
    './preparation-assistance-proposal-table.component.css'
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PreparationAssistanceProposalTableComponent {
  readonly items = input.required<readonly PreparationAssistanceItem[]>();
  readonly resolutions =
    input.required<readonly PreparationAssistanceResolution[]>();
  readonly offer = input<SponsorshipOfferSnapshot | null>(null);
  readonly disabled = input(false);
  readonly documentRequested = output<string>();
  readonly resolutionChange = output<{
    readonly itemId: string;
    readonly patch: Partial<Omit<PreparationAssistanceResolution, 'itemId'>>;
  }>();
  readonly structured = computed(() =>
    this.items().some((item) => !!item.structured)
  );
  readonly publicationClauses = computed(
    () =>
      this.items().filter((item) => item.structured?.nature === 'publication')
        .length
  );
  readonly proofClauses = computed(
    () =>
      this.items().filter((item) => item.structured?.nature === 'proof').length
  );
  readonly completedClauses = computed(
    () => this.items().filter((item) => this.complete(item)).length
  );
  readonly firstIncomplete = computed(
    () => this.items().find((item) => !this.complete(item))?.id ?? null
  );
  readonly dispositions: readonly PreparationAssistanceResolution['disposition'][] =
    ['unresolved', 'included', 'unsupported', 'excluded'];
  private readonly i18n = inject(FundingI18nService);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);

  t(key: string, params?: Record<string, unknown>): string {
    return this.i18n.t('admin.preparationAssistance.' + key, params);
  }

  resolution(id: string): PreparationAssistanceResolution | undefined {
    return this.resolutions().find((item) => item.itemId === id);
  }

  complete(item: PreparationAssistanceItem): boolean {
    const resolution = this.resolution(item.id);
    if (resolution?.disposition === 'excluded')
      return (
        resolution.benefitId === null && resolution.note.trim().length >= 5
      );
    return (
      resolution?.disposition === 'included' &&
      item.attention !== 'unsupported_terms' &&
      !!this.offer()?.benefits.some(
        (benefit) => benefit.id === resolution.benefitId
      )
    );
  }

  deliveryFacts(
    item: PreparationAssistanceItem
  ): readonly PreparationAssistanceFact[] {
    return (
      item.structured?.facts.filter(
        (fact) => fact.kind === 'delivery_deadline'
      ) ?? []
    );
  }

  criticalFacts(
    item: PreparationAssistanceItem
  ): readonly PreparationAssistanceFact[] {
    return (
      item.structured?.facts.filter(
        (fact) => fact.kind === 'unsupported_term'
      ) ?? []
    );
  }

  citedFacts(
    item: PreparationAssistanceItem
  ): readonly PreparationAssistanceFact[] {
    return (
      item.structured?.facts.filter(
        (fact) =>
          fact.kind !== 'unsupported_term' &&
          !(
            item.structured?.nature === 'proof' &&
            fact.kind === 'delivery_deadline'
          )
      ) ?? []
    );
  }

  requestDocumentation(item: PreparationAssistanceItem): void {
    if (!this.disabled() && item.attention !== 'unsupported_terms')
      this.documentRequested.emit(item.id);
  }

  focusFirstIncomplete(): void {
    const id = this.firstIncomplete();
    if (id) this.focusClause(id);
  }

  focusClause(itemId: string): void {
    const row = Array.from(
      this.element.nativeElement.querySelectorAll<HTMLElement>(
        '[data-og7="assistance-clause"]'
      )
    ).find((element) => element.dataset['og7Id'] === itemId);
    if (row) revealControllerFocus(row);
  }

  disposition(id: string, event: Event): void {
    const disposition = (event.target as HTMLSelectElement)
      .value as PreparationAssistanceResolution['disposition'];
    if (this.dispositions.includes(disposition))
      this.resolutionChange.emit({ itemId: id, patch: { disposition } });
  }

  benefit(id: string, event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    const benefit = this.offer()?.benefits.find((item) => item.id === value);
    this.resolutionChange.emit({
      itemId: id,
      patch: { benefitId: benefit?.id ?? null }
    });
  }

  note(id: string, event: Event): void {
    this.resolutionChange.emit({
      itemId: id,
      patch: { note: (event.target as HTMLTextAreaElement).value }
    });
  }
}
