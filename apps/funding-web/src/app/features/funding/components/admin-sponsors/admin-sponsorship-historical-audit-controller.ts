import { signal } from '@angular/core';
import type {
  SponsorshipHistoricalAuditConclusion,
  SponsorshipHistoricalAuditFilter,
  SponsorshipHistoricalAuditItem,
  SponsorshipHistoricalAuditPreview,
  SponsorshipHistoricalAuditReviewRequest,
  SponsorshipHistoricalAuditReviewResponse
} from '@openg7/funding-core';

import type { HistoricalSponsorshipAuditQuery } from '../../services/funding-admin-historical-audit.client.js';
import { AdminDashboardRequestError } from '../../services/funding-admin-session.js';

export interface HistoricalAuditPorts {
  contributionId(): string;
  scope(): 'dossier' | 'portfolio';
  identity?(): string;
  canOwn(): boolean;
  destroyed(): boolean;
  requestId(): string;
  preview(
    query: HistoricalSponsorshipAuditQuery
  ): Promise<SponsorshipHistoricalAuditPreview>;
  review(
    input: SponsorshipHistoricalAuditReviewRequest
  ): Promise<SponsorshipHistoricalAuditReviewResponse>;
  unauthorized(): Promise<void>;
}
/** Owner inventory and explicit conclusions; uncertainty keeps the exact UUID and command. */
export class AdminSponsorshipHistoricalAuditController {
  readonly data = signal<SponsorshipHistoricalAuditPreview | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly saved = signal(false);
  readonly filter = signal<SponsorshipHistoricalAuditFilter | ''>('');
  readonly selected = signal<SponsorshipHistoricalAuditItem | null>(null);
  readonly conclusion =
    signal<SponsorshipHistoricalAuditConclusion>('inconclusive');
  readonly reason = signal('');
  readonly confirmation = signal(false);
  readonly pending = signal<SponsorshipHistoricalAuditReviewRequest | null>(
    null
  );
  private generation = 0;
  private selectedScope = '';
  private readonly pendingByContribution = new Map<
    string,
    SponsorshipHistoricalAuditReviewRequest
  >();
  constructor(private readonly ports: HistoricalAuditPorts) {}
  reset(): void {
    this.pendingByContribution.clear();
    this.selectedScope = '';
    this.select();
  }
  private scopeKey(): string {
    return `${this.ports.identity?.() ?? ''}:${this.ports.scope()}:${this.ports.scope() === 'portfolio' ? '' : this.ports.contributionId()}`;
  }
  select(): void {
    const id = this.scopeKey();
    if (id === this.selectedScope) return;
    this.selectedScope = id;
    this.generation++;
    this.data.set(null);
    this.selected.set(null);
    this.loading.set(false);
    this.saving.set(false);
    this.pending.set(this.pendingByContribution.get(id) ?? null);
    this.reason.set('');
    this.confirmation.set(false);
    this.error.set('');
    this.saved.set(false);
  }
  private current(generation: number, id: string): boolean {
    return (
      !this.ports.destroyed() &&
      this.ports.canOwn() &&
      generation === this.generation &&
      id === this.scopeKey()
    );
  }
  async load(cursor?: string): Promise<void> {
    if (
      !this.ports.canOwn() ||
      this.ports.destroyed() ||
      this.saving() ||
      (this.ports.scope() === 'dossier' && !this.ports.contributionId())
    )
      return;
    const generation = ++this.generation,
      id = this.scopeKey();
    const contributionId = this.ports.contributionId();
    const portfolio = this.ports.scope() === 'portfolio';
    this.loading.set(true);
    this.error.set('');
    try {
      const result = await this.ports.preview({
        pageSize: 25,
        ...(portfolio ? {} : { contributionId }),
        ...(this.filter()
          ? { finding: this.filter() as SponsorshipHistoricalAuditFilter }
          : {}),
        ...(cursor ? { cursor } : {})
      });
      if (this.current(generation, id)) {
        if (
          !portfolio &&
          result.items.some((item) => item.contributionId !== contributionId)
        ) {
          this.data.set(null);
          throw new Error('HISTORICAL_AUDIT_SCOPE_MISMATCH');
        }
        this.data.set(result);
        this.selected.set(null);
      }
    } catch (error) {
      if (this.current(generation, id))
        await this.failure(error, 'loadUnavailable');
    } finally {
      if (this.current(generation, id)) this.loading.set(false);
    }
  }
  choose(item: SponsorshipHistoricalAuditItem): void {
    if (
      !this.ports.canOwn() ||
      this.pending() ||
      this.saving() ||
      (this.ports.scope() === 'dossier' &&
        item.contributionId !== this.ports.contributionId())
    )
      return;
    this.selected.set(item);
    this.reason.set('');
    this.confirmation.set(false);
    this.saved.set(false);
  }
  async submit(): Promise<void> {
    this.select();
    const selected = this.selected();
    if (
      !this.ports.canOwn() ||
      this.saving() ||
      this.loading() ||
      this.pending() ||
      !selected ||
      !this.confirmation() ||
      !this.reason().trim() ||
      this.reason().length > 2000
    )
      return;
    const command: SponsorshipHistoricalAuditReviewRequest = {
      requestId: this.ports.requestId(),
      evidenceId: selected.evidenceId,
      expectedVersion: selected.reviewVersion,
      confirmation: selected.evidenceId,
      conclusion: this.conclusion(),
      reason: this.reason().trim()
    };
    this.pending.set(command);
    this.pendingByContribution.set(this.scopeKey(), command);
    await this.send(command);
  }
  async retry(): Promise<void> {
    this.select();
    if (
      this.pending() &&
      this.ports.canOwn() &&
      !this.saving() &&
      !this.loading()
    )
      await this.send(this.pending()!);
  }
  private async send(
    command: SponsorshipHistoricalAuditReviewRequest
  ): Promise<void> {
    const generation = this.generation,
      id = this.scopeKey();
    this.saving.set(true);
    this.error.set('');
    try {
      const result = await this.ports.review(command);
      if (
        !result ||
        result.evidenceId !== command.evidenceId ||
        !Number.isSafeInteger(result.reviewVersion) ||
        result.reviewVersion !== command.expectedVersion + 1 ||
        !result.review ||
        typeof result.review.id !== 'string' ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
          result.review.id
        ) ||
        result.review.conclusion !== command.conclusion ||
        typeof result.review.reviewedAt !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,6}Z$/.test(
          result.review.reviewedAt
        ) ||
        !Number.isFinite(Date.parse(result.review.reviewedAt))
      )
        throw new Error('HISTORICAL_AUDIT_RECEIPT_UNVERIFIED');
      this.pendingByContribution.delete(id);
      if (this.current(generation, id)) {
        this.pending.set(null);
        this.selected.set(null);
        this.confirmation.set(false);
        this.reason.set('');
        this.saved.set(true);
        this.data.update((data) => {
          if (!data) return data;
          const currentItem = data.items.find(
            (item) => item.evidenceId === result.evidenceId
          );
          return {
            ...data,
            items: data.items.map((item) =>
              item.evidenceId === result.evidenceId &&
              item.reviewVersion < result.reviewVersion
                ? {
                    ...item,
                    reviewVersion: result.reviewVersion,
                    latestReview: result.review
                  }
                : item
            ),
            totals: {
              ...data.totals,
              unreviewed:
                currentItem?.reviewVersion === 0
                  ? Math.max(0, data.totals.unreviewed - 1)
                  : data.totals.unreviewed
            }
          };
        });
      }
    } catch (error) {
      const definite =
        error instanceof AdminDashboardRequestError &&
        ([400, 403, 404, 415, 422].includes(error.status) ||
          (error.status === 409 &&
            error.code === 'HISTORICAL_AUDIT_VERSION_CONFLICT'));
      if (definite) this.pendingByContribution.delete(id);
      if (this.current(generation, id)) {
        if (definite) this.pending.set(null);
        await this.failure(
          error,
          definite &&
            error instanceof AdminDashboardRequestError &&
            error.status === 409
            ? 'conflict'
            : 'reviewUnavailable'
        );
        if (
          definite &&
          error instanceof AdminDashboardRequestError &&
          error.status === 409
        ) {
          this.selected.set(null);
          this.confirmation.set(false);
        }
      }
    } finally {
      if (this.current(generation, id)) this.saving.set(false);
    }
  }
  private async failure(error: unknown, fallback: string): Promise<void> {
    if (error instanceof AdminDashboardRequestError && error.status === 401)
      await this.ports.unauthorized();
    else {
      if (error instanceof AdminDashboardRequestError && error.status === 403) {
        this.data.set(null);
        this.selected.set(null);
        this.reason.set('');
        this.confirmation.set(false);
        this.saved.set(false);
      }
      this.error.set(
        error instanceof AdminDashboardRequestError && error.status === 403
          ? 'ownerRequired'
          : fallback
      );
    }
  }
}
