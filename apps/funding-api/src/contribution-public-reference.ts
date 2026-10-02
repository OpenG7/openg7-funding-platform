const contributionPublicReferencePattern = /^OG7-\d{4}-[A-Z0-9]{4,8}$/;

export const normalizeContributionPublicReference = (
  value: string | null | undefined
): string | null => {
  if (!value) {
    return null;
  }

  const reference = value.trim().toUpperCase();
  return contributionPublicReferencePattern.test(reference) ? reference : null;
};
