export const sponsorProfile = (index = 0, overrides = {}) => ({
  public_id: `public-sponsor-${index}`,
  public_slug: null,
  company_name: `Atelier ${index + 1}`,
  website_url: 'https://example.com/company',
  logo_url: `/api/public/sponsor-logos/logo-${index}.webp`,
  media: [
    {
      id: `photo-${index}`,
      kind: 'supporting_image',
      url: `/api/public/sponsor-media/photo-${index}`,
      alt_text: 'Présentation de l’entreprise',
      width: 960,
      height: 1440,
      sort_order: 0
    }
  ],
  message: 'Une entreprise qui contribue au développement de services ouverts.',
  public_summary: null,
  amount: index === 0 ? null : 250,
  currency: 'CAD',
  paid_at: '2026-09-01T00:00:00Z',
  feed_target: 'openg7',
  feed_channels: ['facebook', 'linkedin'],
  feed_status: index === 1 ? 'published' : 'drafted',
  feed_public_url: 'https://example.com/partner-post',
  visibility_updated_at: null,
  ...overrides
});

export const sponsorsResponse = (profiles, page = 1, pageSize = 12) => ({
  data_source: 'database',
  sponsorships: profiles.slice((page - 1) * pageSize, page * pageSize),
  last_updated_at: '2026-09-19T12:00:00Z',
  pagination: {
    page,
    page_size: pageSize,
    total_count: profiles.length,
    published_count: profiles.filter(
      (p) => p.feed_status === 'published' && p.feed_public_url
    ).length
  }
});
