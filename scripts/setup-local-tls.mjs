#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { env, exit, platform } from 'node:process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJsonPath = join(repositoryRoot, 'package.json');
const certificateDirectory = join(repositoryRoot, 'traefik', 'certs');
const certificatePath = join(certificateDirectory, 'localhost.pem');
const keyPath = join(certificateDirectory, 'localhost-key.pem');

const usage = `Usage: yarn tls:local:setup [--renew] [--no-restart]

Installe mkcert avec winget sous Windows lorsqu'il est absent, approuve son
autorite locale, genere un certificat pour localhost, 127.0.0.1 et ::1, puis
redemarre Traefik avec la surcharge Docker locale.

Options:
  --renew       Regenerer le certificat localhost existant.
  --no-restart  Generer le certificat sans redemarrer Traefik.
  --help        Afficher cette aide.
`;

const args = process.argv.slice(2);
const allowedArgs = new Set(['--renew', '--no-restart', '--help']);
const unknownArg = args.find((arg) => !allowedArgs.has(arg));

if (unknownArg) {
  console.error(`Argument inconnu: ${unknownArg}`);
  console.error(usage.trim());
  exit(1);
}

if (args.includes('--help')) {
  console.log(usage.trim());
  exit(0);
}

const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
if (packageJson.name !== 'openg7-funding-platform') {
  throw new Error('La racine du depot OpenG7 est introuvable.');
}

const run = (command, commandArgs, options = {}) => {
  const result = spawnSync(command, commandArgs, {
    cwd: repositoryRoot,
    stdio: options.quiet ? 'ignore' : 'inherit',
    shell: false,
    windowsHide: true
  });

  if (result.error || result.status !== 0) {
    if (options.allowFailure) {
      return false;
    }
    throw result.error ?? new Error(`${command} a echoue (${result.status}).`);
  }

  return true;
};

const getWinGetPackageCandidates = () => {
  if (platform !== 'win32' || !env.LOCALAPPDATA) {
    return [];
  }

  const packagesDirectory = join(
    env.LOCALAPPDATA,
    'Microsoft',
    'WinGet',
    'Packages'
  );
  if (!existsSync(packagesDirectory)) {
    return [];
  }

  return readdirSync(packagesDirectory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && entry.name.startsWith('FiloSottile.mkcert_')
    )
    .map((entry) => join(packagesDirectory, entry.name, 'mkcert.exe'));
};

const getMkcertCandidates = () =>
  [
    platform === 'win32' ? 'mkcert.exe' : 'mkcert',
    platform === 'win32' && env.LOCALAPPDATA
      ? join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'mkcert.exe')
      : null,
    ...getWinGetPackageCandidates()
  ].filter(Boolean);

const findMkcert = () =>
  getMkcertCandidates().find((candidate) =>
    run(candidate, ['-version'], { allowFailure: true, quiet: true })
  );

let mkcert = findMkcert();
if (!mkcert && platform === 'win32') {
  console.log('mkcert est absent. Installation avec winget...');
  run('winget.exe', [
    'install',
    '--id',
    'FiloSottile.mkcert',
    '--exact',
    '--accept-package-agreements',
    '--accept-source-agreements'
  ]);
  mkcert = findMkcert();
}

if (!mkcert) {
  const guidance =
    platform === 'win32'
      ? 'Ferme et rouvre le terminal, puis relance yarn tls:local:setup.'
      : 'Installe mkcert avec le gestionnaire de paquets du systeme, puis relance cette commande.';
  throw new Error(`mkcert est introuvable. ${guidance}`);
}

console.log("Installation de l'autorite locale de confiance mkcert...");
if (platform === 'win32') {
  console.log(
    "Accepte la fenetre de securite Windows pour approuver l'autorite locale."
  );
}
run(mkcert, ['-install']);

mkdirSync(certificateDirectory, { recursive: true });
const renew = args.includes('--renew');
const certificatePairExists =
  existsSync(certificatePath) && existsSync(keyPath);

if (renew || !certificatePairExists) {
  rmSync(certificatePath, { force: true });
  rmSync(keyPath, { force: true });
  console.log('Generation du certificat HTTPS local...');
  run(mkcert, [
    '-cert-file',
    certificatePath,
    '-key-file',
    keyPath,
    'localhost',
    '127.0.0.1',
    '::1'
  ]);
} else {
  console.log('Le certificat HTTPS local existe deja; il est conserve.');
}

if (!args.includes('--no-restart')) {
  console.log('Redemarrage de Traefik avec le certificat local...');
  run(process.execPath, [
    join(repositoryRoot, 'scripts', 'docker-ready.mjs'),
    '--',
    'docker',
    'compose',
    '-f',
    'docker-compose.yml',
    '-f',
    'docker-compose.local-tls.yml',
    'up',
    '-d',
    '--force-recreate',
    'traefik'
  ]);
}

console.log('HTTPS local configure: https://localhost');
console.log(
  'Ferme et rouvre Firefox pour actualiser son magasin de confiance.'
);
