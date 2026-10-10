#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { createCommandCatalog } from './lib/menu-catalog.mjs';
import {
  formatCatalog,
  parseMenuArgs,
  runMenu,
  runYarnCommand,
  searchCatalog
} from './lib/menu.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const help = `Usage: yarn menu [--help | --list [--search texte]]

Sans option : questionnaire interactif pour les commandes du projet.
--list : afficher le catalogue sans lancer de commande.
--search texte : filtrer le catalogue par nom, description ou catégorie.
--help : afficher cette aide.

Choisir un numéro; 0 revient au menu précédent ou quitte.
Les commandes existantes conservent leurs options et questionnaires.
Les arguments acceptent des guillemets, sans expansion de variables ou de shell.
Les commandes sensibles exigent "executer <nom-script>"; Entrée annule.
Docker avec suppression de volumes exige "supprimer volumes docker:down".
Ne saisir aucun secret : utiliser la configuration prévue par les scripts.
Ctrl+C quitte le menu ou interrompt la commande active.
Les conteneurs Docker restent actifs après l’arrêt du relais Stripe.
`;

// A fresh interface for each question releases stdin before a child uses it.
const ask = (question) =>
  new Promise((resolveAnswer, reject) => {
    const readline = createInterface({
      input: process.stdin,
      output: process.stdout
    });
    let answered = false;
    const finish = (answer) => {
      if (answered) return;
      answered = true;
      readline.close();
      process.stdin.pause();
      resolveAnswer(answer);
    };
    readline.once('close', () => finish(null));
    readline.once('SIGINT', () => {
      process.exitCode = 130;
      finish(null);
    });
    readline.question(question).then(finish, (error) => {
      if (error.code === 'ERR_USE_AFTER_CLOSE' || error.name === 'AbortError')
        finish(null);
      else reject(error);
    });
  });

try {
  const options = parseMenuArgs(process.argv.slice(2));
  if (options.help) console.log(help);
  else {
    const { scripts } = JSON.parse(
      readFileSync(resolve(root, 'package.json'), 'utf8')
    );
    const catalog = createCommandCatalog(scripts);
    if (options.list)
      console.log(formatCatalog(searchCatalog(catalog, options.search)));
    else {
      if (!process.stdin.isTTY || !process.stdout.isTTY)
        throw new Error(
          'Le questionnaire exige un terminal interactif. Utiliser yarn menu --list ou --help.'
        );
      const code = await runMenu({
        catalog,
        ask,
        write: (message) => console.log(message),
        run: (name, args) => runYarnCommand(name, args, { root })
      });
      process.exitCode ||= code;
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
