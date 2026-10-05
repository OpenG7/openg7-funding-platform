export type SponsorMediaKind = 'logo' | 'supporting_image';

export type SponsorMediaReviewStatus =
  'pending_review' | 'approved' | 'rejected';

export type SponsorMediaUploader = 'sponsor' | 'admin';

export interface SponsorMediaAsset {
  readonly id: string;
  readonly contributionId: string;
  readonly kind: SponsorMediaKind;
  readonly reviewStatus: SponsorMediaReviewStatus;
  readonly uploadedBy: SponsorMediaUploader;
  readonly originalFilename: string;
  readonly originalMimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly originalSizeBytes: number;
  readonly processedMimeType: 'image/webp';
  readonly processedSizeBytes: number;
  readonly width: number;
  readonly height: number;
  readonly altText: string | null;
  readonly sortOrder: number;
  readonly publicUrl: string | null;
  readonly reviewedAt: string | null;
  readonly version: string;
  readonly createdAt: string;
}

export interface PublicSponsorMediaAsset {
  readonly id: string;
  readonly kind: SponsorMediaKind;
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly alt_text: string;
  readonly sort_order: number;
}

export interface SponsorMediaLimits {
  readonly maxUploadBytes: number;
  readonly maxSupportingImages: number;
  readonly acceptedMimeTypes: readonly (
    'image/jpeg' | 'image/png' | 'image/webp'
  )[];
}

export interface SponsorshipMediaResponse {
  readonly assets: readonly SponsorMediaAsset[];
  readonly limits: SponsorMediaLimits;
}

export interface SponsorMediaUploadResult {
  readonly uploaded: true;
  readonly asset: SponsorMediaAsset;
}

export interface SponsorMediaDeleteRequest {
  readonly token: string;
  readonly assetId: string;
  readonly expectedVersion: string;
  readonly confirmed: true;
}

export interface SponsorMediaDeleteResult {
  readonly deleted: true;
  readonly assetId: string;
}

export interface AdminSponsorMediaReviewRequest {
  readonly assetId: string;
  readonly expectedVersion: string;
  readonly reviewStatus: SponsorMediaReviewStatus;
  readonly altText?: string;
}

export interface AdminSponsorMediaReviewResult {
  readonly updated: true;
  readonly asset: SponsorMediaAsset;
}

export interface AdminSponsorMediaDeleteRequest {
  readonly assetId: string;
  readonly expectedVersion: string;
  readonly confirmation: string;
}

export interface AdminSponsorLogoUploadResult {
  readonly updated: boolean;
  readonly contributionId: string;
  readonly logoUrl: string;
  readonly mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly sizeBytes: number;
}

export interface AdminSponsorLogoDeleteRequest {
  readonly contributionId: string;
  readonly expectedVersion: string;
  readonly confirmation: string;
}

export interface AdminSponsorLogoDeleteResult {
  readonly updated: boolean;
  readonly contributionId: string;
  readonly deletedLogoUrl: string | null;
}
