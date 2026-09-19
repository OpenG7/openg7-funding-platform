import {
  DestroyRef,
  Injectable,
  computed,
  inject,
  signal
} from '@angular/core';
import type {
  SponsorshipDraftSnapshot,
  SponsorshipDraftValues
} from '@openg7/funding-core';

import {
  followupAccessExpired,
  SponsorshipFollowupError
} from '../models/sponsorship-followup-ui.js';

import { FundingService } from './funding.service.js';

/** One instance per page. Serializes autosaves and preserves edits on failure. */
@Injectable()
export class SponsorshipDraftService {
  private readonly api = inject(FundingService);
  private readonly destroyRef = inject(DestroyRef);
  readonly state = signal<
    | 'loading'
    | 'idle'
    | 'dirty'
    | 'saving'
    | 'saved'
    | 'error'
    | 'unavailable'
    | 'conflict'
  >('loading');
  readonly restored = signal<SponsorshipDraftSnapshot | null>(null);
  readonly revision = signal<number | null>(null);
  readonly accessExpired = signal(false);
  readonly ready = computed(
    () =>
      this.revision() !== null &&
      !['loading', 'conflict', 'unavailable'].includes(this.state())
  );
  private token = '';
  private generation = 0;
  private pending: SponsorshipDraftValues | null | undefined;
  private inFlight?: Promise<boolean>;
  private timer?: ReturnType<typeof setTimeout>;
  constructor() {
    this.destroyRef.onDestroy(() => this.clear());
  }

  clear(): void {
    this.generation++;
    clearTimeout(this.timer);
    this.token = '';
    this.pending = undefined;
    this.revision.set(null);
    this.restored.set(null);
    this.state.set('unavailable');
  }

  async load(token = this.token, restore = true): Promise<void> {
    const generation = this.generation;
    clearTimeout(this.timer);
    if (this.inFlight) await this.inFlight;
    if (this.destroyRef.destroyed || generation !== this.generation || !token)
      return;
    this.token = token;
    this.state.set('loading');
    try {
      const snapshot = await this.api.getSponsorshipDraft(token);
      if (this.destroyRef.destroyed || generation !== this.generation) return;
      this.pending = undefined;
      this.revision.set(snapshot.revision);
      this.restored.set(restore ? snapshot : null);
      this.state.set(snapshot.data ? (restore ? 'saved' : 'conflict') : 'idle');
    } catch (error) {
      if (this.destroyRef.destroyed || generation !== this.generation) return;
      this.state.set('unavailable');
      if (followupAccessExpired(error)) this.accessExpired.set(true);
    }
  }
  changed(data: SponsorshipDraftValues): void {
    this.pending = data;
    clearTimeout(this.timer);
    if (!this.ready()) return;
    this.state.set('dirty');
    this.timer = setTimeout(() => {
      void this.flush();
    }, 2000);
  }
  async flush(): Promise<boolean> {
    clearTimeout(this.timer);
    if (this.destroyRef.destroyed || !this.ready()) return false;
    if (this.inFlight) {
      if (!(await this.inFlight)) return false;
      return this.flush();
    }
    if (this.pending === undefined) return true;
    const data = this.pending;
    const generation = this.generation;
    this.state.set('saving');
    this.inFlight = this.api
      .saveSponsorshipDraft({
        token: this.token,
        expectedRevision: this.revision()!,
        data
      })
      .then((snapshot) => {
        if (this.destroyRef.destroyed || generation !== this.generation)
          return false;
        this.revision.set(snapshot.revision);
        if (this.pending === data) this.pending = undefined;
        this.state.set(this.pending === undefined ? 'saved' : 'dirty');
        return true;
      })
      .catch((error) => {
        if (this.destroyRef.destroyed || generation !== this.generation)
          return false;
        this.state.set(
          error instanceof SponsorshipFollowupError && error.status === 409
            ? 'conflict'
            : 'error'
        );
        if (
          followupAccessExpired(error) &&
          !(error instanceof SponsorshipFollowupError && error.status === 400)
        )
          this.accessExpired.set(true);
        return false;
      });
    const success = await this.inFlight;
    this.inFlight = undefined;
    return success && this.pending !== undefined ? this.flush() : success;
  }
  async discard(): Promise<void> {
    if (!this.ready()) return;
    clearTimeout(this.timer);
    if (this.inFlight && !(await this.inFlight)) return;
    this.pending = null;
    if (await this.flush()) await this.load();
  }
}
