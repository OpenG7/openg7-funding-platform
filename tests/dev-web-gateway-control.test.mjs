import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';

import {
  requestGatewayStop,
  watchGatewayStop
} from '../scripts/lib/dev-web-gateway-control.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'og7-gateway-control-'));
  const paths = {
    backupPath: join(directory, 'backup.json'),
    requestPath: join(directory, 'stop.json')
  };
  t.after(() => {
    for (const name of readdirSync(directory))
      unlinkSync(join(directory, name));
    rmdirSync(directory);
  });
  const backup = (value = { pid: process.pid, sessionId: randomUUID() }) => {
    writeFileSync(paths.backupPath, JSON.stringify(value));
    return value;
  };
  return { ...paths, backup };
}

test('requesting stop without a routing backup is an idempotent no-op', async (t) => {
  const f = fixture(t);
  const other = JSON.stringify({ sessionId: randomUUID() });
  writeFileSync(f.requestPath, other);
  assert.equal(await requestGatewayStop(f), false);
  assert.equal(readFileSync(f.requestPath, 'utf8'), other);
});

test('only the matching session invokes its cleanup, once, without termination signals', async (t) => {
  const f = fixture(t);
  const { sessionId } = f.backup();
  const originalKill = process.kill;
  const probes = [];
  t.mock.method(process, 'kill', (pid, signal) => {
    probes.push([pid, signal]);
    assert.equal(signal, 0);
    return originalKill(pid, signal);
  });
  let stopped = 0;
  const dispose = watchGatewayStop({
    ...f,
    sessionId,
    intervalMs: 5,
    onStop: () => {
      stopped++;
      unlinkSync(f.backupPath);
    }
  });
  t.after(dispose);
  assert.equal(
    await requestGatewayStop({ ...f, intervalMs: 5, timeoutMs: 1000 }),
    true
  );
  writeFileSync(f.requestPath, JSON.stringify({ sessionId }));
  await setTimeout(20);
  assert.equal(stopped, 1);
  assert.ok(probes.length > 0);
  dispose();
  assert.equal(existsSync(f.requestPath), false);
});

test('watcher ignores malformed requests and requests belonging to another session', async (t) => {
  const f = fixture(t);
  const sessionId = randomUUID();
  let stopped = 0;
  const dispose = watchGatewayStop({
    ...f,
    sessionId,
    intervalMs: 5,
    onStop: () => stopped++
  });
  t.after(dispose);
  writeFileSync(f.requestPath, '{invalid');
  await setTimeout(20);
  const other = JSON.stringify({ sessionId: randomUUID() });
  writeFileSync(f.requestPath, other);
  await setTimeout(20);
  assert.equal(stopped, 0);
  dispose();
  assert.equal(readFileSync(f.requestPath, 'utf8'), other);
});

test('invalid routing state and a legacy live launcher are refused without a request', async (t) => {
  const f = fixture(t);
  for (const state of [
    null,
    {},
    { pid: 0 },
    { pid: -1 },
    { pid: '123' },
    { pid: 1.5 },
    { pid: Number.MAX_SAFE_INTEGER }
  ]) {
    f.backup(state);
    await assert.rejects(requestGatewayStop(f), /Invalid process identifier/);
    assert.equal(existsSync(f.requestPath), false);
  }
  f.backup({ pid: process.pid });
  await assert.rejects(
    requestGatewayStop(f),
    /Ctrl\+C in its original terminal/
  );
  f.backup({ pid: process.pid, sessionId: 'not-a-session' });
  await assert.rejects(requestGatewayStop(f), /Invalid session identifier/);
  f.backup({ pid: process.pid, sessionId: [randomUUID()] });
  await assert.rejects(requestGatewayStop(f), /Invalid session identifier/);
  writeFileSync(f.backupPath, '{invalid');
  await assert.rejects(requestGatewayStop(f), /Cannot read/);
  assert.equal(existsSync(f.requestPath), false);
});

test('a stopped launcher retains the routing backup and requires explicit recovery', async (t) => {
  const f = fixture(t);
  f.backup();
  const before = readFileSync(f.backupPath, 'utf8');
  t.mock.method(process, 'kill', () => {
    throw Object.assign(new Error('Synthetic missing process'), {
      code: 'ESRCH'
    });
  });
  await assert.rejects(requestGatewayStop(f), /yarn dev:web:docker:restore/);
  assert.equal(readFileSync(f.backupPath, 'utf8'), before);
  assert.equal(existsSync(f.requestPath), false);
});

test('timeout preserves routing history and removes only its own stop request', async (t) => {
  const f = fixture(t);
  f.backup();
  const before = readFileSync(f.backupPath, 'utf8');
  await assert.rejects(
    requestGatewayStop({ ...f, intervalMs: 5, timeoutMs: 20 }),
    /Timed out waiting/
  );
  assert.equal(readFileSync(f.backupPath, 'utf8'), before);
  assert.equal(existsSync(f.requestPath), false);
});

test('a stale request is replaced only with the active session and completes its cleanup', async (t) => {
  const f = fixture(t);
  const { sessionId } = f.backup();
  const other = JSON.stringify({ sessionId: randomUUID() });
  writeFileSync(f.requestPath, other);
  let stopped = 0;
  const dispose = watchGatewayStop({
    ...f,
    sessionId,
    intervalMs: 5,
    onStop: () => {
      stopped++;
      unlinkSync(f.backupPath);
    }
  });
  t.after(dispose);
  assert.equal(
    await requestGatewayStop({ ...f, intervalMs: 5, timeoutMs: 1000 }),
    true
  );
  assert.equal(stopped, 1);
  assert.equal(existsSync(f.requestPath), false);
});

test('a replacement session is preserved while an old stop request is pending', async (t) => {
  const f = fixture(t);
  const { sessionId } = f.backup();
  let replacement;
  const dispose = watchGatewayStop({
    ...f,
    sessionId,
    intervalMs: 5,
    onStop: () => {
      replacement = f.backup();
      writeFileSync(
        f.requestPath,
        JSON.stringify({ sessionId: replacement.sessionId })
      );
    }
  });
  t.after(dispose);
  await assert.rejects(
    requestGatewayStop({ ...f, intervalMs: 5, timeoutMs: 1000 }),
    /session changed/
  );
  assert.deepEqual(JSON.parse(readFileSync(f.backupPath, 'utf8')), replacement);
  assert.deepEqual(JSON.parse(readFileSync(f.requestPath, 'utf8')), {
    sessionId: replacement.sessionId
  });
});
