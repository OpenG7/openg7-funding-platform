import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parsePreparationSelection,
  projectPreparationPlan
} from '../dist/apps/funding-api/src/admin-preparation-plan.js';
import { createDefaultDraftText } from '../dist/apps/funding-api/src/fund-publication-content.js';
import { createAdminAutomaticRunsHttpHandler } from '../dist/apps/funding-api/src/admin-automatic-runs.http.js';

const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const now = new Date('2026-11-25T12:00:00Z');
const fact = (extra = {}) => ({
  id,
  reference: 'SYNTHETIC',
  sourceVersion: 'v1',
  obligationId: id,
  obligationVersion: 1,
  ordinal: 1,
  channel: 'facebook',
  target: 'openg7',
  eligible: true,
  existing: false,
  refused: false,
  uncertain: false,
  sponsor_company_name: 'Synthetic',
  sponsor_website_url: null,
  sponsor_logo_url: null,
  sponsor_public_summary: 'Synthetic public text',
  sponsor_message: null,
  ...extra
});
test('preview reuses native defaults and counts preserved and blocked passages separately', () => {
  const source = fact();
  const plan = projectPreparationPlan(
    [
      source,
      source,
      fact({ id: other, obligationId: other, existing: true }),
      fact({ obligationId: 'refused', refused: true }),
      fact({ obligationId: 'uncertain', uncertain: true })
    ],
    now
  );
  assert.equal(plan.missingPassages, 1);
  assert.equal(plan.preservedPassages, 1);
  assert.equal(plan.blockedPassages, 2);
  assert.equal(plan.items.length, 1);
  assert.equal(plan.minutesSaved, null);
  const draft = plan.items[0].drafts[0];
  for (const key of ['title', 'body', 'disclosureText'])
    assert.equal(
      draft[key],
      createDefaultDraftText(source, 'openg7', 'facebook')[key]
    );
});
test('all dossier source versions and exact passages determine the preview fingerprint', () => {
  const base = projectPreparationPlan([fact()], now).items[0];
  for (const change of [
    { sourceVersion: 'v2' },
    { obligationVersion: 2 },
    { ordinal: 2 },
    { target: 'openg20' },
    { sponsor_public_summary: 'Changed text' }
  ])
    assert.notEqual(
      projectPreparationPlan([fact(change)], now).items[0].version,
      base.version
    );
  assert.equal(
    projectPreparationPlan([fact()], new Date()).items[0].version,
    base.version
  );
  assert.equal(
    projectPreparationPlan([fact({ existing: true })], now).items.length,
    0
  );
});
test('preview is bounded, counts the complete observed next-passage population and never emits guessed savings', () => {
  const facts = Array.from({ length: 25 }, (_, n) =>
    fact({ id: String(n).padStart(3, '0'), obligationId: String(n) })
  );
  const plan = projectPreparationPlan(facts, now);
  assert.equal(plan.items.length, 20);
  assert.equal(plan.candidateDossiers, 25);
  assert.equal(plan.hasMore, true);
  assert.equal(plan.missingPassages, 25);
  assert.equal(projectPreparationPlan([], now).hasMore, false);
  assert.equal(
    projectPreparationPlan([fact({ eligible: false })], now).blockedPassages,
    1
  );
});
test('selection requires unique exact UUID/version pairs and preserves legacy requests', () => {
  assert.equal(parsePreparationSelection(undefined), undefined);
  const version = 'a'.repeat(64);
  assert.deepEqual(
    parsePreparationSelection([
      { contributionId: other, version },
      { contributionId: id.toUpperCase(), version }
    ]),
    [
      { contributionId: id, version },
      { contributionId: other, version }
    ]
  );
  for (const raw of [
    null,
    [],
    {},
    [{ contributionId: id, version: 'bad' }],
    [{ contributionId: 'bad', version }],
    [{ contributionId: id, version, extra: true }],
    [
      { contributionId: id, version },
      { contributionId: id, version }
    ],
    Array(21).fill({ contributionId: id, version })
  ])
    assert.throws(() => parsePreparationSelection(raw), {
      code: 'RUN_INVALID_REQUEST'
    });
});
test('plan HTTP is private read-only, rejects unexpected input and authorizes before owner reads', async () => {
  let allowed = true,
    reads = 0;
  const responses = [];
  const headers = [];
  const handler = createAdminAutomaticRunsHttpHandler({
    publicBaseOrigin: 'https://synthetic.invalid',
    ensureAdminAccess: () => allowed,
    getAdminAuditActor: () => 'synthetic-admin',
    readBody: () => assert.fail('no body read'),
    writeJson: (_q, _s, status, body) => responses.push({ status, body }),
    automaticRuns: {
      preparationPlan: async () => {
        reads++;
        return projectPreparationPlan([], now);
      }
    }
  });
  const res = { setHeader: (...args) => headers.push(args) };
  const request = (method, url) => handler({ method, url, headers: {} }, res);
  await request('GET', '/api/admin/automatic-runs/preparation-plan');
  assert.equal(reads, 1);
  assert.equal(responses.at(-1).status, 200);
  await request('GET', '/admin/automatic-runs/preparation-plan?limit=1000');
  assert.equal(responses.at(-1).status, 400);
  assert.equal(reads, 1);
  await request('POST', '/admin/automatic-runs/preparation-plan');
  assert.equal(responses.at(-1).status, 405);
  assert.equal(reads, 1);
  allowed = false;
  await request('GET', '/admin/automatic-runs/preparation-plan');
  assert.equal(reads, 1);
  assert.ok(
    headers.some(
      ([name, value]) =>
        name === 'Cache-Control' && value === 'private, no-store'
    )
  );
});
