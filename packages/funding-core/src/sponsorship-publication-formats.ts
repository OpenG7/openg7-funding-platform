export type SponsorshipPublicationFormat =
  | 'collective_text'
  | 'individual_portrait'
  | 'collective_composite'
  | 'image_collection';
export interface SponsorshipOfferFormatOptions {
  readonly facebook?: SponsorshipPublicationFormat;
  readonly linkedin?: SponsorshipPublicationFormat;
}
export interface SponsorshipPublicationFormatCapability {
  readonly available: boolean;
  readonly requiresImage: boolean;
  readonly requiresSingleSponsor: boolean;
  readonly multiImage: boolean;
}

/** Code capabilities; credentials, current authorization and provider readiness are separate guards. */
export const publicationFormatCapability = (
  channel: string,
  format: string
): SponsorshipPublicationFormatCapability => {
  const supportedChannel = ['facebook', 'linkedin'].includes(channel);
  const known = [
    'collective_text',
    'individual_portrait',
    'collective_composite',
    'image_collection'
  ].includes(format);
  return {
    available: supportedChannel && known && format !== 'image_collection',
    requiresImage: format !== 'collective_text',
    requiresSingleSponsor: format === 'individual_portrait',
    multiImage: format === 'image_collection'
  };
};

export const normalizeSponsorshipOfferFormats = (
  value: unknown
): SponsorshipOfferFormatOptions | undefined => {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid sponsorship formats.');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((k) => !['facebook', 'linkedin'].includes(k)))
    throw new Error('Invalid sponsorship formats.');
  const output: Record<string, SponsorshipPublicationFormat> = {};
  for (const channel of ['facebook', 'linkedin'] as const) {
    const format = input[channel];
    if (format === undefined) continue;
    if (
      typeof format !== 'string' ||
      ![
        'collective_text',
        'individual_portrait',
        'collective_composite',
        'image_collection'
      ].includes(format)
    )
      throw new Error('Invalid sponsorship formats.');
    output[channel] = format as SponsorshipPublicationFormat;
  }
  return Object.keys(output).length ? output : undefined;
};
