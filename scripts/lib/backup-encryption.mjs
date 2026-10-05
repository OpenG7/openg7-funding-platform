import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

/** Recovery workstation only. Identity contents and child diagnostics never enter logs. */
export async function decryptBackupFile(source, destination, identity) {
  if (!identity)
    throw new Error('An external age recovery identity is required.');
  const child = spawn(
    process.env.FUNDING_BACKUP_AGE_BINARY || 'age',
    ['--decrypt', '--identity', identity, source],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  child.stderr.resume();
  const finished = new Promise((resolve, reject) => {
    child.once('error', () => reject(new Error('Backup decryption failed.')));
    child.once('close', (code) =>
      code === 0 ? resolve() : reject(new Error('Backup decryption failed.'))
    );
  });
  const streams = [
    finished,
    pipeline(
      child.stdout,
      createWriteStream(destination, { mode: 0o600, flags: 'wx' })
    )
  ];
  try {
    await Promise.all(streams);
  } catch {
    child.kill();
    await Promise.allSettled(streams);
    throw new Error('Backup decryption failed.');
  }
}
