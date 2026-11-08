import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type {
  AdminSponsorshipProgress,
  PublicationWorkshopState,
  WorkshopProposal
} from '@openg7/funding-core';

import en from '../../../../../assets/i18n/admin-publication-workshop.en.json' with { type: 'json' };
import fr from '../../../../../assets/i18n/admin-publication-workshop.fr-CA.json' with { type: 'json' };
import { FundingAdminService } from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminConfirmationService } from '../../services/admin-confirmation.service.js';
import { AdminIconComponent } from '../admin-ui/admin-icon.component.js';

/** Dossier organism: private proposals and adoption into Funding's existing drafts. */
@Component({
  selector: 'openg7-admin-publication-workshop',
  standalone: true,
  imports: [RouterLink, AdminIconComponent],
  templateUrl: './admin-publication-workshop.component.html',
  styleUrls: [
    '../admin-ui/admin-controls.css',
    './admin-publication-workshop.component.css'
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AdminPublicationWorkshopComponent {
  readonly dossier = input.required<AdminSponsorshipProgress>();
  readonly changed = output<void>();
  readonly admin = inject(FundingAdminService);
  private readonly i18n = inject(FundingI18nService);
  private readonly confirmation = inject(AdminConfirmationService);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly document = inject(DOCUMENT);
  readonly data = signal<PublicationWorkshopState | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly previewOpen = signal(false);
  readonly selectedProposalId = signal<string | null>(null);
  readonly proposal = computed(() => {
    const state = this.data(),
      id = this.selectedProposalId();
    return id
      ? (state?.history.find((proposal) => proposal.id === id) ?? null)
      : (state?.proposal ?? null);
  });
  readonly readOnly = computed(() => this.admin.identity()?.role === 'reader');
  readonly sourcePresentation = computed(
    () =>
      this.proposal()?.editorialPreparation.common.sourceFacts.find(
        (fact) => fact.key === 'publicPresentation'
      )?.value ?? ''
  );
  readonly active = computed(() => {
    const proposal = this.proposal();
    return (
      !!proposal &&
      !proposal.obsolete &&
      proposal.id === this.data()?.proposal?.id &&
      proposal.sourceVersion === this.data()?.sourceVersion
    );
  });
  readonly running = computed(() => {
    const mission = this.data()?.mission;
    return (
      !!mission &&
      (['queued', 'sending', 'uncertain'].includes(mission.delivery) ||
        [
          'pending',
          'queued',
          'planning',
          'ready',
          'running',
          'processing',
          'received',
          'waiting_dependency'
        ].includes(mission.status))
    );
  });
  readonly canPrepare = computed(
    () =>
      this.data()?.canPrepare === true &&
      this.admin.hasValidAdminSession() &&
      !this.readOnly() &&
      !this.busy() &&
      !this.loading() &&
      !this.running()
  );
  readonly canAdopt = computed(
    () =>
      this.data()?.canAdopt === true &&
      this.admin.hasValidAdminSession() &&
      this.active() &&
      !this.proposal()?.adoptedAt &&
      !this.readOnly() &&
      !this.busy() &&
      !this.loading()
  );
  private identity = '';
  private contributionId = '';
  private refreshKey = '';
  private serial = 0;
  private generation = 0;
  private disposed = false;
  private cancellation: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pollStarted = 0;
  private command: { signature: string; requestId: string } | null = null;

  constructor() {
    effect(() => {
      const language = this.i18n.currentLanguage();
      untracked(() =>
        this.i18n.mergeTranslations(language, {
          admin: { publicationWorkshop: language === 'en' ? en : fr }
        })
      );
    });
    effect(() => {
      const dossier = this.dossier(),
        identity = this.identityKey();
      const refreshKey = dossier.version + ':' + this.admin.dataRevision();
      untracked(() => {
        if (
          dossier.contributionId !== this.contributionId ||
          identity !== this.identity
        ) {
          ++this.generation;
          ++this.serial;
          this.cancellation?.abort();
          clearTimeout(this.timer);
          this.contributionId = dossier.contributionId;
          this.identity = identity;
          this.data.set(null);
          this.loading.set(false);
          this.busy.set(false);
          this.error.set('');
          this.notice.set('');
          this.selectedProposalId.set(null);
          this.previewOpen.set(false);
          this.command = null;
          this.pollStarted = 0;
          this.refreshKey = '';
        }
        if (this.browser && refreshKey !== this.refreshKey) {
          this.refreshKey = refreshKey;
          void this.load();
        }
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.disposed = true;
      ++this.generation;
      ++this.serial;
      this.cancellation?.abort();
      clearTimeout(this.timer);
      this.data.set(null);
    });
  }

  t(key: string, params?: Record<string, unknown>): string {
    return this.i18n.t('admin.publicationWorkshop.' + key, params);
  }

  date(value: string): string {
    const parsed = new Date(value);
    return Number.isFinite(parsed.valueOf())
      ? new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
          dateStyle: 'medium',
          timeStyle: 'short'
        }).format(parsed)
      : '—';
  }

  selectProposal(proposal: WorkshopProposal): void {
    this.selectedProposalId.set(
      proposal.id === this.data()?.proposal?.id ? null : proposal.id
    );
    this.previewOpen.set(true);
  }

  missingLabel(code: string): string {
    const translated = this.t('missing.' + code);
    return translated === 'admin.publicationWorkshop.missing.' + code
      ? this.t('missing.other', { code })
      : translated;
  }

  targetLabel(obligationId: string): string {
    const target = this.dossier().commitment?.obligations.find(
      (obligation) => obligation.id === obligationId
    )?.target;
    return target === 'openg7'
      ? 'OpenG7'
      : target === 'openg20'
        ? 'OpenG20'
        : this.t('unknownTarget');
  }

  missionLabel(): string {
    const mission = this.data()?.mission;
    if (!mission) return this.t('mission.none');
    if (
      mission.errorCode ||
      mission.delivery === 'failed' ||
      mission.status === 'failed'
    )
      return this.t('mission.failed');
    if (mission.delivery === 'uncertain') return this.t('mission.uncertain');
    if (this.running()) return this.t('mission.processing');
    return this.data()?.proposal
      ? this.t('mission.prepared')
      : this.t('mission.waiting');
  }

  async load(preserveError = false): Promise<void> {
    if (
      !this.current(this.generation) ||
      !this.browser ||
      !this.admin.hasValidAdminSession()
    )
      return;
    clearTimeout(this.timer);
    this.cancellation?.abort();
    const cancellation = new AbortController();
    this.cancellation = cancellation;
    const generation = this.generation,
      serial = ++this.serial;
    this.loading.set(true);
    if (!preserveError) this.error.set('');
    try {
      const result = await this.admin.publicationWorkshop.read(
        this.contributionId,
        AbortSignal.any([cancellation.signal, AbortSignal.timeout(15000)])
      );
      if (!this.current(generation) || serial !== this.serial) return;
      this.data.set(result);
    } catch (error) {
      if (
        !this.current(generation) ||
        serial !== this.serial ||
        cancellation.signal.aborted
      )
        return;
      this.failure(error, false);
    } finally {
      if (this.current(generation) && serial === this.serial) {
        this.loading.set(false);
        this.schedule();
      }
    }
  }

  async prepare(): Promise<void> {
    const state = this.data();
    if (!state || !this.canPrepare()) return;
    await this.mutate('prepare', {
      contributionId: state.contributionId,
      expectedSourceVersion: state.sourceVersion
    });
  }

  async adopt(): Promise<void> {
    const proposal = this.proposal(),
      state = this.data(),
      generation = this.generation;
    if (!proposal || !state || !this.canAdopt()) return;
    const confirmed = await this.confirmation.confirm(
      this.t('adoptConfirm'),
      this.dossier().reference
    );
    if (
      !confirmed ||
      !this.current(generation) ||
      this.proposal() !== proposal ||
      !this.canAdopt()
    )
      return;
    await this.mutate('adopt', {
      contributionId: state.contributionId,
      proposalId: proposal.id,
      expectedSourceVersion: proposal.sourceVersion
    });
  }

  private async mutate(
    action: 'prepare' | 'adopt',
    payload: {
      contributionId: string;
      expectedSourceVersion: number | null;
      proposalId?: string;
    }
  ): Promise<void> {
    const generation = this.generation,
      refreshKey = this.refreshKey,
      signature = action + JSON.stringify(payload);
    if (this.command?.signature !== signature)
      this.command = { signature, requestId: crypto.randomUUID() };
    const requestId = this.command.requestId;
    clearTimeout(this.timer);
    ++this.serial;
    this.cancellation?.abort();
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      const result =
        action === 'prepare'
          ? await this.admin.publicationWorkshop.prepare({
              contributionId: payload.contributionId,
              expectedSourceVersion: payload.expectedSourceVersion,
              requestId
            })
          : await this.admin.publicationWorkshop.adopt({
              contributionId: payload.contributionId,
              expectedSourceVersion: payload.expectedSourceVersion!,
              proposalId: payload.proposalId!,
              requestId
            });
      if (!this.current(generation)) return;
      this.command = null;
      if (this.refreshKey === refreshKey) this.data.set(result);
      else await this.load();
      if (!this.current(generation)) return;
      this.selectedProposalId.set(null);
      this.notice.set(
        action === 'prepare' ? 'preparationRequested' : 'adopted'
      );
      this.pollStarted = 0;
      if (action === 'adopt') this.changed.emit();
    } catch (error) {
      if (!this.current(generation)) return;
      this.failure(error, true);
      if (this.admin.hasValidAdminSession()) await this.load(true);
    } finally {
      if (this.current(generation)) {
        this.busy.set(false);
        this.schedule();
      }
    }
  }

  private failure(error: unknown, mutation: boolean): void {
    const status = (error as { status?: number }).status;
    this.error.set(
      status === 401 || status === 403
        ? 'forbidden'
        : status === 409
          ? 'conflict'
          : mutation
            ? 'uncertain'
            : 'unavailable'
    );
    if (status === 401 || status === 403) {
      this.data.set(null);
      this.command = null;
      if (status === 401) this.admin.clearAdminSession();
    }
  }

  private schedule(): void {
    clearTimeout(this.timer);
    if (!this.current(this.generation) || !this.running() || this.busy())
      return;
    this.pollStarted ||= Date.now();
    if (Date.now() - this.pollStarted > 120000) return;
    this.timer = setTimeout(() => {
      if (this.document.visibilityState !== 'hidden')
        void this.load(!!this.error());
      else this.schedule();
    }, 2500);
  }

  private identityKey(): string {
    const identity = this.admin.identity();
    return `${this.admin.sessionGeneration()}:${identity?.id ?? 'token'}:${identity?.sessionId ?? 'token'}:${identity?.role ?? 'token'}`;
  }

  private current(generation: number): boolean {
    return (
      !this.disposed &&
      generation === this.generation &&
      this.identity === this.identityKey() &&
      this.admin.hasValidAdminSession()
    );
  }
}
