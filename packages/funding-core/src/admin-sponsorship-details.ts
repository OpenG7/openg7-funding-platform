export interface AdminSponsorshipDetails {
  readonly companyName: string;
  readonly publicName: string;
  readonly contactName: string;
  readonly contactEmail: string;
  readonly websiteUrl: string;
}

export type AdminSponsorshipCorrectionReason =
  'correction' | 'contact_update' | 'organization_update';

export interface AdminSponsorshipDetailsRequest extends AdminSponsorshipDetails {
  readonly contributionId: string;
  readonly expectedVersion: string;
  readonly requestId: string;
  readonly reason: AdminSponsorshipCorrectionReason;
  readonly confirmed: true;
}

export interface AdminSponsorshipDetailsResult {
  readonly updated: boolean;
  readonly version: string;
}

export const validateAdminSponsorshipDetails = (
  input: AdminSponsorshipDetails
): Partial<Record<keyof AdminSponsorshipDetails, 'required' | 'invalid'>> => {
  const errors: Partial<
    Record<keyof AdminSponsorshipDetails, 'required' | 'invalid'>
  > = {};
  for (const field of [
    'companyName',
    'publicName',
    'contactName',
    'contactEmail',
    'websiteUrl'
  ] as const) {
    const value = input[field];
    if (
      typeof value !== 'string' ||
      value.length >
        (field === 'websiteUrl' ? 2048 : field === 'publicName' ? 100 : 200) ||
      /[\x00-\x1f\x7f]/.test(value)
    ) {
      errors[field] = 'invalid';
    }
  }
  if (!errors.companyName && !input.companyName.trim())
    errors.companyName = 'required';
  if (
    !errors.contactEmail &&
    input.contactEmail.trim() &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.contactEmail.trim())
  )
    errors.contactEmail = 'invalid';
  if (!errors.websiteUrl && input.websiteUrl.trim()) {
    try {
      const url = new URL(input.websiteUrl.trim());
      if (
        !['https:', 'http:'].includes(url.protocol) ||
        url.username ||
        url.password
      )
        errors.websiteUrl = 'invalid';
    } catch {
      errors.websiteUrl = 'invalid';
    }
  }
  return errors;
};
