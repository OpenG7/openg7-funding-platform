import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, open, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { createHash } from 'node:crypto';

import type { BackupConfig } from './config.js';
import { BACKUP_MAX_BYTES } from './policy.js';
import { isBackupId } from './service.js';

export { BACKUP_MAX_BYTES } from './policy.js';

/** Password is an environment value, never a command argument, shell string or log. */
export function dumpEnvironment(connection: string): NodeJS.ProcessEnv {
  const url = new URL(connection);
  return {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: url.searchParams.get('sslmode') || 'verify-full',
    ...(url.searchParams.get('sslrootcert')
      ? { PGSSLROOTCERT: url.searchParams.get('sslrootcert')! }
      : {}),
    PGCONNECT_TIMEOUT: '10',
    PGAPPNAME: 'openg7-backup',
    PGTARGETSESSIONATTRS: 'read-write'
  };
}

const finished = (child: ChildProcessWithoutNullStreams) =>
  new Promise<void>((resolve, reject) => {
    child.once('error', () => reject(new Error('BACKUP_CAPTURE_FAILED')));
    child.once('close', (code) =>
      code === 0 ? resolve() : reject(new Error('BACKUP_CAPTURE_FAILED'))
    );
    // PostgreSQL diagnostics can contain private identifiers. Never log or persist stderr.
    child.stderr.resume();
  });

export async function captureDatabase(
  config: BackupConfig,
  id: string,
  signal: AbortSignal
) {
  if (!isBackupId(id)) throw new Error('Invalid backup identifier.');
  const directory = join(config.directory, id);
  // No reuse: an existing directory means an earlier result must be reconciled.
  await mkdir(directory, { mode: 0o700 });
  const space = await statfs(directory);
  if (space.bavail * space.bsize < BACKUP_MAX_BYTES + 100 * 1024 * 1024)
    throw new Error('BACKUP_SPACE_REQUIRED');
  const file = join(directory, 'database.sql.age');
  const dump = spawn(
    'pg_dump',
    ['--no-password', '--no-owner', '--no-acl', '--lock-wait-timeout=10000'],
    {
      env: dumpEnvironment(config.databaseUrl),
      windowsHide: true,
      stdio: 'pipe',
      signal,
      killSignal: 'SIGKILL'
    }
  );
  const encrypt = spawn('age', ['--encrypt', '--recipient', config.recipient], {
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
    windowsHide: true,
    stdio: 'pipe',
    signal,
    killSignal: 'SIGKILL'
  });
  dump.stdin.end();
  const hash = createHash('sha256');
  let bytes = 0;
  const streams = [
    finished(dump),
    finished(encrypt),
    pipeline(dump.stdout, encrypt.stdin, { signal }),
    pipeline(
      encrypt.stdout,
      new Transform({
        transform(chunk: Buffer, _, next) {
          bytes += chunk.length;
          if (bytes > BACKUP_MAX_BYTES)
            return next(new Error('BACKUP_SIZE_LIMIT'));
          hash.update(chunk);
          next(null, chunk);
        }
      }),
      createWriteStream(file, { mode: 0o600, flags: 'wx' }),
      { signal }
    )
  ];
  try {
    await Promise.all(streams);
  } catch {
    dump.kill('SIGKILL');
    encrypt.kill('SIGKILL');
    await Promise.allSettled(streams);
    throw new Error('BACKUP_CAPTURE_FAILED');
  }
  if (!bytes) throw new Error('BACKUP_CAPTURE_FAILED');
  const handle = await open(file, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  return { file, bytes, sha256: hash.digest('hex') };
}
