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

const componentRoot =
  'apps/funding-web/src/app/features/funding/components/admin-sponsors/';
const componentFiles = [
  'admin-sponsor-refund-history.component.ts',
  'admin-sponsor-audit-history.component.ts'
].map((filename) => componentRoot + filename);
const catalogs = Object.fromEntries(
  ['fr-CA', 'en'].map((locale) => [
    locale,
    JSON.parse(
      readFileSync(`apps/funding-web/src/assets/i18n/${locale}.json`, 'utf8')
    )
  ])
);
let compiledDirectory;
let RefundHistoryComponent;
let AuditHistoryComponent;

before(async () => {
  compiledDirectory = mkdtempSync(join(tmpdir(), 'openg7-sponsor-history-'));
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
    baseUrl: resolve('.'),
    paths: {
      '@openg7/funding-core': ['packages/funding-core/src/index.ts'],
      '@openg7/funding-models': ['packages/funding-models/src/index.ts']
    },
    rootDir: resolve('.'),
    outDir: compiledDirectory
  };
  const program = createProgram({
    rootNames: componentFiles.map((filename) => resolve(filename)),
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
  const [refund, audit] = await Promise.all(
    componentFiles.map(
      (filename) =>
        import(
          pathToFileURL(
            join(compiledDirectory, filename.replace(/\.ts$/, '.js'))
          ).href
        )
    )
  );
  RefundHistoryComponent = refund.AdminSponsorRefundHistoryComponent;
  AuditHistoryComponent = audit.AdminSponsorAuditHistoryComponent;
  TestBed.initTestEnvironment(
    [BrowserTestingModule, ServerModule],
    platformServer()
  );
});

after(() => {
  TestBed.resetTestEnvironment();
  if (
    compiledDirectory &&
    compiledDirectory.startsWith(join(tmpdir(), 'openg7-sponsor-history-'))
  ) {
    rmSync(compiledDirectory, { recursive: true, force: true });
  }
});

const emptyRefund = Object.freeze({
  statusClass: 'refund-badge refund-not-requested',
  statusLabel: 'No confirmed refund',
  amountLabel: '$500.00 CAD',
  refundAmountLabel: 'Not linked',
  refundReasonLabel: 'Not linked',
  publicReferenceLabel: 'SYNTHETIC-401',
  refundIdLabel: 'Not linked',
  hasRefundWorkflow: false,
  refundNote: null,
  refundError: null,
  timelineEntries: Object.freeze([]),
  auditEntries: Object.freeze([])
});

async function fixture(t, component, value, locale = 'fr-CA') {
  TestBed.configureTestingModule({
    imports: [component],
    providers: [provideTranslateService()]
  });
  const translate = TestBed.inject(TranslateService);
  translate.setTranslation(locale, catalogs[locale]);
  await firstValueFrom(translate.use(locale));
  const fixture = TestBed.createComponent(component);
  fixture.componentRef.setInput('view', value);
  fixture.detectChanges();
  t.after(() => TestBed.resetTestingModule());
  return fixture;
}

for (const locale of ['fr-CA', 'en']) {
  test(`refund panel distinguishes absent history and retains translated labels in ${locale}`, async (t) => {
    const view = await fixture(t, RefundHistoryComponent, emptyRefund, locale);
    const root = view.nativeElement;
    const copy = catalogs[locale].admin.legacy;
    assert.equal(root.querySelectorAll('article').length, 3);
    assert.equal(root.querySelectorAll('ol').length, 0);
    assert.equal(
      root.querySelector('section').getAttribute('aria-label'),
      copy.historique_remboursement
    );
    for (const key of [
      'suivi_remboursement',
      'jalons_remboursement',
      'actions_admin_liees',
      'aucun_remboursement_n_est_demande_pour_cette_commandite',
      'aucun_jalon_de_remboursement_n_est_encore_date_pour_ce_dossier',
      'aucune_action_admin_de_remboursement_n_est_encore_associee_a_cett'
    ]) {
      assert.ok(root.textContent.includes(copy[key]), key);
    }
    assert.equal(root.querySelectorAll('button, input, textarea').length, 0);
    assert.equal(
      root.querySelector('section').getAttribute('data-og7'),
      'dossier-refund-history'
    );
  });

  test(`audit panel emits inspection from its translated button and preserves the focus anchor in ${locale}`, async (t) => {
    const data = Object.freeze({ entries: Object.freeze([]) });
    const view = await fixture(t, AuditHistoryComponent, data, locale);
    const root = view.nativeElement;
    const copy = catalogs[locale].admin;
    const anchor = root.querySelector('#dossier-audit');
    assert.equal(anchor.getAttribute('tabindex'), '-1');
    assert.equal(
      anchor.getAttribute('aria-label'),
      copy.legacy.historique_et_audit
    );
    assert.equal(anchor.getAttribute('data-og7'), 'dossier-audit-history');
    assert.ok(anchor.classList.contains('admin-focus-target'));
    assert.ok(
      root.textContent.includes(
        copy.legacy
          .aucun_historique_administratif_detaille_n_est_encore_disponible_p
      )
    );
    assert.ok(
      root.textContent.includes(
        copy.legacy
          .les_actions_admin_proviennent_du_journal_prive_et_restent_limitee
      )
    );
    const button = root.querySelector('button');
    assert.equal(button.type, 'button');
    assert.equal(button.textContent.trim(), copy.inspector.kinds.history);
    const intentions = [];
    view.componentInstance.inspect.subscribe((intent) =>
      intentions.push(intent)
    );
    button.click();
    assert.deepEqual(intentions, [undefined]);
    assert.deepEqual(data, { entries: [] });
    assert.equal(root.querySelectorAll('ol').length, 0);
  });
}

test('refund panel renders projected chronology, references, notes and failures without changing the view', async (t) => {
  const data = Object.freeze({
    ...emptyRefund,
    statusClass: 'refund-badge refund-processing',
    statusLabel: 'Awaiting provider confirmation',
    refundAmountLabel: '$125.25 CAD',
    refundReasonLabel: 'Requested by sponsor',
    refundIdLabel: 're_synthetic',
    hasRefundWorkflow: true,
    refundNote: 'Synthetic note\nSecond line',
    refundError: '<script>Synthetic provider result is uncertain</script>',
    timelineEntries: Object.freeze([
      Object.freeze({
        id: 'requested',
        dateTimeLabel: 'September 1, 2026',
        label: 'Request recorded',
        stateClass: 'refund-history-requested'
      }),
      Object.freeze({
        id: 'processing',
        dateTimeLabel: 'September 2, 2026',
        label: 'Processing started',
        detail: 'No final confirmation',
        stateClass: 'refund-history-processing'
      })
    ]),
    auditEntries: Object.freeze([
      Object.freeze({
        id: 'admin-action',
        dateTimeLabel: 'September 2, 2026',
        label: 'Server audit',
        detail: 'Synthetic operator'
      })
    ])
  });
  const before = structuredClone(data);
  const view = await fixture(t, RefundHistoryComponent, data);
  const root = view.nativeElement;
  assert.equal(root.querySelectorAll('article').length, 4);
  assert.ok(root.textContent.includes('Awaiting provider confirmation'));
  assert.ok(root.textContent.includes('$125.25 CAD'));
  assert.ok(root.textContent.includes('re_synthetic'));
  assert.ok(root.textContent.includes(data.refundError));
  assert.equal(root.querySelectorAll('script').length, 0);
  assert.deepEqual(
    Array.from(root.querySelectorAll('dd')).map((node) =>
      node.textContent.trim()
    ),
    [data.refundNote, data.refundError]
  );
  const timeline = root.querySelector('[data-og7="dossier-refund-timeline"]');
  assert.deepEqual(
    Array.from(timeline.querySelectorAll('li')).map((node) =>
      node.getAttribute('data-og7-id')
    ),
    ['requested', 'processing']
  );
  assert.deepEqual(
    Array.from(timeline.querySelectorAll('time')).map(
      (node) => node.textContent
    ),
    ['September 1, 2026', 'September 2, 2026']
  );
  assert.equal(timeline.querySelectorAll('small').length, 1);
  assert.equal(
    root
      .querySelector('[data-og7="dossier-refund-audit"] li')
      .getAttribute('data-og7-id'),
    'admin-action'
  );
  assert.deepEqual(data, before);

  view.componentRef.setInput('view', emptyRefund);
  view.detectChanges();
  assert.equal(root.querySelectorAll('ol, dd').length, 0);
  assert.ok(!root.textContent.includes('Synthetic operator'));
  assert.ok(!root.textContent.includes(data.refundNote));
});

test('audit panel preserves projected event order and replaces the selected dossier history', async (t) => {
  const entries = Object.freeze([
    Object.freeze({
      id: 'newest',
      dateTimeLabel: 'September 3, 2026',
      label: 'Newest server event',
      detail: 'Private audit detail'
    }),
    Object.freeze({
      id: 'oldest',
      dateTimeLabel: 'September 1, 2026',
      label: 'Dossier received'
    })
  ]);
  const view = await fixture(t, AuditHistoryComponent, { entries });
  const root = view.nativeElement;
  assert.deepEqual(
    Array.from(root.querySelectorAll('li')).map((node) =>
      node.getAttribute('data-og7-id')
    ),
    ['newest', 'oldest']
  );
  assert.equal(root.querySelectorAll('small').length, 1);
  assert.equal(root.querySelectorAll('button').length, 1);

  view.componentRef.setInput('view', {
    entries: [
      { id: 'other', dateTimeLabel: 'Other date', label: 'Other dossier' }
    ]
  });
  view.detectChanges();
  assert.equal(root.querySelectorAll('li').length, 1);
  assert.ok(root.textContent.includes('Other dossier'));
  assert.ok(!root.textContent.includes('Private audit detail'));
  assert.deepEqual(
    entries.map((entry) => entry.id),
    ['newest', 'oldest']
  );
});
