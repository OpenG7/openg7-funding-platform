// Synthetic configuration only; no provider credentials or connections.
export const completeConfig = {
  APP_DOMAIN: 'funding.test',
  LETSENCRYPT_EMAIL: 'ops@funding.test',
  FUNDING_PLATFORM_ENV: 'test',
  FUNDING_PLATFORM_API_BASE_URL: 'https://funding.test/api',
  FUNDING_PUBLIC_BASE_URL: 'https://funding.test',
  FUNDING_ALLOWED_ORIGINS: 'https://funding.test',
  FUNDING_ADMIN_TOKEN: 'a'.repeat(40),
  FUNDING_ADMIN_SESSION_SECRET: 'b'.repeat(40),
  FUNDING_ADMIN_SESSION_TTL_MINUTES: '60',
  STRIPE_SECRET_KEY: `sk_test_${'c'.repeat(32)}`,
  STRIPE_WEBHOOK_SECRET: `whsec_${'d'.repeat(32)}`,
  SMTP_ENABLED: 'true',
  SMTP_HOST: 'smtp.funding.test',
  SMTP_PORT: '465',
  SMTP_SECURE: 'true',
  SMTP_USER: 'notify@funding.test',
  SMTP_PASSWORD: 'e'.repeat(32),
  MAIL_FROM_ADDRESS: 'notify@funding.test',
  MAIL_REPLY_TO_ADDRESS: 'contact@funding.test',
  FUNDING_ADMIN_NOTIFICATION_EMAIL: 'ops@funding.test',
  FUNDING_ADMIN_REVIEW_REMINDER_ENABLED: 'true',
  FUNDING_ADMIN_REVIEW_REMINDER_MIN_AGE_DAYS: '1',
  FUNDING_ADMIN_REVIEW_REMINDER_POLL_INTERVAL_MS: '3600000',
  FUNDING_ADMIN_REVIEW_REMINDER_MAX_ITEMS: '5',
  FUNDING_SPONSOR_MEDIA_MAX_BYTES: '8388608',
  FUNDING_SPONSOR_MEDIA_MAX_SUPPORTING_IMAGES: '3',
  DATABASE_URL: `postgres://synthetic:${'f'.repeat(32)}@postgres:5432/synthetic`,
  SPONSOR_MEDIA_STORAGE_DRIVER: 'ovh-s3',
  SPONSOR_MEDIA_REGION: 'bhs',
  SPONSOR_MEDIA_ENDPOINT: 'https://s3.funding.test',
  SPONSOR_MEDIA_PUBLIC_BUCKET: 'synthetic-public',
  SPONSOR_MEDIA_PUBLIC_BASE_URL: 'https://public.funding.test',
  SPONSOR_MEDIA_PRIVATE_BUCKET: 'synthetic-private',
  SPONSOR_MEDIA_PRIVATE_BASE_URL: 'https://private.funding.test',
  OVH_S3_ACCESS_KEY_ID: 'g'.repeat(24),
  OVH_S3_SECRET_ACCESS_KEY: 'h'.repeat(40),
  SOCIAL_PUBLICATION_MODE: 'live',
  SOCIAL_PUBLICATION_FACEBOOK_GRAPH_BASE_URL:
    'https://social.funding.test/v25.0',
  SOCIAL_PUBLICATION_FACEBOOK_PAGE_ID: '1234567890',
  SOCIAL_PUBLICATION_FACEBOOK_PAGE_ACCESS_TOKEN: 'i'.repeat(40),
  SOCIAL_PUBLICATION_LINKEDIN_API_BASE_URL: 'https://social.funding.test/rest',
  SOCIAL_PUBLICATION_LINKEDIN_ORGANIZATION_ID: '987654321',
  SOCIAL_PUBLICATION_LINKEDIN_ACCESS_TOKEN: 'j'.repeat(40),
  SOCIAL_PUBLICATION_LINKEDIN_VERSION: '202606'
};

export const oidcConfig = {
  FUNDING_ADMIN_AUTH_MODE: 'oidc',
  FUNDING_ADMIN_TOKEN: undefined,
  FUNDING_ADMIN_SESSION_SECRET: undefined,
  FUNDING_ADMIN_SESSION_TTL_MINUTES: undefined,
  FUNDING_ADMIN_OIDC_ISSUER: 'https://identity.funding.test/realm',
  FUNDING_ADMIN_OIDC_CLIENT_ID: 'synthetic-client',
  FUNDING_ADMIN_OIDC_CLIENT_SECRET: 'synthetic-oidc-secret',
  FUNDING_ADMIN_OIDC_OWNER_SUBJECTS: 'synthetic-owner-a, synthetic-owner-b'
};

export const alertsConfig = {
  FUNDING_OPERATIONS_WEBHOOK_URL:
    'https://alerts.funding.test/hooks/synthetic?key=private-canary',
  FUNDING_OPERATIONS_WEBHOOK_SECRET: 'k'.repeat(32)
};
