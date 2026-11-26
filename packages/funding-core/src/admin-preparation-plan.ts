/** Advisory private preparation; neither content approval nor publication authorization. */
export interface AdminPreparationSelection {
  readonly contributionId: string;
  readonly version: string;
}
export interface AdminPreparationPlanItem extends AdminPreparationSelection {
  readonly reference: string;
  readonly drafts: readonly {
    readonly obligationId: string;
    readonly ordinal: number;
    readonly channel: 'facebook' | 'linkedin';
    readonly target: 'openg7' | 'openg20';
    readonly title: string;
    readonly body: string;
    readonly disclosureText: string;
  }[];
}
export interface AdminPreparationPlan {
  readonly definition: 'missing-private-preparations/v1';
  readonly observedAt: string;
  readonly limit: 20;
  readonly candidateDossiers: number;
  readonly missingPassages: number;
  readonly preservedPassages: number;
  readonly blockedPassages: number;
  readonly hasMore: boolean;
  readonly items: readonly AdminPreparationPlanItem[];
  /** No human baseline has yet been observed for these dossiers. */
  readonly minutesSaved: null;
}
