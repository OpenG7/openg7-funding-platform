import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

// The root build emits the public workspace under dist/packages.
const coreUrl = new URL(
  '../dist/packages/funding-core/src/index.js',
  import.meta.url
).href;
const workspaceResolution = registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier === '@openg7/funding-core'
      ? { url: coreUrl, shortCircuit: true }
      : nextResolve(specifier, context);
  }
});
let isPublicProgressReport;
let publicProgressAllocations;
let publicAllocationReference;
try {
  ({
    isPublicProgressReport,
    publicProgressAllocations,
    publicAllocationReference
  } =
    await import('../dist/apps/funding-web/src/app/features/funding/models/public-progress.utils.js'));
} finally {
  workspaceResolution.deregister();
}

const allocation = (patch = {}) => ({
  project_name: 'Synthetic public initiative',
  public_description: 'A published description of the planned work.',
  expected_outcome: 'An explicitly declared expected outcome.',
  progress_status: 'planned',
  proof_url: 'https://example.invalid/public-proof?version=1#details',
  proof_source: 'Synthetic public demonstration',
  proof_published_at: '2026-11-01T12:00:00.000Z',
  amount_allocated: 42.5,
  currency: 'CAD',
  status: 'published',
  published_at: '2026-11-02T12:00:00.000Z',
  ...patch
});

const report = (allocations = [allocation()], patch = {}) => ({
  data_source: 'database',
  total_received: 100,
  total_fees: 2,
  total_net: 98,
  total_refunded: 0,
  total_payouts: 0,
  current_available_estimate: 98,
  contributions_count: 1,
  pending_fee_count: 0,
  currency: 'CAD',
  monthly_summary: [],
  latest_public_allocations: allocations,
  public_builders: [],
  last_updated_at: '2026-11-03T12:00:00.000Z',
  generated_at: '2026-11-03T12:00:01.000Z',
  ...patch
});

test('public visibility and declared progress remain independent', () => {
  for (const status of ['published', 'active'])
    for (const progress_status of ['planned', 'in_progress', 'delivered']) {
      const source = allocation({ status, progress_status });
      const value = report([source]);
      assert.equal(isPublicProgressReport(value), true);
      assert.deepEqual(publicProgressAllocations(value), [source]);
    }
});

test('a malformed financial report is unavailable before its allocations are projected', () => {
  for (const value of [
    null,
    {},
    report([], { total_received: null }),
    report([], { current_available_estimate: Infinity }),
    report([], { generated_at: 'invalid' })
  ])
    assert.equal(isPublicProgressReport(value), false);
});

test('one invalid allocation rejects the report instead of presenting a partial publication', () => {
  for (const patch of [
    { project_name: '' },
    { project_name: null },
    { public_description: null },
    { expected_outcome: undefined },
    { status: 'draft' },
    { status: 'private' },
    { status: 'archived' },
    { status: 'completed' },
    { progress_status: 'completed' },
    { progress_status: 'active' },
    { progress_status: null },
    { amount_allocated: '42.50' },
    { amount_allocated: NaN },
    { amount_allocated: Infinity },
    { amount_allocated: -1 },
    { currency: 'cad' },
    { currency: null },
    { proof_url: false },
    { proof_source: 42 },
    { proof_published_at: 'invalid' },
    { published_at: 'invalid' },
    { published_at: undefined }
  ])
    assert.equal(
      isPublicProgressReport(report([allocation(), allocation(patch)])),
      false,
      Object.keys(patch).join(',')
    );
  for (const invalid of [null, [], 'public work'])
    assert.equal(isPublicProgressReport(report([invalid])), false);
});

test('only explicit public fields are copied without mutating the received allocation', () => {
  const publicFields = allocation();
  const received = Object.freeze({
    ...publicFields,
    id: 'synthetic-private-id',
    notes_admin: 'Synthetic private note',
    email_private: 'private@example.invalid',
    internal_proof: { token: 'synthetic-private-token' }
  });
  const value = report(Object.freeze([received]));
  const projected = publicProgressAllocations(value);
  assert.deepEqual(projected, [publicFields]);
  assert.notEqual(projected[0], received);
  assert.doesNotMatch(JSON.stringify(projected), /private|notes_admin|token/);
  assert.equal(received.notes_admin, 'Synthetic private note');
});

test('server order and supplied monetary units remain unchanged', () => {
  const rows = [
    allocation({
      project_name: 'Last in calendar',
      progress_status: 'delivered'
    }),
    allocation({ project_name: 'First in calendar', published_at: null }),
    allocation({
      project_name: 'In progress',
      progress_status: 'in_progress',
      amount_allocated: 0,
      currency: 'USD'
    })
  ];
  const value = report(rows);
  assert.equal(isPublicProgressReport(value), true);
  assert.deepEqual(publicProgressAllocations(value), rows);
});

test('a safe HTTPS proof keeps its public source and date while surrounding whitespace is trimmed', () => {
  const source = allocation({
    proof_url: '  https://example.invalid/proof?v=1#demo  '
  });
  const value = report([source]);
  assert.equal(isPublicProgressReport(value), true);
  assert.deepEqual(publicProgressAllocations(value)[0], {
    ...source,
    proof_url: 'https://example.invalid/proof?v=1#demo'
  });
});

test('public references trim admissible links and sources without mutating their source', () => {
  const received = Object.freeze({
    proof_url: '  https://example.invalid/reference?v=1#details  ',
    proof_source: '  Synthetic public source  ',
    proof_published_at: '2026-11-01T12:00:00.000Z',
    notes_admin: 'Synthetic private note'
  });
  assert.deepEqual(publicAllocationReference(received), {
    proof_url: 'https://example.invalid/reference?v=1#details',
    proof_source: 'Synthetic public source',
    proof_published_at: received.proof_published_at
  });
  assert.equal(received.proof_source, '  Synthetic public source  ');
  assert.equal(received.proof_url.startsWith('  '), true);
});

test('an admissible reference keeps its link when its source is blank or its publication date is invalid', () => {
  for (const proof_source of [null, '', ' \t\n '])
    for (const proof_published_at of [null, '', 'invalid']) {
      const source = {
        proof_url: 'https://example.invalid/reference',
        proof_source,
        proof_published_at
      };
      assert.deepEqual(publicAllocationReference(source), {
        proof_url: source.proof_url,
        proof_source: null,
        proof_published_at: null
      });
    }
  assert.deepEqual(
    publicAllocationReference({
      proof_url: 'https://example.invalid/reference',
      proof_source: 'Synthetic public source',
      proof_published_at: 'invalid'
    }),
    {
      proof_url: 'https://example.invalid/reference',
      proof_source: 'Synthetic public source',
      proof_published_at: null
    }
  );
  const invalidReport = report([allocation({ proof_published_at: 'invalid' })]);
  assert.equal(isPublicProgressReport(invalidReport), false);
});

test('an absent or inadmissible public reference clears all metadata', () => {
  for (const proof_url of [
    null,
    '',
    '  ',
    'http://example.invalid/reference',
    'https://synthetic:private@example.invalid/reference',
    'https://synthetic@example.invalid/reference',
    'javascript:alert(1)',
    '//example.invalid/reference',
    '/relative-reference'
  ]) {
    const source = Object.freeze({
      proof_url,
      proof_source: 'Synthetic source to withhold',
      proof_published_at: '2026-11-01T12:00:00.000Z'
    });
    assert.deepEqual(publicAllocationReference(source), {
      proof_url: null,
      proof_source: null,
      proof_published_at: null
    });
    assert.equal(source.proof_url, proof_url);
  }
});

test('an unsafe proof loses its link, source and date without rewriting declared delivery', () => {
  for (const proof_url of [
    'http://example.invalid/proof',
    'https://synthetic:private@example.invalid/proof',
    'https://synthetic@example.invalid/proof',
    'javascript:alert(1)',
    'data:text/html,synthetic',
    '//example.invalid/proof',
    '/private/proof',
    'not a URL',
    'https://example.invalid/' + 'a'.repeat(2048)
  ]) {
    const source = allocation({ progress_status: 'delivered', proof_url });
    const value = report([source]);
    assert.equal(isPublicProgressReport(value), true);
    assert.deepEqual(publicProgressAllocations(value)[0], {
      ...source,
      proof_url: null,
      proof_source: null,
      proof_published_at: null
    });
    assert.equal(source.proof_url, proof_url);
  }
});

test('an absent proof never leaves source or date metadata suggesting a published proof', () => {
  for (const proof_url of [null, '', '   ']) {
    const source = allocation({ progress_status: 'delivered', proof_url });
    const projected = publicProgressAllocations(report([source]))[0];
    assert.equal(projected.progress_status, 'delivered');
    assert.equal(projected.proof_url, null);
    assert.equal(projected.proof_source, null);
    assert.equal(projected.proof_published_at, null);
  }
});

test('empty and Stripe-direct reports never supply public progress allocations', () => {
  for (const data_source of ['empty', 'stripe_direct']) {
    const value = report([allocation()], { data_source });
    assert.equal(isPublicProgressReport(value), true);
    assert.deepEqual(publicProgressAllocations(value), []);
  }
  assert.equal(isPublicProgressReport(report([])), true);
  assert.deepEqual(publicProgressAllocations(report([])), []);
});

test('optional text and dates remain absent without invented publication or verification facts', () => {
  const source = allocation({
    public_description: '',
    expected_outcome: '',
    proof_url: null,
    proof_source: null,
    proof_published_at: null,
    published_at: null
  });
  const value = report([source]);
  assert.equal(isPublicProgressReport(value), true);
  assert.deepEqual(publicProgressAllocations(value), [source]);
});
