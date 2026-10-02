import type { SponsorshipAttentionRecord } from '../fund-contributions.repository.js';

/** Loaded-dataset lookup; the first matching record retains priority. */
export const findSponsorshipByReference = (
  sponsorships: readonly SponsorshipAttentionRecord[],
  reference: string
): SponsorshipAttentionRecord | undefined => {
  const needle = reference.replace(/^#/, '').toLowerCase();
  return sponsorships.find(
    (candidate) =>
      candidate.publicReference?.toLowerCase() === reference.toLowerCase() ||
      candidate.contributionId.toLowerCase() === needle ||
      candidate.contributionId.toLowerCase().startsWith(needle)
  );
};
