import {
  computed,
  signal,
  type Signal,
  type WritableSignal
} from '@angular/core';
import type {
  PublicationAutomationCommand,
  PublicationAutomationState,
  PublicationFeed,
  PublicationFeedId,
  PublicationFeedSettings
} from '@openg7/funding-core';

import type { AdminConfirmationService } from '../../services/admin-confirmation.service.js';
import type { FundingI18nService } from '../../services/funding-i18n.service.js';

import type { PublicationAutomationCommandRunner } from './publication-automation.ports.js';

export interface PublicationAutomationSettingsPorts {
  readonly state: Signal<PublicationAutomationState | null>;
  readonly busy: Signal<boolean>;
  readonly canManageWorker: Signal<boolean>;
  readonly error: Signal<string>;
  readonly notice: WritableSignal<string>;
  readonly commands: PublicationAutomationCommandRunner;
  readonly i18n: Pick<FundingI18nService, 't' | 'currentLanguage'>;
  readonly confirmation: Pick<AdminConfirmationService, 'confirm'>;
  clearFeedback(): void;
}

/** Local configuration drafts and worker decisions; server reads remain page-owned. */
export class PublicationAutomationSettingsController {
  private disposed = false;
  readonly settings = signal<PublicationFeedSettings | null>(null);
  readonly workerChanging = signal(false);
  readonly weekdays = [1, 2, 3, 4, 5, 6, 0];
  readonly settingsFeed = computed(() =>
    this.ports.state()?.feeds.find((feed) => feed.id === this.settings()?.id)
  );
  readonly state: PublicationAutomationSettingsPorts['state'];
  readonly busy: PublicationAutomationSettingsPorts['busy'];
  readonly canManageWorker: PublicationAutomationSettingsPorts['canManageWorker'];
  readonly error: PublicationAutomationSettingsPorts['error'];
  readonly notice: PublicationAutomationSettingsPorts['notice'];

  constructor(private readonly ports: PublicationAutomationSettingsPorts) {
    this.state = ports.state;
    this.busy = ports.busy;
    this.canManageWorker = ports.canManageWorker;
    this.error = ports.error;
    this.notice = ports.notice;
  }

  configure(feed: PublicationFeed): void {
    if (this.busy()) return;
    this.ports.clearFeedback();
    this.settings.set({ ...feed, weekdays: [...feed.weekdays] });
  }

  closeSettings(): void {
    if (!this.busy()) this.settings.set(null);
  }

  settingsDirty(): boolean {
    const draft = this.settings();
    const saved = this.settingsFeed();
    return (
      !!draft &&
      !!saved &&
      (draft.paused !== saved.paused ||
        draft.autoPrepare !== saved.autoPrepare ||
        draft.localTime !== saved.localTime ||
        draft.timezone !== saved.timezone ||
        draft.capacity !== saved.capacity ||
        draft.horizonDays !== saved.horizonDays ||
        draft.weekdays.length !== saved.weekdays.length ||
        draft.weekdays.some((day) => !saved.weekdays.includes(day)))
    );
  }

  toggleDay(day: number): void {
    if (this.busy()) return;
    this.settings.update((draft) =>
      draft
        ? {
            ...draft,
            weekdays: draft.weekdays.includes(day)
              ? draft.weekdays.filter((candidate) => candidate !== day)
              : [...draft.weekdays, day]
          }
        : draft
    );
  }

  pause(feed: PublicationFeed): void {
    if (this.busy()) return;
    void this.ports.commands.run({
      action: 'settings',
      settings: { ...feed, weekdays: [...feed.weekdays], paused: !feed.paused }
    });
  }

  saveSettings(): void {
    const draft = this.settings();
    if (!draft || this.busy()) return;
    void this.ports.commands.run({
      action: 'settings',
      settings: { ...draft, weekdays: [...draft.weekdays] }
    });
  }

  check(feedId: PublicationFeedId): void {
    if (!this.busy()) void this.ports.commands.run({ action: 'check', feedId });
  }

  prepare(feedId: PublicationFeedId): void {
    if (!this.busy() && !this.settingsDirty())
      void this.ports.commands.run({ action: 'prepare', feedId });
  }

  /** Called only after the command and its authoritative server reread succeed. */
  acceptConfirmedSettings(command: PublicationAutomationCommand): void {
    if (
      command.action !== 'settings' ||
      this.settings()?.id !== command.settings.id
    )
      return;
    const confirmed = this.state()?.feeds.find(
      (feed) => feed.id === command.settings.id
    );
    if (confirmed)
      this.settings.set({ ...confirmed, weekdays: [...confirmed.weekdays] });
  }

  async toggleWorker(): Promise<void> {
    const state = this.state();
    if (
      this.disposed ||
      !state ||
      this.busy() ||
      this.workerChanging() ||
      !this.canManageWorker()
    )
      return;
    this.workerChanging.set(true);
    try {
      const enabled = !state.workerEnabled;
      if (
        enabled &&
        !(await this.ports.confirmation.confirm(
          this.ports.i18n.t('admin.publicationAutomation.workerConfirm'),
          this.ports.i18n.t('admin.publicationAutomation.workerTitle')
        ))
      )
        return;
      if (
        this.disposed ||
        this.state() !== state ||
        this.busy() ||
        !this.canManageWorker()
      )
        return;
      await this.ports.commands.run({
        action: 'worker',
        enabled,
        version: state.workerVersion,
        confirmation: enabled ? 'enable-worker' : 'disable-worker'
      });
    } finally {
      this.workerChanging.set(false);
    }
  }

  dispose(): void {
    this.disposed = true;
  }

  dateLabel(value: string): string {
    const date = new Date(value);
    return Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat(this.ports.i18n.currentLanguage(), {
          dateStyle: 'medium',
          timeStyle: 'short'
        }).format(date)
      : '';
  }
}
