#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { env, exit } from 'node:process';

const defaultConfig = {
  VPS_HOST: 'vps-8db0cb49.vps.ovh.ca',
  VPS_USER: 'ubuntu',
  VPS_PORT: '22',
  VPS_APP_DIR: '/opt/openg7-funding-platform',
  VPS_BACKUP_DOWNLOAD_DIR: 'backups/vps'
};

const parseDotEnv = (path) => {
  if (!existsSync(path)) {
    return {};
  }

  const values = {};
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);

  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    let value = rawValue.trim();
    const isDoubleQuoted = value.startsWith('"') && value.endsWith('"');
    const isSingleQuoted = value.startsWith("'") && value.endsWith("'");

    if (isDoubleQuoted || isSingleQuoted) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
};

const dotEnv = parseDotEnv('.env');
const configValue = (key) => env[key] ?? dotEnv[key] ?? defaultConfig[key];
const shellQuote = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;
const localPath = (...parts) => parts.join('/').replace(/\\/g, '/');
const timestamp = () =>
  new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');

const vpsHost = configValue('VPS_HOST');
const vpsUser = configValue('VPS_USER');
const vpsPort = configValue('VPS_PORT');
const vpsAppDir = configValue('VPS_APP_DIR');
const backupDownloadDir = configValue('VPS_BACKUP_DOWNLOAD_DIR');

const run = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit'
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${command} stopped with signal ${signal}.`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`${command} exited with code ${code ?? 1}.`));
        return;
      }

      resolve();
    });
  });

const commandSucceeds = (command, args) =>
  new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: 'ignore'
    });

    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });

const ssh = (remoteCommand) =>
  run('ssh', ['-t', '-p', vpsPort, `${vpsUser}@${vpsHost}`, remoteCommand]);

const scpFromVps = (remotePath, localPath) =>
  run('scp', ['-P', vpsPort, `${vpsUser}@${vpsHost}:${remotePath}`, localPath]);

const remoteFileExists = (remotePath) =>
  commandSucceeds('ssh', [
    '-p',
    vpsPort,
    `${vpsUser}@${vpsHost}`,
    `test -f ${shellQuote(remotePath)}`
  ]);

const inAppDir = (commands) =>
  [`cd ${shellQuote(vpsAppDir)}`, ...commands].join(' && ');

const deployCommand = (args) =>
  `bash scripts/deploy.sh${args.length > 0 ? ` ${args.map(shellQuote).join(' ')}` : ''}`;
const usesLocalBuild = (args) => !args.includes('--no-build');
const ensureNodeToolchainCommand = [
  'set -e',
  'if ! command -v node >/dev/null 2>&1; then command -v curl >/dev/null 2>&1 || (sudo apt-get update && sudo apt-get install -y ca-certificates curl gnupg); curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -; sudo apt-get install -y nodejs; fi',
  'if ! command -v corepack >/dev/null 2>&1; then sudo npm install -g corepack; fi',
  'sudo corepack enable',
  'node --version',
  'corepack --version'
].join(' && ');

const printConnectionInfo = () => {
  console.log(`Connexion SSH vers ${vpsUser}@${vpsHost}:${vpsPort}.`);
  console.log(
    "Si aucune cle SSH n'est configuree, SSH demandera le mot de passe du VPS."
  );
  console.log(`Dossier projet distant: ${vpsAppDir}`);
};

const ensureBackupDownloadDir = () => {
  mkdirSync(backupDownloadDir, {
    recursive: true
  });
};

const prepareLatestConfigBackup = () =>
  inAppDir([
    'bash scripts/backup.sh',
    'latest="$(ls -t backups/openg7-backup-*.tar.gz 2>/dev/null | head -n 1)"',
    'if [ -z "$latest" ]; then echo "No configuration backup was created." >&2; exit 1; fi',
    'cp "$latest" backups/latest-config-backup.tar.gz',
    'chmod 600 backups/latest-config-backup.tar.gz',
    'logo_latest="$(ls -t backups/openg7-sponsor-logos-*.tar.gz 2>/dev/null | head -n 1 || true)"',
    'if [ -n "$logo_latest" ]; then cp "$logo_latest" backups/latest-sponsor-logos-backup.tar.gz && chmod 600 backups/latest-sponsor-logos-backup.tar.gz; fi'
  ]);

const prepareLatestDatabaseBackup = () =>
  inAppDir([
    'bash scripts/backup.sh',
    'latest="$(ls -t backups/openg7-funding-db-*.sql 2>/dev/null | head -n 1)"',
    'if [ -z "$latest" ]; then echo "No database backup was created. Is DATABASE_URL configured and postgres running?" >&2; exit 1; fi',
    'cp "$latest" backups/latest-db-backup.sql',
    'chmod 600 backups/latest-db-backup.sql'
  ]);

const listBackupFiles = (filters, emptyMessage) =>
  inAppDir([
    `backups="$(find backups -maxdepth 1 -type f ${filters} -printf '%T@ %TY-%Tm-%Td %TH:%TM %10s %p\\n' 2>/dev/null | sort -rn | cut -d' ' -f2-)"`,
    `if [ -z "$backups" ]; then echo ${shellQuote(emptyMessage)}; else printf '%s\\n' "$backups"; fi`
  ]);

const listBackups = () =>
  listBackupFiles(
    "\\( -name 'openg7-backup-*.tar.gz' -o -name 'openg7-funding-db-*.sql' -o -name 'openg7-sponsor-logos-*.tar.gz' \\)",
    'No backups found in backups/.'
  );

const listDatabaseBackups = () =>
  listBackupFiles(
    "-name 'openg7-funding-db-*.sql'",
    'No database backups found in backups/.'
  );

const help = `Usage:
  yarn vps:ssh
  yarn vps:env
  yarn vps:node:install
  yarn vps:update [--no-build]
  yarn vps:deploy [--no-build]
  yarn vps:rollback
  yarn vps:check
  yarn vps:logs [service]
  yarn vps:ps
  yarn vps:backup
  yarn vps:backup:list
  yarn vps:backup:download
  yarn vps:db:update
  yarn vps:db:migrate
  yarn vps:db:psql
  yarn vps:db:backup
  yarn vps:db:backup:list
  yarn vps:db:backup:download

Config:
  VPS_HOST, VPS_USER, VPS_PORT, VPS_APP_DIR and VPS_BACKUP_DOWNLOAD_DIR
  can be set in the shell or in .env. VPS_HOST is required.`;

const command = process.argv[2] ?? 'help';
const args = process.argv.slice(3);

try {
  if (command === 'help' || command === '--help' || command === '-h') {
    console.log(help);
    exit(0);
  }

  if (!vpsHost) {
    console.error(
      'VPS_HOST is required. Add it to .env or export it in the shell.'
    );
    exit(1);
  }

  printConnectionInfo();

  if (command === 'ssh') {
    await ssh(inAppDir(['exec bash']));
  } else if (command === 'env') {
    await ssh(
      inAppDir([
        'test -f .env || cp .env.example .env',
        'chmod 600 .env',
        'editor="${EDITOR:-nano}"; if command -v "$editor" >/dev/null 2>&1; then "$editor" .env; else vi .env; fi'
      ])
    );
  } else if (command === 'node:install') {
    await ssh(ensureNodeToolchainCommand);
  } else if (command === 'update') {
    await ssh(
      inAppDir([
        'git pull --ff-only',
        ...(usesLocalBuild(args) ? [ensureNodeToolchainCommand] : []),
        deployCommand(args)
      ])
    );
  } else if (command === 'deploy') {
    await ssh(
      inAppDir([
        ...(usesLocalBuild(args) ? [ensureNodeToolchainCommand] : []),
        deployCommand(args)
      ])
    );
  } else if (command === 'rollback') {
    await ssh(inAppDir(['bash scripts/rollback.sh']));
  } else if (command === 'check') {
    await ssh(inAppDir(['bash scripts/check.sh']));
  } else if (command === 'logs') {
    const logArgs = args.length > 0 ? ` ${args.map(shellQuote).join(' ')}` : '';
    await ssh(inAppDir([`docker compose logs -f --tail=100${logArgs}`]));
  } else if (command === 'ps') {
    await ssh(inAppDir(['docker compose ps']));
  } else if (command === 'backup') {
    await ssh(inAppDir(['bash scripts/backup.sh']));
  } else if (command === 'backup:list') {
    await ssh(listBackups());
  } else if (command === 'backup:download') {
    ensureBackupDownloadDir();
    await ssh(prepareLatestConfigBackup());
    const downloadPath = localPath(
      backupDownloadDir,
      `openg7-config-backup-vps-${timestamp()}.tar.gz`
    );
    await scpFromVps(
      `${vpsAppDir}/backups/latest-config-backup.tar.gz`,
      downloadPath
    );
    console.log(`Backup configuration telecharge: ${downloadPath}`);

    const remoteLogoBackup = `${vpsAppDir}/backups/latest-sponsor-logos-backup.tar.gz`;
    if (await remoteFileExists(remoteLogoBackup)) {
      const logoDownloadPath = localPath(
        backupDownloadDir,
        `openg7-sponsor-logos-backup-vps-${timestamp()}.tar.gz`
      );
      await scpFromVps(remoteLogoBackup, logoDownloadPath);
      console.log(
        `Backup logos commanditaires telecharge: ${logoDownloadPath}`
      );
    }
  } else if (command === 'db:update' || command === 'db:migrate') {
    await ssh(inAppDir(['git pull --ff-only', 'bash scripts/db-migrate.sh']));
  } else if (command === 'db:psql') {
    const psqlArgs =
      args.length > 0 ? ` ${args.map(shellQuote).join(' ')}` : '';
    await ssh(inAppDir([`bash scripts/db-psql.sh${psqlArgs}`]));
  } else if (command === 'db:backup') {
    await ssh(prepareLatestDatabaseBackup());
  } else if (command === 'db:backup:list') {
    await ssh(listDatabaseBackups());
  } else if (command === 'db:backup:download') {
    ensureBackupDownloadDir();
    await ssh(prepareLatestDatabaseBackup());
    const downloadPath = localPath(
      backupDownloadDir,
      `openg7-db-backup-vps-${timestamp()}.sql`
    );
    await scpFromVps(`${vpsAppDir}/backups/latest-db-backup.sql`, downloadPath);
    console.log(`Backup PostgreSQL telecharge: ${downloadPath}`);
  } else {
    console.error(`Commande VPS inconnue: ${command}`);
    console.error(help);
    exit(1);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
}
