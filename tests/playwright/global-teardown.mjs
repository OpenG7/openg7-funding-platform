import { spawnSync } from 'node:child_process';

export default function globalTeardown() {
  // The acceptance runner owns a disposable database and destroys its stack.
  // Preserve the fixtures until its diagnostics have been collected.
  if (process.env.OPENG7_E2E_ISOLATED === '1') return;
  const result = spawnSync(
    process.execPath,
    ['scripts/e2e-seed.mjs', '--cleanup'],
    {
      stdio: 'inherit'
    }
  );
  if (result.error || result.status !== 0) {
    throw new Error('Playwright fixture cleanup failed.');
  }
}
