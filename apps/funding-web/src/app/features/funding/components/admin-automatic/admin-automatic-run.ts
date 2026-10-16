import type { AdminPaymentJourney } from '@openg7/funding-core';

import {
  ADMIN_GUIDANCE_PAGES,
  adminGuidancePage
} from '../admin-guidance/admin-guidance-pages.js';

export type AdminAutomaticPhase =
  | 'idle'
  | 'reading'
  | 'explaining'
  | 'navigating'
  | 'preparing'
  | 'awaiting_confirmation'
  | 'waiting'
  | 'paused'
  | 'blocked'
  | 'error'
  | 'complete';

export interface AdminAutomaticPlan {
  readonly key: string;
  readonly pageId: string;
  readonly adminUrl: string;
  readonly reason: string;
  readonly target?: string;
  readonly contributionId?: string;
  readonly state: AdminPaymentJourney['state'];
}

export interface AdminAutomaticEvent {
  readonly phase: AdminAutomaticPhase | 'checked';
  readonly pageId?: string;
  readonly reason?: string;
}

export interface AdminAutomaticSnapshot {
  readonly phase: AdminAutomaticPhase;
  readonly plan: AdminAutomaticPlan | null;
  readonly events: readonly AdminAutomaticEvent[];
  readonly error: 'unavailable' | 'forbidden' | 'stale' | null;
}

export interface AdminAutomaticPorts {
  read(): Promise<AdminAutomaticPlan>;
  current(): boolean;
  canLeavePage(): boolean;
  explain(): Promise<void>;
  navigate(plan: AdminAutomaticPlan): Promise<boolean>;
  present(
    plan: AdminAutomaticPlan,
    preparationId?: string
  ): Promise<'prepared' | 'manual' | 'unavailable'>;
  changed(snapshot: AdminAutomaticSnapshot): void;
}

/** Only declared admin routes are destinations; server copy is never executable code. */
export function automaticAdminUrl(value: string): string | null {
  if (!value.startsWith('/') || /[\\\u0000-\u0020]/.test(value)) return null;
  try {
    const path = decodeURIComponent(value.split(/[?#]/, 1)[0]);
    if (
      path.startsWith('//') ||
      /[\\\u0000-\u0020]/.test(path) ||
      path.split('/').some((part) => part === '.' || part === '..')
    )
      return null;
    const url = new URL(value, 'https://admin.invalid');
    if (
      url.origin !== 'https://admin.invalid' ||
      !adminGuidancePage(url.pathname) ||
      /[\\\u0000-\u0020]/.test(decodeURIComponent(url.pathname))
    )
      return null;
    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}

export function automaticPagePlan(pageId: string): AdminAutomaticPlan {
  const page = ADMIN_GUIDANCE_PAGES.find((entry) => entry.id === pageId);
  if (!page) throw new Error('AUTOMATIC_UNAVAILABLE');
  return {
    key: page.id,
    pageId: page.id,
    adminUrl: page.path,
    reason: 'page:' + page.id,
    target: page.steps.find((step) => step.target)?.target,
    state: 'action_required'
  };
}

export function automaticPaymentPlan(
  journey: AdminPaymentJourney,
  contributionId: string
): AdminAutomaticPlan {
  if (journey.contributionId !== contributionId)
    throw new Error('AUTOMATIC_UNAVAILABLE');
  if (journey.state === 'complete') {
    if (
      journey.next ||
      journey.steps.length === 0 ||
      journey.total !== journey.steps.length ||
      journey.completed !== journey.total ||
      journey.steps.some(
        (step) => !['complete', 'not_required'].includes(step.state)
      )
    )
      throw new Error('AUTOMATIC_UNAVAILABLE');
    return {
      key: 'complete',
      pageId: 'contributions',
      adminUrl: `/admin/fundraiser/contributions?contributionId=${encodeURIComponent(contributionId)}`,
      reason: 'complete',
      contributionId,
      state: 'complete'
    };
  }
  const next = journey.next;
  if (!next) throw new Error('AUTOMATIC_UNAVAILABLE');
  // Missing financial documents are handled in their existing, scoped workspace.
  const destination = ['invoice_missing', 'credit_missing'].includes(
    next.reason
  )
    ? `/admin/fundraiser/invoices?contributionId=${encodeURIComponent(contributionId)}`
    : next.adminUrl;
  const adminUrl = automaticAdminUrl(destination);
  const page = adminUrl && adminGuidancePage(adminUrl);
  if (!adminUrl || !page) throw new Error('AUTOMATIC_UNAVAILABLE');
  const target =
    page.id === 'invoices' && destination !== next.adminUrl
      ? 'invoice-workspace'
      : next.target;
  return {
    key: JSON.stringify([next.reason, adminUrl, target ?? null]),
    pageId: page.id,
    adminUrl,
    reason: next.reason,
    ...(target ? { target } : {}),
    contributionId,
    state: journey.state
  };
}

/** Sequential preparation only. No business command, confirmation or retry port exists. */
export class AdminAutomaticRun {
  private epoch = 0;
  private busyEpoch: number | null = null;
  private pendingVisit = false;
  private snapshot: AdminAutomaticSnapshot = {
    phase: 'idle',
    plan: null,
    events: [],
    error: null
  };

  constructor(private readonly ports: AdminAutomaticPorts) {}

  get active(): boolean {
    return !['idle', 'paused', 'blocked', 'error', 'complete'].includes(
      this.snapshot.phase
    );
  }

  async start(): Promise<void> {
    if (this.busyEpoch === this.epoch) return;
    const epoch = ++this.epoch;
    this.busyEpoch = epoch;
    this.pendingVisit = false;
    this.update('reading', null);
    try {
      const plan = await this.ports.read();
      if (this.current(epoch)) await this.visit(plan, epoch);
    } catch (error) {
      if (this.current(epoch)) this.fail(error);
    } finally {
      if (this.busyEpoch === epoch) this.busyEpoch = null;
    }
  }

  async verify(): Promise<void> {
    if (this.busyEpoch === this.epoch || !this.active) return;
    const epoch = this.epoch;
    const before = this.snapshot.plan;
    this.busyEpoch = epoch;
    try {
      const plan = await this.ports.read();
      if (!this.current(epoch)) return;
      this.record({
        phase: 'checked',
        pageId: plan.pageId,
        reason: plan.reason
      });
      if (plan.state === 'complete') {
        this.update(
          this.ports.canLeavePage() ? 'complete' : 'awaiting_confirmation',
          plan
        );
      } else {
        this.pendingVisit ||= before?.key !== plan.key;
        if (this.pendingVisit && this.ports.canLeavePage()) {
          this.pendingVisit = false;
          await this.visit(plan, epoch);
        } else {
          // A successful POST or an unchanged next action is not fulfilment evidence.
          this.update(
            plan.state === 'waiting' ? 'waiting' : 'awaiting_confirmation',
            plan
          );
        }
      }
    } catch (error) {
      if (this.current(epoch)) this.fail(error);
    } finally {
      if (this.busyEpoch === epoch) this.busyEpoch = null;
    }
  }

  async prepare(preparationId: string): Promise<void> {
    if (this.busyEpoch === this.epoch || !this.active || !this.snapshot.plan)
      return;
    const epoch = this.epoch;
    const before = this.snapshot.plan;
    this.busyEpoch = epoch;
    try {
      this.update('reading', before);
      const plan = await this.ports.read();
      if (!this.current(epoch)) return;
      if (plan.key !== before.key || plan.state === 'complete') {
        // Never carry a choice made for an obsolete dossier into the new step.
        await this.visit(plan, epoch);
        return;
      }
      this.update('explaining', plan);
      await this.ports.explain();
      if (!this.current(epoch)) return;
      this.update('preparing', plan);
      const result = await this.ports.present(plan, preparationId);
      if (this.current(epoch))
        this.update(
          result === 'unavailable' ? 'blocked' : 'awaiting_confirmation',
          plan
        );
    } catch (error) {
      if (this.current(epoch)) this.fail(error);
    } finally {
      if (this.busyEpoch === epoch) this.busyEpoch = null;
    }
  }

  pause(): void {
    ++this.epoch;
    this.busyEpoch = null;
    if (this.snapshot.phase !== 'idle')
      this.update('paused', this.snapshot.plan);
  }

  clear(): void {
    ++this.epoch;
    this.busyEpoch = null;
    this.pendingVisit = false;
    this.snapshot = { phase: 'idle', plan: null, events: [], error: null };
    this.ports.changed(this.snapshot);
  }

  private current(epoch: number): boolean {
    return epoch === this.epoch && this.ports.current();
  }

  private async visit(plan: AdminAutomaticPlan, epoch: number): Promise<void> {
    if (plan.state === 'complete') {
      this.update(
        this.ports.canLeavePage() ? 'complete' : 'awaiting_confirmation',
        plan
      );
      return;
    }
    this.update('explaining', plan);
    await this.ports.explain();
    if (!this.current(epoch)) return;
    if (!this.ports.canLeavePage()) {
      this.pendingVisit = true;
      this.update('awaiting_confirmation', plan);
      return;
    }
    this.update('navigating', plan);
    if (!(await this.ports.navigate(plan))) {
      if (this.current(epoch)) this.update('blocked', plan, 'stale');
      return;
    }
    if (!this.current(epoch)) return;
    this.update('preparing', plan);
    const result = await this.ports.present(plan);
    if (!this.current(epoch)) return;
    this.update(
      plan.state === 'waiting'
        ? 'waiting'
        : result === 'unavailable'
          ? 'blocked'
          : 'awaiting_confirmation',
      plan
    );
  }

  private fail(error: unknown): void {
    const status = (error as { status?: number } | null)?.status;
    this.update(
      status === 403 || status === 409 ? 'blocked' : 'error',
      this.snapshot.plan,
      status === 403 ? 'forbidden' : status === 409 ? 'stale' : 'unavailable'
    );
  }

  private record(event: AdminAutomaticEvent): void {
    this.snapshot = {
      ...this.snapshot,
      events: [...this.snapshot.events.slice(-11), event]
    };
  }

  private update(
    phase: AdminAutomaticPhase,
    plan: AdminAutomaticPlan | null,
    error: AdminAutomaticSnapshot['error'] = null
  ): void {
    this.record({ phase, pageId: plan?.pageId, reason: plan?.reason });
    this.snapshot = { ...this.snapshot, phase, plan, error };
    this.ports.changed(this.snapshot);
  }
}
