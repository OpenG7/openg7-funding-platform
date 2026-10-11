#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import {
  dockerCommandEnvironment,
  readDockerConfiguration
} from './lib/docker-environment.mjs';
import {
  chooseDockerAuthentication,
  chooseDockerEnvironment,
  dockerUpPlan,
  parseDockerUpArgs,
  prepareDockerLocalIdentity,
  startDockerStack
} from './lib/docker-up.mjs';
import {
  prepareLocalIdentity,
  validateLocalIdentityCertificates
} from './lib/local-identity.mjs';
import { prepareLocalInitialUser } from './lib/keycloak-initial-user.mjs';
import {
  inspectProductionAcmeWithDocker,
  prepareProductionAcme,
  waitForProductionIdentity
} from './lib/production-identity.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readLocalCa = () => {
  try {
    return readFileSync(resolve(root, 'traefik/certs/rootCA.pem'), 'utf8');
  } catch {
    return null;
  }
};
const help = `Usage: yarn docker:up [--environment local|prod|autre] [options]

Sans option, demande l'environnement dans un terminal interactif.
En local interactif, propose token, Keycloak ou OIDC; Entree conserve .env/shell.
En production interactive, propose Keycloak ou OIDC externe; token est refuse.
local/dev : build de developpement, PostgreSQL et relais Stripe de test.
prod      : build de production, sans relais Stripe.
autre     : conserve la configuration .env/shell, sans relais Stripe.
Les conteneurs demarrent en arriere-plan; le relais reste dans ce terminal.
La cible Docker et les secrets proviennent de la configuration existante.

Options:
  --auth token|keycloak|oidc|configured  Choisir l'authentification sans modifier .env (token uniquement local).
  --no-stripe-webhook  Demarrer le mode local sans relais Stripe.
  --database          Activer PostgreSQL aussi pour prod/autre.
  --no-database       Ne pas activer le profil PostgreSQL.
  --identity-only     Preparer HTTPS et demarrer uniquement Keycloak gere en production.
  --dry-run           Afficher les commandes sans les executer.
  --help              Afficher cette aide.

Avec .env, le dry-run exige Docker Compose pour resoudre la configuration,
sans daemon Docker ni modification de la pile.
Le choix --auth vaut pour cette invocation; les autres lanceurs conservent .env/shell.
Keycloak local verifie les certificats et lance le setup TLS --renew --no-restart si necessaire.
Ce setup peut installer mkcert et demander l'approbation de sa CA dans Windows.
Les secrets et hosts restent a preparer selon docs/operations/keycloak-local.md.
Un premier utilisateur local peut etre prepare avec FUNDING_KEYCLOAK_INITIAL_USER_USERNAME/PASSWORD.
Sans opt-in de provisionnement, l'import exige une nouvelle base identite; un volume existant sans etat est conserve avec un avertissement.
FUNDING_KEYCLOAK_PROVISION_USER=true prepare le compte par HTTPS sur une base neuve ou existante, avant l'API.
Avec FUNDING_KEYCLOAK_PROVISION_USER=true, le compte et ses subjects sont prepares apres le demarrage de Keycloak, sur une base neuve ou existante.
Mot de passe et OTP restent a changer/configurer personnellement.
Production OIDC/Keycloak : suivre docs/operations/keycloak-vps.md et admin-identity-and-alerts.md.
Keycloak production prepare ACME sans ecraser le stockage, puis verifie HTTPS et OIDC avant l'application.
La preparation exige un hote POSIX, un email Let's Encrypt et DNS/ports 80/443 publics prets.
Le mode prod reconstruit la pile; la livraison canonique reste bash scripts/deploy.sh.
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
    const shellEnv = { ...process.env };
    let configurationEnv;
    let readline;
    const interaction = {
      interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
      ask: (question) => {
        readline ??= createInterface({
          input: process.stdin,
          output: process.stdout
        });
        return readline.question(question);
      }
    };
    try {
      options.environment = await chooseDockerEnvironment(options, interaction);
      configurationEnv = readDockerConfiguration({ env: shellEnv });
      options.authentication = await chooseDockerAuthentication(options, {
        ...interaction,
        env: configurationEnv
      });
    } finally {
      readline?.close();
    }
    const plan = dockerUpPlan(options, {
      env: configurationEnv,
      localTls:
        existsSync('traefik/certs/localhost.pem') &&
        existsSync('traefik/certs/localhost-key.pem')
    });
    if (
      plan.productionIdentity &&
      !options.dryRun &&
      process.platform === 'win32'
    )
      throw new Error(
        'La preparation ACME de production exige un hote POSIX (VPS Linux), pas Windows. Utiliser --dry-run ici puis executer sur la cible autorisee.'
      );
    console.log(
      `Environnement : ${plan.environment}. Conteneurs en arriere-plan.`
    );
    console.log(`Authentification : ${plan.authentication}.`);
    if (options.dryRun) {
      if (plan.localIdentity) {
        try {
          validateLocalIdentityCertificates(root);
        } catch {
          console.log(
            'node scripts/setup-local-tls.mjs --renew --no-restart (before Docker; no certificate or trust changes in dry-run)'
          );
        }
        console.log(
          'node scripts/prepare-local-identity.mjs (before Docker; no files written in dry-run)'
        );
        if (
          plan.commandEnv.FUNDING_KEYCLOAK_INITIAL_USER_USERNAME &&
          !plan.provisionUser
        )
          console.log(
            'Preparation du premier utilisateur local et de son UUID stable (aucun fichier ni volume inspecte en dry-run).'
          );
      }
      for (const args of plan.commands) {
        if (args === plan.identityUp && plan.productionIdentity)
          console.log(
            'Preparation du stockage ACME persistant (0600, hote POSIX; aucun fichier modifie en dry-run).'
          );
        console.log(`docker ${args.join(' ')}`);
        if (args === plan.identityUp && plan.productionIdentity)
          console.log(
            'Verification HTTPS publique et OIDC (issuer et JWKS; delai maximal 180s; aucun contact reseau en dry-run).'
          );
        if (args === plan.identityUp && plan.provisionUser)
          console.log(
            'Preparation du compte Keycloak et des subjects proprietaires avant l\u2019application (aucun compte modifie ni contact reseau en dry-run).'
          );
      }
      console.log(
        plan.stripeWebhook
          ? 'yarn stripe:webhook:listen (verification avant Docker, puis relais)'
          : 'Relais Stripe desactive.'
      );
    } else {
      const commandEnvironment = (plannedEnv) =>
        dockerCommandEnvironment(plannedEnv, configurationEnv, shellEnv);
      let localCaChanged = false;
      await prepareDockerLocalIdentity(plan, {
        checkCertificates: () => validateLocalIdentityCertificates(root),
        setupTls: async (env) => {
          const previousCa = readLocalCa();
          console.log(
            'Certificats HTTPS locaux absents ou invalides : preparation TLS avec mkcert, sans redemarrage.'
          );
          await runNode(
            ['scripts/setup-local-tls.mjs', '--renew', '--no-restart'],
            commandEnvironment(env)
          );
          localCaChanged = readLocalCa() !== previousCa;
        },
        prepareIdentity: async (env) => {
          prepareLocalIdentity({ root, env });
          // The volume probe needs the daemon. Retain Docker Desktop auto-start
          // without running a Compose mutation before the initial-user checks.
          if (env.FUNDING_KEYCLOAK_INITIAL_USER_USERNAME)
            await runNode(
              [
                'scripts/docker-ready.mjs',
                '--',
                process.execPath,
                '--eval',
                ''
              ],
              commandEnvironment(env)
            );
          if (prepareLocalInitialUser({ root, env }))
            console.log(
              'Import du premier utilisateur local prepare; changement de mot de passe et OTP requis a la connexion.'
            );
        }
      });
      if (localCaChanged) {
        // Node reads its extra CA at startup. Stop only the API after the build
        // succeeds; the existing final up restarts it with the updated trust.
        const up = plan.commands.at(-1);
        plan.commands.splice(-1, 0, [
          ...up.slice(0, up.indexOf('up')),
          'stop',
          'api'
        ]);
        console.log(
          'CA locale mise a jour : l\u2019API sera redemarree apres le build pour actualiser sa confiance TLS.'
        );
      }
      await startDockerStack(plan, {
        prepareKeycloakUser: async (env) => {
          const { provisionKeycloakUser } =
            await import('./lib/keycloak-provision-user.mjs');
          await provisionKeycloakUser({
            root,
            env,
            requireEnrollment: plan.productionIdentity && !plan.identityOnly
          });
          console.log('Compte Keycloak et subjects proprietaires verifies.');
        },
        prepareProductionTls: (env) => {
          console.log('Preparation du stockage ACME persistant pour Traefik.');
          return prepareProductionAcme(root, {
            inspectProtectedStorage: (storage) =>
              inspectProductionAcmeWithDocker({
                root,
                storage,
                composeArgs: plan.identityUp.slice(
                  0,
                  plan.identityUp.indexOf('up')
                ),
                env: commandEnvironment(env)
              })
          });
        },
        checkProductionIdentity: async (env) => {
          console.log('Verification HTTPS publique et OIDC de Keycloak...');
          await waitForProductionIdentity(env);
          console.log('HTTPS et discovery OIDC de Keycloak valides.');
        },
        runDocker: (args, env) =>
          runNode(
            ['scripts/docker-ready.mjs', '--', 'docker', ...args],
            commandEnvironment(env)
          ),
        checkStripe: () =>
          runNode(
            ['scripts/stripe-webhook-listen.mjs', '--check'],
            commandEnvironment(plan.commandEnv)
          ),
        listenStripe: () =>
          runNode(
            ['scripts/stripe-webhook-listen.mjs'],
            commandEnvironment(plan.commandEnv)
          )
      });
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
