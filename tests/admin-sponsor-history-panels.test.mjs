import { fundingBaseTranslations } from './support/funding-base-translations.mjs';
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
  ['fr-CA', 'en'].map((locale) => {
    const catalog = fundingBaseTranslations(locale);
    catalog.admin.finance = JSON.parse(
      readFileSync(
        `apps/funding-web/src/assets/i18n/admin-finance.${locale}.json`,
        'utf8'
      )
    );
    catalog.admin.history = JSON.parse(
      readFileSync(
        `apps/funding-web/src/assets/i18n/admin-history.${locale}.json`,
        'utf8'
      )
    );
    return [locale, catalog];
  })
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

function assertNamedHistoryList(root, hook, heading) {
  const list = root.querySelector(`[data-og7="${hook}"]`);
  assert.ok(list, hook);
  assert.equal(list.tagName, 'OL');
  assert.equal(list.getAttribute('role'), 'list');
  const labelledBy = list.getAttribute('aria-labelledby');
  const label = labelledBy
    ? labelledBy
        .split(/\s+/)
        .map((id) => root.querySelector(`[id="${id}"]`)?.textContent.trim())
        .join(' ')
    : list.getAttribute('aria-label');
  assert.equal(label, heading);
  return list;
}

for (const locale of ['fr-CA', 'en']) {
  test(`refund panel distinguishes absent history and retains translated labels in ${locale}`, async (t) => {
    const view = await fixture(t, RefundHistoryComponent, emptyRefund, locale);
    const root = view.nativeElement;
    const copy = catalogs[locale].admin.legacy;
    assert.equal(root.querySelectorAll('article').length, 1);
    assert.equal(root.querySelectorAll('ol').length, 0);
    assert.ok(
      !root.textContent.includes(catalogs[locale].admin.history.newestFirst)
    );
    assert.equal(
      root.querySelector('section').getAttribute('aria-label'),
      copy.historique_remboursement
    );
    for (const key of [
      'suivi_remboursement',
      'aucun_remboursement_n_est_demande_pour_cette_commandite'
    ]) {
      assert.ok(root.textContent.includes(copy[key]), key);
    }
    assert.ok(!root.querySelector('#dossier-refund-timeline-title'));
    assert.ok(!root.querySelector('#dossier-refund-audit-title'));
    assert.ok(
      !root.textContent.includes(catalogs[locale].admin.finance.operationAmount)
    );
    assert.ok(!root.querySelector('[data-og7="dossier-refund-summary"]'));
    assert.ok(!root.textContent.includes(emptyRefund.amountLabel));
    assert.ok(!root.textContent.includes(emptyRefund.publicReferenceLabel));
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
    assert.ok(
      root.textContent.includes(
        copy.legacy
          .aucun_historique_administratif_detaille_n_est_encore_disponible_p
      )
    );
    assert.ok(root.textContent.includes(copy.history.availableScope));
    const button = root.querySelector('button');
    assert.equal(button.type, 'button');
    assert.equal(button.textContent.trim(), copy.history.inspect);
    const intentions = [];
    view.componentInstance.inspect.subscribe((intent) =>
      intentions.push(intent)
    );
    button.click();
    assert.deepEqual(intentions, [undefined]);
    assert.deepEqual(data, { entries: [] });
    assert.equal(root.querySelectorAll('ol').length, 0);
    assert.ok(!root.textContent.includes(copy.history.newestFirst));
    assert.ok(!root.querySelector('[data-og7="dossier-audit-summary"]'));
  });

  test(`audit filters domains without changing event order, available facts or inspection in ${locale}`, async (t) => {
    const entries = Object.freeze([
      Object.freeze({
        id: 'finance-new',
        domain: 'finances',
        dateTimeLabel: 'September 3, 2026',
        label: 'Confirmed refund'
      }),
      Object.freeze({
        id: 'profile',
        domain: 'profile',
        dateTimeLabel: 'September 2, 2026',
        label: 'Sponsor information'
      }),
      Object.freeze({
        id: 'finance-old',
        domain: 'finances',
        dateTimeLabel: 'September 1, 2026',
        label: 'Confirmed payment'
      }),
      Object.freeze({
        id: 'unknown',
        dateTimeLabel: 'August 31, 2026',
        label: 'Unclassified action'
      })
    ]);
    const before = structuredClone(entries);
    const view = await fixture(t, AuditHistoryComponent, { entries }, locale);
    const root = view.nativeElement;
    const copy = catalogs[locale].admin.history;
    const select = root.querySelector('[data-og7="dossier-audit-domain"]');
    assert.equal(
      root.querySelector(`label[for="${select.id}"]`).textContent.trim(),
      copy.filters.domain
    );
    const eventIds = () =>
      Array.from(
        root.querySelectorAll('[data-og7="dossier-audit-events"] li')
      ).map((entry) => entry.getAttribute('data-og7-id'));
    view.componentInstance.setDomainFilter('finances');
    view.detectChanges();
    assert.deepEqual(eventIds(), ['finance-new', 'finance-old']);
    assert.ok(
      root
        .querySelector('[role="status"]')
        .textContent.includes(
          copy.filters.resultCount
            .replace('{{count}}', '2')
            .replace('{{total}}', '4')
        )
    );
    view.componentInstance.setDomainFilter('publication');
    view.detectChanges();
    assert.deepEqual(eventIds(), []);
    assert.equal(
      root
        .querySelector('[data-og7="dossier-audit-filter-empty"]')
        .textContent.trim(),
      copy.filters.empty
    );
    const intentions = [];
    view.componentInstance.inspect.subscribe((intent) =>
      intentions.push(intent)
    );
    root.querySelector('button').click();
    assert.deepEqual(intentions, [undefined]);
    view.componentInstance.setDomainFilter('other');
    view.detectChanges();
    assert.deepEqual(eventIds(), ['unknown']);
    view.componentInstance.setDomainFilter('invalid-domain');
    view.detectChanges();
    assert.deepEqual(eventIds(), ['unknown']);
    view.componentInstance.setDomainFilter('all');
    view.detectChanges();
    assert.deepEqual(
      eventIds(),
      entries.map((entry) => entry.id)
    );
    assert.deepEqual(entries, before);
  });

  for (const [name, component, hook] of [
    ['audit', () => AuditHistoryComponent, 'dossier-audit-events'],
    ['refund', () => RefundHistoryComponent, 'dossier-refund-audit']
  ]) {
    test(`${name} history keeps actor references in a closed disclosure and escapes event content in ${locale}`, async (t) => {
      const hostile = '<img src=x onerror="alert(1)">';
      const rawActor = `admin:synthetic-${'reference'.repeat(30)}${hostile}`;
      const entries = [
        {
          id: 'technical-actor',
          dateTime: '2026-09-03T14:00:00Z',
          dateTimeLabel: 'September 3, 2026',
          label: `Synthetic event ${hostile}`,
          detail: `Synthetic detail ${hostile}`,
          actorLabel: 'Synthetic administrator',
          actorDetail: rawActor
        },
        {
          id: 'readable-actor',
          dateTimeLabel: 'September 2, 2026',
          label: 'Synthetic event with readable actor',
          actorLabel: `Synthetic operator ${hostile}`
        },
        {
          id: 'without-actor',
          dateTimeLabel: 'September 1, 2026',
          label: 'Synthetic event without actor'
        }
      ];
      const data =
        name === 'audit'
          ? { entries }
          : { ...emptyRefund, auditEntries: entries };
      const before = structuredClone(data);
      const view = await fixture(t, component(), data, locale);
      const root = view.nativeElement;
      const list = root.querySelector(`[data-og7="${hook}"]`);
      const technical = list.querySelector('[data-og7-id="technical-actor"]');
      const disclosure = technical.querySelector('details');
      const copy = catalogs[locale].admin;
      assert.ok(disclosure);
      assert.equal(disclosure.hasAttribute('open'), false);
      assert.equal(
        disclosure.querySelector('summary').textContent.trim(),
        `${copy.inspector.fields.actor} : Synthetic administrator`
      );
      assert.equal(disclosure.querySelector('code').textContent, rawActor);
      assert.equal(
        technical.querySelector('small').textContent.trim(),
        entries[0].detail
      );
      assert.ok(technical.textContent.includes(entries[0].label));
      const readable = list.querySelector('[data-og7-id="readable-actor"]');
      assert.ok(!readable.querySelector('details'));
      assert.ok(
        Array.from(readable.querySelectorAll('p')).some((node) =>
          node.textContent.includes(entries[1].actorLabel)
        )
      );
      assert.ok(
        !list
          .querySelector('[data-og7-id="without-actor"]')
          .querySelector('details')
      );
      assert.equal(root.querySelectorAll('img, script, [onerror]').length, 0);
      assert.deepEqual(data, before);
      if (name === 'audit') {
        const summary = root.querySelector(
          '[data-og7="dossier-audit-summary"]'
        );
        assert.ok(
          summary.textContent.includes(
            copy.history.eventCount.replace('{{count}}', '3')
          )
        );
        assert.ok(summary.textContent.includes(copy.history.newestFirst));
        view.componentRef.setInput('view', { entries: [entries[1]] });
        view.detectChanges();
        assert.ok(
          root
            .querySelector('[data-og7="dossier-audit-summary"]')
            .textContent.includes(copy.history.singleEvent)
        );
        assert.equal(root.querySelectorAll('details').length, 0);
        view.componentRef.setInput('view', { entries: [] });
        view.detectChanges();
        assert.ok(!root.querySelector('[data-og7="dossier-audit-summary"]'));
        assert.ok(!root.textContent.includes(copy.history.newestFirst));
      }
    });
  }
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
        dateTime: '2026-09-01T14:00:00Z',
        dateTimeLabel: 'September 1, 2026',
        label: 'Request recorded',
        stateClass: 'refund-history-requested'
      }),
      Object.freeze({
        id: 'processing',
        dateTime: '2026-09-02T14:00:00Z',
        dateTimeLabel: 'September 2, 2026',
        label: 'Processing started',
        detail: 'No final confirmation',
        stateClass: 'refund-history-processing'
      })
    ]),
    auditEntries: Object.freeze([
      Object.freeze({
        id: 'admin-action',
        dateTime: '2026-09-02T14:00:00Z',
        dateTimeLabel: 'September 2, 2026',
        label: 'Server audit',
        detail: 'Synthetic refund details',
        actorLabel: 'Synthetic operator'
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
    Array.from(root.querySelectorAll('.compact-definition-list dd')).map(
      (node) => node.textContent.trim()
    ),
    [data.refundNote, data.refundError]
  );
  const timeline = assertNamedHistoryList(
    root,
    'dossier-refund-timeline',
    catalogs['fr-CA'].admin.legacy.jalons_remboursement
  );
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
  assert.deepEqual(
    Array.from(timeline.querySelectorAll('time')).map((node) =>
      node.getAttribute('datetime')
    ),
    ['2026-09-01T14:00:00Z', '2026-09-02T14:00:00Z']
  );
  const audit = assertNamedHistoryList(
    root,
    'dossier-refund-audit',
    catalogs['fr-CA'].admin.legacy.actions_admin_liees
  );
  assert.ok(audit.textContent.includes('Synthetic operator'));
  assert.equal(audit.querySelectorAll('details').length, 0);
  assert.equal(
    root
      .querySelector('[data-og7="dossier-refund-audit"] li')
      .getAttribute('data-og7-id'),
    'admin-action'
  );
  assert.deepEqual(data, before);

  view.componentRef.setInput('view', emptyRefund);
  view.detectChanges();
  assert.equal(
    root.querySelectorAll('ol, .compact-definition-list dd').length,
    0
  );
  assert.ok(!root.textContent.includes('Synthetic operator'));
  assert.ok(!root.textContent.includes(data.refundNote));
});

test('audit panel preserves projected event order and replaces the selected dossier history', async (t) => {
  const entries = Object.freeze([
    Object.freeze({
      id: 'newest',
      dateTime: '2026-09-03T14:00:00Z',
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
  const list = assertNamedHistoryList(
    root,
    'dossier-audit-events',
    catalogs['fr-CA'].admin.legacy.historique_disponible
  );
  assert.deepEqual(
    Array.from(root.querySelectorAll('li')).map((node) =>
      node.getAttribute('data-og7-id')
    ),
    ['newest', 'oldest']
  );
  assert.equal(root.querySelectorAll('small').length, 1);
  assert.equal(root.querySelectorAll('button').length, 1);
  assert.deepEqual(
    Array.from(list.querySelectorAll('time')).map(
      (node) => node.getAttribute('datetime') ?? null
    ),
    ['2026-09-03T14:00:00Z', null]
  );
  assert.ok(
    root.textContent.includes(catalogs['fr-CA'].admin.history.newestFirst)
  );
  assert.ok(
    root
      .querySelector('[data-og7="dossier-audit-summary"]')
      .textContent.includes(
        catalogs['fr-CA'].admin.history.eventCount.replace('{{count}}', '2')
      )
  );

  view.componentRef.setInput('view', {
    entries: [
      { id: 'other', dateTimeLabel: 'Other date', label: 'Other dossier' }
    ]
  });
  view.detectChanges();
  assert.equal(root.querySelectorAll('li').length, 1);
  assert.ok(root.textContent.includes('Other dossier'));
  assert.ok(!root.textContent.includes('Private audit detail'));
  assert.ok(
    root
      .querySelector('[data-og7="dossier-audit-summary"]')
      .textContent.includes(catalogs['fr-CA'].admin.history.singleEvent)
  );
  assert.deepEqual(
    entries.map((entry) => entry.id),
    ['newest', 'oldest']
  );
});
