export type {
  SponsorMediaStorageRecord,
  CreateSponsorMediaAssetInput,
  CreateSponsorMediaAssetResult,
  SponsorMediaMutationResult
} from './sponsor-media/persistence-contracts.js';

export { SponsorMediaPersistenceError } from './sponsor-media/persistence-error.js';

export {
  listSponsorMediaAssets,
  getSponsorMediaStorageRecord,
  checkSponsorMediaUpload,
  listPublicSponsorMediaByContributionIds,
  getApprovedPublicSponsorMedia
} from './sponsor-media/persistence-read.js';

export {
  createSponsorMediaAsset,
  deleteSponsorMediaAsset,
  reviewSponsorMediaAsset
} from './sponsor-media/persistence-write.js';
