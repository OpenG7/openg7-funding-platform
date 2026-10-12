/** Shared persistence ports; callers own their transaction and administrative authorization. */
export {
  capturePublicationObligations,
  assertPublicationObligations,
  releasePublicationObligations,
  lockCommitmentDeliveries,
  revokeCommitmentDeliveries
} from './sponsorship-fulfilment/obligations.js';
export {
  recordSocialFulfilment,
  recordWebsiteFulfilment,
  listSponsorshipFulfilmentEvidence
} from './sponsorship-fulfilment/evidence.js';
