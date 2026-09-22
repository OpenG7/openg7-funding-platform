import { DOCUMENT, CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  viewChild
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type {
  PilotAction,
  PilotCommand,
  PilotDecision,
  PilotDomain,
  PilotReceipt,
  PilotState,
  PublicationAutomationState
} from '@openg7/funding-core';

import { FundingAdminService } from '../../services/funding-admin.service.js';
import { AdminGuideComponent } from '../../components/admin-guide/admin-guide.component.js';
import { PILOTAGE_GUIDE } from '../../components/admin-pilotage/pilotage-guides.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminInspectionService } from '../../services/admin-inspection.service.js';
import {
  EditorialProgrammeComponent,
  type ProgrammeCommand
} from '../../components/admin-pilotage/editorial-programme.component.js';
import { AdminInspectorComponent } from '../../components/admin-inspector/admin-inspector.component.js';
import { AdminDrawerComponent } from '../../components/admin-ui/admin-drawer.component.js';
import {
  AdminIconComponent,
  type AdminIconName
} from '../../components/admin-ui/admin-icon.component.js';
import { ControllerService } from '../../components/admin-pilotage/controller.service.js';
import {
  defaultControllerProfile,
  type ControllerIntent
} from '../../components/admin-pilotage/controller-input.js';
import { PilotKeyboardComponent } from '../../components/admin-pilotage/pilot-keyboard.component.js';
import { AdminPublicationCalendarComponent } from '../../components/admin-publications/admin-publication-calendar.component.js';
import type { PublicationCalendarEntry } from '../../components/admin-publications/publication-calendar.js';

type Panel =
  | ''
  | 'confirm'
  | 'edit'
  | 'details'
  | 'calendar'
  | 'menu'
  | 'help'
  | 'settings'
  | 'incident'
  | 'programme';

/** Routed orchestration: one stable decision, explicit commands and server receipts. */
@Component({
  selector: 'openg7-admin-pilotage-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    AdminDrawerComponent,
    AdminIconComponent,
    PilotKeyboardComponent,
    AdminPublicationCalendarComponent,
    AdminInspectorComponent,
    EditorialProgrammeComponent,
    AdminGuideComponent
  ],
  providers: [ControllerService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-pilotage-page.component.html',
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    './admin-pilotage-page.component.css'
  ]
})
export class AdminPilotagePageComponent {
  readonly admin = inject(FundingAdminService);
  readonly i18n = inject(FundingI18nService);
  readonly controller = inject(ControllerService);
  readonly inspection = inject(AdminInspectionService);
  readonly guideSteps = PILOTAGE_GUIDE;
  private readonly guide = viewChild(AdminGuideComponent);
  private readonly programme = viewChild(EditorialProgrammeComponent);
  private readonly document = inject(DOCUMENT);
  readonly state = signal<PilotState | null>(null);
  readonly selected = signal<PilotDecision | null>(null);
  readonly domain = signal<PilotDomain | ''>('');
  readonly panel = signal<Panel>('');
  readonly busy = signal(false);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly receipt = signal<PilotReceipt | null>(null);
  readonly unresolved = signal('');
  readonly image = signal('');
  readonly previewFailed = signal(false);
  readonly detailLoading = signal(false);
  readonly calendar = signal<PublicationCalendarEntry[]>([]);
  readonly calendarState = signal<'idle' | 'loading' | 'ready' | 'error'>(
    'idle'
  );
  readonly keyboard = signal(false);
  readonly pending = signal<{
    action: PilotAction;
    targetId: string;
    version: string;
    title: string;
  } | null>(null);
  readonly metrics = signal({ decisions: 0, details: 0, portal: 0 });
  readonly sessionStart = signal(0);
  readonly sessionDecisions = signal(0);
  readonly sessionElapsed = signal(0);
  readonly domains: { id: PilotDomain; icon: AdminIconName }[] = [
    { id: 'publications', icon: 'publications' },
    { id: 'sponsors', icon: 'sponsors' },
    { id: 'email', icon: 'email' },
    { id: 'invoices', icon: 'invoices' },
    { id: 'contributions', icon: 'contributions' },
    { id: 'projects', icon: 'expenses' },
    { id: 'operations', icon: 'settings' }
  ];
  readonly queue = computed(() => this.state()?.decisions ?? []);
  readonly pageCount = computed(() =>
    Math.max(
      1,
      Math.ceil((this.state()?.total ?? 0) / (this.state()?.pageSize ?? 30))
    )
  );
  readonly preparing = computed(
    () =>
      !!this.state()?.workerEnabled &&
      !!this.state()?.feeds.some((f) => f.autoPrepare)
  );
  readonly following = computed(() =>
    this.queue().filter((d) => d.id !== this.selected()?.id)
  );
  readonly pendingSponsors = computed(
    () =>
      this.selected()?.publication?.sponsors.filter(
        (s) => s.reviewStatus === 'pending_review'
      ) ?? []
  );
  readonly stale = computed(() => {
    const d = this.selected(),
      fresh = this.queue().find((i) => i.id === d?.id);
    return (
      !!d &&
      !!this.state() &&
      (!fresh ||
        fresh.version !== d.version ||
        JSON.stringify(fresh.actions) !== JSON.stringify(d.actions))
    );
  });
  readonly primary = computed(() =>
    this.selected()?.actions.find(
      (a) => !a.id.endsWith('.reject') && !a.id.endsWith('.edit')
    )
  );
  readonly reject = computed(() =>
    this.selected()?.actions.find((a) => a.id.endsWith('.reject'))
  );
  readonly editable = computed(() =>
    this.selected()?.actions.find((a) => a.id === 'publication.edit')
  );
  readonly blocked = computed(
    () =>
      this.busy() ||
      !!this.unresolved() ||
      this.stale() ||
      !this.state()?.writable ||
      this.receipt()?.status === 'completed'
  );
  readonly profile = defaultControllerProfile();
  readonly rawLabels = [
    'A',
    'B',
    'X',
    'Y',
    'LB',
    'RB',
    'LT',
    'RT',
    'View',
    'Menu',
    'LS',
    'RS',
    '↑',
    '↓',
    '←',
    '→'
  ];
  edit = { message: '', scheduledAt: '', mediaId: '' };
  reason = '';
  incidentReason = '';
  private imageRequest = 0;
  private loadRequest = 0;
  private destroyed = false;
  private restoreId = '';

  constructor() {
    effect(() => {
      this.inspection.current();
      this.controller.reset();
    });
    const destroy = inject(DestroyRef);
    destroy.onDestroy(() => {
      this.destroyed = true;
      this.loadRequest++;
      this.imageRequest++;
      this.controller.stop();
      this.clearImage();
    });
    afterNextRender(() => {
      try {
        const storage = this.document.defaultView!.sessionStorage;
        const saved = JSON.parse(
          storage.getItem('og7-pilot-context') ?? 'null'
        ) as { id?: string; domain?: string; page?: number } | null;
        if (saved?.domain && this.domains.some((d) => d.id === saved.domain))
          this.domain.set(saved.domain as PilotDomain);
        this.restoreId = typeof saved?.id === 'string' ? saved.id : '';
        this.unresolved.set(storage.getItem(this.receiptStorageKey()) ?? '');
        void this.load(
          true,
          Number.isSafeInteger(saved?.page) ? saved!.page! : 1
        );
      } catch {
        void this.load(true);
      }
      this.controller.start((intent) => this.intent(intent));
      try {
        const saved = JSON.parse(
          this.document.defaultView!.sessionStorage.getItem(
            this.sessionKey()
          ) ?? 'null'
        );
        if (
          saved &&
          Number.isFinite(saved.start) &&
          saved.start > Date.now() - 86400000 &&
          saved.start <= Date.now()
        ) {
          this.sessionStart.set(saved.start);
          this.sessionDecisions.set(
            Number.isSafeInteger(saved.decisions) && saved.decisions >= 0
              ? saved.decisions
              : 0
          );
        }
      } catch {
        /* Optional session context. */
      }
      const sessionTimer = setInterval(
        () =>
          this.sessionElapsed.set(
            this.sessionStart()
              ? Math.floor((Date.now() - this.sessionStart()) / 60000)
              : 0
          ),
        5000
      );
      destroy.onDestroy(() => clearInterval(sessionTimer));
      Object.assign(this.profile, structuredClone(this.controller.profile()));
      if (this.unresolved()) void this.recover();
      const timer = setInterval(() => {
        if (!this.busy() && !this.document.hidden) void this.load(false);
      }, 30000);
      destroy.onDestroy(() => clearInterval(timer));
    });
  }
  private receiptStorageKey(): string {
    return 'og7-pilot-receipt:' + (this.admin.identity()?.id ?? 'token');
  }
  private sessionKey(): string {
    return 'og7-pilot-session:' + (this.admin.identity()?.id ?? 'token');
  }
  startSession(): void {
    if (!this.sessionStart()) {
      this.sessionStart.set(Date.now());
      this.sessionDecisions.set(0);
      this.sessionElapsed.set(0);
    }
    this.saveSession();
    this.close();
    this.document.getElementById('admin-main')?.focus();
  }
  stopSession(): void {
    this.sessionStart.set(0);
    this.saveSession();
  }
  private saveSession(): void {
    try {
      this.document.defaultView?.sessionStorage.setItem(
        this.sessionKey(),
        JSON.stringify({
          start: this.sessionStart(),
          decisions: this.sessionDecisions()
        })
      );
    } catch {
      /* Optional counters only. */
    }
  }
  async reviewDecision(id: string): Promise<void> {
    if (this.busy()) return;
    try {
      const snapshot = await this.admin.pilotage({ id });
      const d = snapshot.decisions[0];
      if (!d) {
        this.error.set('VERSION_CONFLICT');
        return;
      }
      this.close();
      this.domain.set('');
      await this.load(false, snapshot.focusPage ?? 1);
      this.choose(d);
      this.document.getElementById('admin-main')?.focus();
    } catch {
      this.error.set('PILOTAGE_UNAVAILABLE');
    }
  }
  programmeCommand(command: ProgrammeCommand): void {
    void this.send(command);
  }
  t(key: string): string {
    return this.i18n.t('admin.pilotage.' + key);
  }
  kind(d: PilotDecision): string {
    if (d.kind.startsWith('publication_') && d.publication)
      return this.t('kinds.' + d.kind);
    if (d.kind === 'project_review') return this.t('kinds.project_review');
    const key = 'admin.attention.types.' + d.kind;
    const label = this.i18n.t(key);
    return label === key ? this.t('domains.' + d.domain) : label;
  }
  actionLabel(action: PilotAction): string {
    return this.t('actions.' + action.replace('.', '_'));
  }
  consequence(action?: PilotAction): string {
    return this.t('consequences.' + (action?.replace('.', '_') ?? 'details'));
  }
  date(value: string | null): string {
    return value
      ? new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
          dateStyle: 'medium',
          timeStyle: 'short'
        }).format(new Date(value))
      : this.t('undated');
  }
  errorLabel(code: string): string {
    const programme = 'admin.programme.errors.' + code;
    if (this.i18n.t(programme) !== programme) return this.i18n.t(programme);
    const key = 'admin.pilotage.errors.' + code,
      label = this.i18n.t(key);
    if (label !== key) return label;
    const existing = 'admin.publicationAutomation.errors.' + code,
      translated = this.i18n.t(existing);
    return translated !== existing ? translated : this.t('errors.generic');
  }
  async load(replace = false, page = this.state()?.page ?? 1): Promise<void> {
    const request = ++this.loadRequest;
    try {
      const result = await this.admin.pilotage({
        page,
        domain: this.domain() || undefined
      });
      if (request !== this.loadRequest || this.destroyed) return;
      this.state.set(result);
      this.error.set('');
      if (replace || !this.selected()) {
        const id = this.restoreId || this.selected()?.id;
        this.restoreId = '';
        this.choose(
          result.decisions.find((d) => d.id === id) ??
            result.decisions[0] ??
            null
        );
      }
    } catch (error) {
      if (request === this.loadRequest)
        this.error.set(
          error instanceof Error ? error.message : 'PILOTAGE_UNAVAILABLE'
        );
    } finally {
      if (request === this.loadRequest) this.loading.set(false);
    }
  }
  choose(decision: PilotDecision | null): void {
    if (this.busy() || this.panel() === 'confirm' || this.panel() === 'edit')
      return;
    this.selected.set(decision);
    this.receipt.set(null);
    this.controller.reset();
    this.persist();
    void this.preview(decision);
  }
  async changeDomain(domain: PilotDomain | ''): Promise<void> {
    if (this.busy() || this.panel()) return;
    this.domain.set(domain);
    this.selected.set(null);
    this.loading.set(true);
    this.controller.reset();
    await this.load(true, 1);
    this.persist();
  }
  next(direction = 1): void {
    if (this.busy() || this.panel()) return;
    const queue = this.queue(),
      index = queue.findIndex((d) => d.id === this.selected()?.id);
    if (!queue.length) return;
    this.choose(
      queue[(Math.max(-1, index) + direction + queue.length) % queue.length] ??
        queue[0]!
    );
  }
  async page(direction: number): Promise<void> {
    if (!this.busy()) {
      this.selected.set(null);
      await this.load(true, (this.state()?.page ?? 1) + direction);
      this.persist();
    }
  }
  private persist(): void {
    try {
      this.document.defaultView?.sessionStorage.setItem(
        'og7-pilot-context',
        JSON.stringify({
          id: this.selected()?.id,
          domain: this.domain(),
          page: this.state()?.page
        })
      );
    } catch {
      /* Optional context. */
    }
  }
  open(panel: Panel): void {
    if (this.busy()) return;
    this.panel.set(panel);
    this.keyboard.set(false);
    this.controller.reset();
  }
  close(): void {
    if (!this.busy()) {
      this.panel.set('');
      this.pending.set(null);
      this.controller.reset();
    }
  }
  async request(action: PilotAction): Promise<void> {
    let d = this.selected();
    const available = d?.actions.find((a) => a.id === action);
    if (!d || !available || available.blocked || this.blocked()) return;
    if (action === 'email.retry') {
      this.busy.set(true);
      this.controller.reset();
      try {
        const detail = (await this.admin.pilotage({ id: d.id })).decisions[0];
        if (!detail || detail.version !== d.version) {
          this.error.set('VERSION_CONFLICT');
          return;
        }
        if (this.destroyed) return;
        d = detail;
        this.selected.set(detail);
      } catch {
        this.error.set('PILOTAGE_UNAVAILABLE');
        return;
      } finally {
        this.busy.set(false);
      }
    }
    this.reason = '';
    this.pending.set({
      action,
      targetId: d.targetId,
      version: d.version,
      title: d.title || this.kind(d)
    });
    this.open('confirm');
  }
  feed(feed: PilotState['feeds'][number]): void {
    if (this.busy() || this.unresolved() || !this.state()?.writable) return;
    this.pending.set({
      action: feed.paused ? 'feed.resume' : 'feed.pause',
      targetId: feed.id,
      version: feed.version,
      title: feed.id
    });
    this.open('confirm');
  }
  startEdit(): void {
    const d = this.selected();
    if (
      !d?.publication ||
      !this.editable() ||
      this.editable()!.blocked ||
      this.blocked()
    )
      return;
    const date = new Date(d.publication.scheduledAt);
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    this.edit = {
      message: d.publication.message,
      scheduledAt: date.toISOString().slice(0, 16),
      mediaId: d.publication.mediaId ?? ''
    };
    this.open('edit');
  }
  saveEdit(): void {
    const d = this.selected(),
      date = new Date(this.edit.scheduledAt);
    if (
      !d ||
      !this.edit.message.trim() ||
      !Number.isFinite(date.getTime()) ||
      date.getTime() <= Date.now()
    ) {
      this.error.set('INVALID_EDIT');
      return;
    }
    void this.send({
      action: 'publication.edit',
      targetId: d.targetId,
      version: d.version,
      payload: {
        message: this.edit.message,
        scheduledAt: date.toISOString(),
        mediaId: this.edit.mediaId || null
      }
    });
  }
  shiftDate(minutes: number): void {
    const date = new Date(this.edit.scheduledAt);
    if (!Number.isFinite(date.getTime())) return;
    date.setMinutes(date.getMinutes() + minutes);
    this.edit.scheduledAt = new Date(
      date.getTime() - date.getTimezoneOffset() * 60000
    )
      .toISOString()
      .slice(0, 16);
  }
  confirm(): void {
    const p = this.pending();
    if (!p || this.busy() || this.unresolved()) return;
    if (p.action === 'sponsor.reject' && this.reason.trim().length < 3) return;
    const payload: PilotCommand['payload'] =
      p.action === 'publication.approve'
        ? {
            approveSponsors: this.pendingSponsors().map((s) => ({
              id: s.id,
              version: s.version
            }))
          }
        : p.action === 'sponsor.reject'
          ? { reason: this.reason.trim() }
          : undefined;
    void this.send({ ...p, payload });
  }
  private async send(
    command: Pick<PilotCommand, 'action' | 'targetId' | 'version' | 'payload'>
  ): Promise<void> {
    if (this.busy() || this.unresolved()) return;
    const requestId = this.document.defaultView!.crypto.randomUUID();
    this.busy.set(true);
    this.error.set('');
    this.controller.reset();
    this.unresolved.set(requestId);
    try {
      this.document.defaultView?.sessionStorage.setItem(
        this.receiptStorageKey(),
        requestId
      );
    } catch {
      /* Receipt still retained in memory. */
    }
    try {
      await this.receive(
        await this.admin.pilotageCommand({
          ...command,
          requestId,
          confirmation: command.targetId
        })
      );
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'RESULT_UNKNOWN');
      const status = (error as { status?: number })?.status;
      if (status && [400, 401, 403, 409].includes(status)) {
        this.unresolved.set('');
        try {
          this.document.defaultView?.sessionStorage.removeItem(
            this.receiptStorageKey()
          );
        } catch {
          /* Optional storage. */
        }
        if (status === 401 || status === 403)
          this.state.update((s) => (s ? { ...s, writable: false } : s));
      }
    } finally {
      this.busy.set(false);
      this.panel.set('');
      this.pending.set(null);
      this.controller.reset();
    }
  }
  async recover(): Promise<void> {
    if (!this.unresolved() || this.busy()) return;
    this.busy.set(true);
    this.controller.reset();
    try {
      await this.receive(await this.admin.pilotageReceipt(this.unresolved()));
    } catch {
      this.error.set('RESULT_UNKNOWN');
    } finally {
      this.busy.set(false);
      this.controller.reset();
    }
  }
  async acknowledgeIncident(): Promise<void> {
    if (
      this.busy() ||
      !this.unresolved() ||
      this.receipt()?.status !== 'uncertain' ||
      this.incidentReason.trim().length < 10
    )
      return;
    this.busy.set(true);
    this.controller.reset();
    try {
      await this.receive(
        await this.admin.acknowledgePilotReceipt(
          this.unresolved(),
          this.incidentReason
        )
      );
      this.panel.set('');
      this.error.set('');
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'RESULT_UNKNOWN');
    } finally {
      this.busy.set(false);
      this.controller.reset();
    }
  }
  private async receive(receipt: PilotReceipt): Promise<void> {
    this.receipt.set(receipt);
    if (
      receipt.status === 'completed' ||
      receipt.status === 'failed' ||
      receipt.reviewedAt
    ) {
      this.unresolved.set('');
      try {
        this.document.defaultView?.sessionStorage.removeItem(
          this.receiptStorageKey()
        );
      } catch {
        /* Optional storage. */
      }
      if (receipt.status === 'completed') {
        this.controller.feedback();
        this.metrics.update((m) => ({ ...m, decisions: m.decisions + 1 }));
        if (this.sessionStart()) {
          this.sessionDecisions.update((n) => n + 1);
          this.saveSession();
        }
      } else if (!receipt.reviewedAt) this.error.set(receipt.code ?? 'generic');
      await this.load(false);
    }
  }
  async details(): Promise<void> {
    const d = this.selected();
    if (!d) return;
    if (d.inspection) {
      this.metrics.update((m) => ({ ...m, details: m.details + 1 }));
      if (d.inspection.kind === 'stripe')
        this.inspection.stripe(d.inspection.id, d.detailsUrl);
      else
        this.inspection.invoice(d.inspection.id, d.inspection.contributionId!);
      this.controller.reset();
      return;
    }
    this.open('details');
    this.metrics.update((m) => ({ ...m, details: m.details + 1 }));
    if (d.domain === 'email') {
      this.detailLoading.set(true);
      try {
        const detail = (await this.admin.pilotage({ id: d.id })).decisions[0];
        if (
          detail &&
          this.selected()?.id === d.id &&
          detail.version === d.version
        )
          this.selected.set(detail);
      } catch {
        this.error.set('PILOTAGE_UNAVAILABLE');
      } finally {
        this.detailLoading.set(false);
      }
    }
  }
  portal(): void {
    this.persist();
    this.metrics.update((m) => ({ ...m, portal: m.portal + 1 }));
  }
  async openCalendar(): Promise<void> {
    this.open('calendar');
    this.calendarState.set('loading');
    try {
      const state =
        (await this.admin.publicationAutomation()) as PublicationAutomationState;
      this.calendar.set(
        state.deliveries.map((p) => ({
          id: p.id,
          channel: p.feedId.endsWith('facebook') ? 'facebook' : 'linkedin',
          status:
            p.status === 'published'
              ? 'published'
              : ['approved', 'publishing'].includes(p.status)
                ? 'scheduled'
                : ['cancelled', 'rejected'].includes(p.status)
                  ? 'cancelled'
                  : 'open',
          startsAt: p.scheduledAt,
          capacity: 1,
          capacityUsed: 1,
          target: p.feedId.split(':')[0]!,
          label: p.message.slice(0, 70),
          detail: p.feedId,
          statusLabel: this.i18n.t(
            'admin.publicationAutomation.status.' + p.status
          )
        }))
      );
      this.calendarState.set('ready');
    } catch {
      this.calendarState.set('error');
    }
  }
  async calendarSelect(id: string): Promise<void> {
    try {
      const snapshot = await this.admin.pilotage({
        id: 'publication:' + id,
        domain: 'publications'
      });
      const item = snapshot.decisions[0];
      if (item) {
        this.close();
        this.domain.set('publications');
        await this.load(false, snapshot.focusPage ?? 1);
        this.choose(item);
        await this.details();
      } else this.error.set('CALENDAR_HISTORY');
    } catch {
      this.error.set('PILOTAGE_UNAVAILABLE');
    }
  }
  private clearImage(): void {
    if (this.image().startsWith('blob:')) URL.revokeObjectURL(this.image());
    this.image.set('');
  }
  private async preview(d: PilotDecision | null): Promise<void> {
    const request = ++this.imageRequest;
    this.clearImage();
    this.previewFailed.set(false);
    const id = d?.publication?.mediaId ?? d?.sponsor?.presentationId;
    if (!id) return;
    try {
      const blob = await this.admin.getSponsorMediaPreview(
        this.admin.getSavedAdminToken(),
        id
      );
      if (request === this.imageRequest && !this.destroyed)
        this.image.set(URL.createObjectURL(blob));
    } catch {
      if (request === this.imageRequest) this.previewFailed.set(true);
    }
  }
  saveProfile(): void {
    if (this.controller.save(this.profile)) {
      this.error.set('');
      this.close();
    } else this.error.set('INVALID_PROFILE');
  }
  resetProfile(): void {
    Object.assign(this.profile, defaultControllerProfile());
    this.controller.save(this.profile);
    this.error.set('');
  }
  intent(intent: ControllerIntent): void {
    if (
      this.guide()?.handleIntent(intent) ||
      this.programme()?.guide()?.handleIntent(intent)
    )
      return;
    if (this.busy()) return;
    if (this.inspection.current()) {
      if (intent === 'secondary') {
        this.inspection.close();
        this.controller.reset();
      } else if (['up', 'down', 'left', 'right'].includes(intent))
        this.moveFocus(intent);
      else if (
        intent === 'primary' &&
        (this.document.activeElement as HTMLElement | null)?.closest(
          'dialog[open]'
        )
      )
        (this.document.activeElement as HTMLElement).click();
      return;
    }
    if (intent === 'secondary' && this.panel()) {
      this.close();
      return;
    }
    if (this.panel()) {
      if (intent === 'scrollDown' || intent === 'scrollUp') {
        this.document
          .querySelector('dialog[open]')
          ?.scrollBy({ top: intent === 'scrollDown' ? 140 : -140 });
        return;
      }
      if (intent === 'primary') {
        if (this.panel() === 'confirm') {
          this.confirm();
          return;
        }
        const active = this.document.activeElement as HTMLElement | null;
        if (active?.closest('dialog[open]')) {
          if (active.matches('textarea') && this.panel() === 'edit') {
            this.keyboard.set(true);
            this.controller.reset();
          } else active.click();
        }
      }
      if (['up', 'down', 'left', 'right'].includes(intent))
        this.moveFocus(intent);
      return;
    }
    switch (intent) {
      case 'primary': {
        const active = this.document.activeElement as HTMLElement | null;
        if (
          active?.matches('button:not([disabled]),a[href]') &&
          active.closest('.pilot')
        )
          active.click();
        else if (this.primary()) this.request(this.primary()!.id);
        break;
      }
      case 'secondary':
        if (this.reject()) this.request(this.reject()!.id);
        break;
      case 'edit':
        this.startEdit();
        break;
      case 'details':
        void this.details();
        break;
      case 'previous':
      case 'left':
        this.next(-1);
        break;
      case 'next':
      case 'right':
        this.next();
        break;
      case 'up':
      case 'down':
        this.moveFocus(intent);
        break;
      case 'calendar':
        void this.openCalendar();
        break;
      case 'menu':
        this.open('menu');
        break;
      case 'help':
        this.open('help');
        break;
      case 'domainPrevious':
      case 'domainNext': {
        const choices: ['', ...PilotDomain[]] = [
          '',
          ...this.domains.map((d) => d.id)
        ];
        void this.changeDomain(
          choices[
            (choices.indexOf(this.domain()) +
              (intent === 'domainNext' ? 1 : -1) +
              choices.length) %
              choices.length
          ]!
        );
        break;
      }
      case 'scrollUp':
      case 'scrollDown':
        this.document
          .querySelector('.decision-copy')
          ?.scrollBy({ top: intent === 'scrollDown' ? 150 : -150 });
        break;
    }
  }
  private moveFocus(intent: ControllerIntent): void {
    const active = this.document.activeElement;
    if (
      (intent === 'left' || intent === 'right') &&
      active instanceof HTMLSelectElement
    ) {
      active.selectedIndex = Math.max(
        0,
        Math.min(
          active.options.length - 1,
          active.selectedIndex + (intent === 'right' ? 1 : -1)
        )
      );
      active.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    if (
      (intent === 'left' || intent === 'right') &&
      active instanceof HTMLInputElement &&
      ['range', 'number'].includes(active.type)
    ) {
      if (intent === 'right') active.stepUp();
      else active.stepDown();
      active.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    const scope =
      this.document.querySelector('dialog[open]') ??
      this.document.querySelector('.pilot');
    const elements = Array.from(
      scope?.querySelectorAll<HTMLElement>(
        'button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled])'
      ) ?? []
    ).filter((e) => e.getClientRects().length > 0);
    const current = this.document.activeElement as HTMLElement,
      index = elements.indexOf(current);
    const keyboard = current?.closest('.keys');
    const step = keyboard && (intent === 'up' || intent === 'down') ? 10 : 1;
    const direction = intent === 'up' || intent === 'left' ? -step : step;
    elements[(index + direction + elements.length) % elements.length]?.focus();
  }
}
