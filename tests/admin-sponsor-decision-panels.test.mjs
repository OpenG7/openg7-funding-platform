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

const componentDirectory =
  'apps/funding-web/src/app/features/funding/components/admin-sponsors';
const componentFiles = [
  'admin-sponsor-rejection-panel.component.ts',
  'admin-sponsor-refund-panel.component.ts',
  'admin-sponsor-decision-actions.component.ts'
];
const catalogs = Object.fromEntries(
  ['fr-CA', 'en'].map((locale) => [
    locale,
    JSON.parse(
      readFileSync(`apps/funding-web/src/assets/i18n/${locale}.json`, 'utf8')
    )
  ])
);
let compiledDirectory;
let RejectionPanel;
let RefundPanel;
let DecisionActions;

before(async () => {
  // Compile the real signal inputs, templates and component-scoped styles.
  // The server DOM lets the tests exercise bindings without HTTP or a browser.
  compiledDirectory = mkdtempSync(join(tmpdir(), 'openg7-sponsor-decisions-'));
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
    rootNames: componentFiles.map((name) => resolve(componentDirectory, name)),
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
  const compiled = await Promise.all(
    componentFiles.map(
      (name) =>
        import(
          pathToFileURL(
            join(
              compiledDirectory,
              componentDirectory,
              name.replace(/\.ts$/, '.js')
            )
          ).href
        )
    )
  );
  RejectionPanel = compiled[0].AdminSponsorRejectionPanelComponent;
  RefundPanel = compiled[1].AdminSponsorRefundPanelComponent;
  DecisionActions = compiled[2].AdminSponsorDecisionActionsComponent;
  TestBed.initTestEnvironment(
    [BrowserTestingModule, ServerModule],
    platformServer()
  );
});

after(() => {
  TestBed.resetTestEnvironment();
  if (
    compiledDirectory &&
    compiledDirectory.startsWith(join(tmpdir(), 'openg7-sponsor-decisions-'))
  ) {
    rmSync(compiledDirectory, { recursive: true, force: true });
  }
});

const sponsorship = Object.freeze({
  id: 'synthetic-sponsor',
  public_reference: 'SYNTHETIC-401',
  sponsor_company_name: 'Synthetic company',
  sponsor_review_status: 'approved',
  amount: 500,
  currency: 'CAD',
  version: 'synthetic-version-1'
});
const rejectionDraft = Object.freeze({
  notifySponsor: true,
  recipientEmail: 'synthetic@example.test',
  sponsorMessage: 'Synthetic refusal message',
  refundHandling: 'manual_required',
  refundNote: 'Synthetic manual follow-up'
});
const refundDraft = Object.freeze({
  notifySponsor: true,
  recipientEmail: 'synthetic@example.test',
  sponsorMessage: 'Synthetic refund message',
  refundAmount: '25.50',
  refundReason: 'duplicate',
  confirmationText: 'SYNTHETIC-401',
  refundNote: 'Synthetic refund note'
});

async function fixture(t, component, inputs, locale = 'fr-CA') {
  TestBed.configureTestingModule({
    imports: [component],
    providers: [provideTranslateService()]
  });
  const translate = TestBed.inject(TranslateService);
  translate.setTranslation(locale, catalogs[locale]);
  await firstValueFrom(translate.use(locale));
  const view = TestBed.createComponent(component);
  for (const [name, value] of Object.entries(inputs))
    view.componentRef.setInput(name, value);
  view.detectChanges();
  t.after(() => TestBed.resetTestingModule());
  return view;
}

const rejectionInputs = (overrides = {}) => ({
  draft: rejectionDraft,
  reviewNote: 'Synthetic internal reason',
  validationMessage: 'Synthetic refusal validation',
  canConfirm: true,
  actionsDisabled: false,
  actionPending: false,
  busy: false,
  ...overrides
});
const refundInputs = (overrides = {}) => ({
  sponsorship,
  draft: refundDraft,
  confirmationText: 'SYNTHETIC-401',
  draftAmountLabel: '25,50 $ CA',
  paymentAmountLabel: '500,00 $ CA',
  validationMessage: 'Synthetic refund validation',
  canConfirm: true,
  actionsDisabled: false,
  pending: false,
  busy: false,
  ...overrides
});
const actionInputs = (overrides = {}) => ({
  sponsorship,
  financeTab: false,
  ownerActions: true,
  actionsDisabled: false,
  canApprove: true,
  canRefund: true,
  approvalState: 'idle',
  reviewMessage: 'Synthetic server-backed message',
  anchor: 'dossier-review',
  ...overrides
});

function dispatch(element, type, value) {
  if (typeof value === 'boolean') element.checked = value;
  else element.value = value;
  const event = element.ownerDocument.createEvent('Event');
  event.initEvent(type, true, true);
  element.dispatchEvent(event);
  return event;
}

test('refusal renders retained inputs and emits edits without changing its parent-owned draft', async (t) => {
  const view = await fixture(t, RejectionPanel, rejectionInputs());
  const element = view.nativeElement;
  assert.equal(
    element.querySelector('[data-og7="dossier-rejection-form"]') !== null,
    true
  );
  const textareas = Array.from(element.querySelectorAll('textarea'));
  assert.deepEqual(
    textareas.map((field) => field.value),
    [
      'Synthetic internal reason',
      rejectionDraft.sponsorMessage,
      rejectionDraft.refundNote
    ]
  );
  assert.equal(element.querySelector('select').value, 'manual_required');
  const changes = [];
  const notes = [];
  view.componentInstance.draftFieldChange.subscribe((event) =>
    changes.push(event)
  );
  view.componentInstance.reviewNoteChange.subscribe((event) =>
    notes.push(event)
  );
  const noteEvent = dispatch(textareas[0], 'input', 'Synthetic revised reason');
  const messageEvent = dispatch(
    textareas[1],
    'input',
    'Synthetic revised message'
  );
  const emailEvent = dispatch(
    element.querySelector('input[type="email"]'),
    'input',
    'synthetic-revised@example.test'
  );
  const refundNoteEvent = dispatch(
    textareas[2],
    'input',
    'Synthetic revised note'
  );
  assert.deepEqual(notes, [noteEvent]);
  assert.deepEqual(changes, [
    { field: 'sponsorMessage', event: messageEvent },
    { field: 'recipientEmail', event: emailEvent },
    { field: 'refundNote', event: refundNoteEvent }
  ]);
  assert.equal(view.componentInstance.draft(), rejectionDraft);
  assert.equal(rejectionDraft.sponsorMessage, 'Synthetic refusal message');
  assert.equal(
    textareas[0].getAttribute('aria-describedby'),
    'sponsor-rejection-validation'
  );
});

test('refusal cancellation, validation and shared lock retain their existing controls', async (t) => {
  const view = await fixture(t, RejectionPanel, rejectionInputs());
  const cancels = [];
  const confirms = [];
  view.componentInstance.cancelled.subscribe(() => cancels.push('cancel'));
  view.componentInstance.confirmed.subscribe(() => confirms.push('confirm'));
  const buttons = Array.from(view.nativeElement.querySelectorAll('button'));
  buttons[0].click();
  buttons[1].click();
  buttons[2].click();
  assert.deepEqual(cancels, ['cancel', 'cancel']);
  assert.deepEqual(confirms, ['confirm']);
  view.componentRef.setInput('canConfirm', false);
  view.detectChanges();
  assert.equal(buttons[2].disabled, true);
  assert.equal(
    view.nativeElement
      .querySelector('#sponsor-rejection-validation')
      .textContent.trim(),
    'Synthetic refusal validation'
  );
  view.componentRef.setInput('canConfirm', true);
  view.componentRef.setInput('actionsDisabled', true);
  view.componentRef.setInput('actionPending', true);
  view.componentRef.setInput('busy', true);
  view.detectChanges();
  assert.deepEqual(
    buttons.map((button) => button.disabled),
    [true, true, true]
  );
  assert.equal(buttons[2].textContent.trim(), 'Refus en cours...');
});

test('refusal notification and manual handling changes remain separate intentions', async (t) => {
  const view = await fixture(
    t,
    RejectionPanel,
    rejectionInputs({ draft: { ...rejectionDraft, notifySponsor: false } })
  );
  const element = view.nativeElement;
  assert.equal(element.querySelector('input[type="email"]').disabled, true);
  const notifications = [];
  const handlings = [];
  view.componentInstance.notifySponsorChange.subscribe((event) =>
    notifications.push(event)
  );
  view.componentInstance.refundHandlingChange.subscribe((event) =>
    handlings.push(event)
  );
  const checkboxEvent = dispatch(
    element.querySelector('input[type="checkbox"]'),
    'change',
    true
  );
  const handlingEvent = dispatch(
    element.querySelector('select'),
    'change',
    'manual_completed'
  );
  assert.deepEqual(notifications, [checkboxEvent]);
  assert.deepEqual(handlings, [handlingEvent]);
});

test('refund preserves amount, reason, exact target, notification and note edits', async (t) => {
  const view = await fixture(t, RefundPanel, refundInputs());
  const element = view.nativeElement;
  const amount = element.querySelector('input[type="number"]');
  assert.equal(amount.value, '25.50');
  assert.equal(amount.max, '500');
  assert.equal(amount.step, '0.01');
  assert.equal(amount.getAttribute('inputmode'), 'decimal');
  assert.equal(element.querySelector('select').value, 'duplicate');
  assert.equal(
    element.querySelector('code').textContent.trim(),
    'SYNTHETIC-401'
  );
  const warning = element.querySelector('#sponsor-refund-warning').textContent;
  assert.match(warning, /25,50 \$ CA/);
  assert.match(warning, /500,00 \$ CA/);
  const changes = [];
  const reasons = [];
  const notifications = [];
  view.componentInstance.draftFieldChange.subscribe((event) =>
    changes.push(event)
  );
  view.componentInstance.reasonChange.subscribe((event) => reasons.push(event));
  view.componentInstance.notifySponsorChange.subscribe((event) =>
    notifications.push(event)
  );
  const fieldElements = [
    ['refundAmount', amount, '12.75'],
    [
      'confirmationText',
      element.querySelector('input[type="text"]'),
      'SYNTHETIC-401'
    ],
    [
      'recipientEmail',
      element.querySelector('input[type="email"]'),
      'synthetic-other@example.test'
    ],
    [
      'sponsorMessage',
      element.querySelectorAll('textarea')[0],
      'Synthetic revised refund message'
    ],
    [
      'refundNote',
      element.querySelectorAll('textarea')[1],
      'Synthetic revised refund note'
    ]
  ];
  const expected = fieldElements.map(([field, control, value]) => ({
    field,
    event: dispatch(control, 'input', value)
  }));
  const reasonEvent = dispatch(
    element.querySelector('select'),
    'change',
    'fraudulent'
  );
  const notifyEvent = dispatch(
    element.querySelector('input[type="checkbox"]'),
    'change',
    false
  );
  assert.deepEqual(changes, expected);
  assert.deepEqual(reasons, [reasonEvent]);
  assert.deepEqual(notifications, [notifyEvent]);
  assert.equal(view.componentInstance.draft(), refundDraft);
  assert.equal(refundDraft.refundAmount, '25.50');
  assert.equal(
    amount.getAttribute('aria-describedby'),
    'sponsor-refund-warning sponsor-refund-validation'
  );
});

test('refund validation, cancellation and notification controls obey parent state', async (t) => {
  const view = await fixture(
    t,
    RefundPanel,
    refundInputs({
      canConfirm: false,
      draft: { ...refundDraft, notifySponsor: false }
    })
  );
  const buttons = Array.from(view.nativeElement.querySelectorAll('button'));
  assert.equal(buttons[2].disabled, true);
  assert.equal(
    view.nativeElement.querySelector('input[type="email"]').disabled,
    true
  );
  assert.equal(view.nativeElement.querySelector('textarea').disabled, true);
  const cancels = [];
  const confirms = [];
  view.componentInstance.cancelled.subscribe(() => cancels.push('cancel'));
  view.componentInstance.confirmed.subscribe(() => confirms.push('confirm'));
  buttons[0].click();
  buttons[1].click();
  assert.deepEqual(cancels, ['cancel', 'cancel']);
  view.componentRef.setInput('canConfirm', true);
  view.detectChanges();
  buttons[2].click();
  assert.deepEqual(confirms, ['confirm']);
  view.componentRef.setInput('actionsDisabled', true);
  view.componentRef.setInput('busy', true);
  view.componentRef.setInput('pending', true);
  view.detectChanges();
  assert.deepEqual(
    buttons.map((button) => button.disabled),
    [true, true, true]
  );
  assert.match(buttons[2].textContent, /Remboursement/);
  assert.equal(
    view.nativeElement
      .querySelector('#sponsor-refund-validation')
      .textContent.trim(),
    'Synthetic refund validation'
  );
});

for (const [name, getComponent, getInputs, lockInput, confirmationLabel] of [
  [
    'refusal',
    () => RejectionPanel,
    rejectionInputs,
    'actionPending',
    'Confirmer le refus'
  ],
  ['refund', () => RefundPanel, refundInputs, 'pending', 'Rembourser Stripe']
]) {
  test(`${name} blocks cancellation during another shared action without reporting its own request pending`, async (t) => {
    const view = await fixture(
      t,
      getComponent(),
      getInputs({ [lockInput]: true, actionsDisabled: true, busy: false })
    );
    const buttons = Array.from(view.nativeElement.querySelectorAll('button'));
    assert.deepEqual(
      buttons.map((button) => button.disabled),
      [true, true, true]
    );
    assert.equal(buttons[2].textContent.trim(), confirmationLabel);
    view.componentRef.setInput(lockInput, false);
    view.componentRef.setInput('actionsDisabled', false);
    view.detectChanges();
    assert.deepEqual(
      buttons.map((button) => button.disabled),
      [false, false, false]
    );
  });
}

test('review action bar emits intentions and renders its anchor and live message', async (t) => {
  const view = await fixture(t, DecisionActions, actionInputs());
  const emitted = [];
  for (const name of ['returnPending', 'openRejection', 'approve'])
    view.componentInstance[name].subscribe(() => emitted.push(name));
  const element = view.nativeElement;
  assert.equal(
    element.querySelector('#dossier-review').getAttribute('data-og7'),
    'dossier-actions'
  );
  assert.equal(
    element.querySelector('[role="status"]').textContent.trim(),
    'Synthetic server-backed message'
  );
  const buttons = Array.from(element.querySelectorAll('button'));
  assert.equal(buttons.length, 3);
  for (const button of buttons) button.click();
  assert.deepEqual(emitted, ['returnPending', 'openRejection', 'approve']);
  view.componentRef.setInput('actionsDisabled', true);
  view.detectChanges();
  assert.deepEqual(
    buttons.map((button) => button.disabled),
    [true, true, true]
  );
});

test('financial action bar keeps owner permissions and refund eligibility', async (t) => {
  const view = await fixture(
    t,
    DecisionActions,
    actionInputs({ financeTab: true, ownerActions: false, anchor: null })
  );
  assert.equal(view.nativeElement.querySelectorAll('button').length, 0);
  assert.equal(
    view.nativeElement.querySelector('section').hasAttribute('id'),
    false
  );
  view.componentRef.setInput('ownerActions', true);
  view.componentRef.setInput('canRefund', false);
  view.detectChanges();
  const button = view.nativeElement.querySelector('button');
  assert.equal(button.disabled, true);
  view.componentRef.setInput('canRefund', true);
  view.detectChanges();
  const intentions = [];
  view.componentInstance.openRefund.subscribe(() => intentions.push('refund'));
  button.click();
  assert.deepEqual(intentions, ['refund']);
  assert.equal(
    Boolean(
      view.nativeElement.querySelector('[data-og7="sponsorship-approve"]')
    ),
    false
  );
});

test('approval renders server-backed pending, success and error phases without inventing success', async (t) => {
  const view = await fixture(
    t,
    DecisionActions,
    actionInputs({ canApprove: false })
  );
  const button = view.nativeElement.querySelector(
    '[data-og7="sponsorship-approve"]'
  );
  assert.equal(button.disabled, true);
  assert.equal(button.getAttribute('data-state'), 'idle');
  for (const phase of ['pending', 'success', 'error']) {
    view.componentRef.setInput('approvalState', phase);
    view.detectChanges();
    assert.equal(button.getAttribute('data-state'), phase);
    assert.equal(button.getAttribute('aria-busy'), String(phase === 'pending'));
    assert.equal(
      view.nativeElement
        .querySelector('section')
        .getAttribute('data-approval-state'),
      phase
    );
  }
  assert.equal(button.querySelectorAll('[aria-hidden="true"]').length, 3);
});

for (const [name, getComponent, getInputs, method, selector] of [
  [
    'rejection reason',
    () => RejectionPanel,
    rejectionInputs,
    'focusReason',
    'textarea'
  ],
  [
    'refund amount',
    () => RefundPanel,
    refundInputs,
    'focusAmount',
    'input[type="number"]'
  ],
  [
    'reject button',
    () => DecisionActions,
    actionInputs,
    'focusRejectButton',
    'button'
  ],
  [
    'refund button',
    () => DecisionActions,
    () => actionInputs({ financeTab: true }),
    'focusRefundButton',
    'button'
  ],
  [
    'approval button',
    () => DecisionActions,
    actionInputs,
    'focusApprovalButton',
    '[data-og7="sponsorship-approve"]'
  ]
]) {
  test(`moved ${name} exposes the rendered local focus target`, async (t) => {
    const view = await fixture(t, getComponent(), getInputs());
    const control =
      view.nativeElement.querySelectorAll(selector)[
        method === 'focusRejectButton' ? 1 : 0
      ];
    const focuses = [];
    Object.defineProperty(control, 'focus', {
      value: (options) => focuses.push(options)
    });
    view.componentInstance[method]();
    assert.deepEqual(focuses, [
      method.endsWith('Button') ? { preventScroll: true } : undefined
    ]);
  });
}

test('focus restoration tolerates action buttons absent from the current tab or permissions', async (t) => {
  const view = await fixture(
    t,
    DecisionActions,
    actionInputs({ financeTab: true, ownerActions: false })
  );
  for (const method of [
    'focusRejectButton',
    'focusRefundButton',
    'focusApprovalButton'
  ])
    assert.doesNotThrow(() => view.componentInstance[method]());
});

for (const locale of ['fr-CA', 'en']) {
  for (const [name, getComponent, getInputs, expected] of [
    [
      'refusal',
      () => RejectionPanel,
      rejectionInputs,
      locale === 'en' ? 'Cancel' : 'Annuler'
    ],
    [
      'refund',
      () => RefundPanel,
      refundInputs,
      locale === 'en' ? 'Cancel' : 'Annuler'
    ],
    [
      'actions',
      () => DecisionActions,
      actionInputs,
      locale === 'en' ? 'Accept' : 'Accepter'
    ]
  ]) {
    test(`${name} renders ${locale} labels and no unresolved translation keys`, async (t) => {
      const view = await fixture(t, getComponent(), getInputs(), locale);
      assert.match(view.nativeElement.textContent, new RegExp(expected));
      assert.doesNotMatch(
        view.nativeElement.textContent,
        /admin\.(legacy|dossier|messages)\./
      );
    });
  }
}

test('decision surfaces keep encapsulation, sticky host, mobile and reduced motion styles', () => {
  for (const component of [RejectionPanel, RefundPanel, DecisionActions]) {
    assert.equal(component.ɵcmp.encapsulation, 0);
    const styles = component.ɵcmp.styles.join('\n');
    assert.match(styles, /max-width: 860px/);
    assert.match(styles, /focus-visible/);
  }
  const styles = DecisionActions.ɵcmp.styles.join('\n');
  assert.match(styles, /\[_nghost-%COMP%\]\s*\{[^}]*position: sticky/s);
  assert.match(styles, /max-width: 600px/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
  assert.match(styles, /animation: none/);
  assert.match(styles, /approval-button\[data-state='pending'\]/);
  assert.match(styles, /approval-button\[data-state='success'\]/);
  assert.match(styles, /approval-button\[data-state='error'\]/);
});
