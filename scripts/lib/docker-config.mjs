// Shared build settings only; startup and update keep their own choices/defaults.
export function normalizeDockerBuildEnvironment(value) {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'prod') return 'production';
  if (normalized === 'dev') return 'development';
  return normalized;
}

export function dockerBuildEnvironment(environment, env) {
  return {
    ...env,
    FUNDING_PLATFORM_ENV: environment,
    ANGULAR_CONFIGURATION: environment
  };
}

export const dockerComposeProfileArgs = (useDatabase) =>
  useDatabase ? ['--profile', 'database'] : [];
