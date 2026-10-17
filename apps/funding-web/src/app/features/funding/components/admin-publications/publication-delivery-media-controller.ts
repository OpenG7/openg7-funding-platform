import { signal, type Signal } from '@angular/core';
import type {
  PublicationDelivery,
  PublicationFeedId,
  PublicationPhotoSelection,
  SponsorshipPublicationFormat
} from '@openg7/funding-core';
import { publicationFormatCapability } from '@openg7/funding-core';

import { BlobPreviewResource } from '../../services/blob-preview-resource.js';
import type { FundingAdminService } from '../../services/funding-admin.service.js';

import type { PublicationAutomationMedia } from './publication-automation.ports.js';

interface PublicationDeliveryMediaEdit {
  mediaId: string;
  publicationFormat: SponsorshipPublicationFormat;
  photoSelections: readonly PublicationPhotoSelection[];
}

interface PublicationDeliveryMediaPorts {
  readonly admin: Pick<
    FundingAdminService,
    | 'publicationMedia'
    | 'publicationImagePreview'
    | 'getSponsorMediaPreview'
    | 'getSavedAdminToken'
  >;
  readonly selected: Signal<PublicationDelivery | null>;
  edit(): PublicationDeliveryMediaEdit;
  composeFeed(): PublicationFeedId;
  generation(): number;
  isDisposed(): boolean;
  selectionChanged(): void;
  showError(error: unknown): void;
}

/** Local media catalogue, photo selections and private previews for the delivery drawer. */
export class PublicationDeliveryMediaController {
  readonly media = signal<PublicationAutomationMedia[]>([]);
  private readonly previewResource = new BlobPreviewResource();
  readonly previewUrl = this.previewResource.url;
  readonly previewExact = signal(false);
  readonly collectionPreviews = signal<readonly { url: string; alt: string }[]>(
    []
  );
  private readonly collectionResources: BlobPreviewResource[] = [];
  readonly formats: readonly SponsorshipPublicationFormat[] = [
    'collective_text',
    'individual_portrait',
    'collective_composite',
    'image_collection'
  ];
  private readonly selected: PublicationDeliveryMediaPorts['selected'];
  private mediaGeneration = 0;
  private previewGeneration = 0;

  constructor(private readonly ports: PublicationDeliveryMediaPorts) {
    this.selected = ports.selected;
  }

  private get edit(): PublicationDeliveryMediaEdit {
    return this.ports.edit();
  }

  clear(): void {
    this.mediaGeneration++;
    this.media.set([]);
    this.clearPreview();
  }

  dispose(): void {
    this.mediaGeneration++;
    this.media.set([]);
    this.previewResource.dispose();
    this.clearCollectionPreviews();
  }

  clearPreview(): void {
    this.previewGeneration++;
    this.previewExact.set(false);
    this.previewResource.clear();
    this.clearCollectionPreviews();
  }

  private clearCollectionPreviews(): void {
    for (const resource of this.collectionResources) resource.dispose();
    this.collectionResources.length = 0;
    this.collectionPreviews.set([]);
  }

  mediaBlocked(job: PublicationDelivery): boolean {
    return (
      job.status === 'blocked' && (job.errorCode ?? '').startsWith('MEDIA_')
    );
  }

  async loadMedia(
    deliveryId: string | undefined = this.selected()?.id
  ): Promise<void> {
    if (this.ports.isDisposed()) return;
    const generation = this.ports.generation();
    const mediaGeneration = ++this.mediaGeneration;
    this.media.set([]);
    try {
      const media = await this.ports.admin.publicationMedia(deliveryId);
      if (
        !this.ports.isDisposed() &&
        generation === this.ports.generation() &&
        mediaGeneration === this.mediaGeneration
      )
        this.media.set(media);
    } catch (error) {
      if (
        !this.ports.isDisposed() &&
        generation === this.ports.generation() &&
        mediaGeneration === this.mediaGeneration
      )
        this.ports.showError(error);
    }
  }

  async loadPreview(id: string): Promise<void> {
    const generation = ++this.previewGeneration;
    this.previewExact.set(false);
    const selected = this.selected();
    if (selected?.publicationFormat === 'image_collection') {
      this.previewResource.clear();
      this.clearCollectionPreviews();
      const images = selected.mediaImages ?? [];
      if (id !== selected.mediaId || images.length < 2 || images.length > 10)
        return;
      const resources = images.map(() => new BlobPreviewResource());
      this.collectionResources.push(...resources);
      let failed = false;
      await Promise.all(
        resources.map((resource, index) =>
          resource.load(
            () =>
              this.ports.admin.publicationImagePreview(
                selected.id,
                selected.version,
                images[index]!.sha256,
                index
              ),
            (error) => {
              failed = true;
              if (
                this.previewGeneration === generation &&
                !this.ports.isDisposed()
              )
                this.ports.showError(error);
            }
          )
        )
      );
      if (
        this.previewGeneration !== generation ||
        this.ports.isDisposed() ||
        this.selected() !== selected
      )
        return;
      if (failed || resources.some((resource) => !resource.url())) {
        this.clearCollectionPreviews();
        return;
      }
      this.collectionPreviews.set(
        resources.map((resource, index) => ({
          url: resource.url(),
          alt: images[index]!.alt
        }))
      );
      this.previewExact.set(true);
      return;
    }
    this.clearCollectionPreviews();
    const exact =
      !!selected && id === selected.mediaId && !!selected.mediaDerivedHash;
    await this.previewResource.load(
      id
        ? async () => {
            const image = exact
              ? await this.ports.admin.publicationImagePreview(
                  selected.id,
                  selected.version,
                  selected.mediaDerivedHash!
                )
              : await this.ports.admin.getSponsorMediaPreview(
                  this.ports.admin.getSavedAdminToken(),
                  id
                );
            if (
              this.previewGeneration === generation &&
              !this.ports.isDisposed() &&
              this.selected() === selected &&
              (this.edit.mediaId === id ||
                this.derived(this.edit.publicationFormat))
            )
              this.previewExact.set(exact);
            return image;
          }
        : null,
      (error) => this.ports.showError(error)
    );
  }

  mediaPreview(): { url: string; alt: string } | undefined {
    return this.previewUrl()
      ? {
          url: this.previewUrl(),
          alt:
            this.media().find((media) => media.id === this.edit.mediaId)?.alt ??
            this.selected()?.mediaAlt ??
            ''
        }
      : undefined;
  }

  mediaSelectionValid(): boolean {
    if (this.derived(this.edit.publicationFormat)) {
      const sponsors = this.selected()?.sponsors ?? [];
      return (
        this.edit.mediaId === '' &&
        sponsors.length > 0 &&
        (this.edit.publicationFormat !== 'image_collection' ||
          (sponsors.length >= 2 && sponsors.length <= 10)) &&
        this.edit.photoSelections.length === sponsors.length &&
        (this.edit.publicationFormat !== 'individual_portrait' ||
          sponsors.length === 1) &&
        sponsors.every((sponsor) =>
          this.edit.photoSelections.some(
            (photo) =>
              photo.contributionId === sponsor.id &&
              (this.media().some(
                (media) =>
                  media.id === photo.assetId &&
                  media.contributionId === sponsor.id &&
                  media.version === photo.assetVersion
              ) ||
                this.selected()?.photoSelections?.some(
                  (current) =>
                    current.contributionId === photo.contributionId &&
                    current.assetId === photo.assetId &&
                    current.assetVersion === photo.assetVersion
                ))
          )
        )
      );
    }
    return (
      !this.edit.mediaId ||
      this.edit.mediaId === this.selected()?.mediaId ||
      this.media().some((media) => media.id === this.edit.mediaId)
    );
  }

  derived(format: SponsorshipPublicationFormat | undefined): boolean {
    return !!format && format !== 'collective_text';
  }

  formatAvailable(format: SponsorshipPublicationFormat): boolean {
    return (
      publicationFormatCapability(
        (this.selected()?.feedId ?? this.ports.composeFeed()).split(':')[1] ??
          '',
        format
      ).available &&
      (format !== 'individual_portrait' ||
        this.selected()?.sponsors.length === 1)
    );
  }

  changeFormat(value: string): void {
    const format = this.formats.find((item) => item === value);
    if (!format || !this.formatAvailable(format)) return;
    this.edit.publicationFormat = format;
    this.edit.mediaId = '';
    this.edit.photoSelections = [];
    this.ports.selectionChanged();
    this.clearPreview();
  }

  photoOptions(contributionId: string): PublicationAutomationMedia[] {
    return this.media().filter(
      (media) =>
        media.contributionId === contributionId &&
        media.kind === 'supporting_image' &&
        media.transformations?.includes(
          this.edit.publicationFormat === 'image_collection'
            ? 'technical'
            : this.edit.publicationFormat === 'individual_portrait'
              ? 'portrait'
              : 'composite'
        )
    );
  }

  photoSelection(contributionId: string): string {
    return (
      this.edit.photoSelections.find(
        (photo) => photo.contributionId === contributionId
      )?.assetId ?? ''
    );
  }

  selectPhoto(contributionId: string, assetId: string): void {
    const selected = this.photoOptions(contributionId).find(
      (item) => item.id === assetId
    );
    this.edit.photoSelections = [
      ...this.edit.photoSelections.filter(
        (photo) => photo.contributionId !== contributionId
      ),
      ...(selected?.version
        ? [
            {
              contributionId,
              assetId: selected.id,
              assetVersion: selected.version
            }
          ]
        : [])
    ].sort((a, b) => a.contributionId.localeCompare(b.contributionId));
    this.ports.selectionChanged();
    this.clearPreview();
  }
}
