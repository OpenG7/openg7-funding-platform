import { existsSync, readFileSync } from 'node:fs';

// Mirrors scripts/load-env.sh: fills process.env from a dotenv-style file
// without overwriting variables already set in the shell.
export const loadDotEnv = (path = '.env') => {
  if (!existsSync(path)) {
    return;
  }

  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([\w.-]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    if (!(key in process.env)) {
      process.env[key] = rawValue.replace(/^['"]|['"]$/g, '');
    }
  }
};
