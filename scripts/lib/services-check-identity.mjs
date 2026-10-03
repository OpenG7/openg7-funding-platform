export function checkAdminIdentity(context, env) {
  const {
    readValue,
    hasRealValue,
    safeUrl,
    required,
    requiredSecret,
    requiredPattern,
    requiredPositiveInteger,
    requiredCredentialFreeHttpsUrl,
    record
  } = context;

  const mode = env.FUNDING_ADMIN_AUTH_MODE ?? 'token';
  if (!['token', 'oidc'].includes(mode)) {
    record(
      'missing',
      'Admin',
      'FUNDING_ADMIN_AUTH_MODE',
      'must be token or oidc'
    );
    return;
  }

  record('ok', 'Admin', 'FUNDING_ADMIN_AUTH_MODE', mode);
  if (mode === 'token') {
    requiredSecret(
      'Admin',
      'FUNDING_ADMIN_TOKEN',
      'set a long root admin token',
      32
    );
    requiredSecret(
      'Admin',
      'FUNDING_ADMIN_SESSION_SECRET',
      'set a distinct long session signing secret',
      32
    );
    if (
      hasRealValue('FUNDING_ADMIN_TOKEN') &&
      hasRealValue('FUNDING_ADMIN_SESSION_SECRET') &&
      readValue('FUNDING_ADMIN_TOKEN') ===
        readValue('FUNDING_ADMIN_SESSION_SECRET')
    ) {
      record(
        'missing',
        'Admin',
        'FUNDING_ADMIN_SESSION_SECRET',
        'session secret must be different from the root admin token'
      );
    }
    requiredPositiveInteger(
      'Admin',
      'FUNDING_ADMIN_SESSION_TTL_MINUTES',
      'set a positive session duration'
    );
    return;
  }

  requiredCredentialFreeHttpsUrl('Admin', 'FUNDING_ADMIN_OIDC_ISSUER');
  requiredCredentialFreeHttpsUrl('Admin', 'FUNDING_PUBLIC_BASE_URL');
  requiredCredentialFreeHttpsUrl('Admin', 'FUNDING_PLATFORM_API_BASE_URL');
  const publicUrl = safeUrl(readValue('FUNDING_PUBLIC_BASE_URL'));
  const apiUrl = safeUrl(readValue('FUNDING_PLATFORM_API_BASE_URL'));
  if (publicUrl && apiUrl && publicUrl.origin !== apiUrl.origin) {
    record(
      'missing',
      'Admin',
      'FUNDING_PLATFORM_API_BASE_URL',
      'OIDC requires Web and API on the same origin'
    );
  }
  required('Admin', 'FUNDING_ADMIN_OIDC_CLIENT_ID', 'set the OIDC client ID');
  required(
    'Admin',
    'FUNDING_ADMIN_OIDC_CLIENT_SECRET',
    'set the OIDC client secret'
  );

  const owners = 'FUNDING_ADMIN_OIDC_OWNER_SUBJECTS';
  if (readValue(owners)) {
    requiredPattern(
      'Admin',
      owners,
      /[^,\s]/,
      'set at least one owner subject'
    );
  } else {
    record(
      'warn',
      'Admin',
      owners,
      'no bootstrap owners configured; verify an active owner already exists in PostgreSQL'
    );
  }

  const acr = 'FUNDING_ADMIN_OIDC_MFA_ACR';
  if (readValue(acr)) {
    requiredPattern('Admin', acr, /[^,\s]/, 'set at least one MFA ACR value');
    record(
      'warn',
      'Admin',
      acr,
      'verify that the provider guarantees MFA for every configured ACR value'
    );
  } else {
    record(
      'warn',
      'Admin',
      acr,
      'signed amr must contain mfa; verify with the provider'
    );
  }
  record(
    'warn',
    'Admin',
    'OIDC readiness',
    'configuration only; verify migration 020, same-origin Web/API callback, MFA and session revocation'
  );
}

export function checkOperationsAlerts(context) {
  const { readValue, requiredSecret, requiredCredentialFreeHttpsUrl, record } =
    context;

  const urlName = 'FUNDING_OPERATIONS_WEBHOOK_URL';
  const secretName = 'FUNDING_OPERATIONS_WEBHOOK_SECRET';
  if (!readValue(urlName) && !readValue(secretName)) {
    record(
      'warn',
      'Operations alerts',
      urlName,
      'disabled; no independent alert channel configured'
    );
    return;
  }

  requiredCredentialFreeHttpsUrl('Operations alerts', urlName);
  requiredSecret(
    'Operations alerts',
    secretName,
    'set the webhook signing secret',
    32
  );
  requiredCredentialFreeHttpsUrl(
    'Operations alerts',
    'FUNDING_PUBLIC_BASE_URL'
  );
  record(
    'warn',
    'Operations alerts',
    'Receiver readiness',
    'configuration only; verify migration 021, a running watcher, receiver signature checks and event deduplication'
  );
}
