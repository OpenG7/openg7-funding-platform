import type {
  SponsorMediaAsset,
  SponsorMediaKind,
  SponsorMediaReviewStatus,
  SponsorMediaUploader
} from '@openg7/funding-core';

export interface SponsorMediaAssetRow {
  readonly id: string;
  readonly contribution_id: string;
  readonly kind: SponsorMediaKind;
  readonly review_status: SponsorMediaReviewStatus;
  readonly uploaded_by: SponsorMediaUploader;
  readonly original_filename: string;
  readonly original_mime_type: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly original_size_bytes: number;
  readonly original_storage_key: string;
  readonly processed_mime_type: 'image/webp';
  readonly processed_size_bytes: number;
  readonly processed_storage_key: string;
  readonly public_storage_key: string | null;
  readonly public_url: string | null;
  readonly checksum_sha256: string;
  readonly width: number;
  readonly height: number;
  readonly alt_text: string | null;
  readonly sort_order: number;
  readonly reviewed_at: string | null;
  readonly version: string;
  readonly created_at: string;
}

export interface SponsorMediaStorageRecord extends SponsorMediaAsset {
  readonly originalStorageKey: string;
  readonly processedStorageKey: string;
  readonly publicStorageKey: string | null;
  readonly checksumSha256: string;
}

export interface CreateSponsorMediaAssetInput {
  readonly id: string;
  readonly contributionId: string;
  readonly kind: SponsorMediaKind;
  readonly uploadedBy: SponsorMediaUploader;
  readonly auditActor: string;
  readonly storageDriver: string;
  readonly originalFilename: string;
  readonly originalMimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly originalSizeBytes: number;
  readonly originalStorageKey: string;
  readonly processedSizeBytes: number;
  readonly processedStorageKey: string;
  readonly checksumSha256: string;
  readonly width: number;
  readonly height: number;
  readonly altText: string | null;
  readonly maxSupportingImages: number;
}

export type CreateSponsorMediaAssetResult =
  | {
      readonly status: 'created';
      readonly asset: SponsorMediaAsset;
      readonly replaced: SponsorMediaStorageRecord | null;
    }
  | {
      readonly status:
        | 'contribution_not_found'
        | 'not_editable'
        | 'logo_locked'
        | 'supporting_image_limit_reached';
    };

export interface SponsorMediaMutationResult {
  readonly status:
    'updated' | 'not_found' | 'conflict' | 'approved_locked' | 'not_editable';
  readonly asset: SponsorMediaStorageRecord | null;
}
