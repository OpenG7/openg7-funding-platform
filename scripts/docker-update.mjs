#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { argv, env, exit, platform, stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  dockerCommandEnvironment,
  readDockerConfiguration
} from './lib/docker-environment.mjs';
import {
  assertDockerUpdateTopology,
  chooseDockerUpdateEnvironment,
  dockerUpdateInvocation,
  dockerUpdatePlan,
  executeDockerUpdate,
  parseDockerUpdateArgs,
  resolveDockerUpdateOptions
} from './lib/docker-update.mjs';
import { prepareLocalIdentity } from './lib/local-identity.mjs';

const help = `
Usage:
  yarn docker:update
  yarn docker:update --database
  yarn docker:update --no-database
  yarn docker:update --build-app
  yarn docker:update --no-prune-images
  yarn docker:update --development --stripe-webhook
  yarn docker:update --environment production

Options:
  --database         Run Docker Compose with the database profile.
  --no-database      Run Docker Compose without the database profile.
  --build-app        Recompile the API and Angular app before Docker update.
  --no-build-app     Skip the app recompilation prompt.
  --prune-images     Delete unused dangling Docker images after the update.
  --no-prune-images  Keep unused dangling Docker images after the update.
  --stripe-webhook   Start the Stripe webhook listener after a development update.
  --no-stripe-webhook
                     Skip the Stripe webhook listener prompt.
  --environment      Target environment: production or development.
  --help             Show this message.
`;

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

try {
  const options = parseDockerUpdateArgs(argv.slice(2));
  if (options.help) {
    console.log(help.trim());
    exit(0);
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  process.chdir(root);
  const shellEnv = { ...env };
  const configurationEnv = readDockerConfiguration({ env: shellEnv });

  let targetEnvironment;
  let readline;
  try {
    targetEnvironment = await chooseDockerUpdateEnvironment(options, {
      env: configurationEnv,
      interactive: Boolean(stdin.isTTY && stdout.isTTY),
      ask: (question) => {
        readline ??= createInterface({ input: stdin, output: stdout });
        return readline.question(question);
      },
      reportInvalid: (message) => console.log(message)
    });
  } finally {
    readline?.close();
  }

  const resolvedOptions = await resolveDockerUpdateOptions(
    options,
    targetEnvironment,
    { env: configurationEnv, askYesNo }
  );
  const plan = dockerUpdatePlan(resolvedOptions, {
    env: configurationEnv,
    localTls:
      existsSync('traefik/certs/localhost.pem') &&
      existsSync('traefik/certs/localhost-key.pem')
  });
  const { useDatabase, buildAppFirst, pruneImages, startStripeWebhook } = plan;

  const run = (command, commandArgs, commandEnv) => {
    console.log(`\n> ${command} ${commandArgs.join(' ')}`);
    const invocation = dockerUpdateInvocation(command, commandArgs, {
      platform,
      env: dockerCommandEnvironment(commandEnv, configurationEnv, shellEnv)
    });
    const result = spawnSync(
      invocation.command,
      invocation.args,
      invocation.options
    );
    if (result.error) {
      console.error(
        `Command failed to start: ${command} ${commandArgs.join(' ')}`
      );
      console.error(result.error.message);
      exit(1);
    }
    if (result.status !== 0) exit(result.status ?? 1);
  };

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
  console.log(
    startStripeWebhook
      ? 'Stripe webhook listener sera lance apres Docker update.'
      : 'Stripe webhook listener ignore.'
  );

  await assertDockerUpdateTopology(plan, {
    readComposeServices: async (args, commandEnv) => {
      const invocation = dockerUpdateInvocation('docker', args, {
        platform,
        env: dockerCommandEnvironment(commandEnv, configurationEnv, shellEnv)
      });
      const result = spawnSync(invocation.command, invocation.args, {
        ...invocation.options,
        stdio: 'pipe',
        encoding: 'utf8',
        windowsHide: true
      });
      if (result.error || result.status !== 0)
        throw new Error('Cannot verify Compose services before Docker update.');
      return result.stdout;
    }
  });
  if (
    plan.commands.some(({ args }) =>
      args.includes('docker-compose.identity.local.yml')
    )
  )
    prepareLocalIdentity({ root, env: plan.commandEnv });
  await executeDockerUpdate(plan, {
    runCommand: run,
    beforeStripeWebhook: () => {
      console.log(
        '\nVerification et lancement du relais Stripe. Garde ce terminal ouvert pendant les paiements tests.'
      );
      console.log(
        'La cle de test et le secret de signature seront verifies sans etre affiches.'
      );
    }
  });
} catch (error) {
  console.error(error.message);
  if (error.showHelp) console.error(help.trim());
  exit(1);
}
