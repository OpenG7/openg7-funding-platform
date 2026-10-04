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
  PilotState
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
import { AdminLayoutComponent } from '../../components/admin-layout/admin-layout.component.js';
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
import { PilotDecisionDetailsComponent } from '../../components/admin-pilotage/pilot-decision-details.component.js';
import { AdminPublicationCalendarComponent } from '../../components/admin-publications/admin-publication-calendar.component.js';
import { PilotAppearanceService } from '../../services/pilot-appearance.service.js';
import { PilotAppearanceComponent } from '../../components/admin-pilotage/pilot-appearance.component.js';

import { AdminPilotageCommandWorkflow } from './admin-pilotage-command-workflow.js';
import { AdminPilotageReadController } from './admin-pilotage-read.controller.js';

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
  | 'programme'
  | 'appearance';

/** Routed orchestration: one stable decision, explicit commands and server receipts. */
@Component({
  selector: 'openg7-admin-pilotage-page',
  standalone: true,
  imports: [
    PilotAppearanceComponent,
    CommonModule,
    FormsModule,
    RouterLink,
    AdminDrawerComponent,
    AdminIconComponent,
    PilotKeyboardComponent,
    PilotDecisionDetailsComponent,
    AdminPublicationCalendarComponent,
    AdminLayoutComponent,
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
  readonly appearance = inject(PilotAppearanceService);
  readonly concentrated = signal(false);
  readonly queueVisible = signal(false);
  readonly guideActive = signal(false);
  guideChanged(active: boolean): void {
    this.guideActive.set(active);
    if (active) this.concentrated.set(false);
    this.controller.reset();
  }
  toggleConcentration(): void {
    if (this.busy() || this.panel() || this.guideActive()) return;
    this.concentrated.update((value) => !value);
    this.queueVisible.set(false);
    this.controller.reset();
  }
  toggleQueue(): void {
    this.queueVisible.update((value) => !value);
    this.controller.reset();
  }
  private readonly guide = viewChild(AdminGuideComponent);
  private readonly programme = viewChild(EditorialProgrammeComponent);
  private readonly document = inject(DOCUMENT);
  readonly panel = signal<Panel>('');
  readonly busy = signal(false);
  readonly error = signal('');
  readonly receipt = signal<PilotReceipt | null>(null);
  readonly unresolved = signal('');
  private readonly reads = new AdminPilotageReadController({
    admin: this.admin,
    busy: this.busy.asReadonly(),
    panel: this.panel.asReadonly(),
    error: this.error,
    token: () => this.admin.getSavedAdminToken(),
    translate: (key) => this.i18n.t(key),
    resetInput: () => this.controller.reset(),
    persist: () => this.persist()
  });
  readonly state = this.reads.state;
  readonly selected = this.reads.selected;
  readonly domain = this.reads.domain;
  readonly loading = this.reads.loading;
  readonly image = this.reads.image;
  readonly previewFailed = this.reads.previewFailed;
  readonly detailState = this.reads.detailState;
  readonly calendar = this.reads.calendar;
  readonly calendarState = this.reads.calendarState;
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
  private readonly commands = new AdminPilotageCommandWorkflow({
    admin: this.admin,
    state: {
      busy: this.busy,
      error: this.error,
      receipt: this.receipt,
      unresolved: this.unresolved
    },
    actorId: () => this.admin.identity()?.id ?? 'token',
    storage: () => this.document.defaultView?.sessionStorage ?? null,
    requestId: () => this.document.defaultView!.crypto.randomUUID(),
    resetInput: () => this.controller.reset(),
    settleCommand: () => {
      this.panel.set('');
      this.pending.set(null);
    },
    closeIncident: () => this.panel.set(''),
    confirmed: () => {
      this.controller.feedback();
      this.metrics.update((m) => ({ ...m, decisions: m.decisions + 1 }));
      if (this.sessionStart()) {
        this.sessionDecisions.update((n) => n + 1);
        this.saveSession();
      }
    },
    denyWrites: () =>
      this.state.update((s) => (s ? { ...s, writable: false } : s)),
    refresh: () => this.load(false)
  });
  readonly domains: { id: PilotDomain; icon: AdminIconName }[] = [
    { id: 'publications', icon: 'publications' },
    { id: 'sponsors', icon: 'sponsors' },
    { id: 'email', icon: 'email' },
    { id: 'invoices', icon: 'invoices' },
    { id: 'contributions', icon: 'contributions' },
    { id: 'projects', icon: 'expenses' },
    { id: 'operations', icon: 'settings' }
  ];
  readonly queue = this.reads.queue;
  domainIcon(domain: PilotDomain): AdminIconName {
    return this.domains.find((item) => item.id === domain)?.icon ?? 'audit';
  }
  readonly pageCount = this.reads.pageCount;
  readonly preparing = computed(
    () =>
      !!this.state()?.workerEnabled &&
      !!this.state()?.feeds.some((f) => f.autoPrepare)
  );
  readonly following = this.reads.following;
  readonly pendingSponsors = computed(
    () =>
      this.selected()?.publication?.sponsors.filter(
        (s) => s.reviewStatus === 'pending_review'
      ) ?? []
  );
  readonly stale = this.reads.stale;
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

  constructor() {
    effect(() => {
      this.inspection.current();
      this.controller.reset();
    });
    const destroy = inject(DestroyRef);
    destroy.onDestroy(() => {
      this.reads.dispose();
      this.controller.stop();
    });
    afterNextRender(() => {
      try {
        const storage = this.document.defaultView!.sessionStorage;
        const saved = JSON.parse(
          storage.getItem('og7-pilot-context') ?? 'null'
        ) as { id?: string; domain?: string; page?: number } | null;
        if (saved?.domain && this.domains.some((d) => d.id === saved.domain))
          this.domain.set(saved.domain as PilotDomain);
        this.reads.restoreSelection(
          typeof saved?.id === 'string' ? saved.id : ''
        );
        this.unresolved.set(
          storage.getItem(this.commands.receiptStorageKey()) ?? ''
        );
        void this.load(
          true,
          Number.isSafeInteger(saved?.page) ? saved!.page! : 1
        );
      } catch {
        void this.load(true);
      }
      this.controller.start((intent) => this.intent(intent));
      let globalNavigation = this.globalNavigationActive();
      const focusChanged = () => {
        const next = this.globalNavigationActive();
        if (next !== globalNavigation) this.controller.reset();
        globalNavigation = next;
      };
      this.document.addEventListener('focusin', focusChanged);
      destroy.onDestroy(() =>
        this.document.removeEventListener('focusin', focusChanged)
      );
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
    const snapshot = await this.reads.lookup(id);
    if (!snapshot) return;
    const decision = snapshot.decisions.find((item) => item.id === id);
    if (!decision) {
      this.error.set('VERSION_CONFLICT');
      return;
    }
    this.close();
    if (
      await this.replaceRead(this.reads.focusDecision(snapshot, decision, ''))
    ) {
      this.document.getElementById('admin-main')?.focus();
    }
  }
  programmeCommand(command: ProgrammeCommand): void {
    void this.commands.send(command);
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
    if (replace) await this.replaceRead(this.reads.load(true, page));
    else await this.reads.load(false, page);
  }
  choose(decision: PilotDecision | null): void {
    if (this.reads.choose(decision)) this.receipt.set(null);
  }
  async changeDomain(domain: PilotDomain | ''): Promise<void> {
    await this.replaceRead(this.reads.changeDomain(domain));
  }
  next(direction = 1): void {
    if (this.reads.move(direction)) this.receipt.set(null);
  }
  async page(direction: number): Promise<void> {
    await this.replaceRead(this.reads.page(direction));
  }
  private async replaceRead(read: Promise<boolean>): Promise<boolean> {
    const receipt = this.receipt();
    const unresolved = this.unresolved();
    const applied = await read;
    if (
      applied &&
      this.receipt() === receipt &&
      this.unresolved() === unresolved
    )
      this.receipt.set(null);
    return applied;
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
    if (panel !== 'details') this.reads.invalidatePanelReads();
    this.panel.set(panel);
    this.keyboard.set(false);
    this.controller.reset();
  }
  close(): void {
    if (!this.busy()) {
      this.reads.invalidatePanelReads();
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
        const detail = await this.reads.rereadForAction(d);
        if (!detail) return;
        d = detail;
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
    void this.commands.send({
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
    void this.commands.send({ ...p, payload });
  }
  recover(): Promise<void> {
    return this.commands.recover();
  }
  acknowledgeIncident(): Promise<void> {
    return this.commands.acknowledgeIncident(this.incidentReason);
  }
  async details(): Promise<void> {
    const d = this.selected();
    if (!d || this.busy()) return;
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
    if (d.domain === 'email') await this.loadDetails();
  }
  async loadDetails(acceptLatest = false): Promise<void> {
    const ready = await this.reads.loadDetails(acceptLatest);
    if (ready && acceptLatest) {
      this.document
        .querySelector<HTMLElement>(
          'dialog[open] [data-og7="admin-drawer-content"]'
        )
        ?.focus();
    }
  }
  portal(): void {
    this.persist();
    this.metrics.update((m) => ({ ...m, portal: m.portal + 1 }));
  }
  async openCalendar(): Promise<void> {
    this.open('calendar');
    await this.reads.loadCalendar();
  }
  async calendarSelect(id: string): Promise<void> {
    const snapshot = await this.reads.lookup(
      'publication:' + id,
      'publications'
    );
    if (!snapshot) return;
    const item = snapshot.decisions.find(
      (decision) => decision.id === 'publication:' + id
    );
    if (!item) {
      this.error.set('CALENDAR_HISTORY');
      return;
    }
    this.close();
    if (
      await this.replaceRead(
        this.reads.focusDecision(snapshot, item, 'publications')
      )
    ) {
      await this.details();
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
    // The shared navigation and search own their focus; cockpit shortcuts
    // must never act on a decision while the user is using those controls.
    if (this.globalNavigationActive()) {
      this.controller.reset();
      return;
    }
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
        const dialog = this.document.querySelector('dialog[open]');
        const body = dialog?.querySelector('[data-og7="admin-drawer-content"]');
        const scrollTarget = this.panel() === 'details' ? body : dialog;
        scrollTarget?.scrollBy({ top: intent === 'scrollDown' ? 140 : -140 });
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
          .querySelector('[data-og7="pilot-scroll"]')
          ?.scrollBy({ top: intent === 'scrollDown' ? 150 : -150 });
        break;
    }
  }
  private globalNavigationActive(): boolean {
    if (this.panel() || this.inspection.current()) return false;
    const active = this.document.activeElement;
    return !!(
      this.document.querySelector('dialog[open]') ||
      (active?.closest('openg7-admin-layout') &&
        active.id !== 'admin-main' &&
        !active.closest('[data-og7="pilotage"]'))
    );
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
