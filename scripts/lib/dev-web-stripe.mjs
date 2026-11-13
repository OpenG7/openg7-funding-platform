import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { stripVTControlCharacters } from 'node:util';

import { redactStripeOutput } from './stripe-cli.mjs';

/** Own only the listener started by this Web gateway; never discover or stop other relays. */
export function startDevWebStripe({
  root,
  env,
  readyTimeoutMs = 90000,
  stopTimeoutMs = 5000,
  executable = process.execPath,
  scriptPath = join(root, 'scripts/stripe-webhook-listen.mjs'),
  spawnProcess = spawn,
  platform = process.platform,
  write = console.log,
  killWindowsTree = (pid) =>
    spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: stopTimeoutMs
    }),
  signalPosixGroup = (pid, signal) => process.kill(-pid, signal)
}) {
  if (
    !Number.isFinite(readyTimeoutMs) ||
    readyTimeoutMs <= 0 ||
    !Number.isFinite(stopTimeoutMs) ||
    stopTimeoutMs <= 0
  )
    throw new Error('Invalid Web Stripe listener lifecycle options.');
  let resolveReady;
  let rejectReady;
  let resolveClosed;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // Startup may fail while Angular is still compiling. The caller can await the
  // original rejected promise later without an unhandled rejection meanwhile.
  ready.catch(() => {});
  const closed = new Promise((resolve) => {
    resolveClosed = resolve;
  });
  let readinessSettled = false;
  let hasClosed = false;
  let stopPromise;
  let child;
  let timer;
  const streams = [];
  const failReady = (message) => {
    if (readinessSettled) return;
    readinessSettled = true;
    rejectReady(new Error(message));
  };
  const finish = (code, signal) => {
    if (hasClosed) return;
    hasClosed = true;
    clearTimeout(timer);
    failReady(
      'Le relais Stripe a termine avant de confirmer sa disponibilite.'
    );
    for (const stream of streams) stream.close();
    resolveClosed({ code, signal });
  };
  const waitClosed = (timeoutMs) =>
    new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(false), timeoutMs);
      closed.then(() => {
        clearTimeout(timeout);
        resolve(true);
      });
    });
  const stopOwned = (signal) => {
    if (
      hasClosed ||
      !child?.pid ||
      child.exitCode !== null ||
      child.signalCode !== null
    )
      return;
    if (platform === 'win32') killWindowsTree(child.pid);
    else {
      try {
        signalPosixGroup(child.pid, signal);
      } catch {
        child.kill(signal);
      }
    }
  };
  function stop() {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      if (hasClosed) return;
      clearTimeout(timer);
      failReady('Le relais Stripe a ete arrete avant sa disponibilite.');
      try {
        stopOwned('SIGTERM');
      } catch {
        // A child can exit concurrently. Its close event remains authoritative.
      }
      if (await waitClosed(stopTimeoutMs)) return;
      try {
        stopOwned('SIGKILL');
      } catch {
        /* Report only the fixed error below, never process diagnostics. */
      }
      if (!(await waitClosed(stopTimeoutMs)))
        throw new Error(
          "Impossible de confirmer l'arret du relais Stripe local."
        );
    })();
    return stopPromise;
  }
  try {
    child = spawnProcess(executable, [scriptPath], {
      cwd: root,
      env,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
      detached: platform !== 'win32'
    });
    child.once('error', () => {
      failReady('Impossible de lancer le relais Stripe local.');
      finish(null, null);
    });
    // Node on Windows can omit close after an explicit IPC disconnect even
    // though exit confirms the wrapper ended.
    child.once('exit', (code, signal) => finish(code, signal));
    child.once('close', (code, signal) => finish(code, signal));
    child.on('message', (message) => {
      if (!hasClosed && !readinessSettled && message?.type === 'stripe-ready') {
        readinessSettled = true;
        clearTimeout(timer);
        resolveReady();
      }
    });
    for (const output of [child.stdout, child.stderr]) {
      const stream = createInterface({ input: output, crlfDelay: Infinity });
      stream.on('line', (line) =>
        write(redactStripeOutput(stripVTControlCharacters(line)))
      );
      streams.push(stream);
    }
    timer = setTimeout(() => {
      failReady(
        'Le relais Stripe ne confirme pas sa disponibilite dans le delai.'
      );
      stop().catch(() => {});
    }, readyTimeoutMs);
  } catch {
    failReady('Impossible de lancer le relais Stripe local.');
    finish(null, null);
  }
  return { ready, closed, stop };
}
