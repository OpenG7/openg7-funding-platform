import { spawn } from 'node:child_process';
import { posix, win32 } from 'node:path';
import { MENU_CATEGORIES } from './menu-catalog.mjs';

export function parseMenuArgs(args) {
  const options = { help: false, list: false, search: '' };
  let searchProvided = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help' || args[i] === '-h') options.help = true;
    else if (args[i] === '--list') options.list = true;
    else if (
      args[i] === '--search' &&
      args[i + 1] !== undefined &&
      !args[i + 1].startsWith('--')
    ) {
      searchProvided = true;
      options.search = args[++i];
    } else
      throw new Error(
        'Option inconnue ou incomplete. Consulter yarn menu --help.'
      );
  }
  if (searchProvided && !options.list)
    throw new Error('--search exige --list.');
  return options;
}

// Only grouping/escaping is supported: no environment or shell expansion.
export function parseCommandArguments(input) {
  if (/[\u0000-\u001f\u007f]/u.test(input))
    throw new Error(
      'Les arguments doivent tenir sur une ligne sans caracteres de controle.'
    );
  const args = [];
  let argument = '';
  let quote = null;
  let started = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const next = input[i + 1];
    if (
      quote === '"' &&
      char === '\\' &&
      next === '\\' &&
      input[i + 2] === '"'
    ) {
      argument += '\\';
      i++;
    } else if (
      char === '\\' &&
      quote !== "'" &&
      next !== undefined &&
      (next === '"' || (!quote && (next === "'" || next === ' ')))
    ) {
      argument += next;
      started = true;
      i++;
    } else if (quote) {
      if (char === quote) quote = null;
      else argument += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (char === ' ') {
      if (started) args.push(argument);
      argument = '';
      started = false;
    } else {
      argument += char;
      started = true;
    }
  }
  if (quote) throw new Error('Guillemet non ferme dans les arguments.');
  if (started) args.push(argument);
  return args;
}

export function createYarnInvocation(
  name,
  args,
  {
    env = process.env,
    execPath = process.execPath,
    platform = process.platform
  } = {}
) {
  const yarnPath = env.npm_execpath;
  if (
    yarnPath &&
    /(?:^|[\\/])yarn(?:-[^\\/]*)?\.(?:js|cjs|mjs)$/iu.test(yarnPath)
  )
    return { command: execPath, args: [yarnPath, 'run', name, ...args] };
  if (env.COREPACK_ROOT) {
    const path = platform === 'win32' ? win32 : posix;
    return {
      command: execPath,
      args: [
        path.join(env.COREPACK_ROOT, 'dist', 'yarn.js'),
        'run',
        name,
        ...args
      ]
    };
  }
  if (platform === 'win32')
    throw new Error(
      'Lancer le menu avec yarn menu dans un terminal configure pour Yarn 4/Corepack.'
    );
  return { command: 'yarn', args: ['run', name, ...args] };
}

export function runYarnCommand(
  name,
  args,
  {
    root,
    env = process.env,
    execPath = process.execPath,
    platform = process.platform,
    spawnProcess = spawn,
    signalSource = process
  }
) {
  const invocation = createYarnInvocation(name, args, {
    env,
    execPath,
    platform
  });
  return new Promise((resolve, reject) => {
    const launchError = () =>
      new Error(
        'Impossible de lancer Yarn. Verifier son installation et relancer yarn menu.'
      );
    let child;
    try {
      child = spawnProcess(invocation.command, invocation.args, {
        cwd: root,
        env,
        stdio: 'inherit',
        shell: false,
        windowsHide: true
      });
    } catch {
      reject(launchError());
      return;
    }
    let interruption = null;
    // The child shares our foreground console and receives Ctrl+C itself.
    const interrupt = () => {
      interruption = 'SIGINT';
    };
    const terminate = () => {
      interruption = 'SIGTERM';
      try {
        child.kill('SIGTERM');
      } catch {
        /* The child may already have exited. */
      }
    };
    const cleanup = () => {
      signalSource.off('SIGINT', interrupt);
      signalSource.off('SIGTERM', terminate);
    };
    signalSource.on('SIGINT', interrupt);
    signalSource.on('SIGTERM', terminate);
    child.once('error', () => {
      cleanup();
      reject(launchError());
    });
    child.once('close', (code, signal) => {
      cleanup();
      const interruptedBy = interruption || signal || null;
      resolve({
        code:
          interruptedBy === 'SIGINT'
            ? 130
            : interruptedBy === 'SIGTERM'
              ? 143
              : (code ?? 1),
        signal: interruptedBy
      });
    });
  });
}

const normalizeSearch = (value) =>
  value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export function searchCatalog(catalog, query = '') {
  const terms = normalizeSearch(query).trim().split(/\s+/u).filter(Boolean);
  return catalog.filter((command) => {
    const category =
      MENU_CATEGORIES.find(({ id }) => id === command.category)?.label || '';
    const haystack = normalizeSearch(
      `${command.name} ${command.label} ${category}`
    );
    return terms.every((term) => haystack.includes(term));
  });
}

export function formatCatalog(catalog) {
  return catalog
    .map(
      (command) =>
        `yarn ${command.name} — ${command.label}${command.confirmation ? ' [confirmation]' : ''}`
    )
    .join('\n');
}

const displayArgument = (value) =>
  /^[\w:./=-]+$/u.test(value) ? value : JSON.stringify(value);

const containsSecret = (args, name) =>
  args.some((value) => {
    const objectKeyOption =
      name === 'storage:publish'
        ? /^--(?:source|target)-key$/u.test(value)
        : name === 'storage:unpublish' && /^--(?:key|target-key)$/u.test(value);
    return (
      (!objectKeyOption &&
        /^--?(?:[\w-]*[-_])?(?:secret|password|token|key|api[-_]?key|authorization|credentials?)(?:=|$)/iu.test(
          value
        )) ||
      /(?:sk|rk)_(?:live|test)_\w+|whsec_\w+/u.test(value) ||
      /[a-z][a-z0-9+.-]*:\/\/[^\s/]*@/iu.test(value) ||
      /[?&](?:secret|password|token|access_token|api_key)=/iu.test(value)
    );
  });

const removesDockerVolumes = (args) => {
  let removesVolumes = false;
  const valueOptions = new Set([
    '--timeout',
    '--rmi',
    '--file',
    '--project-name',
    '--profile',
    '--project-directory',
    '--workdir',
    '--env-file',
    '--ansi',
    '--progress',
    '--parallel'
  ]);
  const enabled = (value) =>
    !['false', 'f', '0'].includes(value?.toLowerCase());
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--') break;
    const [option, value] = argument.split('=');
    if (option === '--volumes' || option === '--volume') {
      removesVolumes = enabled(value);
    } else if (valueOptions.has(option) && value === undefined) {
      index++;
    } else if (/^-[^-]/u.test(argument)) {
      // A boolean shorthand may precede another flag: -vt=0 enables volumes
      // and sets the timeout. Values of -t/-f/-p are not volume options.
      for (let offset = 1; offset < argument.length; offset++) {
        const shorthand = argument[offset];
        if (shorthand === 'v') {
          if (argument[offset + 1] === '=') {
            removesVolumes = enabled(argument.slice(offset + 2));
            break;
          }
          removesVolumes = true;
        } else if ('tfp'.includes(shorthand)) {
          if (offset === argument.length - 1) index++;
          break;
        } else if (shorthand !== 'h') break;
      }
    }
  }
  return removesVolumes;
};

export async function runMenu({ catalog, ask, write, run }) {
  let exitCode = 0;
  let ended = false;
  const choose = async (title, entries, backLabel = 'Retour') => {
    write(`\n${title}`);
    entries.forEach((entry, index) => write(`  ${index + 1}. ${entry.label}`));
    write(`  0. ${backLabel}`);
    for (;;) {
      const answer = await ask('Votre choix : ');
      if (answer === null) {
        ended = true;
        return null;
      }
      const value = answer.trim();
      if (value === '0') return null;
      if (/^[1-9]\d*$/u.test(value) && Number(value) <= entries.length)
        return entries[Number(value) - 1];
      write('Choisir un numéro de la liste.');
    }
  };

  const launch = async (command) => {
    write(`\n${command.label}`);
    const rawArgs = await ask(
      'Arguments supplémentaires (Entrée : aucun; sans secret) : '
    );
    if (rawArgs === null) {
      ended = true;
      return;
    }
    let args;
    try {
      args = parseCommandArguments(rawArgs);
    } catch (error) {
      write(error.message);
      return;
    }
    if (containsSecret(args, command.name)) {
      write(
        'Argument privé refusé. Utiliser la configuration prévue par le script pour les secrets.'
      );
      return;
    }
    const deletesVolumes =
      command.name === 'docker:down' && removesDockerVolumes(args);
    if (deletesVolumes) {
      write(
        'Suppression des volumes Compose demandée, dont les données PostgreSQL et les médias. Vérifier la cible et une sauvegarde avant de continuer.'
      );
    } else if (command.note) write(command.note);
    write(
      `\n> yarn ${command.name}${args.length ? ` ${args.map(displayArgument).join(' ')}` : ''}`
    );
    const customArguments =
      args.length > 0 && !(args.length === 1 && args[0] === '--help');
    if (command.confirmation || customArguments || deletesVolumes) {
      write(
        'Vérifier la cible configurée, les effets et les préconditions du guide concerné avant exécution.'
      );
      const expected = deletesVolumes
        ? `supprimer volumes ${command.name}`
        : `executer ${command.name}`;
      const answer = await ask(
        `Saisir "${expected}" pour confirmer (Entrée : annuler) : `
      );
      if (answer === null) {
        ended = true;
        return;
      }
      if (answer.trim() !== expected) {
        write('Commande annulée.');
        return;
      }
    }
    if (command.continuous)
      write('Cette commande garde le terminal. Ctrl+C l’interrompt.');
    try {
      const result = await run(command.name, args);
      if (result.code !== 0) {
        exitCode = result.code;
        if (result.signal === 'SIGTERM') ended = true;
        write(
          result.signal
            ? `Commande interrompue (${result.signal}).`
            : `Commande en échec (code ${result.code}).`
        );
      } else write('Commande terminée.');
    } catch {
      exitCode = 1;
      write(
        'Impossible de lancer la commande. Vérifier Yarn et les prérequis.'
      );
    }
  };

  const commands = async (title, selectedCommands) => {
    const entries = selectedCommands.map((command) => ({
      command,
      label: `${command.label} [${command.name}]${command.confirmation ? ' — confirmation' : ''}`
    }));
    if (!entries.length) {
      write('Aucune commande correspondante.');
      return;
    }
    while (!ended) {
      const selected = await choose(title, entries);
      if (!selected) return;
      await launch(selected.command);
    }
  };

  const actions = [
    { label: 'Démarrer le développement', category: 'development' },
    { label: 'Gérer Docker', category: 'docker' },
    { label: 'Vérifier le projet', category: 'checks' },
    { label: 'Utiliser les outils', tools: true },
    { label: 'Production, VPS et stockage', category: 'advanced' },
    { label: 'Toutes les commandes / recherche', search: true }
  ];
  while (!ended) {
    const action = await choose(
      'OpenG7 — Que voulez-vous faire ?',
      actions,
      'Quitter'
    );
    if (!action) break;
    if (action.tools) {
      const tools = MENU_CATEGORIES.filter(({ id }) =>
        [
          'database',
          'stripe',
          'email',
          'tls',
          'docs',
          'images',
          'other'
        ].includes(id)
      );
      while (!ended) {
        const category = await choose('Quel outil ?', tools);
        if (!category) break;
        await commands(
          category.label,
          catalog.filter(({ category: id }) => id === category.id)
        );
      }
    } else if (action.search) {
      const query = await ask('Rechercher une commande (Entrée : toutes) : ');
      if (query === null) break;
      await commands('Catalogue des commandes', searchCatalog(catalog, query));
    } else {
      await commands(
        action.label,
        catalog.filter(({ category }) => category === action.category)
      );
    }
  }
  return exitCode;
}
