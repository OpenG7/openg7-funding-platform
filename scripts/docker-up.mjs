#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { loadDotEnv } from './lib/load-dotenv.mjs';
import {
  chooseDockerEnvironment,
  dockerUpPlan,
  parseDockerUpArgs,
  startDockerStack
} from './lib/docker-up.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const help = `Usage: yarn docker:up [--environment local|prod|autre] [options]

Sans option, demande l'environnement dans un terminal interactif.
local/dev : build de developpement, PostgreSQL et relais Stripe de test.
prod      : build de production, sans relais Stripe.
autre     : conserve la configuration .env/shell, sans relais Stripe.
Les conteneurs demarrent en arriere-plan; le relais reste dans ce terminal.
La cible Docker et les secrets proviennent de la configuration existante.

Options:
  --no-stripe-webhook  Demarrer le mode local sans relais Stripe.
  --database          Activer PostgreSQL aussi pour prod/autre.
  --no-database       Ne pas activer le profil PostgreSQL.
  --dry-run           Afficher les commandes sans les executer.
  --help              Afficher cette aide.
`;

const runNode = (args, env) =>
  new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      env,
      stdio: 'inherit',
      windowsHide: true
    });
    child.once('error', () =>
      reject(new Error('Impossible de lancer la commande.'))
    );
    child.once('exit', (code, signal) => {
      if (code === 0) resolveRun();
      else
        reject(
          new Error(
            signal ? 'Commande interrompue.' : `Commande en echec (${code}).`
          )
        );
    });
  });

try {
  const options = parseDockerUpArgs(process.argv.slice(2));
  if (options.help) console.log(help);
  else {
    process.chdir(root);
    let readline;
    try {
      options.environment = await chooseDockerEnvironment(options, {
        interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
        ask: (question) => {
          readline ??= createInterface({
            input: process.stdin,
            output: process.stdout
          });
          return readline.question(question);
        }
      });
    } finally {
      readline?.close();
    }
    loadDotEnv('.env');
    const plan = dockerUpPlan(options, {
      env: process.env,
      localTls:
        existsSync('traefik/certs/localhost.pem') &&
        existsSync('traefik/certs/localhost-key.pem')
    });
    console.log(
      `Environnement : ${plan.environment}. Conteneurs en arriere-plan.`
    );
    if (options.dryRun) {
      for (const args of plan.commands) console.log(`docker ${args.join(' ')}`);
      console.log(
        plan.stripeWebhook
          ? 'yarn stripe:webhook:listen (verification avant Docker, puis relais)'
          : 'Relais Stripe desactive.'
      );
    } else {
      await startDockerStack(plan, {
        runDocker: (args, env) =>
          runNode(['scripts/docker-ready.mjs', '--', 'docker', ...args], env),
        checkStripe: () =>
          runNode(
            ['scripts/stripe-webhook-listen.mjs', '--check'],
            plan.commandEnv
          ),
        listenStripe: () =>
          runNode(['scripts/stripe-webhook-listen.mjs'], plan.commandEnv)
      });
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
