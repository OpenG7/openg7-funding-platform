#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { env, exit, platform } from 'node:process';

const rawArgs = process.argv.slice(2);
const separatorIndex = rawArgs.indexOf('--');
const commandArgs =
  separatorIndex >= 0 ? rawArgs.slice(separatorIndex + 1) : rawArgs;

const timeoutMs = Number(env.DOCKER_READY_TIMEOUT_MS ?? 180000);
const pollMs = Number(env.DOCKER_READY_POLL_MS ?? 5000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const runSync = (command, args) =>
  spawnSync(command, args, {
    stdio: 'ignore',
    timeout: 10000
  });

const commandExists = (command) => {
  if (platform === 'win32') {
    return runSync('where', [command]).status === 0;
  }

  return runSync('sh', ['-c', `command -v ${command}`]).status === 0;
};

const dockerIsReady = () => runSync('docker', ['info']).status === 0;

const startDetached = (command, args = []) => {
  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
};

const startDockerDesktop = () => {
  if (env.DOCKER_DESKTOP_PATH) {
    return startDetached(env.DOCKER_DESKTOP_PATH);
  }

  if (platform === 'win32') {
    const candidates = [
      env.ProgramFiles
        ? `${env.ProgramFiles}\\Docker\\Docker\\Docker Desktop.exe`
        : null,
      env.ProgramW6432
        ? `${env.ProgramW6432}\\Docker\\Docker\\Docker Desktop.exe`
        : null,
      env.LOCALAPPDATA
        ? `${env.LOCALAPPDATA}\\Docker\\Docker Desktop.exe`
        : null
    ].filter(Boolean);

    const dockerDesktop = candidates.find((candidate) => existsSync(candidate));
    if (!dockerDesktop) {
      return false;
    }

    return startDetached(dockerDesktop);
  }

  if (platform === 'darwin') {
    return startDetached('open', ['-a', 'Docker']);
  }

  if (platform === 'linux' && commandExists('systemctl')) {
    const desktop = spawnSync('systemctl', ['--user', 'start', 'docker-desktop']);
    if (desktop.status === 0) {
      return true;
    }

    const docker = spawnSync('systemctl', ['start', 'docker']);
    return docker.status === 0;
  }

  return false;
};

const waitForDocker = async () => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (dockerIsReady()) {
      console.log('Docker est pret.');
      return;
    }

    const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
    console.log(
      `Patientez pendant l'ouverture de Docker... ${elapsedSeconds}s`
    );
    await sleep(pollMs);
  }

  throw new Error(
    "Docker n'est toujours pas pret. Ouvre Docker Desktop, attends qu'il soit demarre, puis relance la commande."
  );
};

const runCommand = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: false
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${command} stopped with signal ${signal}.`));
        return;
      }

      resolve(code ?? 1);
    });
  });

if (commandArgs.length === 0) {
  console.error('Usage: node scripts/docker-ready.mjs -- <command> [args...]');
  exit(1);
}

if (!commandExists('docker')) {
  console.error('Docker CLI est introuvable dans le PATH.');
  console.error('Installe Docker Desktop ou verifie ton installation Docker.');
  exit(1);
}

if (!dockerIsReady()) {
  console.log("Docker n'est pas encore pret.");

  if (startDockerDesktop()) {
    console.log('Ouverture de Docker Desktop...');
  } else {
    console.log(
      "Je n'ai pas trouve Docker Desktop automatiquement. Ouvre-le manuellement si necessaire."
    );
  }

  await waitForDocker();
}

const exitCode = await runCommand(commandArgs[0], commandArgs.slice(1));
exit(exitCode);
