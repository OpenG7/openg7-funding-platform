import '@angular/compiler';
import {
  createEnvironmentInjector,
  Injector,
  runInInjectionContext,
  signal
} from '@angular/core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { FundingTransparencyRegistryComponent } from '../dist/apps/funding-web/src/app/features/funding/components/funding-transparency-registry/funding-transparency-registry.component.js';

const componentPath =
  'apps/funding-web/src/app/features/funding/components/funding-transparency-registry/funding-transparency-registry.component';
const source = fs.readFileSync(`${componentPath}.ts`, 'utf8');
const template = fs.readFileSync(`${componentPath}.html`, 'utf8');
const styles = fs.readFileSync(`${componentPath}.css`, 'utf8');
const monthlySummary = Object.freeze([
  Object.freeze({
    month: '2026-09',
    currency: 'CAD',
    total_received: 50,
    total_fees: 1,
    total_net: 49,
    total_refunded: 2,
    total_payouts: 3,
    contributions_count: 1,
    email_private: 'private@example.test'
  }),
  Object.freeze({
    month: '2026-08',
    currency: 'CAD',
    total_received: 100,
    total_fees: 2,
    total_net: 98,
    total_refunded: 0,
    total_payouts: 0,
    contributions_count: 1
  })
]);

function fixture(t, values = {}) {
  const injector = createEnvironmentInjector([], Injector.NULL);
  t.after(() => injector.destroy());
  const component = runInInjectionContext(
    injector,
    () => new FundingTransparencyRegistryComponent()
  );
  const inputs = Object.fromEntries(
    Object.entries({
      monthlySummary,
      availableMonths: ['2026-09', '2026-08'],
      period: 'all',
      filter: 'all',
      hasSnapshot: true,
      loading: false,
      periodUnavailable: false,
      formatMoney: (value, currency) => `${value} ${currency}`,
      ...values
    }).map(([name, value]) => [name, signal(value)])
  );
  Object.assign(component, inputs);
  return { component, inputs };
}

test('registry projects only the selected public fields and preserves nonzero financial facts', (t) => {
  const { component } = fixture(t);
  assert.deepEqual(component.registryFilters, [
    'all',
    'contributions',
    'fees',
    'refunds'
  ]);
  assert.deepEqual(component.registryRows(), [
    {
      type: 'contributions',
      amount: 50,
      id: '2026-09-contributions',
      month: '2026-09',
      currency: 'CAD'
    },
    {
      type: 'fees',
      amount: 1,
      id: '2026-09-fees',
      month: '2026-09',
      currency: 'CAD'
    },
    {
      type: 'refunds',
      amount: 2,
      id: '2026-09-refunds',
      month: '2026-09',
      currency: 'CAD'
    },
    {
      type: 'contributions',
      amount: 100,
      id: '2026-08-contributions',
      month: '2026-08',
      currency: 'CAD'
    },
    {
      type: 'fees',
      amount: 2,
      id: '2026-08-fees',
      month: '2026-08',
      currency: 'CAD'
    }
  ]);
  assert.doesNotMatch(JSON.stringify(component.registryRows()), /private/);
});

test('period and type inputs update only the registry projection without mutating the snapshot', (t) => {
  const { component, inputs } = fixture(t);
  const original = JSON.stringify(monthlySummary);
  inputs.period.set('2026-09');
  inputs.filter.set('refunds');
  assert.deepEqual(
    component.registryRows().map(({ id, amount }) => ({ id, amount })),
    [{ id: '2026-09-refunds', amount: 2 }]
  );
  inputs.period.set('2026-08');
  assert.deepEqual(component.registryRows(), []);
  inputs.filter.set('fees');
  assert.deepEqual(
    component.registryRows().map(({ id, amount }) => ({ id, amount })),
    [{ id: '2026-08-fees', amount: 2 }]
  );
  inputs.period.set('all');
  assert.equal(component.registryRows().length, 2);
  assert.equal(JSON.stringify(monthlySummary), original);
});

test('confirmed zero, unavailable snapshots and valid absent periods retain distinct messages', (t) => {
  const { component, inputs } = fixture(t, {
    monthlySummary: [
      {
        ...monthlySummary[0],
        total_received: 0,
        total_fees: 0,
        total_refunded: 0
      }
    ]
  });
  assert.deepEqual(component.registryRows(), []);
  assert.equal(
    component.emptyStateKey(),
    'funding.transparencyPage.registry.empty'
  );
  inputs.hasSnapshot.set(false);
  assert.equal(
    component.emptyStateKey(),
    'funding.transparencyPage.state.unavailable'
  );
  inputs.hasSnapshot.set(true);
  inputs.period.set('2026-07');
  inputs.periodUnavailable.set(true);
  assert.deepEqual(component.registryRows(), []);
  assert.equal(
    component.emptyStateKey(),
    'funding.transparencyPage.state.unavailable'
  );
  assert.match(template, /@if \(periodUnavailable\(\)\)/);
  assert.match(template, /<option \[value\]="period\(\)">/);
  assert.match(
    template,
    /periodUnavailable\(\) && hasSnapshot\(\) && !loading\(\)/
  );
});

test('retained snapshots keep their registry facts during loading and fee completeness stays unchanged', (t) => {
  const { component, inputs } = fixture(t);
  const rows = component.registryRows();
  inputs.loading.set(true);
  assert.deepEqual(component.registryRows(), rows);
  for (const pending_fee_count of [undefined, null, 0, 1]) {
    inputs.monthlySummary.set(
      monthlySummary.map((row) => ({ ...row, pending_fee_count }))
    );
    assert.deepEqual(component.registryRows(), rows);
  }
  inputs.hasSnapshot.set(false);
  assert.deepEqual(component.registryRows(), []);
});

test('typed outputs carry selections without changing the controlled input state', (t) => {
  const { component } = fixture(t);
  const periods = [];
  const filters = [];
  component.periodChange.subscribe((period) => periods.push(period));
  component.filterChange.subscribe((filter) => filters.push(filter));
  component.periodChange.emit('2026-09');
  component.filterChange.emit('fees');
  assert.deepEqual(periods, ['2026-09']);
  assert.deepEqual(filters, ['fees']);
  assert.equal(component.period(), 'all');
  assert.equal(component.filter(), 'all');
  assert.match(source, /periodChange = output<string>\(\)/);
  assert.match(source, /filterChange = output<TransparencyRegistryFilter>\(\)/);
  assert.match(template, /\(ngModelChange\)="periodChange.emit\(\$event\)"/);
  assert.match(template, /\(click\)="filterChange.emit\(registryFilter\)"/);
});

test('registry retains translated keyboard controls, table semantics and responsive encapsulated styles', () => {
  assert.match(source, /ChangeDetectionStrategy.OnPush/);
  assert.match(source, /input.required<readonly PublicMonthlySummary\[\]>/);
  assert.doesNotMatch(
    source,
    /FundTransparencyService|HttpClient|Router|document|window/
  );
  assert.match(template, /id="public-registry"[\s\S]*?tabindex="-1"/);
  assert.match(template, /aria-labelledby="registry-title"/);
  assert.match(template, /data-og7="transparency-period"/);
  assert.match(template, /\[disabled\]="!hasSnapshot\(\)"/);
  assert.match(
    template,
    /\[attr.aria-pressed\]="filter\(\) === registryFilter"/
  );
  assert.match(template, /role="group"/);
  assert.match(template, /role="status"/);
  assert.match(template, /<caption>/);
  assert.equal((template.match(/scope="col"/g) ?? []).length, 3);
  assert.match(template, /formatMoney\(\)\(row.amount, row.currency\)/);
  assert.match(styles, /:host\s*\{[^}]*display: grid;[^}]*min-width: 0;/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /\.table-wrap\s*\{\s*overflow: auto;/);
  assert.match(styles, /@media \(max-width: 540px\)/);
});
