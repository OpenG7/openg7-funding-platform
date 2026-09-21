import assert from 'node:assert/strict';
import test from 'node:test';
import {
  editorialIntent,
  editorialVariant,
  composeProgramme,
  programmeWarnings
} from '../dist/packages/funding-core/src/editorial-programme.js';

test('editorial instructions are bounded; transformations preserve protected facts and disclosures', () => {
  assert.equal(editorialIntent('Raccourcis le texte'), 'concise');
  assert.equal(
    editorialIntent('mets davantage le projet en valeur'),
    'project_first'
  );
  assert.equal(
    editorialIntent('publie immédiatement et rembourse le paiement'),
    null
  );
  const original =
    'Merci à Atelier Boréal\n\nLe projet avance. La livraison est prévue le 23 septembre à https://example.test.\n\nUne communauté unie. Ensemble, nous avançons.\n\nCommandite rémunérée.';
  const short = editorialVariant(original, 'concise', ['Atelier Boréal']);
  assert.ok(short.length < original.length);
  assert.ok(short.includes('23 septembre à https://example.test'));
  assert.ok(short.includes('Atelier Boréal'));
  assert.ok(short.includes('Commandite rémunérée.'));
  assert.ok(
    editorialVariant(original, 'project_first').startsWith('Le projet')
  );
  assert.ok(
    editorialVariant(original, 'neutral').startsWith(
      'Partenaire : Atelier Boréal'
    )
  );
  assert.equal(
    editorialVariant('Un texte déjà court.', 'concise'),
    'Un texte déjà court.'
  );
});
const item = (id, date, status = 'draft', sponsor = id) => ({
  id,
  scheduledAt: date,
  status,
  feedId: 'openg7:facebook',
  version: 1,
  message: id,
  sponsors: [{ id: sponsor }]
});
test('programme protects approved/uncertain decisions, alternates sponsors and exposes capacity gaps', () => {
  const ds = [
    item('a', '2030-01-01T09:00:00Z', 'draft', 'same'),
    item('b', '2030-01-01T10:00:00Z', 'draft', 'same'),
    item('c', '2030-01-01T11:00:00Z'),
    item('fixed', '2030-01-02T09:00:00Z', 'approved'),
    item('unknown', '2030-01-03T09:00:00Z', 'uncertain')
  ];
  const plan = composeProgramme(
    ds,
    [
      '2030-01-02T09:00:00Z',
      '2030-01-03T09:00:00Z',
      '2030-01-04T09:00:00Z',
      '2030-01-05T09:00:00Z'
    ],
    []
  );
  assert.deepEqual(
    plan.moves.map((m) => m.id),
    ['a', 'c']
  );
  assert.deepEqual(plan.warnings.find((w) => w.code === 'unplaced').ids, ['b']);
  assert.ok(!plan.moves.some((m) => ['fixed', 'unknown'].includes(m.id)));
  assert.ok(
    !composeProgramme(ds, ['2030-01-06T09:00:00Z'], ['a']).moves.some(
      (m) => m.id === 'a'
    )
  );
});
test('conflicts and repetition are scoped to a destination', () => {
  const a = item('a', '2030-01-01T09:00:00Z'),
    b = { ...item('b', '2030-01-01T09:20:00Z'), message: 'a' };
  assert.deepEqual(
    programmeWarnings([a, b], []).map((w) => w.code),
    ['collision', 'repetition']
  );
  assert.deepEqual(
    programmeWarnings([a, { ...b, feedId: 'openg7:linkedin' }], []),
    []
  );
});
