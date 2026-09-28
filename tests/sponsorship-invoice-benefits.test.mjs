import assert from 'node:assert/strict';
import test from 'node:test';

import { formatSponsorshipBenefitList } from '../dist/apps/funding-api/src/sponsorship-benefits.js';

test('sponsorship benefits follow the paid amount, including custom amounts and tier boundaries', () => {
  for (const [amountCents, expected] of [
    [4999, []],
    [5000, ['OpenG7.org']],
    [10000, ['OpenG7.org']],
    [24999, ['OpenG7.org']],
    [25000, ['OpenG7.org', 'Facebook']],
    [37550, ['OpenG7.org', 'Facebook']],
    [49999, ['OpenG7.org', 'Facebook']],
    [50000, ['OpenG7.org', 'Facebook', 'LinkedIn']],
    [75000, ['OpenG7.org', 'Facebook', 'LinkedIn']]
  ]) {
    const benefits = formatSponsorshipBenefitList(amountCents / 100, 'cad');
    for (const label of ['OpenG7.org', 'Facebook', 'LinkedIn']) {
      assert.equal(
        benefits.some((benefit) => benefit.includes(label)),
        expected.includes(label),
        `${amountCents} minor units: ${label}`
      );
    }
    assert.equal(benefits.length, expected.length || 1);
    if (!expected.length) assert.match(benefits[0], /Aucun avantage/);
  }
});

test('CAD benefits are not promised by applying CAD thresholds to another currency', () => {
  assert.deepEqual(formatSponsorshipBenefitList(500, 'USD'), [
    'Avantages de visibilité à confirmer pour cette devise.'
  ]);
});
