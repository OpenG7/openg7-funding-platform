import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { inventory } from './css-inventory.mjs';

async function fixture(context, files) {
  const root = await mkdtemp(join(tmpdir(), 'funding-css-inventory-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return root;
}

test('inventories Angular literals and CSS once, including media, keyframes and token usage', async (context) => {
  const root = await fixture(context, {
    'styles.css': `:root { --brand: #fff; }
      @media (min-width: 40rem) { .a:hover, .b:focus-visible { display: grid; gap: var(--space); padding: 1rem; color: var(--brand); } }
      @keyframes pulse { from { opacity: 0; } to { opacity: 1; } }`,
    'app/admin-panel/panel.css': '.panel { max-width: 20rem; }',
    'app/admin-panel/panel.ts': `import { Component as UI } from '@angular/core';
      const unrelated = { styles: ['.ignored { display: none; }'] };
      @UI({ styles: [\`:host { display: block; }\`, '.badge[disabled] { cursor: default; }', dynamicStyles], styleUrls: ['./panel.css', dynamicUrl] })
      export class Panel {}`,
    'app/public.ts': `import * as core from '@angular/core';
      @core.Component({styles: '.title { font-size: 1rem; }'}) export class Public {}`,
    'app/other.ts': `import { Component } from 'other-library';
      @Component({styles: '.ignored { color: red; }'}) export class Other {}`
  });
  const report = await inventory(root);
  assert.equal(report.totals.files, 4);
  assert.equal(report.totals.externalFiles, 2);
  assert.equal(report.totals.inlineFiles, 2);
  assert.equal(report.totals.styleBlocks, 5);
  assert.equal(report.totals.declarations, 11);
  assert.equal(report.totals.rules, 8);
  assert.equal(report.totals.selectors, 7); // Keyframe steps are rules, not UI selectors.
  assert.equal(report.totals.mediaRules, 1);
  assert.equal(report.totals.keyframes, 1);
  assert.equal(report.totals.tokenDefinitions, 1);
  assert.equal(report.totals.tokenUsages, 2);
  assert.equal(report.totals.families['tokens/themes'], 1);
  assert.equal(report.totals.families.layout, 3); // display twice plus gap; var() is not a token definition.
  assert.equal(report.totals.families['spacing/sizing'], 2);
  assert.equal(report.totals.properties['--brand'], 1);
  assert.equal(report.totals.uniqueProperties, 9);
  assert.equal(report.totals.states[':hover'], 1);
  assert.equal(report.totals.states[':focus-visible'], 1);
  assert.equal(report.totals.states['[disabled]'], 1);
  assert.equal(report.scopes.global.declarations, 7);
  assert.equal(report.scopes.admin.declarations, 3);
  assert.equal(report.scopes.public.declarations, 1);
  assert.equal(report.ignored.length, 4);
  assert.equal(
    report.ignored.filter((item) => item.reason.includes('dynamique')).length,
    2
  );
  assert.equal(
    report.ignored.filter((item) => item.reason.includes('hors décorateur'))
      .length,
    2
  );
  assert.ok(
    report.files.every(
      (file) => file.path.startsWith('src/') && !file.path.includes('\\')
    )
  );
  assert.deepEqual(report, await inventory(root));
});

test('reports interpolation and dynamic Component metadata without evaluating them', async (context) => {
  const root = await fixture(context, {
    'dynamic.ts':
      'import { Component } from "@angular/core"; @Component(metadata) class A {} @Component({styles: [`.x { color: ${color}; }`]}) class B {} @Component({...sharedMetadata}) class C {}'
  });
  const report = await inventory(root);
  assert.equal(report.totals.styleBlocks, 0);
  assert.equal(report.ignored.length, 3);
  assert.match(report.ignored[0].reason, /Métadonnées Component dynamiques/);
  assert.match(report.ignored[1].reason, /styles dynamique/);
  assert.match(report.ignored[2].reason, /Fragment de métadonnées/);
});

test('counts Tailwind source directives without expanding utilities or loading imports', async (context) => {
  const root = await fixture(context, {
    'styles.css': `@import 'missing-framework/theme.css';
      @reference './missing-reference.css';
      .card { @apply tw:flex tw:gap-3 tw:leading-[1.4]; color: var(--text); }
      @media (min-width: 40rem) { .card { @apply tw:flex tw:content-['hello world'] !important; } }`,
    'app/admin-panel.ts': `import { Component } from '@angular/core';
      @Component({template: '<div style="display: grid" [style.color]="color"></div>', styles: '.x { @apply tw:block; }'}) class Panel {}`,
    'app/template.html':
      '<div style="padding: 1rem" [style.margin]="margin"></div>'
  });
  const report = await inventory(root);
  assert.equal(report.totals.declarations, 1);
  assert.equal(report.totals.uniqueProperties, 1);
  assert.equal(report.totals.properties.display, undefined);
  assert.equal(report.totals.applyRules, 3);
  assert.equal(report.totals.applyUtilities, 6);
  assert.equal(report.totals.uniqueApplyUtilities, 5);
  assert.equal(report.totals.utilities['tw:flex'], 2);
  assert.equal(report.totals.utilities["tw:content-['hello world']"], 1);
  assert.equal(report.totals.utilities['!important'], undefined);
  assert.equal(report.totals.referenceRules, 1);
  assert.equal(report.totals.importRules, 1);
  assert.equal(report.scopes.global.applyUtilities, 5);
  assert.equal(report.scopes.admin.applyUtilities, 1);
  assert.equal(
    report.files.find((file) => file.kind === 'inline').blocks[0].applyRules,
    1
  );
  assert.ok(report.limitations.some((limit) => limit.includes('[style.*]')));
  assert.ok(
    report.limitations.some((limit) => limit.includes('sans expansion'))
  );
});

test('CSS parser errors fail explicitly with the stable source path', async (context) => {
  const root = await fixture(context, {
    'broken.css': '.broken { color: red;'
  });
  await assert.rejects(inventory(root), /src\/broken\.css:1.*Unclosed block/s);
});

test('TypeScript parser errors fail explicitly instead of dropping inline styles', async (context) => {
  const root = await fixture(context, { 'broken.ts': 'const value = ;' });
  await assert.rejects(
    inventory(root),
    /src\/broken\.ts:1:15: Expression expected/s
  );
});

test('CLI emits complete JSON from another working directory and rejects unknown options', () => {
  const tool = fileURLToPath(new URL('./css-inventory.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [tool, '--json'], {
    cwd: tmpdir(),
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout);
  assert.equal(report.root, 'src');
  assert.ok(report.totals.styleBlocks > 0);
  assert.ok(report.files.every((file) => file.path.startsWith('src/')));
  const invalid = spawnSync(process.execPath, [tool, '--write'], {
    encoding: 'utf8'
  });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Option inconnue/);
  const summary = spawnSync(process.execPath, [tool], { encoding: 'utf8' });
  assert.equal(summary.status, 0, summary.stderr);
  assert.match(summary.stdout, /déclarations écrites/);
  assert.match(summary.stdout, /\d+ @apply \(\d+ occurrences d’utilitaires/);
  assert.match(summary.stdout, /\d+ @reference, \d+ @import/);
  assert.match(summary.stdout, /style= et \[style\.\*\]/);
});
