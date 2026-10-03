import { createServicesCheckContext } from './services-check-context.mjs';
import {
  checkAdminIdentity,
  checkOperationsAlerts
} from './services-check-identity.mjs';
import {
  checkStripeKey,
  checkSmtp,
  checkAdminReviewReminder,
  checkSponsorMediaStorage,
  checkSocialPublication
} from './services-check-providers.mjs';

// No file, process, network or provider access: callers supply observed tool statuses.
export function evaluateServicesReadiness(
  env,
  { envFile, envFileExists, nodeVersion, toolStatuses }
) {
  const context = createServicesCheckContext(env);
  const {
    checks,
    record,
    required,
    requiredEmail,
    requiredHttpsUrl,
    hasRealValue,
    readValue,
    safeUrl,
    requiredPattern
  } = context;

  record(
    envFileExists ? 'ok' : 'warn',
    'Configuration',
    envFile,
    envFileExists
      ? 'env file found'
      : 'env file not found; using shell environment only'
  );

  if (!nodeVersion.startsWith('22.')) {
    record(
      'warn',
      'Configuration',
      'Node.js',
      'repository expects Node.js 22.x'
    );
  } else {
    record('ok', 'Configuration', 'Node.js', 'Node.js 22.x detected');
  }

  recordToolStatus('docker', 'Configuration', 'Docker CLI');
  recordToolStatus('stripe', 'Stripe', 'Stripe CLI');

  required('HTTPS', 'APP_DOMAIN', 'set the public application domain');
  requiredEmail(
    'HTTPS',
    'LETSENCRYPT_EMAIL',
    'set a real email for certificate renewal notices'
  );
  requiredHttpsUrl(
    'HTTPS',
    'FUNDING_PUBLIC_BASE_URL',
    'set the public base URL with https'
  );
  requiredHttpsUrl(
    'HTTPS',
    'FUNDING_PLATFORM_API_BASE_URL',
    'set the API base URL with https and /api'
  );
  if (hasRealValue('FUNDING_PLATFORM_API_BASE_URL')) {
    const apiUrl = readValue('FUNDING_PLATFORM_API_BASE_URL');
    if (!safeUrl(apiUrl)?.pathname.includes('/api')) {
      record(
        'warn',
        'HTTPS',
        'FUNDING_PLATFORM_API_BASE_URL',
        'URL should include /api'
      );
    }
  }
  checkAllowedOrigins(context);

  checkAdminIdentity(context, env);

  checkStripeKey(context);
  requiredPattern(
    'Stripe',
    'STRIPE_WEBHOOK_SECRET',
    /^whsec_/,
    'set a real webhook signing secret starting with whsec_'
  );

  checkSmtp(context);
  requiredEmail(
    'Mail',
    'FUNDING_ADMIN_NOTIFICATION_EMAIL',
    'set the admin notification recipient'
  );
  checkAdminReviewReminder(context);

  requiredPattern(
    'PostgreSQL',
    'DATABASE_URL',
    /^postgres(?:ql)?:\/\//,
    'set the private PostgreSQL URL for the full admin cockpit, invoices, email queue, and sponsorship follow-up'
  );

  checkOperationsAlerts(context);
  checkSponsorMediaStorage(context);
  checkSocialPublication(context);

  return checks;

  function recordToolStatus(command, section, label) {
    const available = toolStatuses[command] === 0;
    record(
      available ? 'ok' : 'warn',
      section,
      label,
      available ? 'available' : `${command} command not found`
    );
  }
}

export function checkAllowedOrigins(context) {
  const { readValue, safeUrl, required, record } = context;

  if (!required('HTTPS', 'FUNDING_ALLOWED_ORIGINS', 'set allowed origins')) {
    return;
  }

  const origins = readValue('FUNDING_ALLOWED_ORIGINS')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins.length === 0) {
    record(
      'missing',
      'HTTPS',
      'FUNDING_ALLOWED_ORIGINS',
      'set allowed origins'
    );
    return;
  }

  const hasInvalidOrigin = origins.some((origin) => !safeUrl(origin));
  if (hasInvalidOrigin) {
    record(
      'missing',
      'HTTPS',
      'FUNDING_ALLOWED_ORIGINS',
      'every origin must be a valid URL'
    );
    return;
  }

  const environment = readValue('FUNDING_PLATFORM_ENV') || 'development';
  const hasHttpOrigin = origins.some(
    (origin) => safeUrl(origin)?.protocol === 'http:'
  );
  if (environment === 'production' && hasHttpOrigin) {
    record(
      'missing',
      'HTTPS',
      'FUNDING_ALLOWED_ORIGINS',
      'production origins must use https'
    );
  }
}
