import '@angular/compiler';
import { createProgram } from '@angular/compiler-cli';
import { TestBed } from '@angular/core/testing';
import { BrowserTestingModule } from '@angular/platform-browser/testing';
import { provideRouter } from '@angular/router';
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
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { firstValueFrom } from 'rxjs';
import ts from 'typescript';

const componentFile =
  'apps/funding-web/src/app/features/funding/components/funding-contribution-form/funding-contribution-form.component.ts';
const catalogs = Object.fromEntries(
  ['fr-CA', 'en'].map((locale) => [
    locale,
    JSON.parse(
      readFileSync(`apps/funding-web/src/assets/i18n/${locale}.json`, 'utf8')
    )
  ])
);
let compiledDirectory;
let ContributionForm;
let I18nService;
let workspaceHook;

before(async () => {
  compiledDirectory = mkdtempSync(join(tmpdir(), 'openg7-checkout-form-'));
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
  workspaceHook = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('@openg7/')) {
        return {
          url: pathToFileURL(
            resolve(
              'dist/packages',
              specifier.slice('@openg7/'.length),
              'src/index.js'
            )
          ).href,
          shortCircuit: true
        };
      }
      return nextResolve(specifier, context);
    }
  });
  ({ FundingContributionFormComponent: ContributionForm } = await import(
    pathToFileURL(
      join(compiledDirectory, componentFile.replace(/\.ts$/, '.js'))
    ).href
  ));
  ({ FundingI18nService: I18nService } = await import(
    pathToFileURL(
      join(
        compiledDirectory,
        'apps/funding-web/src/app/features/funding/services/funding-i18n.service.js'
      )
    ).href
  ));
  TestBed.initTestEnvironment(
    [BrowserTestingModule, ServerModule],
    platformServer()
  );
});

after(() => {
  TestBed.resetTestEnvironment();
  workspaceHook?.deregister();
  if (
    compiledDirectory &&
    compiledDirectory.startsWith(join(tmpdir(), 'openg7-checkout-form-'))
  ) {
    rmSync(compiledDirectory, { recursive: true, force: true });
  }
});

test('the real contribution form translates verification errors in both languages and blocks submission until review', async (t) => {
  for (const locale of ['fr-CA', 'en']) {
    await t.test(locale, async (t) => {
      TestBed.configureTestingModule({
        imports: [ContributionForm],
        providers: [
          provideTranslateService(),
          provideRouter([]),
          {
            provide: I18nService,
            useValue: {
              currentLanguage: () => locale,
              localizedPath: (path) => path
            }
          }
        ]
      });
      t.after(() => TestBed.resetTestingModule());
      const translate = TestBed.inject(TranslateService);
      translate.setTranslation(locale, catalogs[locale]);
      await firstValueFrom(translate.use(locale));
      const view = TestBed.createComponent(ContributionForm);
      view.componentRef.setInput('loadingState', 'error');
      view.componentRef.setInput('checkoutRequiresVerification', true);
      view.componentInstance.nonCharityAcknowledged.set(true);
      view.detectChanges();
      const text = catalogs[locale].funding.home.contribution;
      assert.equal(
        view.nativeElement.querySelector('[role="alert"]').textContent.trim(),
        text.verificationRequired
      );
      assert.notEqual(text.verificationRequired, text.error);
      assert.equal(
        view.nativeElement.querySelector('button[type="submit"]').disabled,
        true
      );
      const submissions = [];
      view.componentInstance.contributionSubmitted.subscribe((value) =>
        submissions.push(value)
      );
      view.componentInstance.submitContribution();
      assert.equal(submissions.length, 0);

      // Generic Checkout errors keep the existing message and normal retry behavior.
      view.componentRef.setInput('checkoutRequiresVerification', false);
      view.detectChanges();
      assert.equal(
        view.nativeElement.querySelector('[role="alert"]').textContent.trim(),
        text.error
      );
      assert.equal(
        view.nativeElement.querySelector('button[type="submit"]').disabled,
        false
      );
      view.componentInstance.submitContribution();
      assert.equal(submissions.length, 1);
    });
  }
});
