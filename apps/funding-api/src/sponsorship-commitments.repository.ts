/** Public persistence/event ports. The caller owns its transaction and authorization. */
export {
  activateSponsorshipCommitments,
  loadSponsorshipCommitment,
  loadSponsorshipOfferForSession
} from './sponsorship-commitments/repository.js';
export { enqueueSponsorshipObligationNotification } from './sponsorship-commitments/notifications.js';
export type { SponsorshipObligationNotificationInput } from './sponsorship-commitments/notifications.js';
export { sponsorshipCommitmentProjectionSql } from './sponsorship-commitments/projection.js';
