import { signal } from '@angular/core';
import {
  DEFAULT_SPONSORSHIP_PRICING_CONFIG,
  resolveSponsorshipBenefits
} from '@openg7/funding-core';
import type {
  AdminSponsorshipRecord,
  SponsorFeedChannel,
  SponsorshipBenefitId
} from '@openg7/funding-core';

import type {
  AdminSponsorPublicationPorts,
  SponsorshipPublicationChannel,
  SponsorshipPublicationDraft,
  SponsorshipPublicationTextField
} from '../models/admin-sponsor-workflow.ports.js';

import { AdminDashboardRequestError } from './funding-admin-session.js';

const benefitFeedChannelMap: Partial<
  Record<SponsorshipBenefitId, SponsorshipPublicationChannel>
> = {
  facebook_batch: 'facebook',
  linkedin_batch: 'linkedin'
};

/** Local publication forms; the page owns selection, permissions and the shared lock. */
export class AdminSponsorPublicationWorkflow {
  readonly publicationDrafts = signal<
    Record<string, SponsorshipPublicationDraft>
  >({});
  readonly publicationMessages = signal<Record<string, string>>({});
  readonly websiteMessages = signal<Record<string, string>>({});
  private disposed = false;

  constructor(private readonly ports: AdminSponsorPublicationPorts) {}

  reconcile(
    previous: readonly AdminSponsorshipRecord[],
    next: readonly AdminSponsorshipRecord[],
    preserveDrafts = false
  ): void {
    const beforeById = new Map(previous.map((item) => [item.id, item]));
    const publications = this.publicationDrafts();
    this.publicationDrafts.set(
      Object.fromEntries(
        next.map((item) => {
          const refreshed = this.toPublicationDraft(item);
          const before = beforeById.get(item.id);
          const draft = publications[item.id];
          if (!preserveDrafts || !before || !draft) return [item.id, refreshed];
          // Generated defaults are form values too: preserve only fields edited locally.
          const baseline = this.toPublicationDraft(before);
          const edits = Object.fromEntries(
            Object.entries(draft).filter(
              ([key, value]) =>
                value !== baseline[key as keyof SponsorshipPublicationDraft]
            )
          );
          return [item.id, { ...refreshed, ...edits }];
        })
      )
    );
  }

  async changeWebsiteVisibility(
    sponsorship: AdminSponsorshipRecord,
    visible: boolean
  ): Promise<void> {
    const progress = this.ports.progress();
    const site =
      progress?.contributionId === sponsorship.id ? progress.website : null;
    if (!site || !this.canActOn(sponsorship) || (visible && !site.canPublish))
      return;
    const revision = this.ports.selectionRevision();
    if (
      !(await this.ports.confirm(
        this.ports.t(
          'admin.dossier.publicationBridge.site.' +
            (visible ? 'confirmPublish' : 'confirmHide')
        ),
        sponsorship.sponsor_company_name ??
          sponsorship.public_reference ??
          sponsorship.id
      ))
    )
      return;
    const current = this.ports.progress();
    if (
      !this.isCurrent(sponsorship.id, revision) ||
      !this.canActOn(sponsorship) ||
      current?.contributionId !== sponsorship.id ||
      current.website?.version !== site.version ||
      (visible && !current.website.canPublish)
    )
      return;

    this.ports.setActionState('website:' + sponsorship.id);
    const pendingMessage = this.ports.t(
      'admin.dossier.publicationBridge.site.saving'
    );
    this.setWebsiteMessage(sponsorship.id, pendingMessage);
    try {
      await this.ports.admin.setSponsorshipWebsiteVisibility(
        this.ports.adminToken(),
        {
          contributionId: sponsorship.id,
          expectedVersion: site.version,
          visible,
          confirmed: true
        }
      );
      if (!this.isCurrent(sponsorship.id, revision)) return;
      await this.ports.reloadSponsorships();
      if (!this.isCurrent(sponsorship.id, revision)) return;
      this.setWebsiteMessage(
        sponsorship.id,
        this.ports.t('admin.dossier.publicationBridge.site.saved')
      );
    } catch (error) {
      if (!this.isCurrent(sponsorship.id, revision)) return;
      this.ports.messageFromError(error, '');
      this.setWebsiteMessage(
        sponsorship.id,
        this.ports.t(
          error instanceof AdminDashboardRequestError && error.status === 409
            ? 'admin.dossier.conflict'
            : 'admin.dossier.publicationBridge.site.failed'
        )
      );
    } finally {
      if (!this.isCurrent(sponsorship.id, revision)) {
        this.websiteMessages.update((messages) =>
          this.withoutPendingMessage(messages, sponsorship.id, pendingMessage)
        );
      }
      this.ports.setActionState(null);
    }
  }

  async savePublication(sponsorship: AdminSponsorshipRecord): Promise<void> {
    if (!this.canActOn(sponsorship)) return;
    const draft = this.publicationDraftFor(sponsorship.id);
    const slugError = this.slugErrorFor(sponsorship);
    if (!this.publicationDirtyFor(sponsorship) || slugError) {
      this.setPublicationMessage(
        sponsorship.id,
        slugError ||
          this.ports.t('admin.messages.aucune_modification_a_enregistrer')
      );
      return;
    }
    if (!this.canSavePublication(sponsorship)) {
      this.setPublicationMessage(
        sponsorship.id,
        this.ports.paymentEligibilityMessage(sponsorship) ||
          this.ports.t(
            'admin.messages.publication_bloquee_le_paiement_n_est_pas_admissible'
          )
      );
      return;
    }

    const revision = this.ports.selectionRevision();
    if (
      draft.feedStatus !== sponsorship.sponsor_feed_status &&
      (draft.feedStatus === 'published' ||
        sponsorship.sponsor_feed_status === 'published')
    ) {
      if (
        !(await this.ports.confirm(
          this.ports.t(
            draft.feedStatus === 'published'
              ? 'admin.confirmation.publish'
              : 'admin.confirmation.cancelPublication'
          ),
          sponsorship.public_reference ?? sponsorship.id
        ))
      )
        return;
    }
    if (
      !this.isCurrent(sponsorship.id, revision) ||
      !this.canActOn(sponsorship) ||
      !this.canSavePublication(sponsorship) ||
      Object.entries(draft).some(
        ([key, value]) =>
          value !==
          this.publicationDraftFor(sponsorship.id)[
            key as keyof SponsorshipPublicationDraft
          ]
      ) ||
      this.hasSlugError(sponsorship)
    )
      return;

    this.ports.setActionState(this.publicationActionId(sponsorship.id));
    const pendingMessage = this.ports.t(
      'admin.messages.enregistrement_en_cours'
    );
    this.setPublicationMessage(sponsorship.id, pendingMessage);
    try {
      await this.ports.admin.updateSponsorshipPublication(
        this.ports.adminToken(),
        {
          contributionId: sponsorship.id,
          expectedVersion: sponsorship.version,
          publicSlug: draft.publicSlug.trim() || undefined,
          publicSummary: draft.publicSummary.trim() || undefined,
          feedTarget: draft.feedTarget || null,
          feedChannels: [
            ...(draft.facebook ? ['facebook' as const] : []),
            ...(draft.linkedin ? ['linkedin' as const] : [])
          ],
          feedStatus: draft.feedStatus,
          feedPublicUrl: draft.feedPublicUrl.trim() || undefined,
          feedNotes: draft.feedNotes.trim() || undefined
        }
      );
      if (this.disposed) return;
      await this.ports.reloadSponsorships();
      if (!this.isCurrent(sponsorship.id, revision)) return;
      this.setPublicationMessage(
        sponsorship.id,
        this.ports.t('admin.messages.publication_enregistree_')
      );
    } catch (error) {
      if (this.disposed) return;
      const message = this.ports.messageFromError(
        error,
        this.ports.t(
          'admin.messages.les_donnees_de_publication_n_ont_pas_pu_etre_enregistrees'
        )
      );
      if (this.isCurrent(sponsorship.id, revision)) {
        this.setPublicationMessage(sponsorship.id, message);
      }
    } finally {
      if (!this.isCurrent(sponsorship.id, revision)) {
        this.publicationMessages.update((messages) =>
          this.withoutPendingMessage(messages, sponsorship.id, pendingMessage)
        );
      }
      this.ports.setActionState(null);
    }
  }

  setPublicationField(
    id: string,
    field: SponsorshipPublicationTextField,
    event: Event
  ): void {
    const value = this.valueFromEvent(event);
    this.publicationDrafts.update((drafts) => ({
      ...drafts,
      [id]: {
        ...(drafts[id] ?? this.emptyPublicationDraft()),
        [field]: field === 'publicSlug' ? this.normalizeSlug(value) : value
      }
    }));
  }

  setPublicationChannel(
    id: string,
    channel: SponsorshipPublicationChannel,
    event: Event
  ): void {
    const sponsorship = this.ports
      .sponsorships()
      .find((item) => item.id === id);
    const checked =
      (sponsorship && this.isPromisedFeedChannel(sponsorship, channel)) ||
      ((event.target as HTMLInputElement | null)?.checked ?? false);
    this.publicationDrafts.update((drafts) => ({
      ...drafts,
      [id]: {
        ...(drafts[id] ?? this.emptyPublicationDraft()),
        [channel]: checked
      }
    }));
  }

  publicationDraftFor(id: string): SponsorshipPublicationDraft {
    return this.publicationDrafts()[id] ?? this.emptyPublicationDraft();
  }

  promisedFeedChannelsFor(
    sponsorship: AdminSponsorshipRecord
  ): readonly SponsorshipPublicationChannel[] {
    const { achievedBenefits } = resolveSponsorshipBenefits(
      sponsorship.amount,
      DEFAULT_SPONSORSHIP_PRICING_CONFIG
    );
    return achievedBenefits
      .map((benefit) => benefitFeedChannelMap[benefit])
      .filter(
        (channel): channel is SponsorshipPublicationChannel =>
          channel === 'facebook' || channel === 'linkedin'
      );
  }

  isPromisedFeedChannel(
    sponsorship: AdminSponsorshipRecord,
    channel: SponsorshipPublicationChannel
  ): boolean {
    return this.promisedFeedChannelsFor(sponsorship).includes(channel);
  }

  canSavePublication(sponsorship: AdminSponsorshipRecord): boolean {
    return (
      sponsorship.payment_status === 'paid' &&
      sponsorship.sponsorship_refund_status !== 'processing'
    );
  }

  publicationActionId(id: string): string {
    return `publication:${id}`;
  }

  draftChannelsLabel(id: string): string {
    const draft = this.publicationDraftFor(id);
    const channels = [
      ...(draft.facebook ? [this.ports.t('admin.messages.facebook')] : []),
      ...(draft.linkedin ? ['LinkedIn'] : [])
    ];
    return channels.length > 0
      ? channels.join(' / ')
      : this.ports.t('admin.messages.aucun_canal');
  }

  publicationDirtyFor(sponsorship: AdminSponsorshipRecord): boolean {
    const draft = this.publicationDraftFor(sponsorship.id);
    const original = this.toPublicationDraft(sponsorship, false, false);
    return Object.entries(draft).some(
      ([key, value]) =>
        value !== original[key as keyof SponsorshipPublicationDraft]
    );
  }

  publicationStateLabel(sponsorship: AdminSponsorshipRecord): string {
    const message = this.publicationMessages()[sponsorship.id];
    if (message) return message;
    const paymentMessage = this.ports.paymentEligibilityMessage(sponsorship);
    if (paymentMessage) return paymentMessage;
    const slugError = this.slugErrorFor(sponsorship);
    if (slugError) return slugError;
    return this.publicationDirtyFor(sponsorship)
      ? this.ports.t('admin.messages.modifications_non_enregistrees')
      : this.ports.t('admin.messages.publication_enregistree');
  }

  slugErrorFor(sponsorship: AdminSponsorshipRecord): string {
    const slug = this.publicationDraftFor(sponsorship.id).publicSlug.trim();
    if (!slug) return '';
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return this.ports.t(
        'admin.messages.utilisez_seulement_des_lettres_chiffres_et_tirets'
      );
    }
    const duplicate = this.ports
      .sponsorships()
      .some(
        (item) =>
          item.id !== sponsorship.id &&
          this.normalizeSlug(item.sponsor_public_slug ?? '') === slug
      );
    return duplicate
      ? this.ports.t('admin.messages.ce_slug_est_deja_utilise')
      : '';
  }

  hasSlugError(sponsorship: AdminSponsorshipRecord): boolean {
    return Boolean(this.slugErrorFor(sponsorship));
  }

  dispose(): void {
    this.disposed = true;
  }

  private canActOn(sponsorship: AdminSponsorshipRecord): boolean {
    return !this.disposed && this.ports.canActOn(sponsorship);
  }

  private isCurrent(id: string, revision: number): boolean {
    return (
      !this.disposed &&
      revision === this.ports.selectionRevision() &&
      this.ports.isCurrentSelection(id)
    );
  }

  private toPublicationDraft(
    sponsorship: AdminSponsorshipRecord,
    useGeneratedSlug = true,
    includePromisedChannels = true
  ): SponsorshipPublicationDraft {
    const defaultSlug = this.normalizeSlug(
      useGeneratedSlug
        ? sponsorship.sponsor_public_slug ||
            sponsorship.public_name ||
            sponsorship.sponsor_company_name ||
            sponsorship.public_reference ||
            ''
        : sponsorship.sponsor_public_slug || ''
    );
    const feedChannels = new Set<SponsorFeedChannel>([
      ...sponsorship.sponsor_feed_channels,
      ...(includePromisedChannels
        ? this.promisedFeedChannelsFor(sponsorship)
        : [])
    ]);
    return {
      publicSlug: defaultSlug,
      publicSummary: sponsorship.sponsor_public_summary ?? '',
      feedTarget: sponsorship.sponsor_feed_target ?? '',
      facebook: feedChannels.has('facebook'),
      linkedin: feedChannels.has('linkedin'),
      feedStatus: sponsorship.sponsor_feed_status,
      feedPublicUrl: sponsorship.sponsor_feed_public_url ?? '',
      feedNotes: sponsorship.sponsor_feed_notes ?? ''
    };
  }

  private emptyPublicationDraft(): SponsorshipPublicationDraft {
    return {
      publicSlug: '',
      publicSummary: '',
      feedTarget: '',
      facebook: false,
      linkedin: false,
      feedStatus: 'not_planned',
      feedPublicUrl: '',
      feedNotes: ''
    };
  }

  private setPublicationMessage(id: string, message: string): void {
    this.publicationMessages.update((messages) => ({
      ...messages,
      [id]: message
    }));
  }

  private setWebsiteMessage(id: string, message: string): void {
    this.websiteMessages.update((messages) => ({ ...messages, [id]: message }));
  }

  private withoutPendingMessage(
    messages: Record<string, string>,
    id: string,
    pendingMessage: string
  ): Record<string, string> {
    if (messages[id] !== pendingMessage) return messages;
    const next = { ...messages };
    delete next[id];
    return next;
  }

  private normalizeSlug(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-');
  }

  private valueFromEvent(event: Event): string {
    return (
      (
        event.target as
          HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null
      )?.value ?? ''
    );
  }
}
