import '@angular/compiler';
import { createProgram } from '@angular/compiler-cli';
import { TestBed } from '@angular/core/testing';
import { BrowserTestingModule } from '@angular/platform-browser/testing';
import { platformServer, ServerModule } from '@angular/platform-server';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
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
import { firstValueFrom } from 'rxjs';
import ts from 'typescript';

const componentFile =
  'apps/funding-web/src/app/features/funding/components/funding-transparency-reports/funding-transparency-reports.component.ts';
const catalogs = Object.fromEntries(
  ['fr-CA', 'en'].map((locale) => [
    locale,
    JSON.parse(
      readFileSync(`apps/funding-web/src/assets/i18n/${locale}.json`, 'utf8')
    )
  ])
);
let compiledDirectory;
let ReportsComponent;

before(async () => {
  compiledDirectory = mkdtempSync(
    join(tmpdir(), 'openg7-transparency-reports-')
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
    skipLibCheck: true,
    rootDir: resolve('.'),
    outDir: compiledDirectory
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
  ({ FundingTransparencyReportsComponent: ReportsComponent } = await import(
    pathToFileURL(
      join(compiledDirectory, componentFile.replace(/\.ts$/, '.js'))
    ).href
  ));
  TestBed.initTestEnvironment(
    [BrowserTestingModule, ServerModule],
    platformServer()
  );
});

after(() => {
  TestBed.resetTestEnvironment();
  if (
    compiledDirectory &&
    compiledDirectory.startsWith(join(tmpdir(), 'openg7-transparency-reports-'))
  ) {
    rmSync(compiledDirectory, { recursive: true, force: true });
  }
});

async function fixture(
  t,
  { locale = 'fr-CA', period = 'all', canExport = true } = {}
) {
  TestBed.configureTestingModule({
    imports: [ReportsComponent],
    providers: [provideTranslateService()]
  });
  const translate = TestBed.inject(TranslateService);
  translate.setTranslation(locale, catalogs[locale]);
  await firstValueFrom(translate.use(locale));
  const fixture = TestBed.createComponent(ReportsComponent);
  fixture.componentRef.setInput('period', period);
  fixture.componentRef.setInput('canExport', canExport);
  fixture.detectChanges();
  t.after(() => TestBed.resetTestingModule());
  return fixture;
}

test('report buttons emit the typed CSV, JSON and copy intentions from their actual template', async (t) => {
  const view = await fixture(t);
  const intentions = [];
  view.componentInstance.action.subscribe((intent) => intentions.push(intent));
  const buttons = Array.from(view.nativeElement.querySelectorAll('button'));
  assert.equal(buttons.length, 3);
  for (const button of buttons) {
    assert.equal(button.type, 'button');
    assert.equal(button.disabled, false);
    button.click();
  }
  assert.deepEqual(intentions, ['csv', 'json', 'copy']);
});

test('unavailable period remains visible, blocks both exports and keeps copying available', async (t) => {
  const view = await fixture(t, { period: '2026-07', canExport: false });
  const buttons = Array.from(view.nativeElement.querySelectorAll('button'));
  assert.equal(
    view.nativeElement.querySelector('strong').textContent.trim(),
    '2026-07'
  );
  assert.deepEqual(
    buttons.map((button) => button.disabled),
    [true, true, false]
  );
  const intentions = [];
  view.componentInstance.action.subscribe((intent) => intentions.push(intent));
  for (const button of buttons) button.click();
  assert.deepEqual(intentions, ['copy']);

  view.componentRef.setInput('canExport', true);
  view.detectChanges();
  assert.deepEqual(
    buttons.map((button) => button.disabled),
    [false, false, false]
  );
});

for (const locale of ['fr-CA', 'en']) {
  test(`method, selected scope and accessible copy announcements preserve ${locale} translations`, async (t) => {
    const view = await fixture(t, { locale });
    const copy = catalogs[locale].funding.transparencyPage;
    const root = view.nativeElement;
    const articles = Array.from(root.querySelectorAll('article'));
    assert.equal(articles.length, 2);
    assert.equal(articles[0].getAttribute('data-og7'), 'transparency-method');
    assert.equal(articles[1].getAttribute('data-og7'), 'transparency-reports');
    for (const key of ['title', 'formula', 'copy', 'payouts', 'limits']) {
      assert.ok(articles[0].textContent.includes(copy.method[key]));
    }
    assert.equal(
      root.querySelector('strong').textContent.trim(),
      copy.registry.allPeriods
    );
    assert.ok(articles[1].textContent.includes(copy.reports.contents));
    const status = root.querySelector('[role="status"]');
    assert.equal(status.textContent.trim(), '');
    for (const state of ['copied', 'copyFailed', '']) {
      view.componentRef.setInput('copyState', state);
      view.detectChanges();
      assert.equal(status.textContent.trim(), state ? copy.reports[state] : '');
    }
  });
}
