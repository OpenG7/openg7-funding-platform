import type { SponsorMediaAsset } from '@openg7/funding-core';

import { isEditableSponsorship } from '../sponsorship-review-policy.js';

import type {
  SponsorMediaAssetRow,
  SponsorMediaStorageRecord
} from './persistence-contracts.js';
import { sponsorMediaPublicUrl } from './public-url.js';

export const mapAsset = (row: SponsorMediaAssetRow): SponsorMediaAsset => ({
  id: row.id,
  contributionId: row.contribution_id,
  kind: row.kind,
  reviewStatus: row.review_status,
  uploadedBy: row.uploaded_by,
  originalFilename: row.original_filename,
  originalMimeType: row.original_mime_type,
  originalSizeBytes: row.original_size_bytes,
  processedMimeType: row.processed_mime_type,
  processedSizeBytes: row.processed_size_bytes,
  width: row.width,
  height: row.height,
  altText: row.alt_text,
  sortOrder: row.sort_order,
  publicUrl: row.public_url === null ? null : sponsorMediaPublicUrl(row.id),
  reviewedAt: row.reviewed_at,
  version: row.version,
  createdAt: row.created_at
});

export const mapStorageRecord = (
  row: SponsorMediaAssetRow
): SponsorMediaStorageRecord => ({
  ...mapAsset(row),
  originalStorageKey: row.original_storage_key,
  processedStorageKey: row.processed_storage_key,
  publicStorageKey: row.public_storage_key,
  checksumSha256: row.checksum_sha256
});

export const editableContribution = (row: {
  status: string;
  sponsor_review_status: string | null;
}): boolean =>
  isEditableSponsorship({
    paymentStatus: row.status,
    reviewStatus: row.sponsor_review_status
  });
