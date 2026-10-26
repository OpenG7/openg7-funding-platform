import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  defineBuiltWebSuite,
  publicJourneyProjects
} from './ui/playwright-fixtures.config.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
let commit = null;
let workingTree = 'unknown';
try {
  commit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  }).trim();
  workingTree = execFileSync('git', ['status', '--porcelain'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  }).trim()
    ? 'modified'
    : 'clean';
} catch {
  // A source archive may have no Git metadata; never substitute a guessed SHA.
}

// Built Web and intercepted fixtures only; no financial Docker recipes or seed.
export default defineBuiltWebSuite({
  testMatch: [
    'admin-publication-automation.spec.ts',
    'admin-sponsorship-progress.spec.ts'
  ],
  grep: /publication (drawer reliability|content review|review layout|context actions|transverse acceptance|guideposts|authorization guidepost)|ten normalized collection/,
  outputDir: '../test-results/publication-review',
  projects: publicJourneyProjects(),
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile: fileURLToPath(
          new URL(
            '../test-results/publication-review/results.json',
            import.meta.url
          )
        )
      }
    ]
  ],
  metadata: {
    publicationReview: {
      commit,
      workingTree,
      scope: 'synthetic-api-fixtures'
    }
  }
});
