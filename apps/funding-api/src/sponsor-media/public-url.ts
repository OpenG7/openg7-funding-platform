/** Public media always pass through the API's current dossier eligibility checks. */
export const sponsorMediaPublicUrl = (assetId: string): string =>
  `/api/public/sponsor-media/${assetId}`;
