import {
  dockerBuildEnvironment,
  dockerComposeFileArgs,
  dockerComposeProfileArgs,
  normalizeDockerBuildEnvironment
} from './docker-config.mjs';
import { localIdentityHostname } from './local-identity.mjs';
import { createServicesCheckContext } from './services-check-context.mjs';
import { checkAdminIdentity } from './services-check-identity.mjs';
import { validateProductionTlsSettings } from './production-identity.mjs';

export function normalizeDockerAuthentication(value) {
  const authentication = value?.trim().toLowerCase();
  if (!['token', 'keycloak', 'oidc', 'configured'].includes(authentication))
    throw new Error(
      'Authentification invalide : token, keycloak, oidc ou configured.'
    );
  return authentication;
}

export function normalizeDockerEnvironment(value) {
  const normalized = normalizeDockerBuildEnvironment(value);
  const environment =
    normalized === 'local'
      ? 'development'
      : ['autre', 'other'].includes(normalized)
        ? 'other'
        : normalized;
  if (!['development', 'production', 'other'].includes(environment))
    throw new Error('Environnement invalide : local/dev, prod ou autre.');
  return environment;
}

export function parseDockerUpArgs(args) {
  const options = {
    environment: null,
    authentication: null,
    identityOnly: false,
    stripeWebhook: true,
    database: null
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help') options.help = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--identity-only') options.identityOnly = true;
    else if (arg === '--auth' || arg.startsWith('--auth=')) {
      const value = arg.includes('=')
        ? arg.slice(arg.indexOf('=') + 1)
        : args[++i];
      const authentication = normalizeDockerAuthentication(value);
      if (options.authentication && options.authentication !== authentication)
        throw new Error('Choisir un seul mode d\u2019authentification.');
      options.authentication = authentication;
    } else if (arg === '--no-stripe-webhook') options.stripeWebhook = false;
    else if (arg === '--database' || arg === '--no-database') {
      const database = arg === '--database';
      if (options.database !== null && options.database !== database)
        throw new Error('Choisir --database ou --no-database.');
      options.database = database;
    } else if (
      arg === '--environment' ||
      arg === '--env' ||
      arg.startsWith('--environment=') ||
      arg.startsWith('--env=')
    ) {
      const value = arg.includes('=')
        ? arg.slice(arg.indexOf('=') + 1)
        : args[++i];
      const environment = normalizeDockerEnvironment(value);
      if (options.environment && options.environment !== environment)
        throw new Error('Choisir un seul environnement.');
      options.environment = environment;
    } else throw new Error('Option inconnue. Consulter yarn docker:up --help.');
  }
  return options;
}

export async function chooseDockerEnvironment(options, { interactive, ask }) {
  if (options.environment) return options.environment;
  if (!interactive)
    throw new Error(
      'Sans terminal interactif, indiquer --environment local, prod ou autre.'
    );
  for (;;) {
    const answer = await ask(
      'Environnement [local/dev, prod, autre] (local) : '
    );
    try {
      return normalizeDockerEnvironment(answer || 'local');
    } catch {
      // Ask again without echoing arbitrary terminal input.
    }
  }
}

export async function chooseDockerAuthentication(
  options,
  { env, interactive, ask }
) {
  if (options.authentication) return options.authentication;
  if (
    !['development', 'production'].includes(options.environment) ||
    options.dryRun ||
    !interactive
  )
    return null;
  const production = options.environment === 'production';
  const choices = production
    ? ['keycloak', 'oidc', 'configured']
    : ['token', 'keycloak', 'oidc', 'configured'];
  const current =
    env.FUNDING_ADMIN_AUTH_MODE === 'token'
      ? 'token'
      : env.FUNDING_KEYCLOAK_ENABLED === 'true'
        ? 'keycloak'
        : 'OIDC';
  for (;;) {
    const answer = await ask(
      `Authentification ${production ? 'production' : 'locale'} [${choices.join(', ')}] (Entree : conserver ${current}) : `
    );
    if (!answer.trim()) return 'configured';
    try {
      const authentication = normalizeDockerAuthentication(answer);
      if (choices.includes(authentication)) return authentication;
    } catch {
      // Keep arbitrary terminal input out of diagnostics.
    }
  }
}

function validateProductionAuthentication(env) {
  const context = createServicesCheckContext(env);
  checkAdminIdentity(context, env);
  const missing = context.checks.find((check) => check.status === 'missing');
  if (missing)
    throw new Error(
      `${missing.label}: ${missing.detail}. Preparation OIDC : docs/operations/admin-identity-and-alerts.md.`
    );
  for (const name of [
    'FUNDING_PUBLIC_BASE_URL',
    'FUNDING_PLATFORM_API_BASE_URL',
    'FUNDING_ADMIN_OIDC_ISSUER'
  ]) {
    const url = context.safeUrl(env[name]);
    const hostname = url?.hostname.replace(/\.$/, '');
    if (
      !url ||
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      ['localhost', '[::1]', '[::]', '0.0.0.0'].includes(hostname) ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.test') ||
      /^127\./.test(hostname) ||
      /^\[::ffff:7f[0-9a-f]{2}:/.test(hostname) ||
      (name === 'FUNDING_PUBLIC_BASE_URL' && env[name] !== url.origin)
    )
      throw new Error(
        `${name} doit utiliser une URL HTTPS de production sans identifiants, parametres ni adresse locale; l'origine publique doit etre exacte.`
      );
  }
}

export function dockerUpPlan(options, { env, localTls }) {
  const environment = normalizeDockerEnvironment(options.environment);
  const local = environment === 'development';
  const authentication = options.authentication
    ? normalizeDockerAuthentication(options.authentication)
    : null;
  if (authentication && environment === 'other')
    throw new Error('--auth est reserve au demarrage local/dev ou prod.');
  if (authentication === 'token' && !local)
    throw new Error(
      'La production exige OIDC avec MFA; token est reserve au mode local/dev.'
    );
  if (
    ['token', 'keycloak', 'oidc'].includes(authentication) &&
    env.COMPOSE_FILE
  )
    throw new Error(
      '--auth token/keycloak/oidc exige les fichiers Compose geres, sans COMPOSE_FILE. Utiliser --auth configured pour une configuration personnalisee.'
    );
  const commandEnv =
    environment === 'other'
      ? { ...env }
      : dockerBuildEnvironment(environment, env);
  if (authentication === 'token') {
    commandEnv.FUNDING_ADMIN_AUTH_MODE = 'token';
    commandEnv.FUNDING_KEYCLOAK_ENABLED = 'false';
  } else if (authentication === 'oidc') {
    commandEnv.FUNDING_ADMIN_AUTH_MODE = 'oidc';
    commandEnv.FUNDING_KEYCLOAK_ENABLED = 'false';
  } else if (authentication === 'keycloak' && local) {
    Object.assign(commandEnv, {
      FUNDING_ADMIN_AUTH_MODE: 'oidc',
      FUNDING_KEYCLOAK_ENABLED: 'true',
      FUNDING_KEYCLOAK_HOSTNAME: localIdentityHostname,
      FUNDING_PUBLIC_BASE_URL: 'https://localhost',
      FUNDING_ADMIN_OIDC_ISSUER: `https://${localIdentityHostname}/realms/openg7`,
      FUNDING_ADMIN_OIDC_MFA_ACR: '',
      FUNDING_ADMIN_OIDC_CLIENT_ID: env.FUNDING_ADMIN_OIDC_CLIENT_ID?.trim()
        ? env.FUNDING_ADMIN_OIDC_CLIENT_ID
        : 'openg7-funding-admin',
      FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME:
        env.FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME?.trim()
          ? env.FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME
          : 'keycloak-local-bootstrap'
    });
  } else if (authentication === 'keycloak') {
    Object.assign(commandEnv, {
      FUNDING_ADMIN_AUTH_MODE: 'oidc',
      FUNDING_KEYCLOAK_ENABLED: 'true',
      FUNDING_ADMIN_OIDC_ISSUER: `https://${env.FUNDING_KEYCLOAK_HOSTNAME ?? ''}/realms/openg7`,
      FUNDING_ADMIN_OIDC_MFA_ACR: ''
    });
  }
  if (
    environment === 'production' &&
    (commandEnv.FUNDING_ADMIN_AUTH_MODE ?? 'oidc') !== 'oidc'
  )
    throw new Error(
      'La production exige FUNDING_ADMIN_AUTH_MODE=oidc avec MFA.'
    );
  if (
    environment === 'production' &&
    ['keycloak', 'oidc'].includes(authentication)
  )
    validateProductionAuthentication(commandEnv);
  if (local) {
    commandEnv.FUNDING_ALLOWED_ORIGINS = [
      ...new Set([
        ...(env.FUNDING_ALLOWED_ORIGINS ?? '')
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
        'https://localhost',
        'https://127.0.0.1'
      ])
    ].join(',');
  }
  if (local && /^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY ?? ''))
    throw new Error('Le mode local exige une cle Stripe de test, jamais live.');

  const localIdentity =
    local &&
    commandEnv.FUNDING_KEYCLOAK_ENABLED === 'true' &&
    commandEnv.FUNDING_KEYCLOAK_HOSTNAME === localIdentityHostname;
  let composeFiles;
  try {
    composeFiles = dockerComposeFileArgs(commandEnv, {
      localTls: local && (localTls || localIdentity)
    });
  } catch (error) {
    if (authentication === 'keycloak')
      throw new Error(
        `${error.message}\nPreparation Keycloak : docs/operations/${local ? 'keycloak-local' : 'keycloak-vps'}.md.`
      );
    throw error;
  }
  const compose = ['compose', ...composeFiles];
  const productionIdentity =
    environment === 'production' &&
    commandEnv.FUNDING_KEYCLOAK_ENABLED === 'true';
  const provisionUser = commandEnv.FUNDING_KEYCLOAK_PROVISION_USER === 'true';
  if (productionIdentity) {
    validateProductionAuthentication(commandEnv);
    validateProductionTlsSettings(commandEnv);
  }
  if (options.identityOnly && !productionIdentity)
    throw new Error('--identity-only exige Keycloak gere en production.');
  compose.push(...dockerComposeProfileArgs(options.database ?? local));
  if (options.database === false) {
    commandEnv.COMPOSE_PROFILES = (env.COMPOSE_PROFILES ?? '')
      .split(',')
      .filter((profile) => profile.trim() !== 'database')
      .join(',');
  }
  const build = [...compose, 'build'];
  if (commandEnv.ANGULAR_CONFIGURATION) {
    if (
      !['development', 'production'].includes(commandEnv.ANGULAR_CONFIGURATION)
    )
      throw new Error(
        'ANGULAR_CONFIGURATION doit valoir development ou production.'
      );
    build.push(
      '--build-arg',
      `ANGULAR_CONFIGURATION=${commandEnv.ANGULAR_CONFIGURATION}`
    );
  }
  if (options.identityOnly) build.push('keycloak');
  const identityUp =
    productionIdentity || (localIdentity && provisionUser)
      ? [
          ...compose,
          'up',
          '-d',
          '--wait',
          '--wait-timeout',
          '180',
          'identity-postgres',
          'keycloak',
          'traefik'
        ]
      : null;
  return {
    environment,
    localIdentity,
    productionIdentity,
    provisionUser,
    identityOnly: Boolean(options.identityOnly),
    identityUp,
    authentication:
      commandEnv.FUNDING_ADMIN_AUTH_MODE === 'token'
        ? 'token'
        : commandEnv.FUNDING_KEYCLOAK_ENABLED === 'true'
          ? 'keycloak'
          : 'oidc',
    commandEnv,
    stripeWebhook: local && options.stripeWebhook,
    commands: [
      [...compose, 'config', '--quiet'],
      build,
      ...(identityUp ? [identityUp] : []),
      ...(options.identityOnly ? [] : [[...compose, 'up', '-d', '--wait']])
    ]
  };
}

export async function prepareDockerLocalIdentity(
  plan,
  { checkCertificates, setupTls, prepareIdentity }
) {
  if (plan.environment !== 'development' || !plan.localIdentity) return;
  try {
    checkCertificates();
  } catch {
    await setupTls(plan.commandEnv);
    checkCertificates();
  }
  await prepareIdentity(plan.commandEnv);
}

export async function startDockerStack(
  plan,
  {
    runDocker,
    checkStripe,
    listenStripe,
    prepareProductionTls,
    checkProductionIdentity,
    prepareKeycloakUser
  }
) {
  if (
    plan.productionIdentity &&
    (typeof prepareProductionTls !== 'function' ||
      typeof checkProductionIdentity !== 'function')
  )
    throw new Error('Production Keycloak requires ACME and HTTPS checks.');
  if (plan.provisionUser && typeof prepareKeycloakUser !== 'function')
    throw new Error('Keycloak user provisioning requires a preparation hook.');
  if (plan.stripeWebhook) await checkStripe();
  for (const args of plan.commands) {
    if (args === plan.identityUp && plan.productionIdentity)
      await prepareProductionTls(plan.commandEnv);
    await runDocker(args, plan.commandEnv);
    if (args === plan.identityUp) {
      if (plan.productionIdentity)
        await checkProductionIdentity(plan.commandEnv);
      if (plan.provisionUser) await prepareKeycloakUser(plan.commandEnv);
    }
  }
  if (plan.stripeWebhook) await listenStripe();
}
