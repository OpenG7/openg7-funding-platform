const secretNames = new Set([
  'DATABASE_URL',
  'FUNDING_ADMIN_OIDC_CLIENT_SECRET',
  'FUNDING_ADMIN_OIDC_OWNER_SUBJECTS',
  'FUNDING_ADMIN_SESSION_SECRET',
  'FUNDING_ADMIN_TOKEN',
  'FUNDING_OPERATIONS_WEBHOOK_URL',
  'FUNDING_OPERATIONS_WEBHOOK_SECRET',
  'OVH_S3_ACCESS_KEY_ID',
  'OVH_S3_SECRET_ACCESS_KEY',
  'SOCIAL_PUBLICATION_FACEBOOK_PAGE_ACCESS_TOKEN',
  'SOCIAL_PUBLICATION_LINKEDIN_ACCESS_TOKEN',
  'SMTP_PASSWORD',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET'
]);

export function formatServicesReadinessReport(checks, envFile) {
  const output = [];
  const write = (chunk) => output.push(chunk);

  write('OpenG7 funding services readiness\n');
  write(`Env file: ${envFile}\n`);
  write('Scope: configuration and local tool availability only.\n');
  write('Secrets: values are never printed.\n\n');

  for (const check of checks) {
    write(
      `${statusLabel(check.status)} ${check.section} / ${check.label}: ${maskDetail(
        check
      )}\n`
    );
  }

  const okCount = checks.filter((check) => check.status === 'ok').length;
  const warningCount = checks.filter((check) => check.status === 'warn').length;
  const missingChecks = checks.filter((check) => check.status === 'missing');

  write(
    `\nSummary: ${okCount} ok, ${warningCount} warning, ${missingChecks.length} missing\n`
  );

  if (missingChecks.length > 0) {
    write('\nMissing before full operations:\n');
    for (const check of missingChecks) {
      write(`- ${check.section} / ${check.label}: ${maskDetail(check)}\n`);
    }
    write('\nNext: fill .env, then rerun yarn services:check.\n');
    return output.join('');
  }

  write(
    '\nNo blocking configuration issue found. Review warnings; provider access, MFA, alert delivery and running services have not been verified.\n'
  );

  return output.join('');
}

function statusLabel(status) {
  if (status === 'ok') {
    return '[OK]';
  }

  if (status === 'warn') {
    return '[WARN]';
  }

  return '[MISSING]';
}

function maskDetail(check) {
  if (secretNames.has(check.label)) {
    return check.detail.replace(/configured|available|enabled/, 'present');
  }

  return check.detail;
}
