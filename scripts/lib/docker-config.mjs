import { validateKeycloakConfig } from './keycloak-config.mjs';

// Startup and update share configuration; each retains its own choices/defaults.
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

export function dockerOperationsEnabled(env) {
  // Match the existing Bash switch: unset or empty leaves the worker disabled.
  const value = env.FUNDING_OPERATIONS_WATCHER_ENABLED || 'false';
  if (!['true', 'false'].includes(value))
    throw new Error(
      'FUNDING_OPERATIONS_WATCHER_ENABLED must be true or false.'
    );
  return value === 'true';
}

export function dockerComposeFileArgs(env, { localTls = false } = {}) {
  const identity = validateKeycloakConfig(env);
  const operations = dockerOperationsEnabled(env);
  if (env.COMPOSE_FILE) {
    if (identity)
      throw new Error(
        'Use the managed Keycloak overlay without COMPOSE_FILE; select custom Compose files explicitly.'
      );
    return [];
  }
  if (!identity && !operations && !localTls) return [];
  return [
    '-f',
    'docker-compose.yml',
    ...(localTls ? ['-f', 'docker-compose.local-tls.yml'] : []),
    ...(operations ? ['-f', 'docker-compose.operations.yml'] : []),
    ...(identity ? ['-f', 'docker-compose.identity.yml'] : [])
  ];
}
