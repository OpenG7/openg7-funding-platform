#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { argv, env, exit, platform, stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';

const rawArgs = argv.slice(2);

const help = `
Usage:
  yarn docker:update
  yarn docker:update --database
  yarn docker:update --no-database
  yarn docker:update --build-app
  yarn docker:update --no-prune-images
  yarn docker:update --environment production

Options:
  --database         Run Docker Compose with the database profile.
  --no-database      Run Docker Compose without the database profile.
  --build-app        Recompile the API and Angular app before Docker update.
  --no-build-app     Skip the app recompilation prompt.
  --prune-images     Delete unused dangling Docker images after the update.
  --no-prune-images  Keep unused dangling Docker images after the update.
  --environment      Target environment: production or development.
  --help             Show this message.
`;

const validEnvironments = new Set(['production', 'development']);
let forceDatabase = null;
let forceBuildApp = null;
let forcePruneImages = null;
let selectedEnvironment = null;
let showHelp = false;

const normalizeEnvironment = (value) => {
  const normalized = value.trim().toLowerCase();

  if (normalized === 'prod') {
    return 'production';
  }

  if (normalized === 'dev') {
    return 'development';
  }

  return normalized;
};

const setEnvironment = (value) => {
  const normalized = normalizeEnvironment(value);
  if (!validEnvironments.has(normalized)) {
    console.error(
      `Invalid environment "${value}". Use production or development.`
    );
    exit(1);
  }

  if (selectedEnvironment && selectedEnvironment !== normalized) {
    console.error('Choose only one target environment.');
    exit(1);
  }

  selectedEnvironment = normalized;
};

for (let index = 0; index < rawArgs.length; index += 1) {
  const arg = rawArgs[index];

  if (arg === '--database') {
    forceDatabase = true;
  } else if (arg === '--no-database') {
    forceDatabase = false;
  } else if (arg === '--build-app') {
    forceBuildApp = true;
  } else if (arg === '--no-build-app') {
    forceBuildApp = false;
  } else if (arg === '--prune-images') {
    forcePruneImages = true;
  } else if (arg === '--no-prune-images') {
    forcePruneImages = false;
  } else if (arg === '--environment' || arg === '--env') {
    const value = rawArgs[index + 1];
    if (!value) {
      console.error(`${arg} requires production or development.`);
      exit(1);
    }
    setEnvironment(value);
    index += 1;
  } else if (arg.startsWith('--environment=')) {
    setEnvironment(arg.slice('--environment='.length));
  } else if (arg.startsWith('--env=')) {
    setEnvironment(arg.slice('--env='.length));
  } else if (arg === '--production') {
    setEnvironment('production');
  } else if (arg === '--development') {
    setEnvironment('development');
  } else if (arg === '--help') {
    showHelp = true;
  } else {
    console.error(`Unknown argument: ${arg}`);
    console.error(help.trim());
    exit(1);
  }
}

if (showHelp) {
  console.log(help.trim());
  exit(0);
}

if (rawArgs.includes('--database') && rawArgs.includes('--no-database')) {
  console.error('Choose either --database or --no-database, not both.');
  exit(1);
}

if (rawArgs.includes('--build-app') && rawArgs.includes('--no-build-app')) {
  console.error('Choose either --build-app or --no-build-app, not both.');
  exit(1);
}

if (
  rawArgs.includes('--prune-images') &&
  rawArgs.includes('--no-prune-images')
) {
  console.error('Choose either --prune-images or --no-prune-images, not both.');
  exit(1);
}

const envProfiles = (env.COMPOSE_PROFILES ?? '')
  .split(',')
  .map((profile) => profile.trim())
  .filter(Boolean);

const askYesNo = async (question, defaultValue = false) => {
  if (!stdin.isTTY || !stdout.isTTY) {
    return defaultValue;
  }

  const readline = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await readline.question(question);
    const normalized = answer.trim().toLowerCase();
    if (!normalized) {
      return defaultValue;
    }

    return ['y', 'yes', 'o', 'oui'].includes(normalized);
  } finally {
    readline.close();
  }
};

const askForDatabaseProfile = () => {
  if (forceDatabase === true || envProfiles.includes('database')) {
    return true;
  }

  if (forceDatabase === false) {
    return false;
  }

  return askYesNo('Activer la database PostgreSQL pour docker:update ? [y/N] ');
};

const askForAppBuild = () => {
  if (forceBuildApp === true) {
    return true;
  }

  if (forceBuildApp === false) {
    return false;
  }

  return askYesNo(
    "Recompiler l'API et Angular avant le Docker update ? [y/N] "
  );
};

const askForImagePrune = () => {
  if (forcePruneImages !== null) {
    return forcePruneImages;
  }

  return askYesNo(
    'Supprimer les anciennes images Docker non utilisees apres le build ? [Y/n] ',
    true
  );
};

const askForEnvironment = async () => {
  if (selectedEnvironment) {
    return selectedEnvironment;
  }

  const environmentFromShell = env.FUNDING_PLATFORM_ENV
    ? normalizeEnvironment(env.FUNDING_PLATFORM_ENV)
    : null;
  if (environmentFromShell && validEnvironments.has(environmentFromShell)) {
    return environmentFromShell;
  }

  if (!stdin.isTTY || !stdout.isTTY) {
    return 'production';
  }

  const readline = createInterface({ input: stdin, output: stdout });
  try {
    for (;;) {
      const answer = await readline.question(
        'Pour quel environnement est destine le build ? [production/development] (production) '
      );
      const normalized = normalizeEnvironment(answer || 'production');
      if (validEnvironments.has(normalized)) {
        return normalized;
      }

      console.log('Choix invalide. Utilise production ou development.');
    }
  } finally {
    readline.close();
  }
};

const targetEnvironment = await askForEnvironment();
const angularConfiguration =
  targetEnvironment === 'production' ? 'production' : 'development';
const commandEnv = {
  ...env,
  FUNDING_PLATFORM_ENV: targetEnvironment,
  ANGULAR_CONFIGURATION: angularConfiguration
};

const quoteWindowsArg = (arg) => {
  if (arg.length === 0) {
    return '""';
  }

  if (/^[A-Za-z0-9_/:=+.,@%-]+$/.test(arg)) {
    return arg;
  }

  return `"${arg.replace(/(["^&|<>])/g, '^$1')}"`;
};

const run = (command, commandArgs) => {
  console.log(`\n> ${command} ${commandArgs.join(' ')}`);
  const result =
    platform === 'win32'
      ? spawnSync(
          env.ComSpec || 'cmd.exe',
          [
            '/d',
            '/s',
            '/c',
            [command, ...commandArgs].map(quoteWindowsArg).join(' ')
          ],
          {
            stdio: 'inherit',
            env: commandEnv
          }
        )
      : spawnSync(command, commandArgs, {
          stdio: 'inherit',
          env: commandEnv
        });

  if (result.error) {
    console.error(
      `Command failed to start: ${command} ${commandArgs.join(' ')}`
    );
    console.error(result.error.message);
    exit(1);
  }

  if (result.status !== 0) {
    exit(result.status ?? 1);
  }
};

const useDatabase = await askForDatabaseProfile();
const buildAppFirst = await askForAppBuild();
const pruneImages = await askForImagePrune();
const composeProfileArgs = useDatabase ? ['--profile', 'database'] : [];
const composeGlobalArgs = [...composeProfileArgs, '--progress', 'plain'];

console.log(`Environnement cible: ${targetEnvironment}.`);
console.log(
  buildAppFirst
    ? 'Recompilation locale activee avant Docker update.'
    : 'Recompilation locale ignoree.'
);
console.log(
  useDatabase
    ? 'Docker update avec profil database.'
    : 'Docker update sans profil database.'
);
console.log(
  pruneImages
    ? 'Nettoyage des anciennes images Docker active.'
    : 'Nettoyage des anciennes images Docker ignore.'
);

if (buildAppFirst) {
  run('yarn', ['build']);
  run('yarn', [
    'workspace',
    '@openg7/funding-web',
    'build',
    '--configuration',
    angularConfiguration
  ]);
}

run('docker', [
  'compose',
  ...composeGlobalArgs,
  'pull',
  '--ignore-buildable',
  '--quiet'
]);
run('docker', [
  'compose',
  ...composeGlobalArgs,
  'build',
  '--pull',
  '--build-arg',
  `FUNDING_PLATFORM_ENV=${targetEnvironment}`,
  '--build-arg',
  `ANGULAR_CONFIGURATION=${angularConfiguration}`
]);
run('docker', [
  'compose',
  ...composeGlobalArgs,
  'up',
  '-d',
  '--remove-orphans'
]);
if (pruneImages) {
  run('docker', ['image', 'prune', '-f']);
}
