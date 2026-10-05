#!/usr/bin/env node
import {
  captureS3,
  captureS3Archive,
  restoreS3,
  s3BackupConfig,
  verifyS3
} from './lib/s3-backup.mjs';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, chmod, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decryptBackupFile } from './lib/backup-encryption.mjs';

// Explicit environment only: use node --env-file=<source-or-target> for standalone calls.
const [command, directory, confirmation, ...extra] = process.argv.slice(2);
let config, stage;
let phase = 'arguments';
try {
  if (
    !directory ||
    ![
      'capture',
      'capture-archive',
      'verify',
      'restore',
      'restore-archive'
    ].includes(command) ||
    (command === 'restore-archive'
      ? ![1, 2, 3].includes(extra.length)
      : extra.length)
  )
    throw new Error();
  if (['capture', 'verify'].includes(command) && confirmation !== undefined)
    throw new Error();
  if (
    command === 'capture-archive' &&
    (directory !== '-' || confirmation !== undefined)
  )
    throw new Error();
  phase = command;
  if (command === 'restore-archive') {
    phase = 'archive-integrity';
    // directory is the configuration archive, confirmation is its media archive, extra[0] names both target buckets.
    execFileSync(
      process.execPath,
      [
        fileURLToPath(new URL('./backup-artifacts.mjs', import.meta.url)),
        'verify-s3',
        directory,
        confirmation
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }
    );
    stage = await mkdtemp(join(tmpdir(), 'og7-s3-restore-'));
    await chmod(stage, 0o700);
    const manifest = JSON.parse(
      await readFile(directory + '.manifest.json', 'utf8')
    );
    let mediaArchive = resolve(confirmation);
    if (manifest.version === 2) {
      if (extra.length !== 3 || extra[1] !== '--identity') throw new Error();
      const decryptedConfig = join(stage, 'config.tar.gz');
      mediaArchive = join(stage, 'media.tar.gz');
      await decryptBackupFile(directory, decryptedConfig, extra[2]);
      await decryptBackupFile(confirmation, mediaArchive, extra[2]);
      execFileSync(
        process.execPath,
        [
          fileURLToPath(new URL('./backup-artifacts.mjs', import.meta.url)),
          'validate-decrypted',
          decryptedConfig,
          mediaArchive
        ],
        { stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }
      );
    } else if (extra.length !== 2 || extra[1] !== '--allow-legacy-plaintext')
      throw new Error();
    phase = 'archive-extraction';
    execFileSync('tar', ['-xzf', mediaArchive, '-C', stage], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60000
    });
    config = s3BackupConfig(process.env);
    phase = 'target-restore';
    await restoreS3(config, stage, extra[0]);
  } else if (command === 'verify') await verifyS3(directory);
  else {
    config = s3BackupConfig(process.env);
    if (command === 'capture') await captureS3(config, directory);
    else if (command === 'capture-archive')
      await captureS3Archive(config, process.stdout);
    else await restoreS3(config, directory, confirmation);
  }
  if (command !== 'capture-archive')
    console.log(
      command.startsWith('restore')
        ? 'S3 restore verified; all objects remain private. Reconcile before activation.'
        : 'S3 backup operation completed.'
    );
} catch {
  // Provider, filesystem and URL errors may contain credentials or private object keys.
  console.error(
    `S3 backup operation failed (${phase}). Verify configuration, capture integrity and an empty dedicated target; preserve partial targets for reconciliation.`
  );
  process.exitCode = 1;
} finally {
  config?.client.destroy();
  if (
    stage &&
    resolve(stage).startsWith(resolve(tmpdir()) + sep) &&
    stage.split(sep).pop().startsWith('og7-s3-restore-')
  )
    await rm(stage, { recursive: true, force: true });
}
