import '@angular/compiler';
import { createProgram } from '@angular/compiler-cli';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
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
  'apps/funding-web/src/app/features/funding/components/admin-sponsors/admin-sponsor-publication-panel.component.ts';
const catalogs = Object.fromEntries(
  ['fr-CA', 'en'].map((locale) => [
    locale,
    JSON.parse(
      readFileSync(`apps/funding-web/src/assets/i18n/${locale}.json`, 'utf8')
    )
  ])
);
const draft = Object.freeze({
  publicSlug: 'synthetic-company',
  publicSummary: 'Synthetic public summary',
  feedTarget: 'openg7',
  facebook: true,
  linkedin: false,
  feedStatus: 'planned',
  feedPublicUrl: 'https://example.invalid/post',
  feedNotes: 'Synthetic private notes'
});
let compiledDirectory;
let PublicationPanelComponent;

before(async () => {
  compiledDirectory = mkdtempSync(
    join(tmpdir(), 'openg7-sponsor-publication-panel-')
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
  ({ AdminSponsorPublicationPanelComponent: PublicationPanelComponent } =
    await import(
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
    compiledDirectory.startsWith(
      join(tmpdir(), 'openg7-sponsor-publication-panel-')
    )
  ) {
    rmSync(compiledDirectory, { recursive: true, force: true });
  }
});

async function fixture(t, { locale = 'fr-CA', ...overrides } = {}) {
  TestBed.configureTestingModule({
    imports: [PublicationPanelComponent],
    providers: [provideTranslateService()]
  });
  const translate = TestBed.inject(TranslateService);
  translate.setTranslation(locale, catalogs[locale]);
  await firstValueFrom(translate.use(locale));
  const view = TestBed.createComponent(PublicationPanelComponent);
  const inputs = {
    sponsorship: { id: 'synthetic-sponsor' },
    draft,
    expanded: true,
    dirty: true,
    canSave: true,
    saving: false,
    stateLabel: 'Synthetic unsaved changes',
    slugError: '',
    promisedChannels: ['facebook'],
    promisedChannelTitle:
      catalogs[locale].admin.dossier.publicationBridge.promisedChannel,
    feedStatusOptions: [
      { value: 'not_planned', label: 'Synthetic not planned' },
      { value: 'planned', label: 'Synthetic planned' }
    ],
    logoSource: 'https://example.invalid/logo.png',
    logoAlt: 'Synthetic company logo',
    publicName: 'Synthetic company',
    channelsLabel: 'Facebook',
    ...overrides
  };
  for (const [name, value] of Object.entries(inputs))
    view.componentRef.setInput(name, value);
  view.detectChanges();
  t.after(() => TestBed.resetTestingModule());
  return view;
}

test('publication fields and channels emit their original events without editing the controlled draft', async (t) => {
  const view = await fixture(t);
  const fields = [],
    channels = [],
    saves = [];
  const component = view.componentInstance;
  component.fieldChange.subscribe((intent) => fields.push(intent));
  component.channelChange.subscribe((intent) => channels.push(intent));
  component.save.subscribe(() => saves.push('save'));
  const selectors = [
    ['input[type="text"]', 'input', 'publicSlug'],
    ['select', 'change', 'feedTarget'],
    ['select', 'change', 'feedStatus'],
    ['textarea', 'input', 'publicSummary'],
    ['input[type="url"]', 'input', 'feedPublicUrl'],
    ['textarea', 'input', 'feedNotes']
  ];
  const indices = new Map();
  const events = [];
  for (const [selector, type, field] of selectors) {
    const index = indices.get(selector) ?? 0;
    indices.set(selector, index + 1);
    const control = view.debugElement.queryAll(By.css(selector))[index];
    const event = { target: control.nativeElement, type };
    events.push(event);
    control.triggerEventHandler(type, event);
    assert.equal(fields.at(-1).field, field);
    assert.equal(fields.at(-1).event, event);
  }
  const linkedin = view.debugElement.queryAll(
    By.css('input[type="checkbox"]')
  )[1];
  const channelEvent = { target: linkedin.nativeElement, type: 'change' };
  linkedin.triggerEventHandler('change', channelEvent);
  assert.deepEqual(channels, [{ channel: 'linkedin', event: channelEvent }]);
  view.nativeElement.querySelector('button').click();
  assert.deepEqual(saves, ['save']);
  assert.equal(component.draft(), draft);
  assert.equal(component.draft().publicSlug, 'synthetic-company');
  assert.equal(fields.length, events.length);
});

test('shared lock, eligibility, pristine state and validation independently disable saving', async (t) => {
  const view = await fixture(t);
  const button = view.nativeElement.querySelector('button');
  const fieldset = view.nativeElement.querySelector('.publication-grid');
  assert.equal(button.disabled, false);
  for (const [inputName, blocked, unblocked] of [
    ['actionsDisabled', true, false],
    ['canSave', false, true],
    ['dirty', false, true],
    ['slugError', 'Synthetic duplicate slug', '']
  ]) {
    view.componentRef.setInput(inputName, blocked);
    view.detectChanges();
    assert.equal(button.disabled, true, inputName);
    assert.equal(fieldset.disabled, inputName === 'actionsDisabled');
    view.componentRef.setInput(inputName, unblocked);
    view.detectChanges();
    assert.equal(button.disabled, false, inputName);
  }
  const channels = view.nativeElement.querySelectorAll(
    'input[type="checkbox"]'
  );
  assert.equal(channels[0].checked, true);
  assert.equal(channels[0].disabled, true);
  assert.equal(channels[1].disabled, false);
  view.componentRef.setInput('promisedChannels', ['facebook', 'linkedin']);
  view.detectChanges();
  assert.equal(channels[1].disabled, true);
});

test('slug errors stay associated to their field and the status announces dirty, pending and saved feedback', async (t) => {
  const view = await fixture(t, { slugError: 'Synthetic conflicting slug' });
  const slug = view.nativeElement.querySelector('input[type="text"]');
  const errorId = slug.getAttribute('aria-describedby');
  assert.equal(slug.getAttribute('aria-invalid'), 'true');
  assert.equal(errorId, 'publication-slug-error-synthetic-sponsor');
  assert.equal(
    view.nativeElement.querySelector(`[id="${errorId}"]`).textContent.trim(),
    'Synthetic conflicting slug'
  );
  const status = view.nativeElement.querySelector('[aria-live="polite"]');
  assert.equal(status.textContent.trim(), 'Synthetic unsaved changes');
  assert.equal(status.classList.contains('is-dirty'), true);
  view.componentRef.setInput('slugError', '');
  view.componentRef.setInput('stateLabel', 'Synthetic pending save');
  view.componentRef.setInput('saving', true);
  view.detectChanges();
  assert.equal(slug.getAttribute('aria-describedby'), null);
  assert.equal(slug.getAttribute('aria-invalid'), null);
  assert.equal(status.textContent.trim(), 'Synthetic pending save');
  assert.equal(
    view.nativeElement.querySelector('button').textContent.trim(),
    catalogs['fr-CA'].admin.legacy.enregistrement
  );
  view.componentRef.setInput('dirty', false);
  view.componentRef.setInput('stateLabel', 'Synthetic saved');
  view.componentRef.setInput('saving', false);
  view.detectChanges();
  assert.equal(status.classList.contains('is-dirty'), false);
  assert.equal(status.textContent.trim(), 'Synthetic saved');
});

for (const locale of ['fr-CA', 'en']) {
  test(`private preview renders the controlled projection and the existing ${locale} labels`, async (t) => {
    const promisedChannelTitle =
      catalogs[locale].admin.dossier.publicationBridge.promisedChannel;
    assert.equal(typeof promisedChannelTitle, 'string');
    assert.ok(promisedChannelTitle.trim());
    assert.notEqual(
      catalogs['fr-CA'].admin.dossier.publicationBridge.promisedChannel,
      catalogs.en.admin.dossier.publicationBridge.promisedChannel
    );
    const view = await fixture(t, { locale });
    const root = view.nativeElement;
    const copy = catalogs[locale].admin.legacy;
    assert.equal(
      root.querySelector('details').getAttribute('data-og7'),
      'publication-advanced'
    );
    assert.equal(
      root.querySelector('article').getAttribute('data-og7'),
      'dossier-publication-editor'
    );
    assert.ok(root.textContent.includes(copy.commanditaire_et_feeds));
    assert.ok(root.textContent.includes(copy.previsualisation_non_publiee));
    const preview = root.querySelector('.public-preview');
    assert.equal(
      preview.querySelector('h3').textContent.trim(),
      'Synthetic company'
    );
    assert.equal(
      preview.querySelector('p').textContent.trim(),
      draft.publicSummary
    );
    assert.equal(
      preview.querySelector('img').getAttribute('alt'),
      'Synthetic company logo'
    );
    assert.ok(!preview.querySelector('a'));
    assert.equal(preview.textContent.includes(draft.feedNotes), false);
    assert.equal(
      root.querySelector('input[type="checkbox"]').getAttribute('title'),
      catalogs[locale].admin.dossier.publicationBridge.promisedChannel
    );
    const edited = {
      ...draft,
      publicSummary: '',
      feedPublicUrl: '',
      feedTarget: ''
    };
    view.componentRef.setInput('draft', edited);
    view.componentRef.setInput('logoSource', null);
    view.detectChanges();
    assert.ok(!preview.querySelector('figure'));
    assert.equal(
      preview.querySelector('p').textContent.trim(),
      copy.aucun_resume_public_pour_le_moment
    );
    assert.ok(preview.textContent.includes(copy.aucune));
    assert.ok(preview.textContent.includes(copy.non_defini));
  });
}

test('expansion is controlled by the page and toggles report the rendered details state', async (t) => {
  const view = await fixture(t, { expanded: false });
  const changes = [];
  view.componentInstance.expandedChange.subscribe((open) => changes.push(open));
  const details = view.debugElement.query(By.css('details'));
  assert.equal(details.nativeElement.hasAttribute('open'), false);
  view.componentRef.setInput('expanded', true);
  view.detectChanges();
  assert.equal(details.nativeElement.hasAttribute('open'), true);
  details.nativeElement.open = false;
  details.triggerEventHandler('toggle', {});
  assert.deepEqual(changes, [false]);
  assert.equal(view.componentInstance.expanded(), true);
});

test('page-requested focus reaches the extracted summary without opening or saving the panel', async (t) => {
  const view = await fixture(t, { expanded: false });
  const summary = view.nativeElement.querySelector('summary');
  const calls = [];
  const changes = [];
  view.componentInstance.expandedChange.subscribe((open) => changes.push(open));
  view.componentInstance.save.subscribe(() => changes.push('save'));
  Object.defineProperties(summary, {
    focus: { value: () => calls.push('focus'), configurable: true },
    scrollIntoView: {
      value: (options) => calls.push(options),
      configurable: true
    }
  });
  view.componentInstance.focusSummary();
  assert.deepEqual(calls, ['focus', { block: 'nearest', behavior: 'auto' }]);
  assert.equal(view.componentInstance.expanded(), false);
  assert.deepEqual(changes, []);
});

test('publication panel contains presentation only and owns the styles across Angular encapsulation', () => {
  const source = readFileSync(componentFile, 'utf8');
  const styles = readFileSync(componentFile.replace(/\.ts$/, '.css'), 'utf8');
  assert.doesNotMatch(
    source,
    /inject\(|FundingAdminService|AdminSponsorPublicationWorkflow|\.savePublication\(|\.updateSponsorshipPublication\(/
  );
  assert.match(source, /output<AdminSponsorPublicationFieldChange>/);
  assert.match(source, /output<AdminSponsorPublicationChannelChange>/);
  assert.match(
    source,
    /viewChild<ElementRef<HTMLElement>>\('publicationSummary'\)/
  );
  assert.match(source, /summary\?\.focus\(\)/);
  assert.match(
    source,
    /scrollIntoView\(\{ block: 'nearest', behavior: 'auto' \}\)/
  );
  assert.match(
    styles,
    /\.publication-grid\s*\{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/
  );
  assert.match(
    styles,
    /@media \(max-width: 860px\)[\s\S]*?grid-template-columns: 1fr/
  );
  assert.match(styles, /\.publication-advanced > summary:focus-visible/);
  assert.match(styles, /\.detail-card\s*\{[^}]*border-radius: 0\.9rem/);
  assert.doesNotMatch(styles, /animation:|transition:|::ng-deep/);
});
