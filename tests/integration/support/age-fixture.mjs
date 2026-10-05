import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';

export const ageBinary = process.env.FUNDING_BACKUP_AGE_BINARY || 'age';
const keygen =
  process.env.FUNDING_BACKUP_AGE_KEYGEN_BINARY ||
  (ageBinary === 'age'
    ? 'age-keygen'
    : join(
        dirname(ageBinary),
        process.platform === 'win32' ? 'age-keygen.exe' : 'age-keygen'
      ));
const run = (binary, args, input) =>
  execFileSync(binary, args, {
    input,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  });
export const ageAvailable = (() => {
  try {
    run(ageBinary, ['--version']);
    return true;
  } catch {
    return false;
  }
})();

/** Synthetic, independent recovery identity. Its secret is never returned or logged. */
export function createAgeFixture(directory) {
  if (!ageAvailable)
    throw new Error(
      'Install age and age-keygen to exercise encrypted backups.'
    );
  const identity = join(directory, 'recovery-identity.agekey');
  run(keygen, ['--output', identity]);
  const recipient = run(keygen, ['--y', identity]).trim();
  return {
    identity,
    recipient,
    ageBinary,
    encrypt: (bytes) =>
      execFileSync(ageBinary, ['--encrypt', '--recipient', recipient], {
        input: bytes,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      }),
    decrypt: (file) =>
      execFileSync(ageBinary, ['--decrypt', '--identity', identity, file], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
  };
}
