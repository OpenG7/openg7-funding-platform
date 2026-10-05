import {
  dockerBuildEnvironment,
  dockerComposeFileArgs,
  dockerComposeProfileArgs,
  normalizeDockerBuildEnvironment
} from './docker-config.mjs';

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
  const options = { environment: null, stripeWebhook: true, database: null };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help') options.help = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--no-stripe-webhook') options.stripeWebhook = false;
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

export function dockerUpPlan(options, { env, localTls }) {
  const environment = normalizeDockerEnvironment(options.environment);
  const local = environment === 'development';
  const commandEnv =
    environment === 'other'
      ? { ...env }
      : dockerBuildEnvironment(environment, env);
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

  const compose = [
    'compose',
    ...dockerComposeFileArgs(commandEnv, { localTls: local && localTls })
  ];
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
  return {
    environment,
    commandEnv,
    stripeWebhook: local && options.stripeWebhook,
    commands: [
      [...compose, 'config', '--quiet'],
      build,
      [...compose, 'up', '-d', '--wait']
    ]
  };
}

export async function startDockerStack(
  plan,
  { runDocker, checkStripe, listenStripe }
) {
  if (plan.stripeWebhook) await checkStripe();
  for (const args of plan.commands) await runDocker(args, plan.commandEnv);
  if (plan.stripeWebhook) await listenStripe();
}
