#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import { readDockerConfiguration } from './lib/docker-environment.mjs';
import {
  executeKeycloakPasswordReset,
  inspectKeycloakPasswordResetTarget,
  keycloakPasswordResetPlan,
  parseKeycloakPasswordResetArgs
} from './lib/keycloak-password-reset.mjs';

const help = `Usage: yarn keycloak:reset-password [--username NAME] [--admin-user NAME] [--dry-run] [--help]

Réinitialise uniquement un utilisateur du realm openg7 local (development, auth.openg7.test).
Noms par défaut : FUNDING_KEYCLOAK_INITIAL_USER_USERNAME et FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME dans .env/shell.
Le compte master doit être compatible avec l'authentification admin-cli par mot de passe.
Un administrateur exigeant OTP utilise la console Keycloak avec MFA.
Confirmation interactive, puis saisies masquées : nouveau mot de passe utilisateur, mot de passe admin.
Le nouveau mot de passe est temporaire ; UUID et OTP sont conservés.
--dry-run vérifie la configuration et la CA sans contacter le daemon ni créer de fichier.
Aucun mot de passe en argument, aucun secret repris depuis .env, aucun token sauvegardé.
`;

try {
  const options = parseKeycloakPasswordResetArgs(process.argv.slice(2));
  if (options.help) console.log(help);
  else {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const shellEnv = { ...process.env };
    const env = readDockerConfiguration({ cwd: root, env: shellEnv });
    const plan = keycloakPasswordResetPlan({ root, env, options });
    console.log(
      `Réinitialisation temporaire : openg7/${plan.username} sur https://auth.openg7.test ; administrateur master : ${plan.adminUser}.`
    );
    if (options.dryRun)
      console.log(
        'Plan vérifié. Aucun daemon contacté, aucun fichier créé, aucun mot de passe changé.'
      );
    else {
      if (!process.stdin.isTTY || !process.stdout.isTTY)
        throw new Error(
          'Un terminal interactif est requis. Utiliser --dry-run pour vérifier le plan.'
        );
      const commandEnv = { ...shellEnv };
      if (env.COMPOSE_PROJECT_NAME !== undefined)
        commandEnv.COMPOSE_PROJECT_NAME = env.COMPOSE_PROJECT_NAME;
      const target = inspectKeycloakPasswordResetTarget({
        root,
        env: commandEnv,
        plan
      });
      console.log(
        `Cible locale : projet ${target.project}, daemon ${target.daemonId}, conteneur ${target.containerId.slice(0, 12)}.`
      );
      const readline = createInterface({
        input: process.stdin,
        output: process.stdout
      });
      let answer;
      try {
        answer = await readline.question(
          `Saisir "${plan.username}" pour confirmer (Entrée : annuler) : `
        );
      } finally {
        readline.close();
      }
      if (answer !== plan.username) console.log('Réinitialisation annulée.');
      else {
        console.log(
          'Invites Keycloak : 1) nouveau mot de passe utilisateur (14 caractères minimum) ; 2) mot de passe administrateur.'
        );
        const result = executeKeycloakPasswordReset({
          root,
          plan,
          target,
          confirmed: true
        });
        console.log(
          `Mot de passe temporaire réinitialisé. Corrélation : ${result.correlation}. Audit : ${result.auditPath}.`
        );
      }
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
