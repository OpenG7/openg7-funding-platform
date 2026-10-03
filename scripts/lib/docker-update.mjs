import {
  dockerBuildEnvironment,
  dockerComposeProfileArgs,
  normalizeDockerBuildEnvironment
} from './docker-config.mjs';

const validEnvironments = new Set(['production', 'development']);

export class DockerUpdateArgumentError extends Error {
  constructor(message, { showHelp = false } = {}) {
    super(message);
    this.showHelp = showHelp;
  }
}

export function parseDockerUpdateArgs(args) {
  const options = {
    environment: null,
    database: null,
    buildApp: null,
    pruneImages: null,
    stripeWebhook: null,
    help: false
  };
  const setEnvironment = (value) => {
    const normalized = normalizeDockerBuildEnvironment(value);
    if (!validEnvironments.has(normalized))
      throw new DockerUpdateArgumentError(
        `Invalid environment "${value}". Use production or development.`
      );
    if (options.environment && options.environment !== normalized)
      throw new DockerUpdateArgumentError(
        'Choose only one target environment.'
      );
    options.environment = normalized;
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--database') options.database = true;
    else if (arg === '--no-database') options.database = false;
    else if (arg === '--build-app') options.buildApp = true;
    else if (arg === '--no-build-app') options.buildApp = false;
    else if (arg === '--prune-images') options.pruneImages = true;
    else if (arg === '--no-prune-images') options.pruneImages = false;
    else if (arg === '--stripe-webhook') options.stripeWebhook = true;
    else if (arg === '--no-stripe-webhook') options.stripeWebhook = false;
    else if (arg === '--environment' || arg === '--env') {
      const value = args[index + 1];
      if (!value)
        throw new DockerUpdateArgumentError(
          `${arg} requires production or development.`
        );
      setEnvironment(value);
      index += 1;
    } else if (arg.startsWith('--environment=')) {
      setEnvironment(arg.slice('--environment='.length));
    } else if (arg.startsWith('--env=')) {
      setEnvironment(arg.slice('--env='.length));
    } else if (arg === '--production') setEnvironment('production');
    else if (arg === '--development') setEnvironment('development');
    else if (arg === '--help') options.help = true;
    else
      throw new DockerUpdateArgumentError(`Unknown argument: ${arg}`, {
        showHelp: true
      });
  }

  // Help historically precedes boolean conflict checks, but not parse errors.
  if (options.help) return options;
  for (const flag of [
    'database',
    'build-app',
    'prune-images',
    'stripe-webhook'
  ]) {
    if (args.includes(`--${flag}`) && args.includes(`--no-${flag}`))
      throw new DockerUpdateArgumentError(
        `Choose either --${flag} or --no-${flag}, not both.`
      );
  }
  return options;
}

export async function chooseDockerUpdateEnvironment(
  options,
  { env, interactive, ask, reportInvalid = () => {} }
) {
  if (options.environment) return options.environment;
  const fromShell = env.FUNDING_PLATFORM_ENV
    ? normalizeDockerBuildEnvironment(env.FUNDING_PLATFORM_ENV)
    : null;
  if (validEnvironments.has(fromShell)) return fromShell;
  if (!interactive) return 'production';
  for (;;) {
    const answer = await ask(
      'Pour quel environnement est destine le build ? [production/development] (production) '
    );
    const normalized = normalizeDockerBuildEnvironment(answer || 'production');
    if (validEnvironments.has(normalized)) return normalized;
    reportInvalid('Choix invalide. Utilise production ou development.');
  }
}

export async function resolveDockerUpdateOptions(
  options,
  targetEnvironment,
  { env, askYesNo }
) {
  if (targetEnvironment !== 'development' && options.stripeWebhook === true)
    throw new DockerUpdateArgumentError(
      '--stripe-webhook is only available for development builds.'
    );

  const envProfiles = (env.COMPOSE_PROFILES ?? '')
    .split(',')
    .map((profile) => profile.trim())
    .filter(Boolean);
  // Preserve update's existing precedence: an inherited profile enables DB
  // even when --no-database is supplied. docker:up retains its own opt-out.
  const useDatabase =
    options.database === true || envProfiles.includes('database')
      ? true
      : options.database === false
        ? false
        : await askYesNo(
            'Activer la database PostgreSQL pour docker:update ? [y/N] '
          );
  const buildAppFirst =
    options.buildApp ??
    (await askYesNo(
      "Recompiler l'API et Angular avant le Docker update ? [y/N] "
    ));
  const pruneImages =
    options.pruneImages ??
    (await askYesNo(
      'Supprimer les anciennes images Docker non utilisees apres le build ? [Y/n] ',
      true
    ));
  const startStripeWebhook =
    targetEnvironment === 'development'
      ? (options.stripeWebhook ??
        (await askYesNo(
          'Lancer Stripe webhook listener apres le Docker update ? [y/N] '
        )))
      : false;

  return {
    targetEnvironment,
    useDatabase,
    buildAppFirst,
    pruneImages,
    startStripeWebhook
  };
}

export function dockerUpdatePlan(options, { env }) {
  const {
    targetEnvironment,
    useDatabase,
    buildAppFirst,
    pruneImages,
    startStripeWebhook
  } = options;
  const angularConfiguration =
    targetEnvironment === 'production' ? 'production' : 'development';
  const commandEnv = dockerBuildEnvironment(targetEnvironment, env);
  const compose = [
    'compose',
    ...dockerComposeProfileArgs(useDatabase),
    '--progress',
    'plain'
  ];
  const commands = [];
  if (buildAppFirst) {
    commands.push(
      { command: 'yarn', args: ['build'] },
      {
        command: 'yarn',
        args: [
          'workspace',
          '@openg7/funding-web',
          'build',
          '--configuration',
          angularConfiguration
        ]
      }
    );
  }
  commands.push(
    {
      command: 'docker',
      args: [...compose, 'pull', '--ignore-buildable', '--quiet']
    },
    {
      command: 'docker',
      args: [
        ...compose,
        'build',
        '--pull',
        '--build-arg',
        `FUNDING_PLATFORM_ENV=${targetEnvironment}`,
        '--build-arg',
        `ANGULAR_CONFIGURATION=${angularConfiguration}`
      ]
    },
    { command: 'docker', args: [...compose, 'up', '-d', '--remove-orphans'] }
  );
  if (pruneImages)
    commands.push({ command: 'docker', args: ['image', 'prune', '-f'] });
  if (startStripeWebhook)
    commands.push({
      command: 'yarn',
      args: ['stripe:webhook:listen'],
      stripeWebhook: true
    });
  return { ...options, angularConfiguration, commandEnv, commands };
}

const quoteWindowsArg = (arg) => {
  if (arg.length === 0) return '""';
  if (/^[A-Za-z0-9_/:=+.,@%-]+$/.test(arg)) return arg;
  return `"${arg.replace(/(["^&|<>])/g, '^$1')}"`;
};

export function dockerUpdateInvocation(command, args, { platform, env }) {
  return {
    command: platform === 'win32' ? env.ComSpec || 'cmd.exe' : command,
    args:
      platform === 'win32'
        ? ['/d', '/s', '/c', [command, ...args].map(quoteWindowsArg).join(' ')]
        : args,
    options: { stdio: 'inherit', env }
  };
}

export async function executeDockerUpdate(
  plan,
  { runCommand, beforeStripeWebhook = () => {} }
) {
  for (const { command, args, stripeWebhook } of plan.commands) {
    if (stripeWebhook) beforeStripeWebhook();
    await runCommand(command, args, plan.commandEnv);
  }
}
