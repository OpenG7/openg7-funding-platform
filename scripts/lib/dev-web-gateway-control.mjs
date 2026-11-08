import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const recovery = () =>
  new Error(
    'The Web gateway stopped before routing restoration. Run yarn dev:web:docker:restore.'
  );

function readJson(filename) {
  try {
    return JSON.parse(readFileSync(filename, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw new Error('Cannot read the local Web gateway control file.');
  }
}

function removeOwnRequest(requestPath, sessionId) {
  try {
    if (readJson(requestPath)?.sessionId === sessionId) unlinkSync(requestPath);
  } catch {
    // A malformed or inaccessible request must not prevent routing restoration.
  }
}

function running(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw new Error('Cannot verify the local Web gateway process.');
  }
}

/** Ask only this launcher's own cleanup to stop Angular and restore routing. */
export function watchGatewayStop({
  requestPath,
  sessionId,
  onStop,
  intervalMs = 100
}) {
  if (
    typeof sessionId !== 'string' ||
    !uuid.test(sessionId) ||
    typeof onStop !== 'function'
  )
    throw new Error('Invalid local Web gateway stop watcher.');
  let done = false;
  const cleanup = () => {
    done = true;
    clearInterval(timer);
    removeOwnRequest(requestPath, sessionId);
  };
  const timer = setInterval(() => {
    if (done) return;
    let request;
    try {
      request = readJson(requestPath);
    } catch {
      return;
    }
    if (request?.sessionId !== sessionId) return;
    cleanup();
    onStop();
  }, intervalMs);
  timer.unref();
  return cleanup;
}

/** Stop through session-scoped IPC; no signal other than a liveness probe is sent. */
export async function requestGatewayStop({
  backupPath,
  requestPath,
  timeoutMs = 30000,
  intervalMs = 100
}) {
  const backup = readJson(backupPath);
  if (backup === undefined) return false;
  if (
    !Number.isSafeInteger(backup?.pid) ||
    backup.pid <= 0 ||
    backup.pid > 2147483647
  )
    throw new Error(
      'Invalid process identifier in the local Web routing backup.'
    );
  if (!running(backup.pid)) throw recovery();
  if (!backup.sessionId)
    throw new Error(
      'This Web gateway uses an older launcher. Stop it with Ctrl+C in its original terminal.'
    );
  if (typeof backup.sessionId !== 'string' || !uuid.test(backup.sessionId))
    throw new Error(
      'Invalid session identifier in the local Web routing backup.'
    );
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error('Invalid local Web gateway stop timeout.');
  const { pid, sessionId } = backup;
  try {
    // Only the active session can consume this request; old requests are inert.
    writeFileSync(requestPath, JSON.stringify({ sessionId }));
  } catch {
    throw new Error('Cannot write the local Web gateway stop request.');
  }
  try {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const current = readJson(backupPath);
      if (current === undefined) return true;
      if (current?.pid !== pid || current.sessionId !== sessionId)
        throw new Error(
          'The Web gateway session changed; no other gateway was requested to stop.'
        );
      if (!running(pid)) throw recovery();
      if (Date.now() >= deadline)
        throw new Error(
          'Timed out waiting for the Web gateway to stop. Keep the routing backup and check its original terminal.'
        );
      await setTimeout(intervalMs);
    }
  } finally {
    removeOwnRequest(requestPath, sessionId);
  }
}
