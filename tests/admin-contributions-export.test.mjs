import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  buildAdminContributionsCsv,
  parseContributionExport
} from '../dist/apps/funding-api/src/admin-contributions-export.service.js';

const selection = () => ({
  confirmation: 'export_private_contributions',
  contributions: [
    { id: randomUUID(), expectedVersion: '2026-09-24 12:00:00.123456+00' }
  ]
});

test('private export requires explicit confirmation and a bounded, unique, versioned selection', () => {
  const valid = selection();
  assert.deepEqual(parseContributionExport(valid), valid);
  for (const value of [
    null,
    [],
    {},
    { ...valid, confirmation: true },
    { ...valid, confirmation: undefined },
    { ...valid, contributions: [] },
    {
      ...valid,
      contributions: [valid.contributions[0], valid.contributions[0]]
    },
    {
      ...valid,
      contributions: [
        valid.contributions[0],
        {
          ...valid.contributions[0],
          id: valid.contributions[0].id.toUpperCase()
        }
      ]
    },
    { ...valid, search: 'private@person.test' },
    { ...valid, contributions: [{ id: randomUUID() }] },
    { ...valid, contributions: [{ id: 'bad', expectedVersion: 'yesterday' }] },
    {
      ...valid,
      contributions: Array.from(
        { length: 251 },
        () => selection().contributions[0]
      )
    }
  ]) {
    assert.throws(
      () => parseContributionExport(value),
      (error) => error.status === 400
    );
  }
});

test('CSV keeps quoted multiline values and neutralizes formula prefixes without modifying stored values', () => {
  const row = {
    id: randomUUID(),
    amount: 42.5,
    currency: 'CAD',
    public_name: 'Entreprise, "Québec"\nLigne 2'
  };
  let csv = buildAdminContributionsCsv([row]);
  assert.ok(csv.includes('"Entreprise, ""Québec""\nLigne 2"'));
  assert.ok(csv.includes('"42.5","CAD"'));
  for (const value of [
    '=1+1',
    '+SUM(1,2)',
    '-1+2',
    '@SUM(1,2)',
    ' \t=1+1',
    '\r=1',
    '\n=1',
    '\ttexte',
    '＝1+1',
    '＋1',
    '－1',
    '＠SUM(1,2)'
  ]) {
    row.public_name = value;
    csv = buildAdminContributionsCsv([row]);
    assert.ok(csv.includes('"\'' + value.replaceAll('"', '""') + '"'));
    assert.equal(row.public_name, value);
  }
  assert.ok(!csv.split('\r\n')[0].includes('notes_admin'));
  assert.ok(!csv.split('\r\n')[0].includes('token'));
});
