import {
  computed,
  signal,
  type Signal,
  type WritableSignal
} from '@angular/core';
import type {
  PilotDecision,
  PilotDomain,
  PilotState,
  PublicationAutomationState
} from '@openg7/funding-core';

import type { PilotDetailState } from '../../components/admin-pilotage/pilot-decision-details.component.js';
import type { PublicationCalendarEntry } from '../../components/admin-publications/publication-calendar.js';
import { BlobPreviewResource } from '../../services/blob-preview-resource.js';
import type { FundingAdminService } from '../../services/funding-admin.service.js';

export interface PilotageReadPorts {
  readonly admin: Pick<
    FundingAdminService,
    'pilotage' | 'publicationAutomation' | 'getSponsorMediaPreview'
  >;
  readonly busy: Signal<boolean>;
  readonly panel: Signal<string>;
  readonly error: WritableSignal<string>;
  token(): string;
  translate(key: string): string;
  resetInput(): void;
  persist(): void;
}

/** Read snapshots stay independent from the dossier and version being examined. */
export class AdminPilotageReadController {
  readonly state = signal<PilotState | null>(null);
  readonly selected = signal<PilotDecision | null>(null);
  readonly domain = signal<PilotDomain | ''>('');
  readonly loading = signal(true);
  readonly queue = computed(() => this.state()?.decisions ?? []);
  readonly pageCount = computed(() =>
    Math.max(
      1,
      Math.ceil((this.state()?.total ?? 0) / (this.state()?.pageSize ?? 30))
    )
  );
  readonly following = computed(() =>
    this.queue().filter((decision) => decision.id !== this.selected()?.id)
  );
  readonly stale = computed(() => {
    const decision = this.selected();
    const fresh = this.queue().find((item) => item.id === decision?.id);
    return (
      !!decision &&
      !!this.state() &&
      (!fresh ||
        fresh.version !== decision.version ||
        JSON.stringify(fresh.actions) !== JSON.stringify(decision.actions))
    );
  });
  readonly detailState = signal<PilotDetailState>('idle');
  readonly calendar = signal<PublicationCalendarEntry[]>([]);
  readonly calendarState = signal<'idle' | 'loading' | 'ready' | 'error'>(
    'idle'
  );
  private readonly imageResource = new BlobPreviewResource();
  readonly image = this.imageResource.url;
  readonly previewFailed = signal(false);
  private loadRequest = 0;
  private detailRequest = 0;
  private calendarRequest = 0;
  private lookupRequest = 0;
  private selectionGeneration = 0;
  private disposed = false;
  private restoreId = '';

  constructor(private readonly ports: PilotageReadPorts) {}

  restoreSelection(id: string): void {
    this.restoreId = id;
  }

  async load(
    replace = false,
    page = this.state()?.page ?? 1,
    retainEmptySelection = false,
    contextCurrent: () => boolean = () => true
  ): Promise<boolean> {
    if (this.disposed) return false;
    const request = ++this.loadRequest;
    const current = () =>
      !this.disposed && request === this.loadRequest && contextCurrent();
    try {
      const result = await this.ports.admin.pilotage({
        page,
        domain: this.domain() || undefined
      });
      if (!current()) return false;
      this.state.set(result);
      this.ports.error.set('');
      if (replace || (!this.selected() && !retainEmptySelection)) {
        const id = this.restoreId || this.selected()?.id;
        this.restoreId = '';
        this.select(
          result.decisions.find((decision) => decision.id === id) ??
            result.decisions[0] ??
            null
        );
      }
      return true;
    } catch (error) {
      if (current())
        this.ports.error.set(
          error instanceof Error ? error.message : 'PILOTAGE_UNAVAILABLE'
        );
      return false;
    } finally {
      if (current()) this.loading.set(false);
    }
  }

  choose(decision: PilotDecision | null): boolean {
    if (
      this.disposed ||
      this.ports.busy() ||
      ['confirm', 'edit'].includes(this.ports.panel())
    )
      return false;
    this.select(decision);
    return true;
  }

  private select(decision: PilotDecision | null): void {
    this.selectionGeneration++;
    this.invalidatePanelReads();
    this.selected.set(decision);
    this.ports.resetInput();
    this.ports.persist();
    void this.preview(decision);
  }

  async changeDomain(domain: PilotDomain | ''): Promise<boolean> {
    if (this.disposed || this.ports.busy() || this.ports.panel()) return false;
    this.domain.set(domain);
    this.select(null);
    this.loading.set(true);
    const loaded = await this.load(true, 1);
    if (!this.disposed) this.ports.persist();
    return loaded;
  }

  move(direction = 1): boolean {
    if (this.disposed || this.ports.busy() || this.ports.panel()) return false;
    const queue = this.queue();
    const index = queue.findIndex(
      (decision) => decision.id === this.selected()?.id
    );
    if (!queue.length) return false;
    return this.choose(
      queue[(Math.max(-1, index) + direction + queue.length) % queue.length] ??
        queue[0]!
    );
  }

  async page(direction: number): Promise<boolean> {
    if (this.disposed || this.ports.busy()) return false;
    this.select(null);
    const loaded = await this.load(true, (this.state()?.page ?? 1) + direction);
    if (!this.disposed) this.ports.persist();
    return loaded;
  }

  invalidatePanelReads(): void {
    this.detailRequest++;
    this.calendarRequest++;
    this.lookupRequest++;
    this.detailState.set('idle');
    if (this.calendarState() === 'loading') this.calendarState.set('idle');
  }

  async loadDetails(acceptLatest = false): Promise<boolean> {
    const decision = this.selected();
    if (
      this.disposed ||
      !decision ||
      decision.domain !== 'email' ||
      this.ports.panel() !== 'details' ||
      this.detailState() === 'loading'
    )
      return false;
    const request = ++this.detailRequest;
    const current = () =>
      !this.disposed &&
      request === this.detailRequest &&
      this.ports.panel() === 'details' &&
      this.selected()?.id === decision.id;
    this.detailState.set('loading');
    try {
      const snapshot = await this.ports.admin.pilotage({ id: decision.id });
      if (!current()) return false;
      const detail = snapshot.decisions.find((item) => item.id === decision.id);
      if (!detail) {
        this.state.update((state) =>
          state
            ? {
                ...state,
                decisions: state.decisions.filter(
                  (item) => item.id !== decision.id
                )
              }
            : state
        );
        this.detailState.set('missing');
      } else if (detail.version !== decision.version && !acceptLatest) {
        this.state.update((state) =>
          state
            ? {
                ...state,
                decisions: state.decisions.map((item) =>
                  item.id === decision.id ? detail : item
                )
              }
            : state
        );
        this.detailState.set('changed');
      } else if (!detail.email) {
        this.detailState.set('missing');
      } else {
        this.selected.set(detail);
        if (acceptLatest)
          this.state.update((state) =>
            state
              ? {
                  ...state,
                  writable: snapshot.writable,
                  decisions: state.decisions.map((item) =>
                    item.id === detail.id ? detail : item
                  )
                }
              : state
          );
        this.detailState.set('ready');
        this.ports.resetInput();
        return true;
      }
    } catch (error) {
      if (!current()) return false;
      const status = (error as { status?: number })?.status;
      this.detailState.set(
        status === 401 ? 'expired' : status === 403 ? 'forbidden' : 'error'
      );
    }
    return false;
  }

  /** A targeted read is cancelled if its panel or selected dossier changes. */
  async lookup(id: string, domain?: PilotDomain): Promise<PilotState | null> {
    if (this.disposed) return null;
    const request = ++this.lookupRequest;
    const selection = this.selectionGeneration;
    const panel = this.ports.panel();
    const current = () =>
      !this.disposed &&
      request === this.lookupRequest &&
      selection === this.selectionGeneration &&
      panel === this.ports.panel();
    try {
      const result = await this.ports.admin.pilotage({
        id,
        ...(domain ? { domain } : {})
      });
      return current() ? result : null;
    } catch {
      if (current()) this.ports.error.set('PILOTAGE_UNAVAILABLE');
      return null;
    }
  }

  async rereadForAction(
    decision: PilotDecision
  ): Promise<PilotDecision | null> {
    const snapshot = await this.lookup(decision.id);
    if (!snapshot) return null;
    const detail = snapshot.decisions.find((item) => item.id === decision.id);
    if (!detail || detail.version !== decision.version) {
      this.ports.error.set('VERSION_CONFLICT');
      return null;
    }
    this.selected.set(detail);
    return detail;
  }

  async focusDecision(
    snapshot: PilotState,
    decision: PilotDecision,
    domain: PilotDomain | ''
  ): Promise<boolean> {
    if (this.disposed || this.ports.busy()) return false;
    const selection = this.selectionGeneration;
    const lookup = this.lookupRequest;
    const panel = this.ports.panel();
    const current = () =>
      !this.disposed &&
      selection === this.selectionGeneration &&
      lookup === this.lookupRequest &&
      panel === this.ports.panel();
    this.domain.set(domain);
    const loaded = await this.load(
      false,
      snapshot.focusPage ?? 1,
      true,
      current
    );
    if (!loaded || !current()) return false;
    return this.choose(decision);
  }

  async loadCalendar(): Promise<void> {
    if (this.disposed || this.ports.panel() !== 'calendar') return;
    const request = ++this.calendarRequest;
    const selection = this.selectionGeneration;
    const current = () =>
      !this.disposed &&
      request === this.calendarRequest &&
      selection === this.selectionGeneration &&
      this.ports.panel() === 'calendar';
    this.calendarState.set('loading');
    try {
      const state =
        (await this.ports.admin.publicationAutomation()) as PublicationAutomationState;
      if (!current()) return;
      this.calendar.set(
        state.deliveries.map((delivery) => ({
          id: delivery.id,
          channel: delivery.feedId.endsWith('facebook')
            ? 'facebook'
            : 'linkedin',
          status:
            delivery.status === 'published'
              ? 'published'
              : ['approved', 'publishing'].includes(delivery.status)
                ? 'scheduled'
                : ['cancelled', 'rejected'].includes(delivery.status)
                  ? 'cancelled'
                  : 'open',
          startsAt: delivery.scheduledAt,
          capacity: 1,
          capacityUsed: 1,
          target: delivery.feedId.split(':')[0]!,
          label: delivery.message.slice(0, 70),
          detail: delivery.feedId,
          statusLabel: this.ports.translate(
            'admin.publicationAutomation.status.' + delivery.status
          )
        }))
      );
      this.calendarState.set('ready');
    } catch {
      if (current()) this.calendarState.set('error');
    }
  }

  private async preview(decision: PilotDecision | null): Promise<void> {
    this.previewFailed.set(false);
    const id =
      decision?.publication?.mediaId ?? decision?.sponsor?.presentationId;
    await this.imageResource.load(
      id
        ? () => this.ports.admin.getSponsorMediaPreview(this.ports.token(), id)
        : null,
      () => this.previewFailed.set(true)
    );
  }

  dispose(): void {
    this.disposed = true;
    this.loadRequest++;
    this.invalidatePanelReads();
    this.imageResource.dispose();
  }
}
