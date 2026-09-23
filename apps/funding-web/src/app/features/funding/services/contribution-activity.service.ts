import {
  Injectable,
  computed,
  inject,
  signal,
  effect,
  untracked
} from '@angular/core';
import type { ContributionActivityItem } from '@openg7/funding-core';

import { FundingAdminService } from './funding-admin.service.js';

/** Session-scoped polling survives page changes; the server arbitrates toast claims across tabs. */
@Injectable({ providedIn: 'root' })
export class ContributionActivityService {
  private readonly admin = inject(FundingAdminService);
  readonly items = signal<ContributionActivityItem[]>([]);
  readonly toastIds = signal<string[]>([]);
  readonly toasts = computed(() =>
    this.toastIds()
      .map((id) => this.items().find((i) => i.id === id))
      .filter((i): i is ContributionActivityItem => !!i)
  );
  readonly selectedId = signal<string | null>(null);
  readonly selected = computed(
    () => this.items().find((i) => i.id === this.selectedId()) ?? null
  );
  readonly opened = signal(false);
  readonly status = signal<'loading' | 'ready' | 'error' | 'forbidden'>(
    'loading'
  );
  readonly hasMore = signal(false);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private clients = 0;
  private session = '';
  private generation = 0;
  private busy = false;
  private newest: string | undefined;
  private failures = 0;

  constructor() {
    effect(() => {
      this.admin.sessionGeneration();
      untracked(() => this.reset());
    });
  }

  connect(): () => void {
    if (typeof window === 'undefined') return () => {};
    this.clients++;
    if (this.clients === 1) void this.poll();
    return () => {
      this.clients--;
      if (!this.clients) {
        clearTimeout(this.timer);
        this.timer = undefined;
      }
    };
  }
  dismiss(id: string): void {
    this.toastIds.update((ids) => ids.filter((i) => i !== id));
  }
  open(id?: string): void {
    this.selectedId.set(id ?? null);
    this.opened.set(true);
  }
  close(): void {
    this.opened.set(false);
  }
  async openPreparation(id: string): Promise<void> {
    const generation = this.generation;
    this.open(id);
    try {
      const response = await this.admin.contributionActivity({ id });
      if (generation === this.generation) this.merge(response.items);
    } catch {
      if (generation === this.generation) this.status.set('error');
    }
  }
  async more(): Promise<void> {
    const last = this.items().at(-1);
    if (!last) return;
    const generation = this.generation;
    try {
      const response = await this.admin.contributionActivity({
        before: last.id
      });
      if (generation !== this.generation) return;
      this.merge(response.items);
      this.hasMore.set(response.hasMore);
    } catch {
      if (generation === this.generation) this.status.set('error');
    }
  }
  private merge(items: ContributionActivityItem[]): void {
    const map = new Map(this.items().map((i) => [i.id, i]));
    for (const item of items) map.set(item.id, item);
    this.items.set(
      [...map.values()].sort((a, b) => (BigInt(a.id) > BigInt(b.id) ? -1 : 1))
    );
  }
  private reset(): void {
    this.generation++;
    this.items.set([]);
    this.toastIds.set([]);
    this.selectedId.set(null);
    this.opened.set(false);
    this.newest = undefined;
    this.status.set('loading');
  }
  private async poll(): Promise<void> {
    if (this.busy || !this.clients) return;
    const session = this.admin.getSavedAdminToken();
    if (session !== this.session) {
      this.reset();
      this.session = session;
    }
    if (!session) {
      this.schedule();
      return;
    }
    if (document.hidden) {
      this.schedule();
      return;
    }
    this.busy = true;
    const generation = this.generation;
    try {
      const fresh: ContributionActivityItem[] = [];
      // Catch up in ascending pages so a burst cannot silently skip payments.
      let cursor = this.newest;
      for (let page = 0; page < 10; page++) {
        const response = await this.admin.contributionActivity(
          cursor ? { after: cursor } : {}
        );
        if (
          generation !== this.generation ||
          session !== this.admin.getSavedAdminToken()
        )
          return;
        this.merge(response.items);
        fresh.push(...response.items);
        if (!cursor) this.hasMore.set(response.hasMore);
        if (response.items.length)
          this.newest = response.items.reduce(
            (max, i) => (BigInt(i.id) > BigInt(max) ? i.id : max),
            this.newest ?? '0'
          );
        if (!cursor || !response.hasMore) break;
        cursor = this.newest;
      }
      const refresh = new Set([
        ...this.toastIds(),
        ...(this.selectedId() ? [this.selectedId()!] : [])
      ]);
      for (const id of refresh) {
        const response = await this.admin.contributionActivity({ id });
        if (
          generation !== this.generation ||
          session !== this.admin.getSavedAdminToken()
        )
          return;
        this.merge(response.items);
      }
      if (this.opened()) {
        const recent = await this.admin.contributionActivity();
        if (
          generation !== this.generation ||
          session !== this.admin.getSavedAdminToken()
        )
          return;
        this.merge(recent.items);
      }
      // Only claim slots that will actually be displayed. Remaining items stay in activity.
      const candidates = fresh
        .filter((i) => !this.toastIds().includes(i.id))
        .slice(0, Math.max(0, 3 - this.toastIds().length));
      if (candidates.length) {
        const claimed = await this.admin.claimContributionToasts(
          candidates.map((i) => i.id)
        );
        if (
          generation !== this.generation ||
          session !== this.admin.getSavedAdminToken()
        )
          return;
        this.toastIds.update((ids) => [...ids, ...claimed.ids].slice(0, 3));
      }
      this.failures = 0;
      this.status.set('ready');
    } catch (error) {
      if (generation !== this.generation) return;
      const status = (error as { status?: number }).status;
      if (status === 401) this.reset();
      else this.status.set(status === 403 ? 'forbidden' : 'error');
      this.failures++;
    } finally {
      this.busy = false;
      this.schedule();
    }
  }
  private schedule(): void {
    clearTimeout(this.timer);
    if (this.clients)
      this.timer = setTimeout(
        () => void this.poll(),
        Math.min(30000, 2500 * 2 ** Math.min(this.failures, 4))
      );
  }
}
