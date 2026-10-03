import '@angular/compiler';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { createProgram } from '@angular/compiler-cli';
import {
  Component,
  inject,
  provideAppInitializer,
  provideZonelessChangeDetection
} from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import {
  provideServerRendering,
  renderApplication
} from '@angular/platform-server';
import { provideRouter, withDisabledInitialNavigation } from '@angular/router';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import ts from 'typescript';

const componentDirectory =
  'apps/funding-web/src/app/features/funding/components/funding-transparency-allocations';
const componentFile = `${componentDirectory}/funding-transparency-allocations.component.ts`;
const catalogs = Object.fromEntries(
  ['fr-CA', 'en'].map((locale) => [
    locale,
    JSON.parse(
      readFileSync(`apps/funding-web/src/assets/i18n/${locale}.json`, 'utf8')
    )
  ])
);
let compiledDirectory;
let AllocationsComponent;

before(async () => {
  // Compile the real signal-input component and its external template for SSR;
  // no browser, HTTP fixture or additional testing dependency is required.
  compiledDirectory = mkdtempSync(
    join(tmpdir(), 'openg7-transparency-allocations-')
  );
  writeFileSync(
    join(compiledDirectory, 'package.json'),
    JSON.stringify({ type: 'module' })
  );
  symlinkSync(
    resolve('node_modules'),
    join(compiledDirectory, 'node_modules'),
    'junction'
  );
  const options = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    experimentalDecorators: true,
    strict: true,
    strictTemplates: true,
    skipLibCheck: true,
    baseUrl: resolve('.'),
    rootDir: resolve('.'),
    outDir: compiledDirectory,
    paths: JSON.parse(readFileSync('tsconfig.json', 'utf8')).compilerOptions
      .paths
  };
  const program = createProgram({
    rootNames: [resolve(componentFile)],
    options,
    host: ts.createCompilerHost(options)
  });
  await program.loadNgStructureAsync();
  const diagnostics = [
    ...program.getTsSyntacticDiagnostics(),
    ...program.getTsSemanticDiagnostics(),
    ...program.getNgSemanticDiagnostics()
  ];
  assert.equal(
    diagnostics.length,
    0,
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (filename) => filename,
      getCurrentDirectory: () => resolve('.'),
      getNewLine: () => '\n'
    })
  );
  program.emit();
  ({ FundingTransparencyAllocationsComponent: AllocationsComponent } =
    await import(
      pathToFileURL(
        join(compiledDirectory, componentFile.replace(/\.ts$/, '.js'))
      ).href
    ));
});

after(() => {
  if (
    compiledDirectory &&
    compiledDirectory.startsWith(
      join(tmpdir(), 'openg7-transparency-allocations-')
    )
  ) {
    rmSync(compiledDirectory, { recursive: true, force: true });
  }
});

async function render({
  allocations = [],
  hasSnapshot = true,
  locale = 'fr-CA'
} = {}) {
  const moneyCalls = [];
  const dateCalls = [];
  const aboutPath = `${locale === 'en' ? '/en' : ''}/fonds-des-batisseurs/a-propos`;
  class AllocationsFixture {
    allocations = allocations;
    hasSnapshot = hasSnapshot;
    aboutPath = aboutPath;
    formatMoney = (value, currency) => {
      moneyCalls.push([value, currency]);
      return `${value.toFixed(2)} ${currency}`;
    };
    formatDate = (value) => {
      dateCalls.push(value);
      return `date:${value}`;
    };
  }
  Component({
    selector: 'openg7-allocations-test',
    standalone: true,
    imports: [AllocationsComponent],
    template: `<openg7-funding-transparency-allocations
      [allocations]="allocations" [hasSnapshot]="hasSnapshot" [aboutPath]="aboutPath"
      [formatMoney]="formatMoney" [formatDate]="formatDate" />`
  })(AllocationsFixture);
  const html = await renderApplication(
    (context) =>
      bootstrapApplication(
        AllocationsFixture,
        {
          providers: [
            provideServerRendering(),
            provideZonelessChangeDetection(),
            provideRouter([], withDisabledInitialNavigation()),
            provideTranslateService(),
            provideAppInitializer(() => {
              const translate = inject(TranslateService);
              translate.setTranslation(locale, catalogs[locale]);
              return firstValueFrom(translate.use(locale));
            })
          ]
        },
        context
      ),
    {
      document:
        '<html><body><openg7-allocations-test></openg7-allocations-test></body></html>',
      url: 'http://localhost/fonds-des-batisseurs/transparence',
      allowedHosts: ['localhost']
    }
  );
  return { html, moneyCalls, dateCalls, aboutPath };
}

const completeAllocation = {
  project_name: 'Services ouverts',
  public_description: 'Description publique exacte.',
  expected_outcome: 'Résultat attendu public.',
  progress_status: 'in_progress',
  proof_url: 'https://example.test/preuve',
  proof_source: 'Démonstration publique',
  proof_published_at: '2026-09-11T12:00:00.000Z',
  amount_allocated: 125,
  currency: 'CAD',
  status: 'published',
  published_at: '2026-09-10T12:00:00.000Z',
  notes_admin: 'private-synthetic-note',
  stripe_transfer_id: 'private-synthetic-transfer'
};

for (const locale of ['fr-CA', 'en']) {
  test(`published allocations render public description, outcome, progress and evidence in ${locale}`, async () => {
    const { html, moneyCalls, dateCalls, aboutPath } = await render({
      allocations: [completeAllocation],
      locale
    });
    assert.match(html, /data-og7="published-allocations"/);
    for (const text of [
      completeAllocation.project_name,
      completeAllocation.public_description,
      completeAllocation.expected_outcome,
      completeAllocation.proof_source,
      catalogs[locale].funding.transparencyPage.expenses.info,
      catalogs[locale].funding.transparencyPage.expenses.progress.inProgress
    ]) {
      assert.ok(html.includes(text), `missing public allocation text: ${text}`);
    }
    const proofLink = html.match(
      /<a\b[^>]*href="https:\/\/example\.test\/preuve"[^>]*>/
    )?.[0];
    assert.ok(proofLink);
    assert.match(proofLink, /target="_blank"/);
    assert.match(proofLink, /rel="noopener noreferrer"/);
    assert.ok(html.includes(`href="${aboutPath}#about-mission-title"`));
    assert.deepEqual(moneyCalls, [[125, 'CAD']]);
    assert.deepEqual(dateCalls, [
      completeAllocation.published_at,
      completeAllocation.proof_published_at
    ]);
    assert.doesNotMatch(
      html,
      /private-synthetic|notes_admin|stripe_transfer_id/
    );
  });
}

test('partial allocation preserves its confirmed zero and currency without inventing dates or evidence', async () => {
  const { html, moneyCalls, dateCalls } = await render({
    allocations: [
      {
        project_name: 'Allocation prévue',
        amount_allocated: 0,
        currency: 'USD',
        progress_status: 'planned',
        status: 'published',
        public_description: null,
        expected_outcome: null,
        published_at: null,
        proof_url: null,
        proof_source: null,
        proof_published_at: null
      }
    ]
  });
  assert.match(html, /0\.00 USD/);
  assert.ok(
    html.includes(
      catalogs['fr-CA'].funding.transparencyPage.expenses.progress.planned
    )
  );
  assert.deepEqual(moneyCalls, [[0, 'USD']]);
  assert.deepEqual(dateCalls, []);
  assert.doesNotMatch(html, /target="_blank"|date:|null|undefined/);
  assert.ok(
    !html.includes(catalogs['fr-CA'].funding.transparencyPage.state.unavailable)
  );
});

test('proof without source or publication date uses its public fallback label', async () => {
  const { html, dateCalls } = await render({
    allocations: [
      {
        ...completeAllocation,
        proof_source: null,
        proof_published_at: null,
        published_at: null
      }
    ]
  });
  assert.ok(
    html.includes(catalogs['fr-CA'].funding.transparencyPage.expenses.proof)
  );
  assert.deepEqual(dateCalls, []);
  assert.match(html, /href="https:\/\/example\.test\/preuve"/);
});

test('empty confirmed snapshot and unavailable snapshot remain separate states', async () => {
  const empty = await render();
  const unavailable = await render({ hasSnapshot: false });
  assert.ok(
    empty.html.includes(
      catalogs['fr-CA'].funding.transparencyPage.expenses.empty
    )
  );
  assert.ok(
    !empty.html.includes(
      catalogs['fr-CA'].funding.transparencyPage.state.unavailable
    )
  );
  assert.ok(
    unavailable.html.includes(
      catalogs['fr-CA'].funding.transparencyPage.state.unavailable
    )
  );
  assert.ok(
    !unavailable.html.includes(
      catalogs['fr-CA'].funding.transparencyPage.expenses.empty
    )
  );
  assert.deepEqual(empty.moneyCalls, []);
  assert.deepEqual(unavailable.moneyCalls, []);
});
