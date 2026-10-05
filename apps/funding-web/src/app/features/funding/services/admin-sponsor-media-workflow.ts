import { signal } from '@angular/core';
import type {
  AdminSponsorshipRecord,
  SponsorMediaAsset
} from '@openg7/funding-core';

import type {
  AdminSponsorMediaDeleteEvent,
  AdminSponsorMediaReviewEvent
} from '../models/admin-sponsors-ui.models.js';
import type { AdminSponsorMediaPorts } from '../models/admin-sponsor-workflow.ports.js';

import { BlobPreviewResource } from './blob-preview-resource.js';

const sponsorLogoMaxBytes = 512 * 1024;
const sponsorLogoMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const controlledSponsorLogoUrlPrefixes = [
  '/api/public/sponsor-logos/',
  '/public/sponsor-logos/'
];

/** Local media workflows; the page retains selection, rights, shared locks and errors. */
export class AdminSponsorMediaWorkflow {
  readonly logoUploadMessages = signal<Record<string, string>>({});
  readonly logoPreviewUrls = signal<Record<string, string>>({});
  readonly sponsorMedia = signal<Record<string, readonly SponsorMediaAsset[]>>(
    {}
  );
  readonly sponsorMediaPreviewUrls = signal<Record<string, string>>({});
  readonly sponsorMediaMessages = signal<Record<string, string>>({});
  private readonly logoPreviews = new Map<string, BlobPreviewResource>();
  private readonly mediaPreviews = new Map<string, BlobPreviewResource>();
  private logoGeneration = 0;
  private mediaGeneration = 0;
  private mediaLoadGeneration = 0;
  private disposed = false;

  constructor(private readonly ports: AdminSponsorMediaPorts) {}

  async uploadLogo(
    sponsorship: AdminSponsorshipRecord,
    event: Event
  ): Promise<void> {
    if (!this.canActOn(sponsorship)) return;
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0] ?? null;

    if (!file) {
      return;
    }

    if (
      file.size > sponsorLogoMaxBytes ||
      !sponsorLogoMimeTypes.has(file.type)
    ) {
      this.setLogoUploadMessage(
        sponsorship.id,
        this.ports.t('admin.messages.logo_refuse_png_jpeg_ou_webp_max_512_kib')
      );
      if (input) {
        input.value = '';
      }
      return;
    }

    this.ports.setActionState(this.logoActionId(sponsorship.id));
    this.setLogoUploadMessage(
      sponsorship.id,
      this.ports.t('admin.messages.upload_en_cours')
    );

    try {
      const result = await this.ports.admin.uploadSponsorLogo(
        this.ports.adminToken(),
        sponsorship.id,
        sponsorship.version,
        file
      );
      this.setLogoUploadMessage(
        sponsorship.id,
        this.ports.t('admin.messages.logo_enregistre_p0_kib', {
          p0: Math.ceil(result.sizeBytes / 1024)
        })
      );
      await this.ports.reloadSponsorships();
    } catch (error) {
      this.setLogoUploadMessage(
        sponsorship.id,
        this.ports.messageFromError(
          error,
          this.ports.t('admin.messages.upload_du_logo_impossible')
        )
      );
    } finally {
      this.ports.setActionState(null);
      if (input) {
        input.value = '';
      }
    }
  }

  async deleteLogo(sponsorship: AdminSponsorshipRecord): Promise<void> {
    if (!this.canActOn(sponsorship)) return;
    if (
      !(await this.ports.confirm(
        this.ports.t('admin.messages.supprimer_ce_logo_commanditaire')
      ))
    ) {
      return;
    }

    if (!this.canActOn(sponsorship)) return;
    this.ports.setActionState(this.deleteLogoActionId(sponsorship.id));
    this.setLogoUploadMessage(
      sponsorship.id,
      this.ports.t('admin.messages.suppression_en_cours')
    );

    try {
      await this.ports.admin.deleteSponsorLogo(
        this.ports.adminToken(),
        sponsorship.id,
        sponsorship.version,
        sponsorship.id
      );
      this.setLogoUploadMessage(
        sponsorship.id,
        this.ports.t('admin.messages.logo_supprime')
      );
      await this.ports.reloadSponsorships();
    } catch (error) {
      this.setLogoUploadMessage(
        sponsorship.id,
        this.ports.messageFromError(
          error,
          this.ports.t('admin.messages.suppression_du_logo_impossible')
        )
      );
    } finally {
      this.ports.setActionState(null);
    }
  }

  async reviewSponsorMedia(
    sponsorship: AdminSponsorshipRecord,
    event: AdminSponsorMediaReviewEvent
  ): Promise<void> {
    if (!this.canActOn(sponsorship)) return;
    if (
      event.reviewStatus === 'rejected' &&
      !(await this.ports.confirm(
        this.ports.t('admin.messages.refuser_ce_media_commanditaire')
      ))
    ) {
      return;
    }
    if (!this.canActOn(sponsorship)) return;
    this.ports.setActionState(this.sponsorMediaActionId(event.assetId));
    this.setSponsorMediaMessage(
      sponsorship.id,
      this.ports.t('admin.messages.decision_en_cours')
    );
    try {
      await this.saveSponsorMediaReview(event);
      await this.loadSponsorMedia(sponsorship.id);
      this.setSponsorMediaMessage(
        sponsorship.id,
        event.reviewStatus === 'approved'
          ? this.ports.t(
              'admin.messages.media_approuve_il_sera_visible_seulement_lorsque_la_commandite_publique_est_admissible'
            )
          : this.ports.t(
              'admin.messages.media_refuse_le_fichier_public_a_ete_retire'
            )
      );
    } catch (error) {
      this.setSponsorMediaMessage(
        sponsorship.id,
        this.ports.messageFromError(
          error,
          this.ports.t(
            'admin.messages.la_decision_sur_ce_media_n_a_pas_pu_etre_enregistree'
          )
        )
      );
    } finally {
      this.ports.setActionState(null);
    }
  }

  async approveAllSponsorMedia(
    sponsorship: AdminSponsorshipRecord,
    reviews: readonly AdminSponsorMediaReviewEvent[]
  ): Promise<void> {
    if (!this.canActOn(sponsorship)) return;
    const media = (this.sponsorMedia()[sponsorship.id] ?? []).filter(
      (asset) => asset.reviewStatus !== 'approved'
    );
    if (media.length === 0) {
      this.setSponsorMediaMessage(
        sponsorship.id,
        this.ports.t('admin.messages.tous_les_medias_sont_deja_approuves')
      );
      return;
    }

    this.ports.setActionState(this.sponsorMediaBulkActionId(sponsorship.id));
    this.setSponsorMediaMessage(
      sponsorship.id,
      this.ports.t('admin.messages.approbation_de_p0_media_p1_en_cours', {
        p0: media.length,
        p1: media.length > 1 ? 's' : ''
      })
    );

    let approvedCount = 0;
    try {
      for (const asset of media) {
        const review = reviews.find(
          (item) =>
            item.assetId === asset.id && item.expectedVersion === asset.version
        );
        if (!review) continue;
        await this.saveSponsorMediaReview(review);
        approvedCount += 1;
      }
      await this.loadSponsorMedia(sponsorship.id);
      this.setSponsorMediaMessage(
        sponsorship.id,
        this.ports.t(
          'admin.messages.p0_media_p1_approuve_p2_la_visibilite_publique_reste_controlee_par_le_statut_de_la_commandite',
          {
            p0: approvedCount,
            p1: approvedCount > 1 ? 's' : '',
            p2: approvedCount > 1 ? 's' : ''
          }
        )
      );
    } catch (error) {
      await this.loadSponsorMedia(sponsorship.id);
      this.setSponsorMediaMessage(
        sponsorship.id,
        this.ports.messageFromError(
          error,
          this.ports.t(
            'admin.messages.p0_media_p1_approuve_p2_l_approbation_groupee_s_est_interrompue',
            {
              p0: approvedCount,
              p1: approvedCount > 1 ? 's' : '',
              p2: approvedCount > 1 ? 's' : ''
            }
          )
        )
      );
    } finally {
      this.ports.setActionState(null);
    }
  }

  private async saveSponsorMediaReview(
    event: AdminSponsorMediaReviewEvent
  ): Promise<void> {
    const altText = event.altText.trim();
    await this.ports.admin.reviewSponsorMedia(this.ports.adminToken(), {
      assetId: event.assetId,
      expectedVersion: event.expectedVersion,
      reviewStatus: event.reviewStatus,
      altText: altText || undefined
    });
  }

  async deleteSponsorMedia(
    sponsorship: AdminSponsorshipRecord,
    event: AdminSponsorMediaDeleteEvent
  ): Promise<void> {
    if (!this.canActOn(sponsorship)) return;
    if (
      !(await this.ports.confirm(
        this.ports.t(
          'admin.messages.supprimer_ce_media_y_compris_ses_copies_privee_et_publique'
        )
      ))
    ) {
      return;
    }
    if (!this.canActOn(sponsorship)) return;
    this.ports.setActionState(this.sponsorMediaActionId(event.assetId));
    this.setSponsorMediaMessage(
      sponsorship.id,
      this.ports.t('admin.messages.suppression_en_cours')
    );
    try {
      await this.ports.admin.deleteSponsorMedia(this.ports.adminToken(), {
        assetId: event.assetId,
        expectedVersion: event.expectedVersion,
        confirmation: event.assetId
      });
      await this.loadSponsorMedia(sponsorship.id);
      this.setSponsorMediaMessage(
        sponsorship.id,
        this.ports.t('admin.messages.media_supprime')
      );
    } catch (error) {
      this.setSponsorMediaMessage(
        sponsorship.id,
        this.ports.messageFromError(
          error,
          this.ports.t('admin.messages.le_media_n_a_pas_pu_etre_supprime')
        )
      );
    } finally {
      this.ports.setActionState(null);
    }
  }

  logoActionId(id: string): string {
    return `logo:${id}`;
  }

  deleteLogoActionId(id: string): string {
    return `logo-delete:${id}`;
  }

  sponsorMediaActionId(id: string): string {
    return `media:${id}`;
  }

  sponsorMediaBulkActionId(id: string): string {
    return `media:all:${id}`;
  }

  sponsorMediaStatusLabel(status: SponsorMediaAsset['reviewStatus']): string {
    if (status === 'approved') {
      return this.ports.t('admin.messages.approuve');
    }
    if (status === 'rejected') {
      return this.ports.t('admin.messages.refuse');
    }
    return this.ports.t('admin.legacy.en_attente');
  }

  formatMediaSize(bytes: number): string {
    return bytes >= 1024 * 1024
      ? `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
      : `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  }

  logoPreviewSourceFor(sponsorship: AdminSponsorshipRecord): string {
    if (!sponsorship.sponsor_logo_url) {
      return '';
    }

    if (this.isControlledLogoUrl(sponsorship.sponsor_logo_url)) {
      return this.logoPreviewUrls()[sponsorship.id] ?? '';
    }

    return sponsorship.sponsor_logo_url;
  }

  logoUploadMessageFor(id: string): string {
    return this.logoUploadMessages()[id] ?? '';
  }

  private setLogoUploadMessage(id: string, message: string): void {
    this.logoUploadMessages.update((messages) => ({
      ...messages,
      [id]: message
    }));
  }

  private setSponsorMediaMessage(id: string, message: string): void {
    this.sponsorMediaMessages.update((messages) => ({
      ...messages,
      [id]: message
    }));
  }

  async loadLogoPreviews(
    sponsorships: readonly AdminSponsorshipRecord[]
  ): Promise<void> {
    const generation = ++this.logoGeneration;
    this.clearPreviews(this.logoPreviews);
    this.logoPreviewUrls.set({});
    if (!this.canPreview()) return;
    await Promise.all(
      sponsorships
        .filter((sponsorship) =>
          this.isControlledLogoUrl(sponsorship.sponsor_logo_url)
        )
        .map(async (sponsorship) => {
          const resource = new BlobPreviewResource();
          this.logoPreviews.set(sponsorship.id, resource);
          await resource.load(
            () =>
              this.ports.admin.getSponsorLogoPreview(
                this.ports.adminToken(),
                sponsorship.id
              ),
            () => {}
          );
        })
    );
    if (!this.disposed && generation === this.logoGeneration) {
      this.logoPreviewUrls.set(this.previewUrls(this.logoPreviews));
    }
  }

  async loadSponsorMedia(contributionId: string | null): Promise<void> {
    const generation = ++this.mediaLoadGeneration;
    if (this.disposed) return;
    this.mediaGeneration++;
    this.clearPreviews(this.mediaPreviews);
    this.sponsorMediaPreviewUrls.set({});
    if (!contributionId) return;
    try {
      const response = await this.ports.admin.getSponsorMedia(
        this.ports.adminToken(),
        contributionId
      );
      if (this.disposed || generation !== this.mediaLoadGeneration) return;
      this.sponsorMedia.update((current) => ({
        ...current,
        [contributionId]: response.assets
      }));
      this.ports.mediaLoaded();
      await this.loadSponsorMediaPreviews(response.assets);
    } catch (error) {
      if (this.disposed || generation !== this.mediaLoadGeneration) return;
      this.setSponsorMediaMessage(
        contributionId,
        this.ports.messageFromError(
          error,
          this.ports.t(
            'admin.messages.les_medias_commanditaires_ne_peuvent_pas_etre_charges'
          )
        )
      );
    }
  }

  dispose(): void {
    this.disposed = true;
    this.logoGeneration++;
    this.mediaGeneration++;
    this.mediaLoadGeneration++;
    this.clearPreviews(this.logoPreviews);
    this.clearPreviews(this.mediaPreviews);
    this.logoPreviewUrls.set({});
    this.sponsorMediaPreviewUrls.set({});
  }

  private async loadSponsorMediaPreviews(
    assets: readonly SponsorMediaAsset[]
  ): Promise<void> {
    const generation = ++this.mediaGeneration;
    this.clearPreviews(this.mediaPreviews);
    this.sponsorMediaPreviewUrls.set({});
    if (!this.canPreview()) return;
    await Promise.all(
      assets.map(async (asset) => {
        const resource = new BlobPreviewResource();
        this.mediaPreviews.set(asset.id, resource);
        await resource.load(
          () =>
            this.ports.admin.getSponsorMediaPreview(
              this.ports.adminToken(),
              asset.id
            ),
          () => {}
        );
      })
    );
    if (!this.disposed && generation === this.mediaGeneration) {
      this.sponsorMediaPreviewUrls.set(this.previewUrls(this.mediaPreviews));
    }
  }

  private clearPreviews(resources: Map<string, BlobPreviewResource>): void {
    for (const resource of resources.values()) resource.dispose();
    resources.clear();
  }

  private previewUrls(
    resources: ReadonlyMap<string, BlobPreviewResource>
  ): Record<string, string> {
    return Object.fromEntries(
      [...resources]
        .filter(([, resource]) => resource.url())
        .map(([id, resource]) => [id, resource.url()])
    );
  }

  private canPreview(): boolean {
    return (
      !this.disposed &&
      this.ports.isBrowser() &&
      typeof URL !== 'undefined' &&
      typeof URL.createObjectURL === 'function' &&
      typeof URL.revokeObjectURL === 'function'
    );
  }

  private canActOn(sponsorship: AdminSponsorshipRecord): boolean {
    return (
      !this.disposed &&
      !this.ports.actionPending() &&
      this.ports.canActOn(sponsorship)
    );
  }

  private isControlledLogoUrl(logoUrl: string | null): boolean {
    return Boolean(
      logoUrl &&
      controlledSponsorLogoUrlPrefixes.some((prefix) =>
        logoUrl.startsWith(prefix)
      )
    );
  }
}
