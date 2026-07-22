import { spawnSync } from 'node:child_process';

export default function globalTeardown() {
  spawnSync('node', ['scripts/e2e-seed.mjs', '--cleanup'], {
    stdio: 'inherit'
  });
}
