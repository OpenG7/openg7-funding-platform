import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

import {
  computeGlowIntensity,
  computeGlowSpread,
  isPresetSelected,
  normalizeProgress
} from '../dist/apps/funding-web/src/app/features/funding/models/funding-visual.utils.js';

test('Progress normalization clamps values to 0..100', () => {
  assert.equal(normalizeProgress(-8), 0);
  assert.equal(normalizeProgress(50), 50);
  assert.equal(normalizeProgress(1000), 100);
});

test('Guardian halo intensity is stable for 0, 50 and 100 percent', () => {
  const values = [0, 50, 100].map((value) => ({
    intensity: computeGlowIntensity(value),
    spread: computeGlowSpread(value)
  }));

  assert.ok(values[0].intensity < values[1].intensity);
  assert.ok(values[1].intensity < values[2].intensity);
  assert.ok(values[0].spread < values[1].spread);
  assert.ok(values[1].spread < values[2].spread);
  assert.ok(values.every((value) => Number.isFinite(value.intensity)));
  assert.ok(values.every((value) => Number.isFinite(value.spread)));
});

test('Contribution selector selected state helper is deterministic', () => {
  assert.equal(isPresetSelected(25, 25), true);
  assert.equal(isPresetSelected(25, 10), false);
});

test('Funding i18n titles contain hero panel keys in both locales', () => {
  const fr = JSON.parse(
    fs.readFileSync('apps/funding-web/src/assets/i18n/fr-CA.json', 'utf8')
  );
  const en = JSON.parse(
    fs.readFileSync('apps/funding-web/src/assets/i18n/en.json', 'utf8')
  );

  assert.ok(fr.funding.transparency.title);
  assert.ok(fr.funding.allocation.title);
  assert.ok(fr.funding.map.title);
  assert.ok(en.funding.transparency.title);
  assert.ok(en.funding.allocation.title);
  assert.ok(en.funding.map.title);
});

test('Visual-only state is not moved to NgRx funding store', () => {
  const storeSource = fs.readFileSync(
    'apps/funding-web/src/app/features/funding/services/funding.store.ts',
    'utf8'
  );

  assert.equal(/glow|hover|animation|panel|viewport/i.test(storeSource), false);
});

test('Reduced motion media query exists in global styles', () => {
  const styles = fs.readFileSync('apps/funding-web/src/styles.css', 'utf8');
  assert.ok(styles.includes('@media (prefers-reduced-motion: reduce)'));
});
