import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, dirname, resolve } from 'node:path';

// These values are read to choose/validate a plan. Original runtime settings
// stay in Compose's environment files; launchers export only derived overrides.
const configurationNames = [
  'COMPOSE_PROJECT_NAME',
  'COMPOSE_FILE',
  'COMPOSE_PATH_SEPARATOR',
  'COMPOSE_PROFILES',
  'FUNDING_PLATFORM_ENV',
  'ANGULAR_CONFIGURATION',
  'FUNDING_ALLOWED_ORIGINS',
  'STRIPE_SECRET_KEY',
  'LETSENCRYPT_EMAIL',
  'FUNDING_OPERATIONS_WATCHER_ENABLED',
  'FUNDING_KEYCLOAK_ENABLED',
  'FUNDING_KEYCLOAK_HOSTNAME',
  'FUNDING_PUBLIC_BASE_URL',
  'FUNDING_PLATFORM_API_BASE_URL',
  'FUNDING_ADMIN_AUTH_MODE',
  'FUNDING_ADMIN_OIDC_ISSUER',
  'FUNDING_ADMIN_OIDC_MFA_ACR',
  'FUNDING_ADMIN_OIDC_CLIENT_ID',
  'FUNDING_ADMIN_OIDC_CLIENT_SECRET',
  'FUNDING_ADMIN_OIDC_OWNER_SUBJECTS',
  'FUNDING_KEYCLOAK_DB_PASSWORD',
  'FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME',
  'FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD',
  'FUNDING_KEYCLOAK_INITIAL_USER_USERNAME',
  'FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD'
];
const presencePrefix = '__OPENG7_PRESENT_';
const configurationError = () =>
  new Error('Cannot resolve Docker configuration with Docker Compose.');

export function readDockerConfiguration({
  env = process.env,
  cwd = process.cwd(),
  runCompose = spawnSync
} = {}) {
  if (
    !existsSync(resolve(cwd, '.env')) &&
    !env.COMPOSE_ENV_FILES &&
    !env.COMPOSE_FILE
  )
    return { ...env };

  // Every model contains variable references only. Compose owns dotenv parsing
  // and interpolation; its output is captured because it can contain secrets.
  const probe = (
    names,
    { projectDirectory, probeEnv = env, listNames = false } = {}
  ) => {
    const environment = Object.fromEntries(
      names.flatMap((name) => [
        [name, `\${${name}-}`],
        [presencePrefix + name, `\${${name}+1}`]
      ])
    );
    try {
      const result = runCompose(
        'docker',
        [
          'compose',
          ...(projectDirectory
            ? ['--project-directory', projectDirectory]
            : []),
          '-f',
          '-',
          'config',
          ...(listNames ? ['--environment'] : ['--format', 'json'])
        ],
        {
          cwd,
          env: probeEnv,
          input: JSON.stringify({
            services: { configuration: { image: 'scratch', environment } }
          }),
          encoding: 'utf8',
          stdio: 'pipe',
          windowsHide: true
        }
      );
      if (result.error || result.status !== 0) throw configurationError();
      if (listNames) {
        // Discover names only. Values (including multiline ones) are resolved
        // by a JSON probe next; presence markers discard spurious line names.
        return [
          ...new Set([
            ...configurationNames,
            ...Array.from(
              result.stdout.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)=/gm),
              (match) => match[1]
            )
          ])
        ];
      }
      const rendered = JSON.parse(result.stdout).services.configuration
        .environment;
      if (!rendered || typeof rendered !== 'object') throw configurationError();
      const values = {};
      for (const name of names) {
        const present = rendered[presencePrefix + name];
        if (present === '1' && typeof rendered[name] === 'string') {
          // `config` escapes literal dollars so its output can be reused as a
          // Compose model. Restore the original value exactly once for reading.
          values[name] = rendered[name].replace(/\$\$/g, '$');
        } else if (present !== '') throw configurationError();
      }
      return values;
    } catch {
      // Compose diagnostics may quote environment values. Never forward them.
      throw configurationError();
    }
  };
  const configurationFrom = (values) => {
    const resolved = { ...env };
    for (const name of configurationNames) {
      if (Object.hasOwn(values, name)) resolved[name] = values[name];
      else delete resolved[name];
    }
    return resolved;
  };
  const configuration = configurationFrom(probe(configurationNames));
  if (!configuration.COMPOSE_FILE) return configuration;
  const separator = configuration.COMPOSE_PATH_SEPARATOR || delimiter;
  const firstFile = configuration.COMPOSE_FILE.split(separator)[0];
  const projectDirectory = dirname(resolve(cwd, firstFile));
  if (projectDirectory === resolve(cwd)) return configuration;

  // COMPOSE_FILE may move the project and add its lower-priority .env. Preserve
  // every root value here, including aliases referenced by that second file.
  // They exist only for this read; runtime children still get the original shell.
  const rootValues = probe(probe(configurationNames, { listNames: true }));
  return configurationFrom(
    probe(configurationNames, {
      projectDirectory,
      probeEnv: { ...rootValues, ...env }
    })
  );
}

export function dockerCommandEnvironment(
  plannedEnv,
  configurationEnv,
  shellEnv
) {
  const commandEnv = { ...shellEnv };
  for (const [name, value] of Object.entries(plannedEnv)) {
    if (value !== configurationEnv[name]) commandEnv[name] = value;
  }
  return commandEnv;
}
