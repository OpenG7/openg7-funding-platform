#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  collectE2eSources,
  e2eSelectionGaps,
  selectedE2eFiles,
  workflowSelections
} from './lib/e2e-selection.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const workflow =
  args.length === 0
    ? '.github/workflows/admin-acceptance.yml'
    : args.length === 2 && args[0] === '--workflow'
      ? args[1]
      : null;

try {
  if (!workflow)
    throw new Error(
      'Usage: node scripts/check-e2e-selection.mjs [--workflow <path>]'
    );
  const workflowPath = resolve(root, workflow);
  const relativePath = relative(root, workflowPath);
  if (relativePath.startsWith('..') || isAbsolute(relativePath))
    throw new Error('The workflow must be inside the repository.');
  const scripts = JSON.parse(
    readFileSync(resolve(root, 'package.json'), 'utf8')
  ).scripts;
  const suites = workflowSelections(
    readFileSync(workflowPath, 'utf8'),
    scripts
  );
  const sources = collectE2eSources(root);
  if (sources.unfinished.length) throw new Error(sources.unfinished.join('\n'));
  const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) =>
      /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|TEMP|TMP|TMPDIR|PLAYWRIGHT_BROWSERS_PATH)$/i.test(
        name
      )
    )
  );
  const selected = new Set();
  for (const suite of suites) {
    const configPath = relative(root, resolve(root, suite.config));
    if (configPath.startsWith('..') || isAbsolute(configPath))
      throw new Error('The E2E configuration must be inside the repository.');
    let report;
    try {
      report = JSON.parse(
        execFileSync(
          process.execPath,
          [
            cli,
            'test',
            ...suite.args,
            '--list',
            '--forbid-only',
            '--reporter=json'
          ],
          {
            cwd: root,
            env: {
              ...env,
              CI: '1',
              OPENG7_E2E_ISOLATED: '1',
              PLAYWRIGHT_BASE_URL: 'http://127.0.0.1:8080'
            },
            encoding: 'utf8',
            maxBuffer: 16 * 1024 * 1024,
            timeout: 120000,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe']
          }
        )
      );
    } catch {
      // Discovery diagnostics can include fixture data. Report only the config.
      throw new Error(`Cannot discover E2E selection: ${suite.config}`);
    }
    const discovery = selectedE2eFiles(report, root);
    for (const file of discovery.files) selected.add(file);
    console.log(
      `${suite.config}: ${discovery.active} active test declarations discovered`
    );
  }
  const missing = e2eSelectionGaps(sources.files, selected);
  if (missing.length)
    throw new Error(
      `E2E files not selected by ${workflow}:\n${missing.join('\n')}`
    );
  console.log(
    `${sources.files.length} E2E files selected; no only/fixme declarations. Discovery does not certify test execution.`
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
