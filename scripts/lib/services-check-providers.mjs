export function checkStripeKey(context) {
  const { readValue, requiredPattern, record } = context;

  if (
    !requiredPattern(
      'Stripe',
      'STRIPE_SECRET_KEY',
      /^sk_(?:test|live)_/,
      'set a real Stripe secret key starting with sk_test_ or sk_live_'
    )
  ) {
    return;
  }

  const environment = readValue('FUNDING_PLATFORM_ENV') || 'development';
  const key = readValue('STRIPE_SECRET_KEY');
  if (environment === 'production' && key.startsWith('sk_test_')) {
    record(
      'warn',
      'Stripe',
      'STRIPE_SECRET_KEY',
      'test key detected while FUNDING_PLATFORM_ENV=production'
    );
  }

  if (environment !== 'production' && key.startsWith('sk_live_')) {
    record(
      'warn',
      'Stripe',
      'STRIPE_SECRET_KEY',
      'live key detected outside production; keep live operations explicit'
    );
  }
}

export function checkSmtp(context) {
  const {
    readValue,
    hasRealValue,
    isEmail,
    required,
    requiredSecret,
    requiredEmail,
    requiredPositiveInteger,
    record
  } = context;

  const smtpEnabled = readValue('SMTP_ENABLED').toLowerCase();
  if (smtpEnabled !== 'true') {
    record(
      'missing',
      'Mail',
      'SMTP_ENABLED',
      'set SMTP_ENABLED=true to send and verify real email'
    );
    return;
  }

  record('ok', 'Mail', 'SMTP_ENABLED', 'enabled');
  required('Mail', 'SMTP_HOST', 'set the SMTP host');
  requiredPositiveInteger('Mail', 'SMTP_PORT', 'set a valid SMTP port');

  const secure = readValue('SMTP_SECURE').toLowerCase();
  if (!['true', 'false'].includes(secure)) {
    record('missing', 'Mail', 'SMTP_SECURE', 'set SMTP_SECURE=true or false');
  } else {
    record('ok', 'Mail', 'SMTP_SECURE', 'configured');
  }

  requiredEmail('Mail', 'SMTP_USER', 'set the SMTP username email');
  requiredSecret('Mail', 'SMTP_PASSWORD', 'set the SMTP password', 8);
  requiredEmail('Mail', 'MAIL_FROM_ADDRESS', 'set the sender email address');

  if (hasRealValue('MAIL_REPLY_TO_ADDRESS')) {
    if (!isEmail(readValue('MAIL_REPLY_TO_ADDRESS'))) {
      record(
        'warn',
        'Mail',
        'MAIL_REPLY_TO_ADDRESS',
        'reply-to email is invalid'
      );
    } else {
      record('ok', 'Mail', 'MAIL_REPLY_TO_ADDRESS', 'configured');
    }
  }
}

export function checkAdminReviewReminder(context) {
  const {
    readValue,
    optionalNonNegativeInteger,
    optionalPositiveInteger,
    record
  } = context;

  const enabled = readValue('FUNDING_ADMIN_REVIEW_REMINDER_ENABLED')
    .trim()
    .toLowerCase();

  if (!enabled) {
    record(
      'warn',
      'Mail',
      'FUNDING_ADMIN_REVIEW_REMINDER_ENABLED',
      'not set; API defaults to true'
    );
  } else if (
    !['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'].includes(enabled)
  ) {
    record(
      'missing',
      'Mail',
      'FUNDING_ADMIN_REVIEW_REMINDER_ENABLED',
      'set a boolean value'
    );
  } else {
    record('ok', 'Mail', 'FUNDING_ADMIN_REVIEW_REMINDER_ENABLED', 'configured');
  }

  optionalNonNegativeInteger(
    'Mail',
    'FUNDING_ADMIN_REVIEW_REMINDER_MIN_AGE_DAYS',
    '1',
    'set a non-negative delay before the first reminder'
  );
  optionalPositiveInteger(
    'Mail',
    'FUNDING_ADMIN_REVIEW_REMINDER_POLL_INTERVAL_MS',
    '3600000',
    'set a positive reminder polling interval'
  );
  optionalPositiveInteger(
    'Mail',
    'FUNDING_ADMIN_REVIEW_REMINDER_MAX_ITEMS',
    '5',
    'set a positive reminder item display limit'
  );
}

export function checkSponsorMediaStorage(context) {
  const {
    readValue,
    required,
    requiredSecret,
    requiredHttpsUrl,
    optionalPositiveInteger,
    record
  } = context;

  optionalPositiveInteger(
    'Sponsor media',
    'FUNDING_SPONSOR_MEDIA_MAX_BYTES',
    '8388608',
    'set a sponsor media upload limit between 1 and 8388608 bytes',
    8388608
  );
  optionalPositiveInteger(
    'Sponsor media',
    'FUNDING_SPONSOR_MEDIA_MAX_SUPPORTING_IMAGES',
    '3',
    'set a positive supporting image limit'
  );

  if (
    !required(
      'Sponsor media',
      'SPONSOR_MEDIA_STORAGE_DRIVER',
      'set local or ovh-s3'
    )
  ) {
    return;
  }

  const driver = readValue('SPONSOR_MEDIA_STORAGE_DRIVER');
  if (driver === 'local') {
    required(
      'Sponsor media',
      'FUNDING_SPONSOR_LOGO_STORAGE_DIR',
      'set the local sponsor logo storage directory'
    );
    return;
  }

  if (driver !== 'ovh-s3') {
    record(
      'missing',
      'Sponsor media',
      'SPONSOR_MEDIA_STORAGE_DRIVER',
      'must be local or ovh-s3'
    );
    return;
  }

  required('Sponsor media', 'SPONSOR_MEDIA_REGION', 'set the OVH S3 region');
  requiredHttpsUrl(
    'Sponsor media',
    'SPONSOR_MEDIA_ENDPOINT',
    'set the OVH S3 https endpoint'
  );
  required(
    'Sponsor media',
    'SPONSOR_MEDIA_PUBLIC_BUCKET',
    'set the public sponsor media bucket'
  );
  requiredHttpsUrl(
    'Sponsor media',
    'SPONSOR_MEDIA_PUBLIC_BASE_URL',
    'set the public sponsor media base URL'
  );
  required(
    'Sponsor media',
    'SPONSOR_MEDIA_PRIVATE_BUCKET',
    'set the private sponsor media bucket'
  );
  requiredHttpsUrl(
    'Sponsor media',
    'SPONSOR_MEDIA_PRIVATE_BASE_URL',
    'set the private sponsor media base URL'
  );
  requiredSecret(
    'Sponsor media',
    'OVH_S3_ACCESS_KEY_ID',
    'set the OVH S3 access key id',
    8
  );
  requiredSecret(
    'Sponsor media',
    'OVH_S3_SECRET_ACCESS_KEY',
    'set the OVH S3 secret access key',
    16
  );
}

export function checkSocialPublication(context) {
  const {
    readValue,
    required,
    requiredSecret,
    requiredPattern,
    requiredHttpsUrl,
    record
  } = context;

  const mode = readValue('SOCIAL_PUBLICATION_MODE') || 'disabled';
  if (mode === 'disabled') {
    record(
      'warn',
      'Social publication',
      'SOCIAL_PUBLICATION_MODE',
      'disabled; set mock for local E2E or live for Facebook/LinkedIn publishing'
    );
    return;
  }

  if (mode === 'mock') {
    record(
      'ok',
      'Social publication',
      'SOCIAL_PUBLICATION_MODE',
      'mock provider enabled'
    );
    return;
  }

  if (mode !== 'live') {
    record(
      'missing',
      'Social publication',
      'SOCIAL_PUBLICATION_MODE',
      'must be disabled, mock, or live'
    );
    return;
  }

  record('ok', 'Social publication', 'SOCIAL_PUBLICATION_MODE', 'live');
  requiredHttpsUrl(
    'Social publication',
    'SOCIAL_PUBLICATION_FACEBOOK_GRAPH_BASE_URL',
    'set the Meta Graph API base URL'
  );
  required(
    'Social publication',
    'SOCIAL_PUBLICATION_FACEBOOK_PAGE_ID',
    'set the Facebook Page id'
  );
  requiredSecret(
    'Social publication',
    'SOCIAL_PUBLICATION_FACEBOOK_PAGE_ACCESS_TOKEN',
    'set the Facebook Page access token',
    16
  );
  requiredHttpsUrl(
    'Social publication',
    'SOCIAL_PUBLICATION_LINKEDIN_API_BASE_URL',
    'set the LinkedIn API base URL'
  );
  required(
    'Social publication',
    'SOCIAL_PUBLICATION_LINKEDIN_ORGANIZATION_ID',
    'set the LinkedIn organization id or urn'
  );
  requiredSecret(
    'Social publication',
    'SOCIAL_PUBLICATION_LINKEDIN_ACCESS_TOKEN',
    'set the LinkedIn access token',
    16
  );
  requiredPattern(
    'Social publication',
    'SOCIAL_PUBLICATION_LINKEDIN_VERSION',
    /^[0-9]{6}$/,
    'set a LinkedIn API version as YYYYMM'
  );
}
