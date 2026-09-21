import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  afterNextRender,
  computed,
  inject,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type {
  PublicationAutomationCommand,
  PublicationAutomationState,
  PublicationDelivery,
  PublicationFeed,
  PublicationFeedId,
  PublicationFeedSettings
} from '@openg7/funding-core';

import { FundingAdminService } from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminConfirmationService } from '../../services/admin-confirmation.service.js';
import { AdminLayoutComponent } from '../../components/admin-layout/admin-layout.component.js';
import { AdminDrawerComponent } from '../../components/admin-ui/admin-drawer.component.js';
import { AdminPublicationCalendarComponent } from '../../components/admin-publications/admin-publication-calendar.component.js';
import type { PublicationCalendarEntry } from '../../components/admin-publications/publication-calendar.js';

@Component({
  selector: 'openg7-admin-publication-automation-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    TranslatePipe,
    AdminLayoutComponent,
    AdminDrawerComponent,
    AdminPublicationCalendarComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-publication-automation-page.component.html',
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    './admin-publication-automation-page.component.css'
  ]
})
export class AdminPublicationAutomationPageComponent {
  private readonly admin = inject(FundingAdminService);
  readonly i18n = inject(FundingI18nService);
  private readonly confirmation = inject(AdminConfirmationService);
  private readonly route = inject(ActivatedRoute);
  readonly state = signal<PublicationAutomationState | null>(null);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly tab = signal('review');
  readonly feedFilter = signal('');
  readonly selected = signal<PublicationDelivery | null>(null);
  readonly composing = signal(false);
  readonly settings = signal<PublicationFeedSettings | null>(null);
  readonly media = signal<
    { id: string; url: string; alt: string; company: string }[]
  >([]);
  readonly visible = computed(() =>
    (this.state()?.deliveries ?? [])
      .filter(
        (d) =>
          (!this.feedFilter() || d.feedId === this.feedFilter()) &&
          (this.tab() === 'review'
            ? d.status === 'draft'
            : this.tab() === 'scheduled'
              ? ['approved', 'publishing'].includes(d.status)
              : this.tab() === 'exceptions'
                ? ['blocked', 'uncertain'].includes(d.status)
                : ['published', 'cancelled'].includes(d.status))
      )
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
  );
  readonly tabs = ['review', 'scheduled', 'calendar', 'exceptions', 'history'];
  readonly calendarEntries = computed<PublicationCalendarEntry[]>(() => {
    this.i18n.trackTranslationState();
    return (this.state()?.deliveries ?? [])
      .filter((d) => !this.feedFilter() || d.feedId === this.feedFilter())
      .map((d) => ({
        id: d.id,
        channel: d.feedId.endsWith('facebook') ? 'facebook' : 'linkedin',
        status:
          d.status === 'published'
            ? 'published'
            : d.status === 'cancelled'
              ? 'cancelled'
              : ['approved', 'publishing'].includes(d.status)
                ? 'scheduled'
                : 'open',
        startsAt: d.scheduledAt,
        capacity: 1,
        capacityUsed: 1,
        target: d.feedId.split(':')[0].toUpperCase(),
        label: d.message.slice(0, 56),
        detail: this.i18n.t('admin.publicationAutomation.kinds.' + d.kind),
        statusLabel: this.i18n.t(
          'admin.publicationAutomation.status.' + d.status
        )
      }));
  });
  openCalendar(id: string): void {
    const job = this.state()?.deliveries.find((j) => j.id === id);
    if (job) this.open(job);
  }
  readonly kinds: PublicationDelivery['kind'][] = [
    'news',
    'achievement',
    'campaign'
  ];
  readonly weekdays = [1, 2, 3, 4, 5, 6, 0];
  edit = { message: '', scheduledAt: '', mediaId: '' };
  composeFeed: PublicationFeedId = 'openg7:facebook';
  composeKind: PublicationDelivery['kind'] = 'news';
  approved = false;
  externalPostId = '';
  absenceReason = '';
  absenceChecked = false;
  browserTimezone = '';
  dateLabel(value: string): string {
    const date = new Date(value);
    return Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
          dateStyle: 'medium',
          timeStyle: 'short'
        }).format(date)
      : '';
  }
  constructor() {
    const destroy = inject(DestroyRef);
    afterNextRender(() => {
      this.browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      void this.load().then(async () => {
        const batchId = this.route.snapshot.queryParamMap.get('batchId');
        const feedId = this.route.snapshot.queryParamMap.get(
          'feedId'
        ) as PublicationFeedId | null;
        if (
          batchId &&
          feedId &&
          this.state()?.feeds.some((f) => f.id === feedId)
        )
          await this.run(
            { action: 'compose', feedId, kind: 'sponsorship', batchId },
            true
          );
      });
      const timer = setInterval(() => {
        if (
          !this.busy() &&
          !this.selected() &&
          !this.composing() &&
          !this.settings()
        )
          void this.load();
      }, 30000);
      destroy.onDestroy(() => clearInterval(timer));
    });
  }
  async load(): Promise<void> {
    try {
      const state =
        (await this.admin.publicationAutomation()) as PublicationAutomationState;
      this.state.set(state);
      this.error.set('');
    } catch (error) {
      this.showError(error);
    }
  }
  private showError(error: unknown): void {
    const code = error instanceof Error ? error.message : '';
    const key = [
      'VERSION_CONFLICT',
      'SOURCE_CHANGED',
      'MEDIA_CHANGED',
      'SOURCE_NOT_ELIGIBLE',
      'CONNECTION_REQUIRED',
      'APPROVAL_UNAVAILABLE',
      'DESTINATION_CHANGED',
      'MEDIA_NOT_APPROVED',
      'LEGACY_DELIVERY_EXISTS',
      'INVALID_MESSAGE',
      'POST_MISMATCH',
      'MEDIA_RECONCILIATION_REQUIRED'
    ].includes(code)
      ? code
      : 'generic';
    this.error.set(`admin.publicationAutomation.errors.${key}`);
  }
  async run(
    command: PublicationAutomationCommand,
    open = false
  ): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      const result = (await this.admin.publicationAutomation(command)) as {
        id?: string;
      };
      const next =
        (await this.admin.publicationAutomation()) as PublicationAutomationState;
      this.state.set(next);
      this.notice.set('admin.publicationAutomation.saved');
      if (result.id && (open || this.selected()?.id === result.id)) {
        const job = next.deliveries.find((j) => j.id === result.id);
        if (job) this.open(job);
      }
      if (command.action === 'settings') this.settings.set(null);
    } catch (error) {
      this.showError(error);
    } finally {
      this.busy.set(false);
    }
  }
  private localDate(date: string): string {
    const value = new Date(date);
    return new Date(value.getTime() - value.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  }
  open(job: PublicationDelivery): void {
    this.absenceChecked = false;
    this.absenceReason = '';
    this.selected.set(job);
    this.composing.set(false);
    this.approved = false;
    this.externalPostId = '';
    this.edit = {
      message: job.message,
      scheduledAt: this.localDate(job.scheduledAt),
      mediaId: job.mediaId ?? ''
    };
    void this.loadMedia();
  }
  async loadMedia(): Promise<void> {
    try {
      this.media.set(await this.admin.publicationMedia());
    } catch (error) {
      this.showError(error);
    }
  }
  create(): void {
    this.selected.set(null);
    this.composing.set(true);
    this.approved = false;
    this.edit = {
      message: '',
      scheduledAt: this.localDate(
        new Date(Date.now() + 86400000).toISOString()
      ),
      mediaId: ''
    };
    void this.loadMedia();
  }
  close(): void {
    this.selected.set(null);
    this.composing.set(false);
    this.error.set('');
  }
  editable(): boolean {
    return (
      this.composing() ||
      ['draft', 'approved', 'blocked'].includes(this.selected()?.status ?? '')
    );
  }
  dirty(): boolean {
    const s = this.selected();
    return (
      !!s &&
      (this.edit.message !== s.message ||
        this.edit.scheduledAt !== this.localDate(s.scheduledAt) ||
        this.edit.mediaId !== (s.mediaId ?? ''))
    );
  }
  async save(): Promise<void> {
    const timestamp = new Date(this.edit.scheduledAt);
    if (!Number.isFinite(timestamp.getTime())) return;
    if (this.composing())
      await this.run(
        {
          action: 'compose',
          feedId: this.composeFeed,
          kind: this.composeKind,
          message: this.edit.message,
          scheduledAt: timestamp.toISOString(),
          mediaId: this.edit.mediaId || null
        },
        true
      );
    else {
      const s = this.selected();
      if (s)
        await this.run({
          action: 'edit',
          id: s.id,
          version: s.version,
          message: this.edit.message,
          scheduledAt: timestamp.toISOString(),
          mediaId: this.edit.mediaId || null
        });
    }
  }
  async approve(): Promise<void> {
    const s = this.selected();
    if (s && this.approved && !this.dirty())
      await this.run({
        action: 'approve',
        id: s.id,
        version: s.version,
        confirmation: s.id
      });
  }
  async cancel(): Promise<void> {
    const s = this.selected();
    if (
      s &&
      (await this.confirmation.confirm(
        this.i18n.t('admin.publicationAutomation.cancelConfirm'),
        s.feedId
      ))
    )
      await this.run({
        action: 'cancel',
        id: s.id,
        version: s.version,
        confirmation: s.id
      });
  }
  reconcile(): void {
    const s = this.selected();
    if (s)
      void this.run({
        action: 'reconcile',
        id: s.id,
        version: s.version,
        confirmation: s.id,
        externalPostId: this.externalPostId
      });
  }
  confirmAbsent(): void {
    const s = this.selected();
    if (s && this.absenceChecked && this.absenceReason.trim().length >= 20)
      void this.run({
        action: 'confirm-absent',
        id: s.id,
        version: s.version,
        confirmation: s.id,
        reason: this.absenceReason
      });
  }
  configure(feed: PublicationFeed): void {
    this.settings.set({ ...feed, weekdays: [...feed.weekdays] });
  }
  toggleDay(day: number): void {
    this.settings.update((s) =>
      s
        ? {
            ...s,
            weekdays: s.weekdays.includes(day)
              ? s.weekdays.filter((d) => d !== day)
              : [...s.weekdays, day]
          }
        : s
    );
  }
  pause(feed: PublicationFeed): void {
    void this.run({
      action: 'settings',
      settings: { ...feed, paused: !feed.paused }
    });
  }
  saveSettings(): void {
    const s = this.settings();
    if (s) void this.run({ action: 'settings', settings: s });
  }
  mediaPreview(): { url: string; alt: string } | undefined {
    return (
      this.media().find((m) => m.id === this.edit.mediaId) ??
      (this.selected()?.mediaUrl
        ? {
            url: this.selected()!.mediaUrl!,
            alt: this.selected()!.mediaAlt ?? ''
          }
        : undefined)
    );
  }
}
